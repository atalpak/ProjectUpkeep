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
 * The flow for one card: frame → best rectangle that passes the full-card gate
 * (`bestFullCard`) → outline tracker (one stable outline, no bouncing) → two
 * consecutive steady detections lock it → straighten with the detected quad →
 * OCR title and printing bands → `onCardRead`. Quick scan (`fastDetection`)
 * detects on every frame the device can keep up with, but shows NO outline while
 * searching. It is built for a card held in the hand: once a card has been a
 * valid full card for a few detections (and is not being swept through) every
 * frame is straightened and its sharpness measured, the first one sharp enough is
 * read, and failing that the sharpest seen (`BurstTracker`). Only then is a green
 * outline drawn and held for `greenHold` before the read is delivered, so the
 * person sees what was captured. It also reports what it sees (`onScanStatus`)
 * so the screen can coach ("move closer"). It then refuses to read
 * again until that card has left (`framesUntilRelease` empty detections) or a
 * different card has clearly replaced it (`swapDistance`), which is what stops
 * one card held in frame from being added over and over. A read that JS rejects
 * bumps `retryToken` and the same card is read again (`retryHeldCard`) rather than
 * waiting for it to leave. Focus, exposure and zoom are configured in
 * `configureDevice` and re-applied after every preset change, since a switch
 * of active format discards what was set before it.
 */
