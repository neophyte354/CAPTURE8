# Printing & sharing

Templates: `templates/PrintService.swift`, `templates/QRCode.swift`.

## AirPrint

```swift
let info = UIPrintInfo(dictionary: nil)
info.outputType = .photo
info.orientation = .portrait
info.jobName = "Photobooth \(session.id)"
let pic = UIPrintInteractionController.shared
pic.printInfo = info
pic.printingItem = compositeURL
```

- **Kiosk mode (no dialog)**: let the operator pick the printer once in the admin
  panel with `UIPrinterPickerController`, store `printer.url`, then for each job:
  `UIPrinter(url:)` → `contactPrinter` → `pic.print(to: printer)`. Guests never see the iOS print sheet.
- Paper size: implement `UIPrintInteractionControllerDelegate.printInteractionController(_:choosePaper:)`
  and return `UIPrintPaper.bestPaper(forPageSize:withPapersFrom:)` for 4×6 in points (288×432).
- Not all dye-sub printers support AirPrint. Options: printer with AirPrint (Canon Selphy CP1500,
  some DNP with WPS-1 / Wi‑Fi box), or a small print server (Mac/PC/Raspberry Pi) receiving
  the JPEG over HTTP on the local network and printing with the vendor driver. Tell the user
  which option they're on — it changes the code.
- Handle: printer offline (`contactPrinter` returns false), job failure in the completion
  handler, out-of-paper (usually only visible via printer status — show "ask staff" message).
- Count prints per session; enforce `copiesPerPrint` limit to save media.

## Sharing options

| Method | Needs network? | Notes |
|---|---|---|
| AirDrop / Share sheet | No (AirDrop) | `ShareLink(item: compositeURL)`; guest must be near iPad |
| QR code → download page | Yes | Upload JPEG to storage (S3/Cloudflare R2/Firebase Storage), show QR of the public URL |
| Email / SMS | Yes | Queue and send via backend; requires collecting contact info → consent text |
| Save to iPad Photos | No | Operator's gallery for later; `PHPhotoLibrary.shared().performChanges` |

### QR upload flow

1. After compositing, start upload in background (`URLSession` background config so it
   survives app suspension).
2. Show the QR immediately using a pre-assigned URL (`shareBaseURL/<session-id>.jpg`) so
   guests don't wait; the page can show "processing" until the upload finishes.
3. If offline, queue uploads in a persisted list and retry when `NWPathMonitor` reports connectivity.
4. **Never embed long-lived cloud secrets in the app.** Have a tiny backend issue
   pre-signed upload URLs per session.

### QR generation

```swift
let filter = CIFilter.qrCodeGenerator()
filter.message = Data(url.absoluteString.utf8)
filter.correctionLevel = "M"
let scaled = filter.outputImage!.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
```
Render with `.interpolation(.none)` in SwiftUI so it stays sharp.
