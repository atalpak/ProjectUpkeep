// Optional real-photo regression. Supply the owner's failed 2026-09-27
// 04:09:01 Book #116 snapshot (not stored in the repository).
// Compile alongside ios/UpkeepCardVision.swift as main.swift.
import AppKit

guard CommandLine.arguments.count == 2,
      let photo = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let card = photo.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fatalError("Supply the failed Book #116 snapshot")
}
let score = UpkeepCardVision.sharpness(of: card)
precondition(score < BurstTracker.minimumSharpness * BurstTracker.acceptableFraction,
             "This blurred crop must wait for focus instead of locking immediately")
let read = UpkeepCardText.read(card)
precondition(read.printingLines.contains { $0.contains("OI16") || $0.contains("0116") },
             "The bounded 3x unsharpened footer retry must recover the collector token")
print("Failed Book snapshot: blur rejected, collector token recovered", read.printingLines)
