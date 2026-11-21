import Observation
import UIKit

struct SessionResult: Equatable, Identifiable {
    let id: UUID
    let shots: [URL]
    let composite: URL
    let createdAt: Date
}

enum BoothState: Equatable {
    case idle
    case countdown(remaining: Int, shot: Int)
    case capturing(shot: Int)
    case processing
    case review(SessionResult)
    case error(String)
}

struct BoothConfig: Codable {
    var shotsPerSession = 4
    var countdownSeconds = 3
    var mirrorSavedPhotos = false
    var eventTitle = "My Event"
    var overlayAssetName: String? = nil
    var enablePrint = true
    var reviewTimeoutSeconds = 45
    var errorTimeoutSeconds = 8
    var retentionDays = 7
}

@MainActor
@Observable
final class BoothViewModel {
    let camera = CameraService()
    var config = BoothConfig()
    private(set) var state: BoothState = .idle
    private(set) var lastShot: UIImage?
    private(set) var flash = false

    private var sessionTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private let compositor = StripCompositor()

    var totalShots: Int { config.shotsPerSession }

    // MARK: Flow

    func startSession() {
        guard state == .idle else { return }
        sessionTask?.cancel()
        sessionTask = Task { await runSession() }
    }

    func cancelSession() {
        sessionTask?.cancel()
        sessionTask = nil
        set(.idle)
    }

    func finish() { cancelSession() }

    private func runSession() async {
        camera.mirrorSavedPhotos = config.mirrorSavedPhotos
        let id = UUID()
        let dir = Self.sessionDirectory(id)
        var shots: [URL] = []

        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

            for shot in 1...totalShots {
                for n in stride(from: config.countdownSeconds, through: 1, by: -1) {
                    set(.countdown(remaining: n, shot: shot))
                    try await Task.sleep(for: .seconds(1))
                }
                set(.capturing(shot: shot))
                await screenFlash()
                let data = try await camera.capturePhoto()
                let url = dir.appendingPathComponent("shot-\(shot).jpg")
                try data.write(to: url)
                shots.append(url)
                lastShot = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 800, height: 800))
                if shot < totalShots { try await Task.sleep(for: .seconds(1.5)) }
            }

            set(.processing)
            let compositeURL = dir.appendingPathComponent("composite.jpg")
            let layout = StripCompositor.Layout.doubleStrip4x6(shots: totalShots)
            let title = config.eventTitle
            let overlay = config.overlayAssetName
            let compositor = self.compositor
            let shotURLs = shots
            try await Task.detached(priority: .userInitiated) {
                try compositor.render(shots: shotURLs, layout: layout, title: title,
                                      overlayAssetName: overlay, to: compositeURL)
            }.value

            let result = SessionResult(id: id, shots: shots, composite: compositeURL, createdAt: .now)
            set(.review(result))
        } catch is CancellationError {
            set(.idle)
        } catch {
            set(.error(error.localizedDescription))
        }
    }

    // MARK: Helpers

    private func set(_ newState: BoothState) {
        state = newState
        timeoutTask?.cancel()
        let seconds: Int?
        switch newState {
        case .review: seconds = config.reviewTimeoutSeconds
        case .error: seconds = config.errorTimeoutSeconds
        default: seconds = nil
        }
        guard let seconds else { return }
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.state = .idle
        }
    }

    private func screenFlash() async {
        flash = true
        try? await Task.sleep(for: .milliseconds(150))
        flash = false
    }

    static func sessionDirectory(_ id: UUID) -> URL {
        let day = Date.now.formatted(.iso8601.year().month().day())
        return URL.documentsDirectory
            .appendingPathComponent("Sessions")
            .appendingPathComponent(day)
            .appendingPathComponent(id.uuidString)
    }

    /// Deletes session folders older than `retentionDays`. Call on launch.
    func purgeOldSessions() {
        let root = URL.documentsDirectory.appendingPathComponent("Sessions")
        let cutoff = Calendar.current.date(byAdding: .day, value: -config.retentionDays, to: .now)!
        let fm = FileManager.default
        guard let days = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey])
        else { return }
        for day in days {
            let created = (try? day.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .now
            if created < cutoff { try? fm.removeItem(at: day) }
        }
    }
}
