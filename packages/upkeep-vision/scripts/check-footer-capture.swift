// Image regression for the inner-frame crop reported on 2026-09-26.
// Supply the upright Scryfall normal image for Book of Mazarbul LTR #116.
// cp this file /tmp/main.swift; swiftc -O ios/UpkeepCardVision.swift
// /tmp/main.swift -o /tmp/check-footer; /tmp/check-footer <book116.jpg>
// No camera or Expo needed; compiles the shipped implementation.
import AppKit
import CoreImage

guard CommandLine.arguments.count == 2,
      let picture = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = picture.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fatalError("Supply Book of Mazarbul LTR #116 normal image")
}
let context = CIContext()
let width = CGFloat(cg.width), height = CGFloat(cg.height)
let margin: CGFloat = 100
let extent = CGRect(x: 0, y: 0, width: width + 2 * margin, height: height + 2 * margin)
let shifted = CIImage(cgImage: cg).transformed(by: CGAffineTransform(translationX: margin, y: margin))
let background = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: extent)
let frame = shifted.composited(over: background)
func point(_ x: CGFloat, _ yFromTop: CGFloat) -> CGPoint {
  CGPoint(x: (margin + x * width) / extent.width,
          y: (margin + (1 - yFromTop) * height) / extent.height)
}
// Orange frame only: black footer below 92% of card height is excluded.
let inner = [point(20 / 488, 20 / 680), point(468 / 488, 20 / 680),
             point(468 / 488, 626 / 680), point(20 / 488, 626 / 680)]
guard let detected = UpkeepCardVision.straighten(frame, corners: inner, context: context),
      let corners = UpkeepCardVision.footerCaptureCorners(inner),
      let footer = UpkeepCardVision.straighten(frame, corners: corners, context: context) else {
  fatalError("Could not construct inner-frame regression")
}
let original = UpkeepCardText.read(detected)
let rescued = UpkeepCardText.read(detected, footerCard: footer)
precondition(!original.printingLines.contains(where: { $0.contains("0116") }), "original crop must omit the collector number")
precondition(rescued.title == original.title, "footer recovery must not change title recognition")
precondition(rescued.printingLines.contains(where: { $0.contains("0116") }), "recovery must read collector 116")
precondition(rescued.printingLines.contains(where: { $0.contains("LTR") }), "recovery must read the set")
print("Inner-frame footer recovery passed: \(rescued.printingLines)")
let fullCard = UpkeepCardText.read(cg)
let fullCardWithRescue = UpkeepCardText.read(cg, footerCard: footer)
precondition(fullCardWithRescue.title == fullCard.title)
precondition(fullCardWithRescue.printingLines == fullCard.printingLines,
             "a correctly captured footer must not use supplementary background text")
print("Existing full-card recognition unchanged")
