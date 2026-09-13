package app.artstock.desktop

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PadE2eStoreTest {
    @Test
    fun publicConfigDoesNotEmbedSecrets() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        PadE2eStore.writePublicConfig(ctx, "http://127.0.0.1:19001", "art")
        val file = java.io.File(ctx.filesDir, PadE2eStore.CONFIG_NAME)
        assertTrue(file.exists())
        val text = file.readText()
        assertTrue(text.contains("127.0.0.1:19001"))
        assertTrue(text.contains("\"bucket\":\"art\""))
        assertFalse(text.contains("secretAccessKey", ignoreCase = true))
        assertFalse(text.contains("super-secret"))
    }
}
