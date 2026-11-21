import UIKit

/// AirPrint wrapper. In kiosk mode the operator selects a printer once (admin panel);
/// guests then print without seeing the system print sheet.
@MainActor
final class PrintService: NSObject, UIPrintInteractionControllerDelegate {
    static let shared = PrintService()
    private let printerURLKey = "photobooth.printerURL"

    var savedPrinterURL: URL? {
        get { UserDefaults.standard.url(forKey: printerURLKey) }
        set { UserDefaults.standard.set(newValue, forKey: printerURLKey) }
    }

    /// Admin: present printer picker and remember the choice.
    func pickPrinter(from view: UIView) async -> Bool {
        let picker = UIPrinterPickerController(initiallySelectedPrinter: savedPrinterURL.map(UIPrinter.init(url:)))
        return await withCheckedContinuation { cont in
            _ = picker.present(from: view.bounds, in: view, animated: true) { controller, selected, _ in
                if selected, let printer = controller.selectedPrinter {
                    self.savedPrinterURL = printer.url
                }
                cont.resume(returning: selected)
            }
        }
    }

    enum PrintError: LocalizedError {
        case noPrinter, printerOffline, failed(String)
        var errorDescription: String? {
            switch self {
            case .noPrinter: "No printer is set up. Please ask staff."
            case .printerOffline: "The printer isn't reachable. Please ask staff."
            case .failed(let msg): "Printing failed: \(msg)"
            }
        }
    }

    /// Prints directly to the saved printer, without UI.
    func print(_ imageURL: URL, copies: Int = 1, jobName: String = "Photobooth") async throws {
        guard let url = savedPrinterURL else { throw PrintError.noPrinter }
        let printer = UIPrinter(url: url)
        let reachable = await withCheckedContinuation { cont in
            printer.contactPrinter { cont.resume(returning: $0) }
        }
        guard reachable else { throw PrintError.printerOffline }

        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .photo
        info.orientation = .portrait
        info.jobName = jobName

        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printingItems = Array(repeating: imageURL, count: max(1, copies))
        controller.delegate = self

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            _ = controller.print(to: printer) { _, completed, error in
                if let error { cont.resume(throwing: PrintError.failed(error.localizedDescription)) }
                else if !completed { cont.resume(throwing: PrintError.failed("cancelled")) }
                else { cont.resume() }
            }
        }
    }

    // 4×6 inch = 288×432 points.
    func printInteractionController(_ controller: UIPrintInteractionController,
                                     choosePaper paperList: [UIPrintPaper]) -> UIPrintPaper {
        UIPrintPaper.bestPaper(forPageSize: CGSize(width: 288, height: 432), withPapersFrom: paperList)
    }
}
