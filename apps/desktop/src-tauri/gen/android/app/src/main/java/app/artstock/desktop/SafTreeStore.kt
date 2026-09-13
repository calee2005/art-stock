package app.artstock.desktop

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject
import java.io.File

/**
 * Persisted SAF export-folder grant. Revoke drops the URI so scans stop.
 * The URI is not a secret; never write access keys here.
 */
object SafTreeStore {
    const val PREFS = "artstock.saf"
    const val KEY_URI = "treeUri"
    const val E2E_DIR = "saf-export"

    @JvmStatic
    fun persist(context: Context, uri: Uri) {
        if (uri.scheme == "content") {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_URI, uri.toString())
            .commit()
    }

    @JvmStatic
    fun load(context: Context): Uri? {
        val raw =
            context
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_URI, null) ?: return null
        return Uri.parse(raw)
    }

    @JvmStatic
    fun authorized(context: Context): Boolean = load(context) != null

    @JvmStatic
    fun revoke(context: Context) {
        val uri = load(context)
        if (uri != null && uri.scheme == "content") {
            try {
                context.contentResolver.releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            } catch (_: SecurityException) {
                // Already gone.
            }
        }
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_URI)
            .commit()
    }

    @JvmStatic
    fun openPicker(context: Context) {
        val intent = Intent(context, SafPickActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    @JvmStatic
    fun grantLocalDirForE2e(context: Context): String {
        val dir = File(context.filesDir, E2E_DIR).also { it.mkdirs() }
        val seed = File(dir, "saf-sketch.png")
        if (!seed.exists()) {
            seed.writeBytes(
                byteArrayOf(
                    0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
                    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                    0x08, 0x02, 0x00, 0x00, 0x00, 0x90.toByte(), 0x77, 0x53,
                    0xDE.toByte(), 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
                    0xAE.toByte(), 0x42, 0x60, 0x82.toByte(),
                ),
            )
        }
        persist(context, Uri.fromFile(dir))
        return statusJson(context)
    }

    @JvmStatic
    fun statusJson(context: Context): String {
        val uri = load(context)
        val json =
            JSONObject()
                .put("authorized", uri != null)
                .put("label", uri?.lastPathSegment ?: "")
                .toString()
        require(!json.contains("secretAccessKey", ignoreCase = true))
        return json
    }

    @JvmStatic
    fun scanJson(context: Context): String {
        val uri = load(context)
        if (uri == null) {
            val json = JSONObject().put("authorized", false).put("copied", 0).toString()
            require(!json.contains("secretAccessKey", ignoreCase = true))
            return json
        }
        val copied = copyNewFilesToInbox(context, uri)
        val json = JSONObject().put("authorized", true).put("copied", copied).toString()
        require(!json.contains("secretAccessKey", ignoreCase = true))
        return json
    }

    @JvmStatic
    fun copyNewFilesToInbox(context: Context, uri: Uri): Int {
        var copied = 0
        val inbox = InboxStore.inboxDir(context)
        if (uri.scheme == "file") {
            val dir = uri.path?.let { File(it) } ?: return 0
            dir.listFiles()?.filter { it.isFile }?.forEach { file ->
                if (copyFileIfNew(file, inbox)) {
                    copied += 1
                }
            }
            return copied
        }
        val tree = DocumentFile.fromTreeUri(context, uri) ?: return 0
        tree.listFiles().filter { it.isFile }.forEach { doc ->
            val name = InboxStore.sanitizeName(doc.name ?: "export.bin")
            val dest = File(inbox, name)
            if (dest.exists() && dest.length() == doc.length()) {
                return@forEach
            }
            context.contentResolver.openInputStream(doc.uri)?.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
            copied += 1
        }
        return copied
    }

    private fun copyFileIfNew(file: File, inbox: File): Boolean {
        val name = InboxStore.sanitizeName(file.name)
        val dest = File(inbox, name)
        if (dest.exists() && dest.length() == file.length()) {
            return false
        }
        file.copyTo(dest, overwrite = true)
        return true
    }
}
