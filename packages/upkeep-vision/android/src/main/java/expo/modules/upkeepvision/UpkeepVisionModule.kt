package expo.modules.upkeepvision

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

class UpkeepVisionModule : Module() {
  private val busy = AtomicBoolean(false)
  override fun definition() = ModuleDefinition {
    Name("UpkeepVision")
    AsyncFunction("readText") { uri: String, promise: Promise ->
      if (!busy.compareAndSet(false, true)) {
        promise.reject("E_BUSY", "Recognition is already running", null)
      } else {
        try {
          val context = appContext.reactContext ?: throw IllegalStateException("No application context")
          val parsed = Uri.parse(uri)
          require(parsed.scheme == "file") { "A local photo is required" }
          val image = InputImage.fromFilePath(context, parsed)
          val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
          recognizer.process(image)
            .addOnSuccessListener { text ->
              val lines = text.textBlocks.flatMap { it.lines }.sortedWith(compareBy({ it.boundingBox?.top ?: 0 }, { it.boundingBox?.left ?: 0 }))
              // Reading order is retained; footer hints are isolated from title/rules text.
              val footer = lines.filter { (it.boundingBox?.top ?: 0) > image.height * 0.78 }
              promise.resolve(mapOf("lines" to lines.take(8).map { it.text }, "printingLines" to footer.map { it.text }))
            }
            .addOnFailureListener { promise.reject("E_OCR", "Could not read this photo", it) }
            .addOnCompleteListener { recognizer.close(); busy.set(false) }
        } catch (error: Exception) {
          busy.set(false)
          promise.reject("E_IMAGE", "Could not open this photo", error)
        }
      }
    }
    AsyncFunction("compareArtwork") { _: String, _: List<String> ->
      // Apple Vision feature prints have no cross-platform representation.
      mapOf("index" to -1, "confident" to false)
    }
  }
}
