import CoreGraphics
import CoreImage
import Vision

/**
 * The card-finding and card-reading maths, with no capture session, no Expo
 * types and no UI attached. Everything here is a pure function of an image,
 * which is the point: `scripts/validate-detection.swift` compiles this exact
 * file against still frames so the thresholds and the quad→view mapping can
 * be checked on a laptop, where there is no camera.
 *
 * The numbers are ported from the Flutter scanner the owner confirmed worked
 * (MTGCardScanner ios/Runner/AppDelegate.swift and
 * lib/src/scanner/domain/frame_stability_tracker.dart). Treat them as tuned
 * against real footage, not as defaults worth adjusting on a hunch.
 */
enum UpkeepCardVision {
  /// Matches the on-screen gold corner guide, and is also the area the manual
  /// "Scan card" button reads. One rectangle for both means what the player
  /// aims at is exactly what OCR sees on a full-art card whose edge Vision
  /// cannot find. Vision's normalized space: origin bottom-left.
  static let guideBox = CGRect(x: 0.17, y: 0.25, width: 0.66, height: 0.52)

  /// The best card-shaped rectangle in the frame, or nil. `allowContrastRetry`
  /// is the caller's rate limiter: a card whose art runs to its border can
  /// lose its outer edge against a dark table, and a contrast-only retry
  /// finds it, but it costs a full filter pass so it must not run on every
  /// empty frame.
  static func bestCard(in image: CIImage, orientation: CGImagePropertyOrientation,
                       allowContrastRetry: Bool) -> VNRectangleObservation? {
    if let found = detectRectangle(in: image, orientation: orientation) { return found }
    guard allowContrastRetry, let enhanced = contrastEnhanced(image) else { return nil }
    return detectRectangle(in: enhanced, orientation: orientation)
  }

  static func detectRectangle(in image: CIImage, orientation: CGImagePropertyOrientation) -> VNRectangleObservation? {
    let request = VNDetectRectanglesRequest()
    request.maximumObservations = 8
    // Strict enough that card art, a phone screen or a table detail is never
    // outlined as the card. A false outline is worse than no outline — the
    // guide and the manual Scan card button cover what this rejects.
    request.minimumAspectRatio = 0.55
    request.maximumAspectRatio = 0.90
    request.minimumSize = 0.16
    do {
      try VNImageRequestHandler(ciImage: image, orientation: orientation, options: [:]).perform([request])
    } catch {
      return nil
    }
    return (request.results ?? []).max { liveCardScore($0) < liveCardScore($1) }
  }

  static func liveCardScore(_ card: VNRectangleObservation) -> CGFloat {
    let box = card.boundingBox
    let areaBonus = min(box.width * box.height, 0.35) * 0.65
    // People naturally centre the card they mean. This stops a second card at
    // the edge of the frame from stealing the outline.
    let centrePenalty = (pow(box.midX - 0.5, 2) + pow(box.midY - 0.5, 2)) * 0.85
    return CGFloat(card.confidence) + areaBonus - centrePenalty
  }

  static func contrastEnhanced(_ image: CIImage) -> CIImage? {
    guard let filter = CIFilter(name: "CIColorControls") else { return nil }
    filter.setValue(image, forKey: kCIInputImageKey)
    filter.setValue(1.8, forKey: kCIInputContrastKey)
    filter.setValue(-0.06, forKey: kCIInputBrightnessKey)
    return filter.outputImage
  }

  static func corners(of card: VNRectangleObservation) -> [CGPoint] {
    [card.topLeft, card.topRight, card.bottomRight, card.bottomLeft]
  }

  /// Vision's normalized, bottom-left-origin point → view coordinates under
  /// an aspect-fill preview. Done explicitly rather than through
  /// `layerPointConverted` so it is deterministic and can be exercised
  /// offline; `image` must be the size of the image AFTER orientation.
  static func project(_ point: CGPoint, image: CGSize, view: CGSize) -> CGPoint {
    let scale = max(view.width / image.width, view.height / image.height)
    let offsetX = (image.width * scale - view.width) / 2
    let offsetY = (image.height * scale - view.height) / 2
    return CGPoint(
      x: point.x * image.width * scale - offsetX,
      y: (1 - point.y) * image.height * scale - offsetY
    )
  }

