# Camera (AVFoundation)

Template: `templates/CameraService.swift`, `templates/CameraPreview.swift`.

## Setup sequence

1. `AVCaptureDevice.authorizationStatus(for: .video)`; if `.notDetermined`, `await AVCaptureDevice.requestAccess(for: .video)`.
2. Pick device:
   ```swift
   AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
   ```
   iPad front cameras with Center Stage are ultra-wide; consider
   `AVCaptureDevice.centerStageControlMode = .cooperative` and let the operator
   toggle `isCenterStageEnabled` — Center Stage keeps groups framed, which is great for booths.
3. `session.sessionPreset = .photo`, add `AVCaptureDeviceInput` and `AVCapturePhotoOutput`
   inside `beginConfiguration()/commitConfiguration()`.
4. `photoOutput.maxPhotoQualityPrioritization = .quality` (but capture with `.balanced`
   for faster shot-to-shot time).
5. `startRunning()` on the session queue, never main.

## Rotation (iOS 17+)

```swift
let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
// preview:
previewLayer.connection?.videoRotationAngle = coordinator.videoRotationAngleForHorizonLevelPreview
// capture (set right before each capture):
photoOutput.connection(with: .video)?.videoRotationAngle = coordinator.videoRotationAngleForHorizonLevelCapture
```
Observe `videoRotationAngleForHorizonLevelPreview` with KVO to update on rotation.

## Mirroring

- Preview: `previewLayer.connection?.automaticallyAdjustsVideoMirroring = false; isVideoMirrored = true`.
- Saved photo: the photo output connection is not mirrored by default for the front
  camera on capture; set `connection.isVideoMirrored = config.mirrorSavedPhotos`
  (requires `automaticallyAdjustsVideoMirroring = false` first).

## Capture

Wrap the delegate in a continuation:

```swift
func capturePhoto() async throws -> Data {
    try await withCheckedThrowingContinuation { cont in
        sessionQueue.async {
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            settings.photoQualityPrioritization = .balanced
            settings.flashMode = .off   // front camera: use screen flash instead
            let delegate = PhotoCaptureDelegate(continuation: cont)
            self.inFlight[settings.uniqueID] = delegate   // keep strong ref!
            self.photoOutput.capturePhoto(with: settings, delegate: delegate)
        }
    }
}
```

Forgetting to retain the delegate is the #1 bug — capture silently never completes.

## Screen flash

Front cameras have no flash. On capture, overlay a full-screen white view at 100%
opacity and set `UIScreen.main.brightness = 1.0` for ~0.3 s *before* triggering
capture; restore after. Make it optional in config.

## Interruptions

Observe `AVCaptureSession.wasInterruptedNotification` / `interruptionEndedNotification`
and `.runtimeErrorNotification`; on `mediaServicesWereReset` restart the session.
Multitasking (Split View / Slide Over) interrupts the camera on many iPads — Guided
Access prevents this at events.

## Simulator

There is no camera in the Simulator. For UI work, add a `#if targetEnvironment(simulator)`
fake that returns bundled sample images, so the state machine and compositing can be developed there.
