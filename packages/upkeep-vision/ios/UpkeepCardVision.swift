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
    detectRectangles(in: image, orientation: orientation).max { liveCardScore($0) < liveCardScore($1) }
  }

  /// Every card-shaped rectangle Vision reports, unranked. The live scanner
  /// needs the whole list (not just the top-scoring one) so it can choose the
  /// best one that also passes the full-card gate.
  static func detectRectangles(in image: CIImage, orientation: CGImagePropertyOrientation) -> [VNRectangleObservation] {
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
      return []
    }
    return request.results ?? []
  }

  // MARK: - The full-card gate

  /// A real card is 63 x 88 mm.
  static let cardAspect: CGFloat = 63.0 / 88.0
  /// ±12% of `cardAspect`, on short side / long side so a card held sideways
  /// passes too. Wide enough for perspective from a hand-held phone, narrow
  /// enough to reject a phone screen, a deck box or a playmat edge.
  static let aspectTolerance: CGFloat = 0.12
  /// Every corner must sit at least this far (normalized) from every frame
  /// edge. A corner at the edge means the card is cut off, and reading it
  /// would read a partial card.
  static let edgeMargin: CGFloat = 0.02
  /// Fraction of the frame the card must cover. Below this the title is too
  /// small for OCR to read reliably anyway.
  /// Raised from 0.10 with the bigger quick-scan box: a card that small in the
  /// frame is too far away for the footer to be legible, and the settle wait
  /// below would only be spent on a read that cannot succeed.
  static let minimumArea: CGFloat = 0.18
  /// Vision's rectangle confidence, via CardObservation.isUsable in Flutter.
  static let minimumConfidence: VNConfidence = 0.70

  /// The single rule for "there is a whole card in view", used both to draw
  /// the outline and to lock a read. Sharing it is the point: an outline the
  /// scanner would refuse to read is exactly the bouncing, inaccurate-looking
  /// outline the owner reported. `corners` are Vision-normalized (TL, TR, BR,
  /// BL) and `imageSize` is the size AFTER orientation, because aspect must be
  /// judged in pixels, not in the stretched normalized square.
  static func isFullCard(corners: [CGPoint], confidence: VNConfidence, imageSize: CGSize,
                         minimumConfidence: VNConfidence = UpkeepCardVision.minimumConfidence) -> Bool {
    guard corners.count == 4, imageSize.width > 0, imageSize.height > 0,
          confidence >= minimumConfidence,
          isInsideWithMargin(corners, margin: edgeMargin),
          isConvex(corners),
          area(of: corners) >= minimumArea,
          let ratio = aspectRatio(corners: corners, imageSize: imageSize),
          isCardAspect(ratio) else { return false }
    return true
  }

  static func pickFullCard(_ observations: [VNRectangleObservation], imageSize: CGSize,
                           minimumConfidence: VNConfidence = UpkeepCardVision.minimumConfidence) -> VNRectangleObservation? {
    observations
      .filter { isFullCard(corners: corners(of: $0), confidence: $0.confidence, imageSize: imageSize, minimumConfidence: minimumConfidence) }
      .max { liveCardScore($0) < liveCardScore($1) }
  }

  /// The best rectangle in the frame that passes the full-card gate, or nil.
  /// The contrast retry runs when nothing PASSING was found, not merely when
  /// nothing was found: a card whose outer edge is lost against a dark table
  /// often still yields a smaller inner rectangle that the gate rejects.
  static func bestFullCard(in image: CIImage, orientation: CGImagePropertyOrientation, imageSize: CGSize,
                           allowContrastRetry: Bool) -> VNRectangleObservation? {
    findFullCard(in: image, orientation: orientation, imageSize: imageSize, allowContrastRetry: allowContrastRetry).card
  }

  /// `bestFullCard`, also reporting whether the expensive contrast pass actually
  /// ran. The caller's rate limiter must only be charged for a pass that was
  /// spent: charging it on every frame that merely *offered* one meant a frame
  /// where the plain pass succeeded used up the retry a later dark frame needed.
  static func findFullCard(in image: CIImage, orientation: CGImagePropertyOrientation, imageSize: CGSize,
                           allowContrastRetry: Bool) -> (card: VNRectangleObservation?, retryRan: Bool) {
    if let found = pickFullCard(detectRectangles(in: image, orientation: orientation), imageSize: imageSize) { return (found, false) }
    guard allowContrastRetry, let enhanced = contrastEnhanced(image) else { return (nil, false) }
    return (pickFullCard(detectRectangles(in: enhanced, orientation: orientation), imageSize: imageSize), true)
  }

  /// Short side over long side of the quad, measured in pixels: 0.716 for a
  /// card seen square-on, whichever way it is turned. Opposite edges are
  /// averaged so mild perspective does not tip it.
  static func aspectRatio(corners: [CGPoint], imageSize: CGSize) -> CGFloat? {
    guard corners.count == 4 else { return nil }
    let p = corners.map { CGPoint(x: $0.x * imageSize.width, y: $0.y * imageSize.height) }
    func length(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }
    let across = (length(p[0], p[1]) + length(p[3], p[2])) / 2
    let down = (length(p[0], p[3]) + length(p[1], p[2])) / 2
    guard across > 0, down > 0 else { return nil }
    return min(across, down) / max(across, down)
  }

  static func isCardAspect(_ ratio: CGFloat) -> Bool {
    abs(ratio - cardAspect) / cardAspect <= aspectTolerance
  }

  static func isInsideWithMargin(_ corners: [CGPoint], margin: CGFloat) -> Bool {
    corners.allSatisfy { $0.x >= margin && $0.x <= 1 - margin && $0.y >= margin && $0.y <= 1 - margin }
  }

  /// Every turn goes the same way. Vision can return a bow-tie or a dented
  /// quad for a busy background; none of those is a card.
  static func isConvex(_ corners: [CGPoint]) -> Bool {
    guard corners.count >= 3 else { return false }
    var sign: CGFloat = 0
    for index in corners.indices {
      let a = corners[index]
      let b = corners[(index + 1) % corners.count]
      let c = corners[(index + 2) % corners.count]
      let cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      if abs(cross) < 1e-9 { return false }
      if sign == 0 { sign = cross > 0 ? 1 : -1 } else if (cross > 0) != (sign > 0) { return false }
    }
    return true
  }

  /// Shoelace area in normalized units, i.e. the fraction of the frame covered.
  static func area(of corners: [CGPoint]) -> CGFloat {
    var twice: CGFloat = 0
    for index in corners.indices {
      let a = corners[index]
      let b = corners[(index + 1) % corners.count]
      twice += a.x * b.y - b.x * a.y
    }
    return abs(twice) / 2
  }

  // MARK: - Sharpness

  /// Variance of the 4-neighbour Laplacian over a fixed-width greyscale copy of
  /// the image. High = crisp edges, low = motion blur or missed focus. The
  /// fixed width makes the number comparable between a small and a large card
  /// crop, and keeps the cost to ~90k pixels of plain arithmetic.
  static func sharpness(of image: CGImage, width: Int = 256) -> Double {
    guard image.width > 0, image.height > 0 else { return 0 }
    let height = max(8, Int((Double(width) * Double(image.height) / Double(image.width)).rounded()))
    var pixels = [UInt8](repeating: 0, count: width * height)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                    bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                    bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
      context.interpolationQuality = .medium
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { return 0 }
    var sum = 0.0
    var sumSquares = 0.0
    var count = 0.0
    for y in 1..<(height - 1) {
      for x in 1..<(width - 1) {
        let i = y * width + x
        let laplacian = 4 * Double(pixels[i]) - Double(pixels[i - 1]) - Double(pixels[i + 1])
          - Double(pixels[i - width]) - Double(pixels[i + width])
        sum += laplacian
        sumSquares += laplacian * laplacian
        count += 1
      }
    }
    let mean = sum / count
    return sumSquares / count - mean * mean
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

  /// For detections ~0.2s apart (the normal Scan tab). 0.0245 is the mean corner
  /// movement over that whole gap, so it is meaningless between frames a few
  /// milliseconds apart -- two near-identical frames always "pass" it. Quick
  /// scan, which detects every frame, uses `SettleTracker` instead.
  static func isSteady(movement: CGFloat) -> Bool { 1 - movement / 0.07 >= 0.65 }

  /// Painted-line smoothing that does not trail. Tiny movement is detection
  /// jitter and is damped hard (alpha 0.35); real movement is followed closely,
  /// reaching a straight snap (alpha 1) at 0.02 mean corner movement. A fixed
  /// 0.35 made the outline lag a moving card by several frames.
  static func smoothed(previous: [CGPoint], next: [CGPoint]) -> [CGPoint] {
    guard previous.count == next.count else { return next }
    let moved = movement(from: previous, to: next)
    let alpha = min(1, max(0.35, moved / 0.02))
    return zip(previous, next).map {
      CGPoint(x: $0.x + ($1.x - $0.x) * alpha, y: $0.y + ($1.y - $0.y) * alpha)
    }
  }

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
 * Decides which single quad the outline shows. Detection flips between
 * rectangles from frame to frame (the card, its art frame, a second card), and
 * drawing each flip is the "bouncing" outline. This tracks one candidate: a
 * quad near the current one just moves it; a quad elsewhere must appear on
 * `switchAfter` consecutive detections before it replaces it (a first-ever
 * card is held to the same rule, so a one-frame false positive never paints);
 * and a missed detection keeps the old outline for `grace` seconds (a parameter, since it depends on how often detection runs) instead of
 * hiding it at once. Pure state, no clock of its own, so it can be unit-checked.
 */
struct OutlineTracker {
  /// Mean corner distance (normalized) under which two quads are the same card.
  static let sameCardMovement: CGFloat = 0.12
  static let switchAfter = 2
  /// How long a missed detection keeps the old outline, per detection cadence:
  /// the normal tab detects every 0.2s, so one miss is a 0.4s gap and needs more
  /// than the ~0.25s that suits detection on every frame (a single 0.25s grace
  /// on the slow cadence hid the outline on every missed detection).
  static let normalGrace: TimeInterval = 0.5
  static let fastGrace: TimeInterval = 0.25

  /// The smoothed quad to paint, or nil for no outline.
  private(set) var shown: [CGPoint]?
  private var accepted: [CGPoint]?
  private var acceptedAt: TimeInterval = 0
  private var challenger: [CGPoint]?
  private var challengerCount = 0

  /// Feed one detection (nil = no full card this frame); returns what to paint.
  @discardableResult
  mutating func observe(_ candidate: [CGPoint]?, at now: TimeInterval, grace: TimeInterval = OutlineTracker.normalGrace) -> [CGPoint]? {
    if accepted != nil, now - acceptedAt > grace {
      accepted = nil
      shown = nil
    }
    guard let candidate else {
      challenger = nil
      challengerCount = 0
      return shown
    }
    if let accepted, UpkeepCardVision.movement(from: accepted, to: candidate) <= Self.sameCardMovement {
      shown = UpkeepCardVision.smoothed(previous: shown ?? candidate, next: candidate)
      self.accepted = candidate
      acceptedAt = now
      challenger = nil
      challengerCount = 0
      return shown
    }
    if let challenger, UpkeepCardVision.movement(from: challenger, to: candidate) <= Self.sameCardMovement {
      challengerCount += 1
    } else {
      challenger = candidate
      challengerCount = 1
    }
    if challengerCount >= Self.switchAfter {
      accepted = candidate
      acceptedAt = now
      shown = candidate
      challenger = nil
      challengerCount = 0
    }
    return shown
  }

  /// True when `candidate` is the card the outline is currently following, so
  /// a lock only ever reads the card the player can see outlined.
  func follows(_ candidate: [CGPoint]) -> Bool {
    guard let accepted else { return false }
    return UpkeepCardVision.movement(from: accepted, to: candidate) <= Self.sameCardMovement
  }

  mutating func reset() { self = OutlineTracker() }
}

/**
 * Quick scan's "hold still" rule, for detections on every frame. A card must be
 * a valid full card whose corners stay within `tolerance` (mean, normalized) of
 * where the settle window began, for `duration` seconds of elapsed time. Judging
 * against the window's start rather than the previous frame is deliberate: at
 * 30fps a slowly sliding card moves almost nothing per frame yet drifts a long
 * way, and a two-detections rule (the old one) is satisfied within ~60ms, which
 * is why a card laid on a table was read before it had even come to rest. Any
 * missing detection, or a gap over `maxGap`, restarts the wait. Pure state, no
 * clock of its own.
 */
struct SettleTracker {
  static let duration: TimeInterval = 0.3
  static let tolerance: CGFloat = 0.015
  static let maxGap: TimeInterval = 0.25

  private var anchor: [CGPoint]?
  private var anchorAt: TimeInterval = 0
  private var lastAt: TimeInterval = 0

  /// Feed one detection (nil = no full card); true once the card has settled.
  mutating func observe(_ corners: [CGPoint]?, at now: TimeInterval) -> Bool {
    guard let corners else {
      anchor = nil
      return false
    }
    if let current = anchor, now - lastAt <= Self.maxGap,
       UpkeepCardVision.movement(from: current, to: corners) <= Self.tolerance {
      // still inside the window
    } else {
      anchor = corners
      anchorAt = now
    }
    lastAt = now
    return now - anchorAt >= Self.duration
  }

  mutating func reset() { self = SettleTracker() }
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
