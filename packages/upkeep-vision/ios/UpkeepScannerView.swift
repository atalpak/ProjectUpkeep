import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import ExpoModulesCore
import UIKit
import Vision

/**
 * The live card scanner. Owns its own AVCaptureSession and does detection,
 * outline drawing and OCR entirely in native code, handing JS only finished
 * reads — `expo-camera` cannot expose frames to native code at all, which is
 * why the previous JS-side "take a still every 1.2s and OCR it" loop could
 * never draw an outline that tracks a card.
 *
 * This file is the session, the layers and the per-card state machine. The
 * image maths it calls lives in UpkeepCardVision.swift, deliberately free of
 * Expo and AVFoundation so the offline validation script can run the exact
 * same detection and OCR against still frames.
 *
 * The flow for one card: throttled frame → `bestCard` → stability tracker →
 * two consecutive steady frames locks it → straighten with the detected quad
 * → OCR title and printing bands → `onCardRead`. It then refuses to read
 * again until that card has left (`framesUntilRelease` empty detections) or a
 * different card has clearly replaced it (`swapDistance`), which is what stops
 * one card held in frame from being added over and over.
 */
public final class UpkeepScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onCardRead = EventDispatcher()
  let onCardLost = EventDispatcher()
  let onOutlineChange = EventDispatcher()
  let onScannerError = EventDispatcher()

  private static let detectionInterval: TimeInterval = 0.2
  private static let contrastRetryInterval: TimeInterval = 0.75
  /// Quick-scan mode: look for the card twice as often, and retry with extra
  /// contrast sooner. The two-steady-frames rule is unchanged, so this makes
  /// the lock arrive sooner without accepting a card that is still moving.
  private static let fastDetectionInterval: TimeInterval = 0.1
  private static let fastContrastRetryInterval: TimeInterval = 0.35
  /// ~0.8s of empty frames before the same physical card may be read again.
  private static let framesUntilRelease = 4
  private static let framesUntilOutlineHidden = 3
  /// A steady card whose centre has jumped this far (normalized) is a
  /// different physical card swapped in without a gap, not the same one.
  private static let swapDistance: CGFloat = 0.15
  /// Vision's rectangle confidence, via CardObservation.isUsable in Flutter.
  private static let minimumConfidence: VNConfidence = 0.70
  private static let outlineGold = UIColor(red: 0xC9 / 255, green: 0xA3 / 255, blue: 0x4A / 255, alpha: 1)
  private static let outlineGreen = UIColor(red: 0x7F / 255, green: 0xA3 / 255, blue: 0x5A / 255, alpha: 1)

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "dev.projectupkeep.scanner.session")
  private let frameQueue = DispatchQueue(label: "dev.projectupkeep.scanner.frames")
  // OCR runs off the detection queue so a ~300ms accurate pass never freezes
  // the outline that is still tracking the card in the player's hand.
  private let readQueue = DispatchQueue(label: "dev.projectupkeep.scanner.read", qos: .userInitiated)
  private let output = AVCaptureVideoDataOutput()
  private let imageContext = CIContext(options: nil)
  private lazy var previewLayer = AVCaptureVideoPreviewLayer(session: session)
  private let outlineLayer = CAShapeLayer()
  private let guideLayer = CAShapeLayer()

  private var configured = false
  private var configurationFailed = false

  private let geometryLock = NSLock()
  private var viewSize: CGSize = .zero
  private var imageSize: CGSize = .zero

  // Everything below is touched only on frameQueue.
  private var lastDetectionAt = Date.distantPast
  private var lastContrastRetry = Date.distantPast
  private var previousCorners: [CGPoint]?
  private var steadyFrames = 0
  /// Read on frameQueue; set from JS (a plain Bool, so a torn read is harmless).
  public var fastDetection = false
  private var missedFrames = 0
  private var awaitingRelease = false
  private var lastReadCentre: CGPoint?
  private var guideCaptureRequested = false
  private var smoothedQuad: [CGPoint]?
  private var outlineShown = false

  public var active = false {
    didSet {
      guard active != oldValue else { return }
      active ? start() : stop()
    }
  }

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    for shape in [guideLayer, outlineLayer] {
      shape.fillColor = UIColor.clear.cgColor
      shape.lineJoin = .round
      shape.lineCap = .round
      layer.addSublayer(shape)
    }
    guideLayer.strokeColor = Self.outlineGold.withAlphaComponent(0.68).cgColor
    guideLayer.lineWidth = 2.5
    outlineLayer.strokeColor = Self.outlineGold.cgColor
    outlineLayer.lineWidth = 3
    outlineLayer.isHidden = true
  }

  deinit {
    session.stopRunning()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    guideLayer.frame = bounds
    outlineLayer.frame = bounds
    CATransaction.commit()
    geometryLock.lock()
    viewSize = bounds.size
    geometryLock.unlock()
    drawGuide()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      stop()
    } else if active {
      start()
    }
  }

  /// The full-art fallback: no edge for Vision to find, so read the guide area
  /// the player was told to fill. Serviced on the next frame rather than by
  /// retaining every frame just in case — at 5fps that costs ≤200ms and no
  /// per-frame copy of a 1080p buffer.
  func captureNow() {
    frameQueue.async { self.guideCaptureRequested = true }
  }

  // MARK: - Capture session

  private func start() {
    guard window != nil, !configurationFailed else { return }
    sessionQueue.async { [weak self] in
      guard let self, self.configure(), !self.session.isRunning else { return }
      // The output retains its delegate, so the view is only handed over while
      // running and taken back in stop() -- otherwise view -> session ->
      // output -> view would keep every scanner view alive forever.
      self.output.setSampleBufferDelegate(self, queue: self.frameQueue)
      self.session.startRunning()
    }
  }

  private func stop() {
    frameQueue.async { self.resetTracking() }
    sessionQueue.async { [weak self] in
      guard let self else { return }
      self.output.setSampleBufferDelegate(nil, queue: nil)
      if self.session.isRunning { self.session.stopRunning() }
    }
  }

  private func configure() -> Bool {
    if configured { return true }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      fail("Camera access is off. Enable it in Settings to scan cards.")
      return false
    }
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
          let input = try? AVCaptureDeviceInput(device: device) else {
      // The simulator has no capture device. Degrade to a black view with a
      // message rather than crashing on a developer's machine.
      fail("This device has no usable back camera.")
      return false
    }
    session.beginConfiguration()
    session.sessionPreset = session.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
    guard session.canAddInput(input), session.canAddOutput(output) else {
      session.commitConfiguration()
      fail("The camera could not be opened.")
      return false
    }
    session.addInput(input)
    session.addOutput(output)
    session.commitConfiguration()

    configureDevice(device)
    DispatchQueue.main.async { self.orientPreview() }
    configured = true
    return true
  }

  private func configureDevice(_ device: AVCaptureDevice) {
    guard (try? device.lockForConfiguration()) != nil else { return }
    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
    if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
    device.unlockForConfiguration()
  }

  /// Only the preview layer is rotated. The video data output keeps its native
  /// landscape buffers and Vision is told `.right` instead — rotating frames
  /// too would cost a conversion per frame for nothing.
  private func orientPreview() {
    guard let connection = previewLayer.connection else { return }
    if #available(iOS 17.0, *) {
      if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
    } else if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
  }

  private func fail(_ message: String) {
    configurationFailed = true
    DispatchQueue.main.async { self.onScannerError(["message": message]) }
  }

  // MARK: - Detection loop

  public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    // A back camera held portrait produces a landscape buffer whose "up" is to
    // the right, and Vision reports normalized coordinates in the ORIENTED
    // space — so the size recorded here is the buffer's, swapped. That is what
    // makes the quad→view mapping a plain aspect-fill sum rather than a second
    // rotation.
    geometryLock.lock()
    let firstFrame = imageSize == .zero
    imageSize = CGSize(width: CVPixelBufferGetHeight(buffer), height: CVPixelBufferGetWidth(buffer))
    geometryLock.unlock()
    // layoutSubviews runs before any frame exists, so the guide marks are
    // first drawn from a placeholder. Redraw them once the real frame size
    // makes the true aspect-fill mapping available.
    if firstFrame { DispatchQueue.main.async { self.drawGuide() } }

    if guideCaptureRequested {
      guideCaptureRequested = false
      captureGuideArea(buffer)
      return
    }

    let now = Date()
    guard now.timeIntervalSince(lastDetectionAt) >= (fastDetection ? Self.fastDetectionInterval : Self.detectionInterval) else { return }
    lastDetectionAt = now

    let retry = now.timeIntervalSince(lastContrastRetry) >= (fastDetection ? Self.fastContrastRetryInterval : Self.contrastRetryInterval)
    if retry { lastContrastRetry = now }
    let card = UpkeepCardVision.bestCard(in: CIImage(cvPixelBuffer: buffer), orientation: .right, allowContrastRetry: retry)
    let corners = card.map(UpkeepCardVision.corners)

    if card == nil {
      missedFrames += 1
      if awaitingRelease && missedFrames >= Self.framesUntilRelease { release() }
    } else {
      missedFrames = 0
    }

    let steady = assessStability(corners)
    updateOutline(corners)

    guard let card, let corners, steady, card.confidence >= Self.minimumConfidence else { return }
    let centre = CGPoint(x: card.boundingBox.midX, y: card.boundingBox.midY)
    if awaitingRelease {
      guard let previous = lastReadCentre,
            hypot(previous.x - centre.x, previous.y - centre.y) > Self.swapDistance else { return }
      release()
    }
    lock(corners: corners, centre: centre, buffer: buffer)
  }

  private func assessStability(_ corners: [CGPoint]?) -> Bool {
    guard let corners else {
      previousCorners = nil
      steadyFrames = 0
      return false
    }
    defer { previousCorners = corners }
    guard let previous = previousCorners, previous.count == corners.count else {
      steadyFrames = 1
      return false
    }
    if UpkeepCardVision.isSteady(movement: UpkeepCardVision.movement(from: previous, to: corners)) {
      steadyFrames += 1
    } else {
      steadyFrames = 0
    }
    return steadyFrames >= 2
  }

  private func resetTracking() {
    previousCorners = nil
    steadyFrames = 0
    missedFrames = 0
    awaitingRelease = false
    guideCaptureRequested = false
    lastReadCentre = nil
    smoothedQuad = nil
    setOutline(hidden: true, locked: false)
  }

  private func release() {
    awaitingRelease = false
    lastReadCentre = nil
    previousCorners = nil
    steadyFrames = 0
    setOutline(locked: false)
    DispatchQueue.main.async { self.onCardLost([:]) }
  }

  // MARK: - Reading one card

  private func lock(corners: [CGPoint], centre: CGPoint, buffer: CVPixelBuffer) {
    // The pixel buffer is recycled the moment this delegate call returns, so
    // the straighten has to happen here, synchronously, before handing an
    // independent CGImage to the OCR queue.
    let image = CIImage(cvPixelBuffer: buffer).oriented(.right)
    // The gate is armed only once a read is really queued. Arming it first
    // would leave a card whose crop failed permanently un-readable (green
    // outline, no result) until it left the frame.
    guard let card = UpkeepCardVision.straighten(image, corners: corners, context: imageContext) else { return }
    awaitingRelease = true
    lastReadCentre = centre
    setOutline(locked: true)
    readQueue.async { self.read(card, source: "outline") }
  }

  private func captureGuideArea(_ buffer: CVPixelBuffer) {
    let image = CIImage(cvPixelBuffer: buffer).oriented(.right)
    guard let card = UpkeepCardVision.guideCrop(image, context: imageContext) else { return }
    readQueue.async { self.read(card, source: "guide") }
  }

  private func read(_ card: CGImage, source: String) {
    let evidence = UpkeepCardText.read(card)
    var payload: [String: Any] = [
      "title": evidence.title,
      "lines": evidence.lines,
      "printingLines": evidence.printingLines,
      "source": source
    ]
    // The straightened card itself, so JS can compare its picture with each
    // candidate printing's (`rankCardImage`). Text alone cannot tell a full-art
    // promo from its reprint when the footer is unreadable. Left out if the
    // write fails: an older JS or a full disk degrades to text-only.
    if let uri = Self.writeSnapshot(card) { payload["imageUri"] = uri }
    DispatchQueue.main.async {
      // A read finishing after the tab blurred or the view left the screen
      // must not stage a card behind the user's back.
      guard self.window != nil, self.active else { return }
      self.onCardRead(payload)
    }
  }

  // MARK: - Snapshot of the straightened card

  /// Only the newest few are kept, so a session of scans never accumulates
  /// files. A read is verified in JS (downloads plus a comparison, seconds) and
  /// its details sheet holds the photo open after that, so nothing is removed
  /// while it is young, whatever the count.
  private static let snapshotsKept = 12
  private static let snapshotMinimumAge: TimeInterval = 60
  private static let snapshotDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    .appendingPathComponent("upkeep-scan", isDirectory: true)

  /// Writes the straightened card as a JPEG in the temp directory and returns
  /// its file:// URI. This is the same image OCR just read, at the resolution
  /// the 1080p preview gives (the card fills roughly 700x1000 px); a sharper
  /// capture for the footer would need a still-photo output on the session and
  /// was deliberately left out of this change.
  private static func writeSnapshot(_ card: CGImage) -> String? {
    let manager = FileManager.default
    do {
      try manager.createDirectory(at: snapshotDirectory, withIntermediateDirectories: true)
      let modified: (URL) -> Date = {
        (try? $0.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
      }
      let existing = try manager.contentsOfDirectory(at: snapshotDirectory, includingPropertiesForKeys: [.contentModificationDateKey])
      // Make room for the one about to be written, but never remove a file
      // that may still be on screen or being compared.
      let now = Date()
      for old in existing.sorted(by: { modified($0) > modified($1) }).dropFirst(snapshotsKept - 1)
      where now.timeIntervalSince(modified(old)) > snapshotMinimumAge {
        try? manager.removeItem(at: old)
      }
      guard let data = UIImage(cgImage: card).jpegData(compressionQuality: 0.92) else { return nil }
      let url = snapshotDirectory.appendingPathComponent("scan-\(UUID().uuidString).jpg")
      try data.write(to: url, options: .atomic)
      return url.absoluteString
    } catch {
      return nil
    }
  }

  // MARK: - Drawing

  private func geometry() -> (view: CGSize, image: CGSize) {
    geometryLock.lock()
    defer { geometryLock.unlock() }
    return (viewSize, imageSize)
  }

  private func updateOutline(_ corners: [CGPoint]?) {
    let (view, image) = geometry()
    guard view.width > 0, view.height > 0, image.width > 0, image.height > 0 else { return }

    guard let corners else {
      if missedFrames >= Self.framesUntilOutlineHidden {
        smoothedQuad = nil
        setOutline(hidden: true)
      }
      return
    }
    let projected = corners.map { UpkeepCardVision.project($0, image: image, view: view) }
    // Raw corners shake by a few pixels between detections. Smooth only the
    // painted line, never the lock decision, so the outline glides without
    // making the scan slower.
    let quad: [CGPoint]
    if let previous = smoothedQuad, previous.count == projected.count {
      quad = zip(previous, projected).map { previous, next in
        CGPoint(x: previous.x + (next.x - previous.x) * 0.35, y: previous.y + (next.y - previous.y) * 0.35)
      }
    } else {
      quad = projected
    }
    smoothedQuad = quad

    let path = UIBezierPath()
    for (index, point) in quad.enumerated() {
      index == 0 ? path.move(to: point) : path.addLine(to: point)
    }
    path.close()
    let cgPath = path.cgPath
    DispatchQueue.main.async {
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      self.outlineLayer.path = cgPath
      CATransaction.commit()
    }
    setOutline(hidden: false)
  }

  private func setOutline(hidden: Bool? = nil, locked: Bool? = nil) {
    if let hidden {
      let changed = outlineShown == hidden
      outlineShown = !hidden
      DispatchQueue.main.async {
        self.outlineLayer.isHidden = hidden
        self.guideLayer.isHidden = !hidden
        if changed { self.onOutlineChange(["found": !hidden]) }
      }
    }
    if let locked {
      let colour = (locked ? Self.outlineGreen : Self.outlineGold).cgColor
      DispatchQueue.main.async { self.outlineLayer.strokeColor = colour }
    }
  }

  /// The four gold L-marks, drawn from the same guide rectangle the manual
  /// capture reads — so "fit the card inside the marks" is literally true.
  private func drawGuide() {
    let view = bounds.size
    let (_, image) = geometry()
    guard view.width > 0, view.height > 0 else { return }
    let box = UpkeepCardVision.guideBox
    let rect: CGRect
    if image.width > 0, image.height > 0 {
      let topLeft = UpkeepCardVision.project(CGPoint(x: box.minX, y: box.maxY), image: image, view: view)
      let bottomRight = UpkeepCardVision.project(CGPoint(x: box.maxX, y: box.minY), image: image, view: view)
      rect = CGRect(x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y)
    } else {
      // Before the first frame there is no image size to map through. A
      // card-shaped placeholder keeps the marks from jumping into position.
      let width = view.width * 0.8
      rect = CGRect(x: (view.width - width) / 2, y: (view.height - width / 0.714) / 2, width: width, height: width / 0.714)
    }
    let arm = rect.width * 0.16
    let path = UIBezierPath()
    for (x, y, dx, dy) in [(rect.minX, rect.minY, arm, arm), (rect.maxX, rect.minY, -arm, arm),
                           (rect.minX, rect.maxY, arm, -arm), (rect.maxX, rect.maxY, -arm, -arm)] {
      path.move(to: CGPoint(x: x + dx, y: y))
      path.addLine(to: CGPoint(x: x, y: y))
      path.addLine(to: CGPoint(x: x, y: y + dy))
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    guideLayer.path = path.cgPath
    CATransaction.commit()
  }
}
