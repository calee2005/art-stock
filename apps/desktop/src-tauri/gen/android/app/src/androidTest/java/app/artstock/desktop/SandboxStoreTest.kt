package app.artstock.desktop

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class SandboxStoreTest {
    @Test
    fun sqliteLivesInAppSandboxAndCacheIsSeparateFromPinned() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val db = SandboxStore.metadataDb(ctx)
        assertTrue(db.path.contains("/data/user/") || db.path.contains("/data/data/"))
        assertTrue(db.path.contains("app.artstock.desktop"))
        assertTrue(db.path.endsWith("databases/metadata.db") || db.parentFile?.name == "databases")

        SandboxStore.putMeta(ctx, "libraryCount", "2")
        assertEquals("2", SandboxStore.getMeta(ctx, "libraryCount"))
        assertFalse(db.readBytes().toString(Charsets.ISO_8859_1).contains("secretAccessKey"))

        val cacheFile = File(SandboxStore.cacheDir(ctx), "thumb.bin")
        val pinFile = File(SandboxStore.pinnedDir(ctx), "original.bin")
        cacheFile.writeBytes(byteArrayOf(1, 2, 3))
        pinFile.writeBytes(byteArrayOf(9, 9, 9))
        assertTrue(cacheFile.exists())
        assertTrue(pinFile.exists())
        assertFalse(
            SandboxStore.cacheDir(ctx).canonicalPath == SandboxStore.pinnedDir(ctx).canonicalPath,
        )
        assertTrue(SandboxStore.cacheDir(ctx).canonicalPath.contains("cache"))
        assertFalse(SandboxStore.pinnedDir(ctx).canonicalPath.contains("/cache/"))

        SandboxStore.reclaimCache(ctx)
        assertFalse(cacheFile.exists())
        assertTrue(pinFile.exists())
        assertEquals("2", SandboxStore.getMeta(ctx, "libraryCount"))
    }
}
