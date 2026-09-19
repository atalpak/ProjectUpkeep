// Offline check of the scanner's detection, quad mapping and OCR against
// still images, on a machine with no camera. Compiles the SHIPPED
// ios/UpkeepCardVision.swift rather than a copy of it, so a threshold that
// drifts here has drifted in the app too.
//
//   cp packages/upkeep-vision/scripts/validate-detection.swift "$TMP/main.swift"
//   swiftc -O -o "$TMP/validate" \
//     packages/upkeep-vision/ios/UpkeepCardVision.swift "$TMP/main.swift"
//   "$TMP/validate" <out-dir> <frame.jpg> [more.jpg ...]
//
// (the copy is only so swiftc treats it as the entry point — top-level
// statements are allowed in `main.swift` and nowhere else)
//
// For each input it prints the winning rectangle's score/confidence/aspect,
// the OCR title and printing lines from the straightened crop, and writes a
// debug PNG with the quad drawn where the live outline would be.
//
// It calls the ungated `bestCard`, not the live scanner's `findFullCard`, so a
// frame that prints a rectangle here may still be refused by the full-card gate
// (area >= 0.18, aspect, margins) in the app. The gate itself is exercised by
// check-full-card-gate.swift.
//
// Caveat worth remembering when reading the output: the owner's frames are
// portrait screenshots that already contain the app's own chrome, so they are
// upright (orientation .up, not the live camera's .right) and the bottom
// sheet can itself be a rectangle-shaped distraction.

import AppKit
import CoreImage
import Foundation
import Vision

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
  FileHandle.standardError.write(Data("usage: validate <out-dir> <frame.jpg> [...]\n".utf8))
  exit(2)
}
let outputDirectory = URL(fileURLWithPath: arguments[1], isDirectory: true)
try? FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
let context = CIContext(options: nil)

func load(_ path: String) -> CIImage? {
  CIImage(contentsOf: URL(fileURLWithPath: path))
}

func writePNG(_ image: NSImage, to url: URL) {
  guard let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:]) else { return }
  try? png.write(to: url)
}

/// Draws the quad exactly where the live view would put it: the same
/// aspect-fill projection, into a "view" the size of the frame itself.
func debugImage(_ source: CIImage, corners: [CGPoint], guide: CGRect) -> NSImage? {
  guard let cgImage = context.createCGImage(source, from: source.extent) else { return nil }
  let size = source.extent.size
  let image = NSImage(size: size)
  image.lockFocus()
  guard let gc = NSGraphicsContext.current?.cgContext else { image.unlockFocus(); return nil }
  gc.draw(cgImage, in: CGRect(origin: .zero, size: size))
  // AppKit's origin is bottom-left, which is Vision's too, so project into a
  // flipped "view" and mirror back rather than special-casing the maths.
  func point(_ normalized: CGPoint) -> CGPoint {
    let projected = UpkeepCardVision.project(normalized, image: size, view: size)
    return CGPoint(x: projected.x, y: size.height - projected.y)
  }
  gc.setLineWidth(6)
  gc.setStrokeColor(NSColor(red: 0xC9 / 255, green: 0xA3 / 255, blue: 0x4A / 255, alpha: 1).cgColor)
  if corners.count == 4 {
    gc.move(to: point(corners[0]))
    for corner in corners.dropFirst() { gc.addLine(to: point(corner)) }
    gc.closePath()
    gc.strokePath()
  }
  gc.setLineWidth(3)
  gc.setStrokeColor(NSColor(red: 0x7F / 255, green: 0xA3 / 255, blue: 0x5A / 255, alpha: 0.9).cgColor)
  let topLeft = point(CGPoint(x: guide.minX, y: guide.maxY))
  let bottomRight = point(CGPoint(x: guide.maxX, y: guide.minY))
  gc.stroke(CGRect(x: topLeft.x, y: bottomRight.y, width: bottomRight.x - topLeft.x, height: topLeft.y - bottomRight.y))
  image.unlockFocus()
  return image
}

for path in arguments.dropFirst(2) {
  let name = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
  guard let image = load(path) else {
    print("\(name): could not be read")
    continue
  }
  let size = image.extent.size
  guard let card = UpkeepCardVision.bestCard(in: image, orientation: .up, allowContrastRetry: true) else {
    print("\(name): NO RECTANGLE (\(Int(size.width))x\(Int(size.height)))")
    if let debug = debugImage(image, corners: [], guide: UpkeepCardVision.guideBox) {
      writePNG(debug, to: outputDirectory.appendingPathComponent("\(name)-debug.png"))
    }
    continue
  }
  let corners = UpkeepCardVision.corners(of: card)
  let box = card.boundingBox
  let pixelAspect = (box.width * size.width) / (box.height * size.height)
  print(String(
    format: "%@: score %.3f confidence %.3f aspect %.3f box (%.3f, %.3f, %.3f, %.3f)",
    name, Double(UpkeepCardVision.liveCardScore(card)), Double(card.confidence),
    Double(pixelAspect), Double(box.minX), Double(box.minY), Double(box.width), Double(box.height)
  ))

  if let straightened = UpkeepCardVision.straighten(image, corners: corners, context: context) {
    let evidence = UpkeepCardText.read(straightened)
    print("    title:    \(evidence.title)")
    print("    printing: \(evidence.printingLines.joined(separator: " | "))")
    writePNG(NSImage(cgImage: straightened, size: .zero),
             to: outputDirectory.appendingPathComponent("\(name)-card.png"))
  } else {
    print("    straighten failed")
  }

  if let guideCrop = UpkeepCardVision.guideCrop(image, context: context) {
    let evidence = UpkeepCardText.read(guideCrop)
    print("    guide title: \(evidence.title)")
  }

  if let debug = debugImage(image, corners: corners, guide: UpkeepCardVision.guideBox) {
    writePNG(debug, to: outputDirectory.appendingPathComponent("\(name)-debug.png"))
  }
}
