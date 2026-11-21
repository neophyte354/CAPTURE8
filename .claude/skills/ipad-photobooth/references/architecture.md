# Architecture: the booth state machine

A photobooth is a loop. Model it as an explicit state enum owned by one
`@Observable` view model, and let the UI be a pure function of state.

```
        ┌──────────── timeout / done ─────────────┐
        ▼                                          │
     .idle ──tap──▶ .countdown(n) ──0──▶ .capturing(shot i)
                        ▲                    │
                        └── i < total ───────┘
                                             │ i == total
                                             ▼
                                        .processing ──▶ .review(result) ──▶ .output(print/share)
                                                                │
                                                         retake │
                                                                ▼
                                                           .countdown
     any state ──error──▶ .error(message) ──timeout──▶ .idle
```

```swift
enum BoothState: Equatable {
    case idle
    case countdown(remaining: Int, shot: Int)
    case capturing(shot: Int)
    case processing
    case review(SessionResult)
    case error(String)
}
```

## Rules

- **One source of truth**: only `BoothViewModel` mutates state, always on the `@MainActor`.
- **Cancellable flow**: run the session as a single `Task` stored in the view model;
  cancelling it (admin abort, app backgrounding) must return to `.idle` cleanly.
- **Timeouts per state**: `review` → 45 s, `error` → 10 s, back to `.idle`.
  Implement with a `Task.sleep` that is cancelled when state changes.
- **Inter-shot pause**: show the just-taken photo for ~1.5 s between shots, so people can re-pose.
- **Session model**:
  ```swift
  struct SessionResult: Equatable, Identifiable {
      let id: UUID
      let shots: [URL]        // individual JPEGs on disk
      let composite: URL      // final print-ready JPEG
      let createdAt: Date
  }
  ```
  Write images to disk immediately; keep only URLs and small thumbnails in memory.

## Configuration

Put event settings in a `Codable` `BoothConfig` stored as JSON in Documents so an
operator can change them from the admin panel without rebuilding:

```swift
struct BoothConfig: Codable {
    var shotsPerSession = 4
    var countdownSeconds = 3
    var layout: Layout = .doubleStrip4x6
    var mirrorSavedPhotos = false
    var eventTitle = "My Event"
    var overlayAssetName: String? = "frame"
    var enablePrint = true
    var copiesPerPrint = 1
    var shareBaseURL: URL? = nil      // where uploads become downloadable
    var adminPIN = "1234"
    var retentionDays = 7
}
```

## Concurrency notes

- `CameraService` is an `actor`-like class with its own serial `DispatchQueue` for
  `AVCaptureSession`; expose `async` methods (`start()`, `capturePhoto() async throws -> Data`).
- Compositing runs off the main actor (`Task.detached(priority: .userInitiated)`).
- UI updates happen only by assigning to `state` on the main actor.
