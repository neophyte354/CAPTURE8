# Kiosk hardening for events

## Lock the iPad to the app

- **Guided Access** (no MDM needed): Settings → Accessibility → Guided Access → On, set
  passcode; open the app, triple-click side/home button → Start. Disable touch on
  areas like the admin button if desired. Give the operator these steps in the README.
- **Single App Mode / Autonomous Single App Mode** requires a supervised device via MDM
  (Apple Configurator / Jamf). Mention only for rental fleets.
- `UIApplication.shared.isIdleTimerDisabled = true` while the app is active, so the screen never sleeps.
- Hide status bar (`.statusBarHidden()`), set `.persistentSystemOverlays(.hidden)` to
  minimise the home indicator, and `.defersSystemGestures(on: .all)`.

## Admin panel

- Hidden entry: long-press 3 s on the logo corner, or 5 taps → PIN pad.
- Contents: config editor (shots, countdown, layout, title, filters), printer picker,
  test print, prints counter, storage usage, "export all photos" (share sheet zip),
  "delete all sessions", camera selection, Center Stage toggle, app version.

## Self-healing

- Every non-idle state has a timeout back to `.idle`.
- On `scenePhase == .active`, restart camera session if not running.
- On memory warning, drop thumbnail caches.
- Catch and display errors as friendly "Oops, let's try again" screens that auto-dismiss.
- Log events (session start/end, print success/failure) to a local file viewable in admin.

## Storage & retention

- Sessions in `Documents/Sessions/<yyyy-MM-dd>/<uuid>/`.
- On launch and every hour, delete sessions older than `retentionDays` (unless operator disables).
- Warn in admin if free space < 1 GB (`volumeAvailableCapacityForImportantUsage`).
- Enable "File Sharing" (`UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`) so
  the operator can copy photos off via Finder/Files after the event.

## Hardware tips to tell the operator

- Keep the iPad plugged in; use a stand at eye level (~150–160 cm), landscape.
- Soft front light (ring light / softbox) matters more than any filter.
- Test the full flow + print 10 times before guests arrive.
