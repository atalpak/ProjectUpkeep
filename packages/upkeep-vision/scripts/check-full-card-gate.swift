// Unit checks for the pure helpers in ios/UpkeepCardVision.swift: the
// full-card gate, the outline tracker's hysteresis, quick scan's burst capture
// rule, the coaching-status tracker and the sharpness measure.
// Compiles the SHIPPED file, no camera and no Expo needed:
//
//   TMP=$(mktemp -d); cp packages/upkeep-vision/scripts/check-full-card-gate.swift "$TMP/main.swift"
//   swiftc -o "$TMP/check" packages/upkeep-vision/ios/UpkeepCardVision.swift "$TMP/main.swift"
//   "$TMP/check"
//
// Exits non-zero on the first failed expectation.

import CoreGraphics
import CoreImage
import Foundation

var failures = 0
func expect(_ condition: Bool, _ name: String) {
  print(condition ? "ok   " : "FAIL ", name)
  if !condition { failures += 1 }
}

// A portrait 1080x1920 frame; a card is 0.716 wide-to-tall in pixels.
let frame = CGSize(width: 1080, height: 1920)
/// Vision order: TL, TR, BR, BL, y up. `w`/`h` in pixels, centred at (cx, cy) normalized.
func quad(cx: CGFloat = 0.5, cy: CGFloat = 0.5, w: CGFloat = 700, aspect: CGFloat = 0.716) -> [CGPoint] {
  let h = w / aspect
  let hx = w / frame.width / 2, hy = h / frame.height / 2
  return [CGPoint(x: cx - hx, y: cy + hy), CGPoint(x: cx + hx, y: cy + hy),
          CGPoint(x: cx + hx, y: cy - hy), CGPoint(x: cx - hx, y: cy - hy)]
}
func gate(_ q: [CGPoint], confidence: Float = 0.9, quick: Bool = false) -> Bool {
  UpkeepCardVision.isFullCard(corners: q, confidence: confidence, imageSize: frame,
                              minimumArea: quick ? UpkeepCardVision.quickMinimumArea : UpkeepCardVision.minimumArea)
}

expect(gate(quad()), "centred card passes")
expect(!gate(quad(), confidence: 0.5), "low confidence fails")
expect(!gate(quad(cx: 0.05)), "corner near the left edge fails")
expect(!gate(quad(cy: 0.97)), "corner near the top edge fails")
expect(!gate(quad(w: 300)), "tiny card (below minimum area) fails")
expect(!gate(quad(w: 480), quick: true), "quick scan: card covering ~0.15 of the frame fails the 0.18 minimum")
expect(gate(quad(w: 480)), "normal tab: the same ~0.15 card passes its 0.10 minimum")
expect(gate(quad(w: 560), quick: true), "quick scan: card covering ~0.22 of the frame passes")
expect(!gate(quad(aspect: 1.0)), "square-ish quad fails")
expect(!gate(quad(aspect: 0.55)), "too tall quad fails")
expect(gate(quad(aspect: 0.716 * 1.10)), "aspect +10% passes")
expect(!gate(quad(aspect: 0.716 * 1.16)), "aspect +16% fails")
// Sideways card: swap x/y extents in pixels.
let sideways: [CGPoint] = {
  let w: CGFloat = 900, h: CGFloat = w * 0.716
  let hx = w / frame.width / 2, hy = h / frame.height / 2
  return [CGPoint(x: 0.5 - hx, y: 0.5 + hy), CGPoint(x: 0.5 + hx, y: 0.5 + hy),
          CGPoint(x: 0.5 + hx, y: 0.5 - hy), CGPoint(x: 0.5 - hx, y: 0.5 - hy)]
}()
expect(gate(sideways), "sideways card passes (orientation-agnostic)")
var bowtie = quad(); bowtie.swapAt(2, 3)
expect(!UpkeepCardVision.isConvex(bowtie), "bow-tie is not convex")
expect(!gate(bowtie), "bow-tie fails the gate")
expect(UpkeepCardVision.isConvex(quad()), "rectangle is convex")

