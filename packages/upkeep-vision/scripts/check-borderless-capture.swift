// Regression for automatic borderless capture and rejection boundaries.
// Compile with the shipped ios/UpkeepCardVision.swift and provide the normal
// Scryfall image for Oliphaunt LTR #426 as the sole argument.
import AppKit
import CoreImage
import Vision
guard CommandLine.arguments.count == 2, let ref = NSImage(contentsOfFile: CommandLine.arguments[1]) else { fatalError("Supply Oliphaunt LTR #426 normal image") }
func frame(_ name:String, rect:NSRect?, card:Bool) -> CIImage {
 let image=NSImage(size:NSSize(width:700,height:1000))
 image.lockFocus()
 NSColor(white:0.2,alpha:1).setFill();NSRect(x:0,y:0,width:700,height:1000).fill()
 if let rect {
  if card {ref.draw(in:rect)} else {NSColor(white:0.75,alpha:1).setFill();NSBezierPath(roundedRect:rect,xRadius:20,yRadius:20).fill()}
 }
 image.unlockFocus()
 let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
 return CIImage(cgImage:bitmap.cgImage!)
}
let scenes:[(String,NSRect?,Bool)]=[
 ("oliphaunt",NSRect(x:106,y:160,width:488,height:680),true),
 ("partial",NSRect(x:-80,y:160,width:488,height:680),true),
 ("far",NSRect(x:277,y:399,width:145,height:202),true),
 ("phone",NSRect(x:180,y:160,width:340,height:680),false),
 ("wide",NSRect(x:100,y:280,width:500,height:440),false),
 ("blank",nil,false)
]
for (name,rect,isCard) in scenes {
 let image=frame(name,rect:rect,card:isCard)
 let observations=UpkeepCardVision.detectDocument(in:image,orientation:.up)
 let result=UpkeepCardVision.findFullCard(in:image,orientation:.up,imageSize:image.extent.size,allowContrastRetry:true,minimumArea:0.18)
 let segmentPass=UpkeepCardVision.pickFullCard(observations,imageSize:image.extent.size,minimumArea:0.18) != nil
 print(name,"segmentationPass",segmentPass,"pipelinePass",result.card != nil,"segmented",result.segmented,"miss",String(describing:result.miss))
 for r in observations {print("  segment",r.confidence,r.boundingBox)}
 precondition((result.card != nil)==(name == "oliphaunt"),"unexpected pipeline outcome: "+name)
 precondition(segmentPass==(name == "oliphaunt"),"unexpected segmentation outcome: "+name)
}

let tracked = frame("tracked", rect: NSRect(x:106,y:160,width:488,height:680),card:true)
let continued = UpkeepCardVision.findFullCard(in:tracked,orientation:.up,imageSize:tracked.extent.size,allowContrastRetry:false,allowSegmentationRetry:true,minimumArea:0.18)
precondition(continued.card != nil && continued.segmented, "successful segmentation must continue between cold retry slots")
let throttled = UpkeepCardVision.findFullCard(in:tracked,orientation:.up,imageSize:tracked.extent.size,allowContrastRetry:false,allowSegmentationRetry:false,minimumArea:0.18)
precondition(throttled.card == nil && !throttled.retryRan, "a cold miss must respect the fallback rate limit")
print("Borderless fallback and continuation regressions passed")
