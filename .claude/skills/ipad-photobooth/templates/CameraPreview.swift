import AVFoundation
import SwiftUI

/// Live, mirrored camera preview that follows device rotation.
struct CameraPreview: UIViewRepresentable {
    let camera: CameraService

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = camera.session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.camera = camera
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        weak var camera: CameraService?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            // CameraService sets up mirroring + rotation (deferred until the camera is configured).
            if window != nil { camera?.attachPreviewLayer(previewLayer) }
        }
    }
}
