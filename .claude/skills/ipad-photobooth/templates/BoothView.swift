import SwiftUI

struct BoothView: View {
    @Bindable var model: BoothViewModel
    @State private var printing = false
    @State private var printMessage: String?

    var body: some View {
        ZStack {
            CameraPreview(camera: model.camera)
                .ignoresSafeArea()

            content
                .animation(.easeInOut(duration: 0.25), value: model.state)

            if model.flash {
                Color.white.ignoresSafeArea().transition(.opacity)
            }
        }
        .onAppear { model.purgeOldSessions() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle:
            VStack(spacing: 24) {
                Spacer()
                Text(model.config.eventTitle)
                    .font(.system(size: 64, weight: .heavy))
                    .shadow(radius: 8)
                Button(action: model.startSession) {
                    Text("Tap to start")
                        .font(.system(size: 44, weight: .bold))
                        .padding(.horizontal, 60).padding(.vertical, 28)
                        .background(.pink, in: Capsule())
                }
                .buttonStyle(.plain)
                Spacer().frame(height: 80)
            }
            .foregroundStyle(.white)

        case .countdown(let remaining, let shot):
            VStack {
                Text("Photo \(shot) of \(model.totalShots)")
                    .font(.title.bold())
                    .padding(.top, 40)
                Spacer()
                Text("\(remaining)")
                    .font(.system(size: 280, weight: .black, design: .rounded))
                    .contentTransition(.numericText(countsDown: true))
                    .shadow(radius: 20)
                Spacer()
            }
            .foregroundStyle(.white)

        case .capturing:
            Color.clear

        case .processing:
            ZStack {
                Color.black.opacity(0.6).ignoresSafeArea()
                VStack(spacing: 20) {
                    ProgressView().controlSize(.large).tint(.white)
                    Text("Making your photo strip…").font(.title.bold())
                }
                .foregroundStyle(.white)
            }

        case .review(let result):
            ReviewView(result: result,
                       printing: printing,
                       printMessage: printMessage,
                       enablePrint: model.config.enablePrint,
                       onPrint: { Task { await printResult(result) } },
                       onDone: model.finish)

        case .error(let message):
            VStack(spacing: 20) {
                Text("Oops!").font(.system(size: 64, weight: .heavy))
                Text(message).font(.title2)
                Button("Try again", action: model.finish).font(.title.bold())
            }
            .foregroundStyle(.white)
            .padding(60)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 32))
        }
    }

    private func printResult(_ result: SessionResult) async {
        printing = true
        defer { printing = false }
        do {
            try await PrintService.shared.print(result.composite, jobName: "Photobooth \(result.id)")
            printMessage = "Printing! Pick it up at the printer."
        } catch {
            printMessage = error.localizedDescription
        }
    }
}

private struct ReviewView: View {
    let result: SessionResult
    let printing: Bool
    let printMessage: String?
    let enablePrint: Bool
    let onPrint: () -> Void
    let onDone: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.85).ignoresSafeArea()
            HStack(spacing: 48) {
                AsyncImage(url: result.composite) { image in
                    image.resizable().scaledToFit()
                } placeholder: { ProgressView() }
                .frame(maxHeight: .infinity)
                .shadow(radius: 20)

                VStack(spacing: 24) {
                    if enablePrint {
                        Button(action: onPrint) {
                            Label(printing ? "Printing…" : "Print", systemImage: "printer.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .disabled(printing)
                    }
                    ShareLink(item: result.composite) {
                        Label("AirDrop / Share", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    if let printMessage {
                        Text(printMessage).font(.title3).multilineTextAlignment(.center)
                    }
                    Spacer()
                    Button("Done", action: onDone)
                }
                .font(.title.bold())
                .buttonStyle(.borderedProminent)
                .frame(width: 340)
            }
            .padding(48)
            .foregroundStyle(.white)
        }
    }
}
