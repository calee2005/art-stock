package app.artstock.desktop

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File

/**
 * Pad sandbox: metadata SQLite under [Context.getDatabasePath],
 * OS-reclaimable [Context.getCacheDir], durable [pinned] under filesDir.
 */
object SandboxStore {
    private const val DB_NAME = "metadata.db"
    private const val CACHE_BLOBS = "blobs"
    private const val PINNED = "pinned"

    @JvmStatic
    fun metadataDb(context: Context): File = context.getDatabasePath(DB_NAME)

    @JvmStatic
    fun cacheDir(context: Context): File = File(context.cacheDir, CACHE_BLOBS).also { it.mkdirs() }

    @JvmStatic
    fun pinnedDir(context: Context): File = File(context.filesDir, PINNED).also { it.mkdirs() }

    @JvmStatic
    fun putMeta(context: Context, key: String, value: String) {
        require(key.isNotEmpty() && !key.contains("secretAccessKey")) { "invalid meta key" }
        open(context).use { db ->
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
            )
            db.execSQL(
                "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
                arrayOf(key, value),
            )
        }
    }

    @JvmStatic
    fun getMeta(context: Context, key: String): String? {
        open(context).use { db ->
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
            )
            db.rawQuery("SELECT value FROM meta WHERE key = ?", arrayOf(key)).use { cursor ->
                return if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }
    }

    @JvmStatic
    fun reclaimCache(context: Context) {
        cacheDir(context).listFiles()?.forEach { child ->
            child.deleteRecursively()
        }
    }

    private fun open(context: Context): SQLiteDatabase =
        context.openOrCreateDatabase(DB_NAME, Context.MODE_PRIVATE, null)
}
