package app.artstock.desktop

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Public Pad e2e config (endpoint/bucket only). Secrets stay in Keystore.
 */
object PadE2eStore {
    const val CONFIG_NAME = "pad-e2e.json"
    const val STATUS_NAME = "pad-e2e-status.json"

    @JvmStatic
    fun writePublicConfig(
        context: Context,
        endpoint: String,
        bucket: String,
        forcePathStyle: Boolean = true,
        libraryName: String = "Pad库",
    ) {
        val json =
            JSONObject()
                .put("endpoint", endpoint)
                .put("bucket", bucket)
                .put("forcePathStyle", forcePathStyle)
                .put("libraryName", libraryName)
                .toString()
        require(!json.contains("secretAccessKey", ignoreCase = true))
        require(!json.contains("super-secret", ignoreCase = true))
        File(context.filesDir, CONFIG_NAME).writeText(json)
    }

    @JvmStatic
    fun readStatus(context: Context): String? {
        val file = File(context.filesDir, STATUS_NAME)
        if (!file.exists()) {
            return null
        }
        val text = file.readText()
        require(!text.contains("secretAccessKey", ignoreCase = true))
        return text
    }
}
