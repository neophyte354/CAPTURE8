import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Renders captured shots into a print-ready JPEG at exact pixel size (300 DPI).
struct StripCompositor: Sendable {

    struct Layout: Sendable {
        var canvas: CGSize
        var slots: [CGRect]
        var titleRects: [CGRect]
        var background: UIColor = .white

        /// 4×6" portrait (1200×1800 px) containing two identical 2×6" strips,
        /// for dye-sub printers with a 2" cut option.
        static func doubleStrip4x6(shots: Int) -> Layout {
            let canvas = CGSize(width: 1200, height: 1800)
            let stripWidth: CGFloat = 600
            let margin: CGFloat = 40
            let titleHeight: CGFloat = 220
            let gap: CGFloat = 24
            let photoWidth = stripWidth - margin * 2
            let available = canvas.height - margin * 2 - titleHeight - gap * CGFloat(shots - 1)
            let photoHeight = min(available / CGFloat(shots), photoWidth * 0.75)

            var slots: [CGRect] = []
            var titles: [CGRect] = []
            for strip in 0..<2 {
                let x = CGFloat(strip) * stripWidth + margin
                for i in 0..<shots {
                    let y = margin + CGFloat(i) * (photoHeight + gap)
                    slots.append(CGRect(x: x, y: y, width: photoWidth, height: photoHeight))
                }
                titles.append(CGRect(x: x, y: canvas.height - margin - titleHeight,
                                     width: photoWidth, height: titleHeight))
            }
            return Layout(canvas: canvas, slots: slots, titleRects: titles)
        }

        /// Single 6×4" landscape postcard (1800×1200 px), shots in a grid.
        static func postcard4x6(shots: Int) -> Layout {
            let canvas = CGSize(width: 1800, height: 1200)
            let margin: CGFloat = 50, gap: CGFloat = 30, titleHeight: CGFloat = 160
            let cols = shots <= 2 ? shots : 2
            let rows = Int(ceil(Double(shots) / Double(cols)))
            let w = (canvas.width - margin * 2 - gap * CGFloat(cols - 1)) / CGFloat(cols)
            let h = (canvas.height - margin * 2 - titleHeight - gap * CGFloat(rows - 1)) / CGFloat(rows)
            let slots = (0..<shots).map { i in
                CGRect(x: margin + CGFloat(i % cols) * (w + gap),
                       y: margin + CGFloat(i / cols) * (h + gap), width: w, height: h)
            }
            let title = CGRect(x: margin, y: canvas.height - margin - titleHeight,
                               width: canvas.width - margin * 2, height: titleHeight)
            return Layout(canvas: canvas, slots: slots, titleRects: [title])
        }
    }

    enum CompositeError: Error { case decodeFailed, encodeFailed }

    func render(shots: [URL], layout: Layout, title: String,
                overlayAssetName: String?, to output: URL) throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1          // exact pixels
        format.opaque = true

        // Decode each shot once, downsampled to the largest slot dimension.
        let maxSlot = layout.slots.map { max($0.width, $0.height) }.max() ?? 1000
        let images = try shots.map { url -> CGImage in
            guard let img = Self.downsample(url, maxPixel: maxSlot * 1.5) else { throw CompositeError.decodeFailed }
            return img
        }

        let renderer = UIGraphicsImageRenderer(size: layout.canvas, format: format)
        let data = renderer.jpegData(withCompressionQuality: 0.92) { ctx in
            layout.background.setFill()
            ctx.fill(CGRect(origin: .zero, size: layout.canvas))

            // Slots repeat the shot list (e.g. 2 strips × N shots).
            for (i, slot) in layout.slots.enumerated() where !images.isEmpty {
                let image = UIImage(cgImage: images[i % images.count])
                ctx.cgContext.saveGState()
                ctx.cgContext.clip(to: slot)
                image.draw(in: Self.aspectFillRect(for: image.size, in: slot))
                ctx.cgContext.restoreGState()
            }

            if let name = overlayAssetName, let overlay = UIImage(named: name) {
                overlay.draw(in: CGRect(origin: .zero, size: layout.canvas))
            }

            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let dateText = Date.now.formatted(date: .long, time: .omitted)
            for rect in layout.titleRects {
                let titleAttrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 56, weight: .heavy),
                    .foregroundColor: UIColor.black,
                    .paragraphStyle: paragraph,
                ]
                let dateAttrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 30, weight: .medium),
                    .foregroundColor: UIColor.darkGray,
                    .paragraphStyle: paragraph,
                ]
                (title as NSString).draw(in: rect.insetBy(dx: 0, dy: 40), withAttributes: titleAttrs)
                (dateText as NSString).draw(
                    in: CGRect(x: rect.minX, y: rect.maxY - 60, width: rect.width, height: 50),
                    withAttributes: dateAttrs)
            }
        }
        try data.write(to: output, options: .atomic)
    }

    static func aspectFillRect(for image: CGSize, in slot: CGRect) -> CGRect {
        let scale = max(slot.width / image.width, slot.height / image.height)
        let size = CGSize(width: image.width * scale, height: image.height * scale)
        return CGRect(x: slot.midX - size.width / 2, y: slot.midY - size.height / 2,
                      width: size.width, height: size.height)
    }

    static func downsample(_ url: URL, maxPixel: CGFloat) -> CGImage? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL,
                                                   [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    }
}
