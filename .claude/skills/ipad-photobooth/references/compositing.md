# Compositing, templates & filters

Template: `templates/StripCompositor.swift`.

## Print sizes at 300 DPI

| Layout | Inches | Pixels |
|---|---|---|
| Single 4×6 landscape | 6×4 | 1800×1200 |
| 4×6 portrait | 4×6 | 1200×1800 |
| Strip 2×6 | 2×6 | 600×1800 |
| Double strip on 4×6 (cut in half by printer) | 4×6 | 1200×1800 = two 600×1800 strips |
| Square (Instagram) digital only | — | 1080×1080 |

For DNP/Mitsubishi dye-sub printers with "2-inch cut", output the 4×6 double-strip
and let the printer cut. Selphy CP-series prints 4×6 (postcard) without cut.

## Layout definition

Describe layouts as data, not code, so new templates are cheap:

```swift
struct Layout: Codable {
    var canvas: CGSize                 // pixels
    var slots: [CGRect]                // photo rects in canvas pixels
    var overlay: String?               // PNG asset with transparent holes, drawn on top
    var background: String? = "white"  // color name or asset
    var titleRect: CGRect?             // where event title / date goes
}
```

Draw order: background → photos (aspect-fill into each slot, clipped) → overlay PNG → text.
Design the overlay PNG at exactly canvas size with transparent windows matching `slots`.
Give designers a Figma/Canva template at those pixel sizes.

## Aspect-fill a photo into a slot

```swift
func aspectFillRect(for image: CGSize, in slot: CGRect) -> CGRect {
    let scale = max(slot.width / image.width, slot.height / image.height)
    let size = CGSize(width: image.width * scale, height: image.height * scale)
    return CGRect(x: slot.midX - size.width / 2, y: slot.midY - size.height / 2,
                  width: size.width, height: size.height)
}
```
Clip with `UIRectClip(slot)` / `context.cgContext.clip(to:)` inside a `saveGState` block.

## Memory

Decode shots with ImageIO thumbnailing to the slot size instead of loading full-res `UIImage`:

```swift
func downsample(_ url: URL, maxPixel: CGFloat) -> CGImage? {
    let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary)!
    let opts: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
}
```

Use `UIGraphicsImageRendererFormat` with `scale = 1` so pixel sizes are exact, and
`opaque = true` for JPEG output.

## Filters (Core Image)

Reuse a single `CIContext` (expensive to create). Good booth filters:

| Name | Filter |
|---|---|
| B&W classic | `CIPhotoEffectNoir` or `CIPhotoEffectTonal` |
| Vintage | `CIPhotoEffectTransfer` / `CISepiaTone` (intensity 0.6) |
| Warm | `CITemperatureAndTint` |
| Pop | `CIVibrance` (amount 0.6) + slight `CIColorControls` contrast |
| Beauty (soft skin) | light `CIGaussianBlur` blended at low alpha — keep subtle |

Apply filters per shot *before* compositing so frames/logos keep their brand colors.
Show a live filter preview by applying the same filter to the video feed via
`AVCaptureVideoDataOutput` + Metal only if the user explicitly wants it — it's significantly more work.

## Extras users often ask for

- **GIF / Boomerang**: capture a burst (or video via `AVCaptureMovieFileOutput`, 2 s),
  then write frames with `CGImageDestination` (`UTType.gif`) or forward+reverse to MP4 with `AVAssetWriter`.
- **Green screen**: use `VNGeneratePersonSegmentationRequest` (Vision) to mask the person,
  then composite over a background — works without a physical green screen. Use `.balanced` quality.
- **Props / stickers**: overlay draggable PNGs in the review screen and render them into the composite.