public final class UpkeepScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onCardRead = EventDispatcher()
  let onCardLost = EventDispatcher()
  let onOutlineChange = EventDispatcher()
  let onScannerError = EventDispatcher()
  /// Quick scan only: `{ status: ScanStatus.rawValue }`, sent when it changes.
  let onScanStatus = EventDispatcher()

  private static let detectionInterval: TimeInterval = 0.2
  private static let contrastRetryInterval: TimeInterval = 0.75
  /// Quick-scan mode: no throttle. Vision runs synchronously inside the frame
  /// delegate on a serial queue with `alwaysDiscardsLateVideoFrames`, so a slow
  /// detection just makes the camera drop frames rather than queue them up;
  /// the loop is its own busy flag. What stops it locking on a card still
  /// moving is `SettleTracker` (elapsed time, not a detection count).
  private static let fastContrastRetryInterval: TimeInterval = 0.35
  /// Quick scan: how long the green capture outline is on screen before the read
  /// reaches JS (which opens the details and tears the camera down). Counted
  /// from the lock, so OCR time (~0.3s) is part of the hold rather than added
  /// to it; a read that finishes early waits, a slow one is not delayed.
  private static let greenHold: TimeInterval = 0.35
  /// Detection runs on a copy scaled down to this many pixels on its long side
  /// when a buffer is larger. At the 1080p preset the buffer is already 1920, so
  /// this is a no-op; it only guards against a larger format being chosen.
  /// Normalized corners map straight across because the scale is uniform.
  private static let detectionLongSide: CGFloat = 1920
  /// ~0.8s without a full card before the same physical card may be read again.
  /// Time, not a frame count: quick scan detects every frame, so four frames
  /// would be a tenth of a second.
  private static let releaseAfter: TimeInterval = 0.8
  /// A steady card whose centre has jumped this far (normalized) is a
  /// different physical card swapped in without a gap, not the same one.
  private static let swapDistance: CGFloat = 0.15
  /// Quick scan's largest zoom. 1.0 is off, and stays off: a 2.0 cap was tried
  /// with the 4K preset and backed out after phone testing. `CameraFocus.zoom`
  /// still computes a factor (clamped to this cap) if it is ever raised again.
  private static let quickZoomCap: CGFloat = 1.0
  /// After a rejected read JS bumps `retryToken`; the same card is read again this
  /// long after, so the hint is readable and focus has a moment to settle.
  private static let retryDelay: TimeInterval = 0.4
  /// How many times a hold may throw away a blurry 1.2s fallback and wait for a
  /// sharper burst before reading whatever it has. Each is ~1.2s, so 2 bounds the
  /// extra wait at about 2.4s.
  private static let maxBlurryRestarts = 2
  /// The focus point follows the card only when its centre moved this far
  /// (normalized), and at most this often: every change restarts the focus search.
  private static let focusFollowDistance: CGFloat = 0.08
  private static let focusFollowInterval: TimeInterval = 0.5
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

  /// Set once in `configure()` before the session runs; read on frameQueue for
  /// `isAdjustingFocus` (a plain property read, safe off the session queue).
  private var captureDevice: AVCaptureDevice?
  private var configured = false
  private var configurationFailed = false

  private let geometryLock = NSLock()
  private var viewSize: CGSize = .zero
  private var imageSize: CGSize = .zero

  // Everything below is touched only on frameQueue.
  private var lastDetectionAt: TimeInterval = 0
  private var lastContrastRetry: TimeInterval = 0
  private var previousCorners: [CGPoint]?
  private var previousCornersAt: TimeInterval = 0
  private var steadyFrames = 0
  private var tracker = OutlineTracker()
  private var burst = BurstTracker()
  private var statusTracker = ScanStatusTracker()
  private var focusGate = FocusGate()
  private var blurryRestarts = 0
  private var focusCentre: CGPoint?
  private var focusSetAt: TimeInterval = 0
  private var lastFullCardAt: TimeInterval = 0
  /// Bumped from JS each time it rejects a quick-scan read: the card is still in
  /// frame, so re-arm the gate and read it again instead of asking for it to be
  /// taken away. An older JS never sets it, an older native build ignores it.
  public var retryToken = 0 {
    didSet {
      guard retryToken != oldValue else { return }
      frameQueue.asyncAfter(deadline: .now() + Self.retryDelay) { [weak self] in self?.retryHeldCard() }
    }
  }
  /// Read on frameQueue; set from JS (a plain Bool, so a torn read is harmless).
  public var fastDetection = false {
    didSet {
      // The gold corner marks are an aim aid for the normal tab; quick scan
      // shows nothing at all until it captures.
      DispatchQueue.main.async { self.syncGuide() }
      // The prop can arrive after the session was configured, so re-pick the
      // resolution on the session queue rather than only at configure time.
      sessionQueue.async { [weak self] in self?.applyPreset() }
    }
  }
  private var awaitingRelease = false
  /// Bumped whenever a locked card stops being "the card": released, swapped,
  /// or the scanner stopped. A quick-scan read waiting out its green hold
  /// delivers only if this is unchanged, so a card that left (or was replaced)
  /// during the hold cannot report a stale read. Written on frameQueue, read on
  /// main, hence the lock.
  private var generation = 0
  private let generationLock = NSLock()
  private var lastReadCentre: CGPoint?
  private var guideCaptureRequested = false
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
      // Starting can reset what was configured before it ran.
      if let device = self.captureDevice { self.configureDevice(device) }
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
    captureDevice = device
    session.beginConfiguration()
    session.sessionPreset = preferredPreset()
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

  /// 1080p in every mode. A 4K session was tried for quick scan (sharper footer)
  /// and backed out after phone testing: the known-good behaviour is 1080p.
  private func preferredPreset() -> AVCaptureSession.Preset {
    return session.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
  }

  /// Session queue. Switches resolution live when quick scan is toggled after
  /// configuration; a no-op before `configure()` or when it would not change.
  private func applyPreset() {
    guard configured else { return }
    let wanted = preferredPreset()
    if session.sessionPreset != wanted {
      session.beginConfiguration()
      session.sessionPreset = wanted
      session.commitConfiguration()
    }
    // A preset change swaps the device's active format, which discards the focus,
    // exposure and zoom set on the old one -- the first version configured these
    // once and lost them to the 4K switch. Always re-apply, even when the preset
    // did not change, because the zoom depends on the mode.
    if let device = captureDevice { configureDevice(device) }
  }

  /// Session queue. Continuous autofocus limited to the near range (a card is held
  /// at arm's length or closer, and a far-range hunt is what finds the background),
  /// centre metering, no "smooth" autofocus (it slows the lens in video on purpose),
  /// and quick scan's zoom. Idempotent; called at configure, after every preset
  /// change and after the session starts.
  private func configureDevice(_ device: AVCaptureDevice) {
    guard (try? device.lockForConfiguration()) != nil else { return }
    defer { device.unlockForConfiguration() }
    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
    if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
    if device.isSmoothAutoFocusSupported { device.isSmoothAutoFocusEnabled = false }
    // A lock on the old card's position must not outlive it.
    if device.isFocusPointOfInterestSupported { device.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5) }
    if device.isExposurePointOfInterestSupported { device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5) }
    device.videoZoomFactor = zoomFactor(for: device)
  }

  private func zoomFactor(for device: AVCaptureDevice) -> CGFloat {
    guard fastDetection, #available(iOS 15.0, *) else { return 1 }
    let format = device.activeFormat
    return CameraFocus.zoom(minimumFocusDistanceMM: device.minimumFocusDistance,
                            fieldOfViewDegrees: format.videoFieldOfView, cap: Self.quickZoomCap,
                            maxZoom: format.videoMaxZoomFactor,
                            upscaleThreshold: format.videoZoomFactorUpscaleThreshold)
  }

  /// Session queue. Points focus and exposure at the tracked card (`nil` = back to
  /// the centre) so the lens refocuses on the card, not the background behind it.
  /// `oriented` is a Vision point; the device wants the sensor's own space.
  private func aimFocus(at oriented: CGPoint?) {
    guard let device = captureDevice, device.isFocusPointOfInterestSupported,
          (try? device.lockForConfiguration()) != nil else { return }
    defer { device.unlockForConfiguration() }
    let point = oriented.map(CameraFocus.devicePoint(fromOriented:)) ?? CGPoint(x: 0.5, y: 0.5)
    device.focusPointOfInterest = point
    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    if device.isExposurePointOfInterestSupported {
      device.exposurePointOfInterest = point
      if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
    }
  }

  /// frameQueue. Follows the card with the focus point, rate-limited (see the
  /// constants) because each change restarts the focus search.
  private func followWithFocus(_ centre: CGPoint, at now: TimeInterval) {
    if let last = focusCentre,
       hypot(last.x - centre.x, last.y - centre.y) < Self.focusFollowDistance || now - focusSetAt < Self.focusFollowInterval { return }
    focusCentre = centre
    focusSetAt = now
    sessionQueue.async { [weak self] in self?.aimFocus(at: centre) }
  }

  private func recentreFocus() {
    guard focusCentre != nil else { return }
    focusCentre = nil
    sessionQueue.async { [weak self] in self?.aimFocus(at: nil) }
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

    let now = CACurrentMediaTime()
    let fast = fastDetection
    if !fast {
      guard now - lastDetectionAt >= Self.detectionInterval else { return }
    }
    lastDetectionAt = now

    let retry = now - lastContrastRetry >= (fast ? Self.fastContrastRetryInterval : Self.contrastRetryInterval)
    let size = geometry().image
    // Detect on a copy no larger than `detectionLongSide`; the full buffer is
    // kept for the straighten. A lazy scale, so Core Image only ever renders the
    // small version.
    var detectionImage = CIImage(cvPixelBuffer: buffer)
    let longSide = max(size.width, size.height)
    if fast, longSide > Self.detectionLongSide * 1.25 {
      let scale = Self.detectionLongSide / longSide
      detectionImage = detectionImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }
    let found = UpkeepCardVision.findFullCard(in: detectionImage, orientation: .right,
                                              imageSize: size, allowContrastRetry: retry,
                                              minimumArea: fast ? UpkeepCardVision.quickMinimumArea : UpkeepCardVision.minimumArea)
    // Only a retry that actually ran uses up the allowance.
    if found.retryRan { lastContrastRetry = now }
    let card = found.card
    let corners = card.map(UpkeepCardVision.corners)

    if card != nil {
      lastFullCardAt = now
    } else if awaitingRelease && now - lastFullCardAt >= Self.releaseAfter {
      release()
    }

    tracker.observe(corners, at: now, grace: fast ? OutlineTracker.fastGrace : OutlineTracker.normalGrace)

    if fast {
      readQuick(card: card, corners: corners, miss: found.miss, buffer: buffer, at: now)
      return
    }

    let steady = assessStability(corners, at: now)
    updateOutline(tracker.shown)
    // Only the card the outline is following may be read, so what is read is
    // always what the player sees outlined.
    guard let card, let corners, steady, tracker.follows(corners) else { return }
    let centre = CGPoint(x: card.boundingBox.midX, y: card.boundingBox.midY)
    if awaitingRelease {
      guard let previous = lastReadCentre,
            hypot(previous.x - centre.x, previous.y - centre.y) > Self.swapDistance else { return }
      release()
    }
    let image = CIImage(cvPixelBuffer: buffer).oriented(.right)
    // The gate is armed only once a read is really queued. Arming it first
    // would leave a card whose crop failed permanently un-readable (green
    // outline, no result) until it left the frame.
    guard let crop = UpkeepCardVision.straighten(image, corners: corners, context: imageContext) else { return }
    commit(crop, corners: corners, centre: centre, fast: false)
  }

  /// Quick scan's per-frame step: coach, and while a valid card is in view
  /// collect frames and read the sharpest (`BurstTracker`). Everything runs on
  /// frameQueue.
  private func readQuick(card: VNRectangleObservation?, corners: [CGPoint]?, miss: UpkeepCardVision.NearMiss?,
                         buffer: CVPixelBuffer, at now: TimeInterval) {
    if awaitingRelease {
      publish(.reading, at: now)
      // A different card swapped in without a gap releases the gate; the same
      // card staying in frame does not read again.
      guard let card, let corners, tracker.follows(corners), let previous = lastReadCentre,
            hypot(previous.x - card.boundingBox.midX, previous.y - card.boundingBox.midY) > Self.swapDistance else { return }
      release()
      return
    }
    let step = burst.observe(corners, at: now)
    guard let card, let corners else {
      // The burst keeps its best crop across a short gap; the tracker drops it
      // itself when the gap is long enough to end the burst.
      publish(miss.map { $0 == .far ? .far : .partial } ?? .searching, at: now)
      if miss == nil { recentreFocus() }
      return
    }
    // Focus on the card rather than whatever is behind it.
    followWithFocus(CGPoint(x: card.boundingBox.midX, y: card.boundingBox.midY), at: now)
    switch step {
    case .sweeping:
      publish(.moving, at: now)
      return
    case .waiting:
      focusGate.reset()
      return
    case .sample:
      break
    }
    guard tracker.follows(corners) else { return }
    // A frame taken while the lens is still hunting is soft whatever the sharpness
    // threshold says; wait for it (bounded, see `FocusGate`).
    if focusGate.shouldSkip(adjusting: captureDevice?.isAdjustingFocus == true, at: now) {
      publish(.blurry, at: now)
      return
    }
    // The pixel buffer is recycled the moment this delegate call returns, so the
    // straighten has to happen here, synchronously, from the FULL-resolution buffer.
    let image = CIImage(cvPixelBuffer: buffer).oriented(.right)
    guard let crop = UpkeepCardVision.straighten(image, corners: corners, context: imageContext) else { return }
    let centre = CGPoint(x: card.boundingBox.midX, y: card.boundingBox.midY)
    // A blurry 1.2s fallback is thrown away (and the burst restarted) up to
    // `maxBlurryRestarts` times per hold before a soft frame is read anyway.
    let verdict = burst.offer(sharpness: UpkeepCardVision.sharpness(of: crop), crop: crop, at: now,
                              allowBlurryFallback: blurryRestarts >= Self.maxBlurryRestarts)
    switch verdict {
    case .store, .skip:
      publish(.blurry, at: now)
    case .retry:
      blurryRestarts += 1
      focusGate.reset()
      publish(.blurry, at: now)
    case .lockCurrent:
      commit(crop, corners: corners, centre: centre, fast: true)
    case .lockBest:
      commit(burst.bestCrop ?? crop, corners: corners, centre: centre, fast: true)
    }
  }

  /// Sends a status change to JS (quick scan only), after the tracker's own
  /// debounce. Nil = no opinion this frame.
  private func publish(_ status: ScanStatus?, at now: TimeInterval) {
    guard let changed = statusTracker.observe(status, at: now) else { return }
    DispatchQueue.main.async { self.onScanStatus(["status": changed.rawValue]) }
  }

  /// The normal tab's rule: two consecutive steady detections ~0.2s apart.
  private func assessStability(_ corners: [CGPoint]?, at now: TimeInterval) -> Bool {
    guard let corners else {
      previousCorners = nil
      steadyFrames = 0
      return false
    }
    defer {
      previousCorners = corners
      previousCornersAt = now
    }
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

  private func bumpGeneration() {
    generationLock.lock(); generation += 1; generationLock.unlock()
  }

  private func currentGeneration() -> Int {
    generationLock.lock(); defer { generationLock.unlock() }
    return generation
  }

  private func resetTracking() {
    bumpGeneration()
    previousCorners = nil
    burst.reset()
    statusTracker.reset()
    focusGate.reset()
    blurryRestarts = 0
    recentreFocus()
    steadyFrames = 0
    tracker.reset()
    awaitingRelease = false
    guideCaptureRequested = false
    lastReadCentre = nil
    setOutline(hidden: true, locked: false)
  }

  private func release() {
    bumpGeneration()
    awaitingRelease = false
    lastReadCentre = nil
    previousCorners = nil
    burst.reset()
    focusGate.reset()
    blurryRestarts = 0
    recentreFocus()
    steadyFrames = 0
    // Quick scan has no tracking outline to fall back to, so the green one goes.
    setOutline(hidden: fastDetection ? true : nil, locked: false)
    DispatchQueue.main.async { self.onCardLost([:]) }
  }

  /// frameQueue, `retryDelay` after JS rejected a read. Clears the once-per-card
  /// gate so the card still in frame is read again. Does nothing if the card has
  /// already left or been swapped (the gate was released then, and a new card's
  /// burst must not be reset), or the read was accepted (the view is going away).
  private func retryHeldCard() {
    guard awaitingRelease, active else { return }
    bumpGeneration()
    awaitingRelease = false
    lastReadCentre = nil
    burst.reset()
    focusGate.reset()
    // Not `blurryRestarts`: that budget belongs to the hold, not to one read.
    setOutline(hidden: true, locked: false)
  }

  // MARK: - Reading one card

  /// Queues the read of an already-straightened card. `fast` (quick scan) draws
  /// the green outline at the card's current position and holds delivery for
  /// `greenHold`.
  private func commit(_ card: CGImage, corners: [CGPoint], centre: CGPoint, fast: Bool) {
    awaitingRelease = true
    lastReadCentre = centre
    burst.reset()
    var deliverAfter: TimeInterval = 0
    let token = currentGeneration()
    if fast {
      // The one outline quick scan ever draws: green, where the card is now.
      updateOutline(corners)
      deliverAfter = CACurrentMediaTime() + Self.greenHold
      publish(.reading, at: CACurrentMediaTime())
    }
    setOutline(locked: true)
    readQueue.async { self.read(card, source: "outline", deliverAfter: deliverAfter, generation: token) }
  }

  private func captureGuideArea(_ buffer: CVPixelBuffer) {
    let image = CIImage(cvPixelBuffer: buffer).oriented(.right)
    guard let card = UpkeepCardVision.guideCrop(image, context: imageContext) else { return }
    readQueue.async { self.read(card, source: "guide") }
  }

  private func read(_ card: CGImage, source: String, deliverAfter: TimeInterval = 0, generation token: Int? = nil) {
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
    let deliver = {
      // A read finishing after the tab blurred or the view left the screen
      // must not stage a card behind the user's back.
      guard self.window != nil, self.active else { return }
      // Only quick scan's held reads carry a token; the normal tab's read has
      // no hold in which the card could change.
      if deliverAfter > 0, let token, token != self.currentGeneration() { return }
      self.onCardRead(payload)
      // A read JS rejects leaves the card in frame; the green outline must not
      // linger as if it were still being tracked.
      if deliverAfter > 0 { self.frameQueue.async { self.setOutline(hidden: true, locked: false) } }
    }
    let wait = deliverAfter - CACurrentMediaTime()
    if wait > 0 {
      DispatchQueue.main.asyncAfter(deadline: .now() + wait, execute: deliver)
    } else {
      DispatchQueue.main.async(execute: deliver)
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
  /// its file:// URI. This is the same image OCR just read: from the full-resolution
  /// buffer, so about
  /// 700x1000 px (1080p session).
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

  /// Paints the tracker's quad, or hides the outline when it has none. The
  /// tracker has already applied hysteresis, grace and smoothing, so this only
  /// projects and draws.
  private func updateOutline(_ quad: [CGPoint]?) {
    let (view, image) = geometry()
    guard view.width > 0, view.height > 0, image.width > 0, image.height > 0 else { return }
    guard let quad else {
      setOutline(hidden: true)
      return
    }
    let projected = quad.map { UpkeepCardVision.project($0, image: image, view: view) }
    let path = UIBezierPath()
    for (index, point) in projected.enumerated() {
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
    // Detection now runs every frame in quick scan, so only touch the layers
    // when visibility actually changes.
    if let hidden, outlineShown == hidden {
      outlineShown = !hidden
      DispatchQueue.main.async {
        self.outlineLayer.isHidden = hidden
        self.syncGuide()
        self.onOutlineChange(["found": !hidden])
      }
    }
    if let locked {
      let colour = (locked ? Self.outlineGreen : Self.outlineGold).cgColor
      DispatchQueue.main.async { self.outlineLayer.strokeColor = colour }
    }
  }

  /// Main thread. The guide marks show only while there is no outline, and never
  /// in quick scan.
  private func syncGuide() {
    guideLayer.isHidden = fastDetection || !outlineLayer.isHidden
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
