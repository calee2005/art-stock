package app.artstock.desktop

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Local share inbox under filesDir/inbox. Not uploaded until the user archives
 * into the asset library (withRemoteLock in packages/core).
 */
object InboxStore {
    const val DIR_NAME = "inbox"
    private val NAME_RE = Regex("^[A-Za-z0-9._-]{1,128}$")

    @JvmStatic
    fun inboxDir(context: Context): File = File(context.filesDir, DIR_NAME).also { it.mkdirs() }

    @JvmStatic
    fun sanitizeName(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\')
        val trimmed = base.ifBlank { "shared.bin" }
        val noDots = trimmed.replace("..", "_")
        val safe = noDots.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val clipped = safe.take(128)
        require(NAME_RE.matches(clipped)) { "invalid inbox name" }
        return clipped
    }

    @JvmStatic
    fun ingestBytes(context: Context, name: String, bytes: ByteArray): File {
        val dest = File(inboxDir(context), sanitizeName(name))
        dest.writeBytes(bytes)
        return dest
    }

    @JvmStatic
    fun ingestUri(context: Context, uri: Uri): File {
        val display = queryDisplayName(context, uri) ?: "shared.bin"
        val dest = File(inboxDir(context), sanitizeName(display))
        context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "cannot open shared uri" }
            dest.outputStream().use { output -> input.copyTo(output) }
        }
        return dest
    }

    @JvmStatic
    fun ingestIntent(context: Context, intent: Intent): File? {
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) {
            return null
        }
        val uri =
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
        return uri?.let { ingestUri(context, it) }
    }

    @JvmStatic
    fun listJson(context: Context): String {
        val arr = JSONArray()
        inboxDir(context).listFiles()?.sortedBy { it.name }?.forEach { file ->
            if (file.isFile) {
                arr.put(
                    JSONObject()
                        .put("name", file.name)
                        .put("size", file.length())
                        .put("mimeGuess", mimeGuess(file.name)),
                )
            }
        }
        val json = arr.toString()
        require(!json.contains("secretAccessKey", ignoreCase = true))
        return json
    }

    @JvmStatic
    fun remove(context: Context, name: String) {
        val dest = File(inboxDir(context), sanitizeName(name))
        if (dest.exists()) {
            dest.delete()
        }
    }

    private fun mimeGuess(name: String): String {
        val lower = name.lowercase()
        return when {
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".pdf") -> "application/pdf"
            else -> "application/octet-stream"
        }
    }

    private fun queryDisplayName(context: Context, uri: Uri): String? {
        if (uri.scheme == "file") {
            return uri.lastPathSegment
        }
        val cursor = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val idx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) {
                    return it.getString(idx)
                }
            }
        }
        return uri.lastPathSegment
    }
}