  /// Mean corner movement between two consecutive detections, in normalized
  /// units. Ported from FrameStabilityTracker; the caller turns this into a
  /// steady-frame count.
  static func movement(from previous: [CGPoint], to next: [CGPoint]) -> CGFloat {
    guard previous.count == next.count, !next.isEmpty else { return .infinity }
    var total: CGFloat = 0
    for (index, corner) in next.enumerated() {
      total += hypot(previous[index].x - corner.x, previous[index].y - corner.y)
    }
    return total / CGFloat(next.count)
  }

  static func isSteady(movement: CGFloat) -> Bool { 1 - movement / 0.07 >= 0.65 }

  /// Flattens the detected quadrilateral into an upright card image. `image`
  /// must already be oriented; `corners` are Vision-normalized.
  static func straighten(_ image: CIImage, corners: [CGPoint], context: CIContext) -> CGImage? {
    guard corners.count == 4, let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
    let extent = image.extent
    func vector(_ point: CGPoint) -> CIVector {
      CIVector(x: extent.minX + point.x * extent.width, y: extent.minY + point.y * extent.height)
    }
    filter.setValue(image, forKey: kCIInputImageKey)
    filter.setValue(vector(corners[0]), forKey: "inputTopLeft")
    filter.setValue(vector(corners[1]), forKey: "inputTopRight")
    filter.setValue(vector(corners[2]), forKey: "inputBottomRight")
    filter.setValue(vector(corners[3]), forKey: "inputBottomLeft")
    guard let output = filter.outputImage else { return nil }
    return context.createCGImage(output, from: output.extent)
  }

  /// The guide-box crop the manual "Scan card" button reads.
  static func guideCrop(_ image: CIImage, context: CIContext) -> CGImage? {
    let extent = image.extent
    let rect = CGRect(
      x: extent.minX + guideBox.minX * extent.width,
      y: extent.minY + guideBox.minY * extent.height,
      width: guideBox.width * extent.width,
      height: guideBox.height * extent.height
    )
    return context.createCGImage(image, from: rect)
  }
}

/**
 * Title and printing-line OCR over one already-straightened card image.
 */
enum UpkeepCardText {
  struct Evidence {
    let title: String
    let lines: [String]
    let printingLines: [String]
  }

  /// Reading the title band and the bottom set/collector band separately is
  /// what stops rules text in the middle from being taken for a card name,
  /// and gives the tiny printing line its own pass. Language correction helps
  /// a real English card name and actively harms a set code like "FDN 0696",
  /// so it is on for one request and off for the other.
  static func read(_ card: CGImage) -> Evidence {
    let unit = CGRect(x: 0, y: 0, width: 1, height: 1)
    let title = makeRequest(languageCorrection: true)
    title.regionOfInterest = titleRegion(of: unit)
    let printing = makeRequest(languageCorrection: false)
    printing.regionOfInterest = printingRegion(of: unit)
    do {
      try VNImageRequestHandler(cgImage: card, orientation: .up, options: [:]).perform([title, printing])
    } catch {
      return Evidence(title: "", lines: [], printingLines: [])
    }
    let titleLines = readingOrder(title)
    let printingLines = readingOrder(printing)
    var lines: [String] = []
    for line in titleLines + printingLines where !lines.contains(line) { lines.append(line) }
    let name = titleLines.first(where: hasLetters) ?? lines.first(where: hasLetters) ?? ""
    return Evidence(title: name, lines: lines, printingLines: printingLines)
  }

  private static func makeRequest(languageCorrection: Bool) -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = languageCorrection
    return request
  }

  private static func readingOrder(_ request: VNRecognizeTextRequest) -> [String] {
    (request.results ?? [])
      .compactMap { observation -> (String, CGFloat, CGFloat)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (candidate.string, observation.boundingBox.minX, observation.boundingBox.maxY)
      }
      .sorted { left, right in
        if abs(left.2 - right.2) < 0.025 { return left.1 < right.1 }
        return left.2 > right.2
      }
      .map(\.0)
  }

  private static func hasLetters(_ value: String) -> Bool {
    value.range(of: "[A-Za-z]", options: .regularExpression) != nil
  }

  static func titleRegion(of card: CGRect) -> CGRect {
    CGRect(x: card.minX + card.width * 0.03, y: card.minY + card.height * 0.58,
           width: card.width * 0.94, height: card.height * 0.37)
      .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
  }

  static func printingRegion(of card: CGRect) -> CGRect {
    CGRect(x: card.minX + card.width * 0.02, y: card.minY + card.height * 0.01,
           width: card.width * 0.96, height: card.height * 0.28)
      .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
  }
}