// Tracker: hysteresis, grace, no trailing.
var tracker = OutlineTracker()
let a = quad(cx: 0.4, cy: 0.5), b = quad(cx: 0.75, cy: 0.5)
expect(tracker.observe(a, at: 0.00) == nil, "first sighting does not paint yet")
expect(tracker.observe(a, at: 0.03) != nil, "second consecutive sighting paints")
expect(tracker.observe(b, at: 0.06) != nil && tracker.follows(a), "one-frame flip keeps the old card")
expect(tracker.observe(a, at: 0.09) != nil && tracker.follows(a), "flip back leaves it unchanged")
_ = tracker.observe(b, at: 0.12)
_ = tracker.observe(b, at: 0.15)
expect(tracker.follows(b), "two consecutive on a new card switch to it")
expect(tracker.observe(nil, at: 0.25, grace: OutlineTracker.fastGrace) != nil, "a miss inside the fast grace keeps the outline")
expect(tracker.observe(nil, at: 0.60, grace: OutlineTracker.fastGrace) == nil, "a miss past the fast grace hides it")

// Normal tab: detection every 0.2s, so one missed detection means the next
// sighting arrives 0.4s after the last accepted one.
var slow = OutlineTracker()
_ = slow.observe(a, at: 0.0); _ = slow.observe(a, at: 0.2)
expect(slow.observe(nil, at: 0.4) != nil, "normal cadence: a missed detection keeps the outline")
expect(slow.observe(a, at: 0.6) != nil && slow.follows(a), "normal cadence: the card is picked up again with no re-acquire flicker")
var slowFast = OutlineTracker()
_ = slowFast.observe(a, at: 0.0); _ = slowFast.observe(a, at: 0.2)
_ = slowFast.observe(nil, at: 0.4, grace: OutlineTracker.fastGrace)
expect(slowFast.observe(a, at: 0.6, grace: OutlineTracker.fastGrace) == nil, "the fast grace would have dropped it (why grace is per-mode)")
var gone = OutlineTracker()
_ = gone.observe(a, at: 0.0); _ = gone.observe(a, at: 0.2)
expect(gone.observe(nil, at: 0.75) == nil, "normal cadence: gone after the 0.5s grace")

