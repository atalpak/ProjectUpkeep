// Unit checks for the pure helpers in ios/UpkeepCardVision.swift: the
// full-card gate, the outline tracker's hysteresis and the sharpness measure.
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

// Settle: quick scan's elapsed-time hold-still rule at ~30fps.
var settle = SettleTracker()
var settled = false
for i in 0..<8 { settled = settle.observe(quad(cx: 0.5), at: Double(i) * 0.033) }
expect(!settled, "eight steady frames (0.23s) are not yet settled")
for i in 8..<12 { settled = settle.observe(quad(cx: 0.5 + 0.002), at: Double(i) * 0.033) }
expect(settled, "steady for 0.3s with jitter settles")
expect(!settle.observe(quad(cx: 0.55), at: 0.40), "a jump restarts the wait")
var creeping = SettleTracker()
var creepSettled = false
for i in 0..<30 { creepSettled = creeping.observe(quad(cx: 0.4 + Double(i) * 0.02), at: Double(i) * 0.033) }
expect(!creepSettled, "a card sliding briskly (small per frame, large overall) does not settle")
// Fallback: a hand that sways past the tight tolerance still locks eventually.
var sway = SettleTracker()
var swaySettledAt: Double?
for i in 0..<120 {
  let t = Double(i) * 0.033
  let x = 0.5 + 0.02 * sin(t * 2 * .pi * 2)
  if sway.observe(quad(cx: CGFloat(x)), at: t), swaySettledAt == nil { swaySettledAt = t }
}
print("sway settled at \(swaySettledAt.map { String($0) } ?? "never")")
expect((swaySettledAt ?? 0) >= SettleTracker.fallbackAfter, "a swaying card does not settle before the fallback")
expect(swaySettledAt != nil, "a swaying card settles once the fallback relaxes the tolerance")
var fastMover = SettleTracker()
var fastSettled = false
for i in 0..<150 {
  let x = 0.2 + (Double(i) * 0.02).truncatingRemainder(dividingBy: 0.6)
  if fastMover.observe(quad(cx: CGFloat(x)), at: Double(i) * 0.033) { fastSettled = true }
}
expect(!fastSettled, "a card moving fast never settles, fallback included")
var drift = SettleTracker()
var driftSettled = false
for i in 0..<30 { driftSettled = drift.observe(quad(cx: 0.4 + Double(i) * 0.0005), at: Double(i) * 0.033) }
expect(driftSettled, "a very slow drift settles (measured against a moving average)")
var gap = SettleTracker()
_ = gap.observe(quad(), at: 0.0)
expect(!gap.observe(quad(), at: 0.5), "a detection gap restarts the wait")
var lost = SettleTracker()
_ = lost.observe(quad(), at: 0.0); _ = lost.observe(nil, at: 0.2)
expect(!lost.observe(quad(), at: 0.35), "a missing detection restarts the wait")

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

exit(failures == 0 ? 0 : 1)
