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
  /// The normal Scan tab's floor: it reads the title band only, which is
  /// legible from further away.
  static let minimumArea: CGFloat = 0.10
  /// Quick scan's floor, raised with its bigger box: it verifies the footer, and
  /// a card this small in the frame is too far away for that to be legible, so
  /// the settle wait would only be spent on a read that cannot succeed. Per
  /// mode on purpose -- applying it to the normal tab shrank its working range.
  static let quickMinimumArea: CGFloat = 0.18
  /// Vision's rectangle confidence, via CardObservation.isUsable in Flutter.
  static let minimumConfidence: VNConfidence = 0.70

  /// The single rule for "there is a whole card in view", used both to draw
  /// the outline and to lock a read. Sharing it is the point: an outline the
  /// scanner would refuse to read is exactly the bouncing, inaccurate-looking
  /// outline the owner reported. `corners` are Vision-normalized (TL, TR, BR,
  /// BL) and `imageSize` is the size AFTER orientation, because aspect must be
  /// judged in pixels, not in the stretched normalized square.
  static func isFullCard(corners: [CGPoint], confidence: VNConfidence, imageSize: CGSize,
                         minimumConfidence: VNConfidence = UpkeepCardVision.minimumConfidence,
                         minimumArea: CGFloat = UpkeepCardVision.minimumArea) -> Bool {
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
                           minimumConfidence: VNConfidence = UpkeepCardVision.minimumConfidence,
                           minimumArea: CGFloat = UpkeepCardVision.minimumArea) -> VNRectangleObservation? {
    observations
      .filter { isFullCard(corners: corners(of: $0), confidence: $0.confidence, imageSize: imageSize,
                           minimumConfidence: minimumConfidence, minimumArea: minimumArea) }
      .max { liveCardScore($0) < liveCardScore($1) }
  }

  /// The best rectangle in the frame that passes the full-card gate, or nil.
  /// The contrast retry runs when nothing PASSING was found, not merely when
  /// nothing was found: a card whose outer edge is lost against a dark table
  /// often still yields a smaller inner rectangle that the gate rejects.
  static func bestFullCard(in image: CIImage, orientation: CGImagePropertyOrientation, imageSize: CGSize,
                           allowContrastRetry: Bool,
                           minimumArea: CGFloat = UpkeepCardVision.minimumArea) -> VNRectangleObservation? {
    findFullCard(in: image, orientation: orientation, imageSize: imageSize, allowContrastRetry: allowContrastRetry,
                 minimumArea: minimumArea).card
  }

  /// `bestFullCard`, also reporting whether the expensive contrast pass actually
  /// ran. The caller's rate limiter must only be charged for a pass that was
  /// spent: charging it on every frame that merely *offered* one meant a frame
  /// where the plain pass succeeded used up the retry a later dark frame needed.
  /// `miss`, set only when no card passed, says WHY the nearest candidate did not
  /// (`NearMiss`), which is what lets quick scan tell the person "move closer"
  /// instead of leaving them guessing.
  static func findFullCard(in image: CIImage, orientation: CGImagePropertyOrientation, imageSize: CGSize,
                           allowContrastRetry: Bool,
                           minimumArea: CGFloat = UpkeepCardVision.minimumArea)
    -> (card: VNRectangleObservation?, retryRan: Bool, miss: NearMiss?) {
    let plain = detectRectangles(in: image, orientation: orientation)
    if let found = pickFullCard(plain, imageSize: imageSize, minimumArea: minimumArea) { return (found, false, nil) }
    let plainMiss = nearMiss(plain, imageSize: imageSize, minimumArea: minimumArea)
    guard allowContrastRetry, let enhanced = contrastEnhanced(image) else { return (nil, false, plainMiss) }
    let boosted = detectRectangles(in: enhanced, orientation: orientation)
    let card = pickFullCard(boosted, imageSize: imageSize, minimumArea: minimumArea)
    return (card, true, card == nil ? (nearMiss(boosted, imageSize: imageSize, minimumArea: minimumArea) ?? plainMiss) : nil)
  }

  /// Why a card-like rectangle was refused, for the live coaching text.
  enum NearMiss: Equatable {
    /// A whole card, but covering less of the frame than the floor: too far away.
    case far
    /// A card-like rectangle touching or crossing the frame edge: part of it is cut off.
    case partial
  }

  /// Lower than `minimumConfidence` on purpose: a card half out of frame is
  /// exactly where Vision is least sure, and this only ever changes a hint.
  static let missConfidence: VNConfidence = 0.5
  /// A rectangle covering less than this is table clutter, not a card worth coaching about.
  static let missMinimumArea: CGFloat = 0.06

  /// The most plausible reason no card passed, or nil when nothing card-like was
  /// seen at all. `partial` wins over `far`: a card cut off by the edge is the
  /// more actionable message, and it is often ALSO small. A cut-off card's visible
  /// quad has no card aspect, so aspect is only judged for the `far` case, where
  /// the whole quad is inside the frame. Vision's own aspect request bounds
  /// (0.55...0.90) already reject anything wildly un-card-like.
  static func nearMiss(_ observations: [VNRectangleObservation], imageSize: CGSize,
                       minimumArea: CGFloat) -> NearMiss? {
    var sawFar = false
    for observation in observations where observation.confidence >= missConfidence {
      let quad = corners(of: observation)
      guard isConvex(quad), area(of: quad) >= missMinimumArea else { continue }
      if !isInsideWithMargin(quad, margin: edgeMargin) { return .partial }
      if area(of: quad) < minimumArea, let ratio = aspectRatio(corners: quad, imageSize: imageSize), isCardAspect(ratio) {
        sawFar = true
      }
    }
    return sawFar ? .far : nil
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
  /// scan, which detects every frame, uses `BurstTracker` instead.
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
 * Quick scan's capture rule, built for a card held IN THE HAND. The earlier rule
 * (a card must stay within 0.015 of its own running average for 0.3s) asked for
 * a stillness a hand does not have, so it either waited out a 1.5s fallback or
 * fought the person. This one does not ask for stillness at all. It asks for a
 * card that is really there and is not being swept through the frame, and then
 * lets SHARPNESS -- the actual quality question -- pick the frame:
 *
 *  - a detection counts toward a streak while the card moves less than
 *    `looseMovement` (mean corner movement between consecutive detections)
 *    from the previous one. Bigger than that is a card being carried through the
 *    frame: the streak, and every frame collected so far, restart;
 *  - once the streak is `minimumStreak` detections long each further frame is a
 *    SAMPLE: the caller straightens it, measures its sharpness and `offer`s it;
 *  - the first sample whose sharpness clears `minimumSharpness` locks at once. If
 *    none does, the sharpest sample so far is read after `earlyWindow` provided
 *    it reached `acceptableFraction` of the threshold, and unconditionally after
 *    `fallbackAfter`, so a flat card that scores low while perfectly sharp, or a
 *    hand that never steadies, still scans. A blurred read costs a wrong-card
 *    round trip, which is why the threshold is still the gate whenever a frame
 *    can pass it.
 *
 * A single missing detection does not restart anything (a hand-held card drops
 * out of Vision now and then); only a gap over `maxGap` does. Pure state, no
 * clock of its own.
 */
struct BurstTracker {
  /// Mean corner movement (normalized) between consecutive detections above which
  /// the card is being swept through the frame, not held. Loose on purpose: real
  /// hand tremor is ~0.005-0.03 per frame.
  static let looseMovement: CGFloat = 0.05
  static let minimumStreak = 3
  /// Seconds into a streak after which a merely acceptable best frame is read.
  static let earlyWindow: TimeInterval = 0.7
  /// Seconds into a streak after which the best frame is read whatever it scored.
  static let fallbackAfter: TimeInterval = 1.2
  /// Variance of the Laplacian (UpkeepCardVision.sharpness) below which the
  /// straightened crop is treated as motion blur or missed focus. Estimated, not
  /// measured on a phone; tune it from real cards.
  static let minimumSharpness = 40.0
  /// At `earlyWindow` the best frame needs at least this share of the threshold.
  static let acceptableFraction = 0.5
  static let maxGap: TimeInterval = 0.25

  enum Step {
    /// Not enough consecutive detections yet, or none this frame.
    case waiting
    /// The card jumped further than `looseMovement`: it is being swept through.
    case sweeping
    /// Straighten this frame and `offer` it.
    case sample
  }

  enum Verdict {
    /// Keep collecting, and remember THIS frame: it is the sharpest so far.
    case store
    /// Keep collecting, discard this frame.
    case skip
    /// Read this frame.
    case lockCurrent
    /// Read the frame stored earlier (it was sharper than this one).
    case lockBest
  }

  private var previous: [CGPoint]?
  private var lastAt: TimeInterval = 0
  private var streak = 0
  private var streakStart: TimeInterval = 0
  private var bestSharpness = -1.0
  /// The sharpest straightened crop of the current burst. Held HERE, beside the
  /// score it belongs to, so the two can only be cleared together: every path
  /// that forgets `bestSharpness` (restart, a gap over `maxGap`, `reset`) drops
  /// the crop, and none that keeps it can lose the crop. A view-side copy drifted
  /// from this once, discarding the best frame on a single missed detection.
  private(set) var bestCrop: CGImage?

  mutating func observe(_ corners: [CGPoint]?, at now: TimeInterval) -> Step {
    guard let corners else {
      if now - lastAt > Self.maxGap { self = BurstTracker() }
      return .waiting
    }
    defer { previous = corners; lastAt = now }
    guard let last = previous, last.count == corners.count, now - lastAt <= Self.maxGap else {
      restart(at: now)
      return .waiting
    }
    if UpkeepCardVision.movement(from: last, to: corners) > Self.looseMovement {
      restart(at: now)
      return .sweeping
    }
    streak += 1
    return streak >= Self.minimumStreak ? .sample : .waiting
  }

  private mutating func restart(at now: TimeInterval) {
    streak = 1
    streakStart = now
    bestSharpness = -1
    bestCrop = nil
  }

  /// `.lockBest` means `bestCrop` is the frame to read; take it before `reset`.
  mutating func offer(sharpness: Double, crop: CGImage, at now: TimeInterval) -> Verdict {
    let isBest = sharpness > bestSharpness
    if isBest { bestSharpness = sharpness; bestCrop = crop }
    if sharpness >= Self.minimumSharpness { return .lockCurrent }
    let elapsed = now - streakStart
    let due = elapsed >= Self.fallbackAfter ||
      (elapsed >= Self.earlyWindow && bestSharpness >= Self.minimumSharpness * Self.acceptableFraction)
    if due { return isBest ? .lockCurrent : .lockBest }
    return isBest ? .store : .skip
  }

  mutating func reset() { self = BurstTracker() }
}

/**
 * What quick scan is seeing, for the live coaching line above the camera box.
 * Raw states change frame to frame; `ScanStatusTracker` makes them steady enough
 * to send, and JS paces them again for the eye (scan-core `paceStatus`).
 */
enum ScanStatus: String {
  /// No card-like rectangle in view.
  case searching
  /// A whole card, too small in the frame.
  case far
  /// A card-like shape touching the frame edge.
  case partial
  /// The card is being swept through, not held.
  case moving
  /// Steady enough, but the frames are not sharp yet.
  case blurry
  /// Captured; OCR is running.
  case reading
}

/**
 * Turns per-frame raw status into changes worth sending: an event only when the
 * status differs, and a fall back to `searching` only after `searchingGrace` of
 * continuous nothing, so the single missed detection every hand-held card has
 * does not flash the hint. Anything more specific than `searching` is sent at
 * once. A raw value of nil means "no opinion this frame" and changes nothing.
 * Pure state, no clock of its own.
 */
struct ScanStatusTracker {
  static let searchingGrace: TimeInterval = 0.3
  private(set) var current: ScanStatus = .searching
  private var searchingSince: TimeInterval?

  /// The new status when it changed, else nil.
  mutating func observe(_ raw: ScanStatus?, at now: TimeInterval) -> ScanStatus? {
    guard let raw else { return nil }
    if raw == .searching {
      guard current != .searching else { searchingSince = nil; return nil }
      let since = searchingSince ?? now
      searchingSince = since
      guard now - since >= Self.searchingGrace else { return nil }
    }
    searchingSince = nil
    guard raw != current else { return nil }
    current = raw
    return raw
  }

  mutating func reset() { self = ScanStatusTracker() }
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
    var printingLines = readingOrder(printing)
    // The footer is the smallest text on the card and the one JS most needs to
    // choose a printing, so a pass that produced no readable set or number gets a
    // second, footer-only attempt at higher magnification.
    if !hasFooterEvidence(printingLines) {
      for line in readFooterBand(card) where !printingLines.contains(line) { printingLines.append(line) }
    }
    var lines: [String] = []
    for line in titleLines + printingLines where !lines.contains(line) { lines.append(line) }
    let name = titleLines.first(where: hasLetters) ?? lines.first(where: hasLetters) ?? ""
    return Evidence(title: name, lines: lines, printingLines: printingLines)
  }

  /// The footer's bottom strip, as a fraction of card height. The printing
  /// region above is 28% tall so it also catches the artist line; the set and
  /// collector number sit in the last ~12%.
  static let footerBandHeight: CGFloat = 0.14
  /// The footer is upscaled until the crop is about this wide, capped at
  /// `footerMaxScale`, so tiny type gets enough pixels per stroke for the accurate
  /// recogniser. A 4K capture needs little; a 1080p one about 2.5x.
  static let footerTargetWidth: CGFloat = 1800
  static let footerMaxScale: CGFloat = 3

  private static let footerContext = CIContext(options: nil)

  /// Cheap shape test on the first pass's printing lines, deliberately looser
  /// than scan-core's `printingHints` (which needs the catalog). A collector
  /// number is a standalone run of 2-5 digits. A set code is 3-5 uppercase
  /// letters/digits with at least one letter, that is not a language code, and
  /// that sits on a line that also carries a number, a bullet/dot or a language
  /// token -- the shape of "FDN 0696 R" or "0696 * EN" -- so a stray word from
  /// the artist line ("Kev", "Walker") no longer counts. Missing either triggers
  /// the second pass; a false "found" only skips an optional retry.
  static func hasFooterEvidence(_ lines: [String]) -> Bool {
    let languages: Set<String> = ["EN", "DE", "FR", "ES", "IT", "PT", "JA", "JP", "KO", "RU", "ZH", "ZHS", "ZHT", "PH"]
    var number = false
    var set = false
    for line in lines {
      // Artist credit and copyright are words and years, never the printing.
      let upper = line.uppercased()
      if upper.contains("ILLUS") || upper.contains("WIZARDS") || upper.contains("COAST") || upper.contains("©") || upper.contains("™") { continue }
      let hasMarker = upper.contains("•") || upper.contains("·") || upper.contains("*")
      let tokens = upper.split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "/" }).map(String.init)
      let lineNumber = tokens.contains { token in
        let head = token.split(separator: "/").first.map(String.init) ?? token
        return (2...5).contains(head.count) && head.allSatisfy(\.isNumber)
      }
      let hasLanguage = tokens.contains { languages.contains($0) }
      if lineNumber { number = true }
      guard lineNumber || hasMarker || hasLanguage else { continue }
      for token in tokens where (3...5).contains(token.count) && token.contains(where: \.isLetter)
        && token.allSatisfy({ $0.isASCII && ($0.isUppercase || $0.isNumber) }) && !languages.contains(token) {
        // Numeric-looking tokens with one stray letter ("0O96") are number misreads, not sets.
        if token.filter(\.isLetter).count >= 2 || token.first?.isLetter == true { set = true }
      }
    }
    return number && set
  }

  /// The footer strip alone, enlarged and sharpened, read with the accurate
  /// recogniser and no language correction (which turns "FDN 0696" into words).
  /// Returns nothing on any failure: this is a best-effort second chance.
  static func readFooterBand(_ card: CGImage) -> [String] {
    let bandHeight = max(1, Int((CGFloat(card.height) * footerBandHeight).rounded()))
    let band = CGRect(x: 0, y: card.height - bandHeight, width: card.width, height: bandHeight)
    guard let strip = card.cropping(to: band) else { return [] }
    let scale = min(footerMaxScale, max(1, footerTargetWidth / CGFloat(strip.width)))
    var image = CIImage(cgImage: strip)
    if scale > 1.05, let lanczos = CIFilter(name: "CILanczosScaleTransform") {
      lanczos.setValue(image, forKey: kCIInputImageKey)
      lanczos.setValue(scale, forKey: kCIInputScaleKey)
      lanczos.setValue(1, forKey: kCIInputAspectRatioKey)
      image = lanczos.outputImage ?? image
    }
    if let sharpen = CIFilter(name: "CIUnsharpMask") {
      sharpen.setValue(image, forKey: kCIInputImageKey)
      sharpen.setValue(1.6, forKey: kCIInputRadiusKey)
      sharpen.setValue(1.2, forKey: kCIInputIntensityKey)
      image = sharpen.outputImage ?? image
    }
    guard let enlarged = footerContext.createCGImage(image, from: image.extent) else { return [] }
    let request = makeRequest(languageCorrection: false)
    do {
      try VNImageRequestHandler(cgImage: enlarged, orientation: .up, options: [:]).perform([request])
    } catch {
      return []
    }
    return readingOrder(request)
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