// Burst: quick scan's hand-held capture at ~30fps. `run` feeds one detection per
// frame and one sharpness per SAMPLE frame, and reports when it locked. A nil
// position is a missed detection.
struct Lock { var at: Double; var sharpness: Double; var sweepSeen: Bool }
func run(frames: Int, position: (Int) -> Double?, sharpness: (Int) -> Double) -> Lock? {
  var burst = BurstTracker()
  var sweepSeen = false
  for i in 0..<frames {
    let t = Double(i) * 0.033
    let corners = position(i).map { quad(cx: CGFloat($0)) }
    let step = burst.observe(corners, at: t)
    if step == .sweeping { sweepSeen = true }
    guard step == .sample else { continue }
    let sharp = sharpness(i)
    let crop = fakeCrop(sharp)
    // Mirrors readQuick: report the crop that would actually be committed.
    switch burst.offer(sharpness: sharp, crop: crop, at: t) {
    case .store, .skip: break
    case .lockCurrent: return Lock(at: t, sharpness: Double(crop.width - 1), sweepSeen: sweepSeen)
    case .lockBest:
      let read = burst.bestCrop ?? crop
      return Lock(at: t, sharpness: Double(read.width - 1), sweepSeen: sweepSeen)
    }
  }
  return nil
}
// A stand-in crop whose width encodes its sharpness, so the frame the view would
// read (`lockBest` -> `burst.bestCrop`) can be told apart from the last score.
func fakeCrop(_ sharpness: Double) -> CGImage {
  let context = CGContext(data: nil, width: Int(sharpness) + 1, height: 1, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  return context.makeImage()!
}
// Deterministic hand tremor: mean corner movement between frames stays ~0.02-0.04.
func tremor(_ i: Int) -> Double { 0.5 + 0.02 * sin(Double(i) * 2.3) + 0.012 * cos(Double(i) * 5.1) }

let handHeld = run(frames: 60, position: tremor, sharpness: { $0 < 4 ? 22 : 55 })
print("hand-held locked at \(handHeld.map { String($0.at) } ?? "never")")
expect(handHeld != nil && handHeld!.at < 0.7, "a jittery hand-held card locks in under 0.7s once a frame is sharp")
expect(handHeld?.sweepSeen == false, "hand tremor is never mistaken for a sweep")
let instant = run(frames: 30, position: { _ in 0.5 }, sharpness: { _ in 80 })
expect(instant != nil && instant!.at <= 0.1, "a sharp still card locks as soon as the 3-detection streak is met")
let sweepStream = run(frames: 150, position: { 0.2 + (Double($0) * 0.06).truncatingRemainder(dividingBy: 0.6) }, sharpness: { _ in 80 })
expect(sweepStream == nil, "a card swept through the frame (0.06 per detection) never locks, even with sharp frames")
let slowSweep = run(frames: 20, position: { 0.2 + Double($0) * 0.045 }, sharpness: { _ in 80 })
expect(slowSweep != nil, "movement under the loose 0.05 tolerance still counts as held")
// Blurry-only: nothing clears the threshold, so the best frame is read at the window/timeout.
let blurry = run(frames: 120, position: tremor, sharpness: { 10.0 + Double(($0 * 7) % 15) })
print("blurry-only locked at \(blurry.map { String($0.at) } ?? "never") with sharpness \(blurry?.sharpness ?? 0)")
expect(blurry != nil && blurry!.at >= BurstTracker.earlyWindow && blurry!.at < BurstTracker.earlyWindow + 0.1, "acceptably blurry frames (best >= half the threshold) are read at the early window")
expect(blurry != nil && blurry!.sharpness >= 20, "the frame read is the sharpest seen, not the last")
let hopeless = run(frames: 120, position: tremor, sharpness: { _ in 8 })
print("hopeless locked at \(hopeless.map { String($0.at) } ?? "never")")
expect(hopeless != nil && hopeless!.at >= BurstTracker.fallbackAfter && hopeless!.at < BurstTracker.fallbackAfter + 0.1, "a stream that never sharpens is read anyway at the 1.2s timeout")
let skipped = run(frames: 60, position: { $0 % 7 == 3 ? nil : tremor($0) }, sharpness: { $0 < 12 ? 20 : 60 })
expect(skipped != nil && skipped!.at < 0.7, "an occasional missed detection does not restart the burst")
// Frame 11 is the best (30); every later frame is worse (25) and every 4th
// detection is missed. What is read at the early window must be the 30 frame.
let retained = run(frames: 120, position: { $0 % 4 == 0 ? nil : tremor($0) }, sharpness: { $0 == 11 ? 30 : ($0 < 11 ? 12 : 25) })
print("retained read sharpness \(retained?.sharpness ?? 0) at \(retained.map { String($0.at) } ?? "never")")
expect(retained != nil && retained!.sharpness == 30, "missed detections keep the best crop: the 30 frame is read, not the later 25 or an earlier worse one")
var droppedBurst = BurstTracker()
for i in 0..<4 { _ = droppedBurst.observe(quad(), at: Double(i) * 0.03) }
_ = droppedBurst.offer(sharpness: 30, crop: fakeCrop(30), at: 0.12)
_ = droppedBurst.observe(nil, at: 0.2)
expect(droppedBurst.bestCrop != nil, "a short gap keeps the best crop")
_ = droppedBurst.observe(nil, at: 0.5)
expect(droppedBurst.bestCrop == nil, "a gap over 0.25s drops the best crop together with its score")
var sweptCrop = BurstTracker()
for i in 0..<4 { _ = sweptCrop.observe(quad(cx: 0.3), at: Double(i) * 0.03) }
_ = sweptCrop.offer(sharpness: 30, crop: fakeCrop(30), at: 0.12)
_ = sweptCrop.observe(quad(cx: 0.5), at: 0.15)
expect(sweptCrop.bestCrop == nil, "a sweep drops the best crop")
var gapBurst = BurstTracker()
_ = gapBurst.observe(quad(), at: 0); _ = gapBurst.observe(quad(), at: 0.03)
expect(gapBurst.observe(quad(), at: 0.6) == .waiting, "a gap over 0.25s restarts the streak")
var lostBurst = BurstTracker()
_ = lostBurst.observe(quad(), at: 0); _ = lostBurst.observe(quad(), at: 0.03)
_ = lostBurst.observe(nil, at: 0.5)
expect(lostBurst.observe(quad(), at: 0.53) == .waiting, "a long absence restarts the streak")
var swept = BurstTracker()
_ = swept.observe(quad(cx: 0.3), at: 0); _ = swept.observe(quad(cx: 0.3), at: 0.03); _ = swept.observe(quad(cx: 0.3), at: 0.06)
expect(swept.observe(quad(cx: 0.4), at: 0.09) == .sweeping, "a 0.1 jump mid-streak is a sweep and restarts it")
expect(swept.observe(quad(cx: 0.4), at: 0.12) == .waiting, "the streak has to be rebuilt after a sweep")

// Status: sent only on change, and searching only after a grace of nothing.
var status = ScanStatusTracker()
expect(status.observe(.searching, at: 0) == nil, "starts on searching, nothing to send")
expect(status.observe(.far, at: 0.1) == .far, "far is sent at once")
expect(status.observe(.far, at: 0.13) == nil, "no repeat")
expect(status.observe(.searching, at: 0.16) == nil, "one empty frame does not clear a hint")
expect(status.observe(.far, at: 0.20) == nil, "and the far hint is still current")
expect(status.observe(.searching, at: 0.30) == nil && status.observe(.searching, at: 0.62) == .searching, "0.3s of nothing returns to searching")
expect(status.observe(nil, at: 0.65) == nil, "no opinion changes nothing")
expect(status.observe(.reading, at: 0.7) == .reading, "reading is sent at once")

var moving = OutlineTracker()
_ = moving.observe(quad(cx: 0.4), at: 0); _ = moving.observe(quad(cx: 0.4), at: 0.03)
let target = quad(cx: 0.45)
let painted = moving.observe(target, at: 0.06)!
expect(abs(painted[0].x - target[0].x) < 1e-9, "a real move is followed with no lag")
let jitter = quad(cx: 0.4 + 0.001)
let damped = UpkeepCardVision.smoothed(previous: quad(cx: 0.4), next: jitter)
expect(abs(damped[0].x - quad(cx: 0.4)[0].x) < abs(jitter[0].x - quad(cx: 0.4)[0].x) * 0.5, "jitter is damped")

// Sharpness: fine checkerboard vs the same thing blurred vs flat.
let context = CIContext()
func checker() -> CGImage {
  var pixels = [UInt8](repeating: 0, count: 256 * 358)
  for y in 0..<358 { for x in 0..<256 { pixels[y * 256 + x] = ((x / 3 + y / 3) % 2 == 0) ? 20 : 235 } }
  let provider = CGDataProvider(data: Data(pixels) as CFData)!
  return CGImage(width: 256, height: 358, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: 256,
                 space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0),
                 provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
}
let sharpImage = checker()
let blurred = CIImage(cgImage: sharpImage).clampedToExtent().applyingGaussianBlur(sigma: 6)
  .cropped(to: CGRect(x: 0, y: 0, width: 256, height: 358))
let blurredImage = context.createCGImage(blurred, from: blurred.extent)!
let sharpScore = UpkeepCardVision.sharpness(of: sharpImage)
let blurScore = UpkeepCardVision.sharpness(of: blurredImage)
print("sharp \(sharpScore) blurred \(blurScore)")
expect(sharpScore > 40 && blurScore < 40 && sharpScore > blurScore * 20, "sharp scores above 40, blurred below")

// Footer evidence: the second OCR pass must fire when the number was read but
// the set was not, and must not be fooled by artist or copyright lines.
expect(UpkeepCardText.hasFooterEvidence(["FDN • EN", "0696/271 R"]), "set and number both read: no second pass")
expect(UpkeepCardText.hasFooterEvidence(["0696 R", "FDN • EN"]), "a set on a bullet/language line counts")
expect(!UpkeepCardText.hasFooterEvidence(["0696 R", "Illus. Kev Walker"]), "number without a set triggers the second pass; artist line ignored")
expect(!UpkeepCardText.hasFooterEvidence(["0696", "KEV WALKER"]), "an artist name with no marker is not a set code")
expect(!UpkeepCardText.hasFooterEvidence(["0696 EN"]), "a language code alone is not a set code")
expect(!UpkeepCardText.hasFooterEvidence(["FDN • EN"]), "set without a number triggers the second pass")
expect(!UpkeepCardText.hasFooterEvidence(["0696 R", "TM & © 2025 Wizards of the Coast"]), "copyright line is skipped")
expect(!UpkeepCardText.hasFooterEvidence(["0O96 • EN"]), "a digit misread as a letter is not a set code")

exit(failures == 0 ? 0 : 1)
