@preconcurrency import AVFoundation
import UIKit

enum CameraError: LocalizedError {
    case notAuthorized, noDevice, cannotAddInput, cannotAddOutput, captureFailed

    var errorDescription: String? {
        switch self {
        case .notAuthorized: "Camera access is turned off. Enable it in Settings."
        case .noDevice: "No camera found."
        case .cannotAddInput, .cannotAddOutput: "Couldn't configure the camera."
        case .captureFailed: "The photo couldn't be taken. Let's try again."
        }
    }
}

/// Owns the AVCaptureSession. All session work happens on `sessionQueue`.
final class CameraService: NSObject, @unchecked Sendable {
    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "photobooth.camera.session")
    private var device: AVCaptureDevice?
    private var isConfigured = false
    private var inFlight: [Int64: PhotoCaptureDelegate] = [:]   // strong refs to delegates
    private var pendingPreviewLayer: AVCaptureVideoPreviewLayer?
    private var rotationObservation: NSKeyValueObservation?

    /// Set by CameraPreview once the preview layer exists; used for rotation.
    private(set) var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    var mirrorSavedPhotos = false

    var position: AVCaptureDevice.Position = .front

    // MARK: Authorization

    static func requestAuthorization() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    // MARK: Lifecycle

    func start() async {
        guard await Self.requestAuthorization() else { return }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            sessionQueue.async {
                if !self.isConfigured { try? self.configure() }
                if !self.session.isRunning { self.session.startRunning() }
                cont.resume()
            }
        }
    }

    func stop() async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            sessionQueue.async {
                if self.session.isRunning { self.session.stopRunning() }
                cont.resume()
            }
        }
    }

    private func configure() throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
        else { throw CameraError.noDevice }
        self.device = device

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw CameraError.cannotAddInput }
        session.addInput(input)

        guard session.canAddOutput(photoOutput) else { throw CameraError.cannotAddOutput }
        session.addOutput(photoOutput)
        photoOutput.maxPhotoQualityPrioritization = .quality

        // Center Stage keeps groups framed on supported iPads; operator can toggle it.
        AVCaptureDevice.centerStageControlMode = .cooperative

        isConfigured = true
        if let layer = pendingPreviewLayer { setUpRotation(for: layer) }
    }

    /// Called from the preview once its layer exists.
    func attachPreviewLayer(_ layer: AVCaptureVideoPreviewLayer) {
        sessionQueue.async { self.setUpRotation(for: layer) }
    }

    /// Must run on sessionQueue. Defers until the device exists.
    private func setUpRotation(for layer: AVCaptureVideoPreviewLayer) {
        pendingPreviewLayer = layer
        guard let device else { return }
        let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: layer)
        rotationCoordinator = coordinator
        let mirrored = (position == .front)
        DispatchQueue.main.async {
            guard let connection = layer.connection else { return }
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = mirrored
            connection.videoRotationAngle = coordinator.videoRotationAngleForHorizonLevelPreview
        }
        // Keep the preview upright when the iPad rotates.
        rotationObservation = coordinator.observe(
            \.videoRotationAngleForHorizonLevelPreview, options: [.new]
        ) { coord, _ in
            let angle = coord.videoRotationAngleForHorizonLevelPreview
            DispatchQueue.main.async { layer.connection?.videoRotationAngle = angle }
        }
    }

    // MARK: Capture

    /// Captures one JPEG and returns its data.
    func capturePhoto() async throws -> Data {
        try await withCheckedThrowingContinuation { cont in
            sessionQueue.async {
                guard self.session.isRunning,
                      let connection = self.photoOutput.connection(with: .video)
                else { cont.resume(throwing: CameraError.captureFailed); return }

                if let angle = self.rotationCoordinator?.videoRotationAngleForHorizonLevelCapture,
                   connection.isVideoRotationAngleSupported(angle) {
                    connection.videoRotationAngle = angle
                }
                if connection.isVideoMirroringSupported {
                    connection.automaticallyAdjustsVideoMirroring = false
                    connection.isVideoMirrored = self.mirrorSavedPhotos
                }

                let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                settings.photoQualityPrioritization = .balanced   // faster shot-to-shot

                let id = settings.uniqueID
                let delegate = PhotoCaptureDelegate { [weak self] result in
                    self?.sessionQueue.async { self?.inFlight[id] = nil }
                    cont.resume(with: result)
                }
                self.inFlight[id] = delegate
                self.photoOutput.capturePhoto(with: settings, delegate: delegate)
            }
        }
    }
}

private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let completion: (Result<Data, Error>) -> Void
    init(completion: @escaping (Result<Data, Error>) -> Void) { self.completion = completion }

    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        if let error { completion(.failure(error)); return }
        guard let data = photo.fileDataRepresentation() else {
            completion(.failure(CameraError.captureFailed)); return
        }
        completion(.success(data))
    }
}
