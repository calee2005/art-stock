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
class InboxStoreTest {
    @Test
    fun sharedPngLandsInInboxWithoutSecrets() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val png =
            byteArrayOf(
                0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            )
        InboxStore.inboxDir(ctx).listFiles()?.forEach { it.delete() }
        val dest = InboxStore.ingestBytes(ctx, "from-gallery.png", png)
        assertTrue(dest.exists())
        assertEquals("from-gallery.png", dest.name)
        assertTrue(dest.path.contains("/files/inbox/"))
        val json = InboxStore.listJson(ctx)
        assertTrue(json.contains("from-gallery.png"))
        assertFalse(json.contains("secretAccessKey", ignoreCase = true))
        InboxStore.remove(ctx, "from-gallery.png")
        assertFalse(File(InboxStore.inboxDir(ctx), "from-gallery.png").exists())
    }

    @Test
    fun rejectsPathTraversalNames() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val dest = InboxStore.ingestBytes(ctx, "../escape.png", byteArrayOf(1, 2, 3))
        assertEquals("escape.png", dest.name)
        assertTrue(dest.parentFile?.absolutePath?.endsWith("/inbox") == true)
        dest.delete()
    }
}
