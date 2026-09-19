import ExpoModulesCore
import Vision
import ImageIO
import UIKit

public class UpkeepVisionModule: Module {
  // Serial native work bounds memory/CPU even if JS unmounts or abandons a request.
  private let worker = DispatchQueue(label: "dev.projectupkeep.vision", qos: .userInitiated)
  public func definition() -> ModuleDefinition {
    Name("UpkeepVision")
    AsyncFunction("readText") { (uri: String) -> [String: Any] in
      let url = try self.localURL(uri)
      let handler = VNImageRequestHandler(url: url, options: [:])
      let rectangles = VNDetectRectanglesRequest()
      rectangles.maximumObservations = 4
      rectangles.minimumAspectRatio = 0.55
      rectangles.maximumAspectRatio = 0.90
      rectangles.minimumSize = 0.2
      try handler.perform([rectangles])
      let box = rectangles.results?.max(by: { a, b in
        a.boundingBox.width * a.boundingBox.height < b.boundingBox.width * b.boundingBox.height
      })?.boundingBox
      let title = VNRecognizeTextRequest()
      let footer = VNRecognizeTextRequest()
      for request in [title, footer] {
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        if #available(iOS 16.0, *) { request.automaticallyDetectsLanguage = true }
      }
      // If no rectangle is found, use full-frame text rather than an incorrectly mapped preview guide.
      if let box {
        title.regionOfInterest = CGRect(x: box.minX, y: box.minY + box.height * 0.72, width: box.width, height: box.height * 0.28)
        footer.regionOfInterest = CGRect(x: box.minX, y: box.minY, width: box.width, height: box.height * 0.17)
      }
      try handler.perform([title, footer])
      func lines(_ request: VNRecognizeTextRequest) -> [String] {
        (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
          .compactMap { $0.topCandidates(1).first?.string }
      }
      return ["lines": lines(title), "printingLines": lines(footer)]
    }.runOnQueue(worker)

    AsyncFunction("compareArtwork") { (uri: String, references: [String]) -> [String: Any] in
      guard references.count >= 2 && references.count <= 16 else { return ["index": -1, "confident": false] }
      let url = try self.localURL(uri)
      let handler = VNImageRequestHandler(url: url, options: [:])
      let rectangle = VNDetectRectanglesRequest()
      rectangle.minimumAspectRatio = 0.55
      rectangle.maximumAspectRatio = 0.90
      rectangle.minimumSize = 0.2
      try handler.perform([rectangle])
      guard let box = rectangle.results?.max(by: {
        $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height
      })?.boundingBox else { return ["index": -1, "confident": false] }
      let capture = VNGenerateImageFeaturePrintRequest()
      capture.regionOfInterest = box
      try handler.perform([capture])
      guard let feature = capture.results?.first as? VNFeaturePrintObservation else { return ["index": -1, "confident": false] }
      var distances: [(Int, Float)] = []
      for (i, ref) in references.enumerated() {
        // References are local files. Networking, deadlines and caching belong to the caller.
        let request = VNGenerateImageFeaturePrintRequest()
        try VNImageRequestHandler(url: self.localURL(ref), options: [:]).perform([request])
        guard let other = request.results?.first as? VNFeaturePrintObservation else { continue }
        var distance: Float = 0
        try feature.computeDistance(&distance, to: other)
        if distance.isFinite { distances.append((i, distance)) }
      }
      distances.sort { $0.1 < $1.1 }
      guard distances.count == references.count, distances.count >= 2 else { return ["index": -1, "confident": false] }
      // A ranking hint only, never proof of a printing. Confirmation is mandatory in JS.
      return ["index": distances[0].0, "confident": distances[0].1 < distances[1].1 * 0.90]
    }.runOnQueue(worker)

    // The whole card against each candidate printing's whole picture, no
    // rectangle detection: the photo is already a straightened card, and
    // `compareArtwork` above would look for a rectangle INSIDE it (the art
    // box) and compare that against full cards. Returns one feature-print
    // distance per reference, in order (lower is closer), or -1 for a
    // reference that could not be read. Deciding what counts as a clear
    // winner belongs to the caller (scan-core `artVerdict`).
    AsyncFunction("rankCardImage") { (uri: String, references: [String]) -> [String: Any] in
      guard !references.isEmpty && references.count <= 40 else { return ["distances": [Double]()] }
      let capture = VNGenerateImageFeaturePrintRequest()
      try VNImageRequestHandler(url: try self.localURL(uri), options: [:]).perform([capture])
      guard let feature = capture.results?.first as? VNFeaturePrintObservation else { return ["distances": [Double]()] }
      var distances: [Double] = []
      for ref in references {
        let request = VNGenerateImageFeaturePrintRequest()
        var distance: Float = 0
        guard let refURL = try? self.localURL(ref),
              (try? VNImageRequestHandler(url: refURL, options: [:]).perform([request])) != nil,
              let other = request.results?.first as? VNFeaturePrintObservation,
              (try? feature.computeDistance(&distance, to: other)) != nil,
              distance.isFinite else { distances.append(-1); continue }
        distances.append(Double(distance))
      }
      return ["distances": distances]
    }.runOnQueue(worker)

    View(UpkeepScannerView.self) {
      Events("onCardRead", "onCardLost", "onOutlineChange", "onScannerError")
      Prop("active") { (view: UpkeepScannerView, active: Bool) in view.active = active }
      Prop("fastDetection") { (view: UpkeepScannerView, fast: Bool) in view.fastDetection = fast }
      AsyncFunction("captureNow") { (view: UpkeepScannerView) in view.captureNow() }
    }
  }
  private func localURL(_ value: String) throws -> URL {
    guard let url = URL(string: value), url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
      throw NSError(domain: "UpkeepVision", code: 1, userInfo: [NSLocalizedDescriptionKey: "A readable local photo is required"])
    }
    return url
  }
}
