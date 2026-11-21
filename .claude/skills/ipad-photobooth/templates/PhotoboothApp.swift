import SwiftUI

@main
struct PhotoboothApp: App {
    @State private var model = BoothViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            BoothView(model: model)
                .statusBarHidden()
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)
                .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                UIApplication.shared.isIdleTimerDisabled = true
                Task { await model.camera.start() }
            case .background:
                model.cancelSession()
                Task { await model.camera.stop() }
            default:
                break
            }
        }
    }
}
