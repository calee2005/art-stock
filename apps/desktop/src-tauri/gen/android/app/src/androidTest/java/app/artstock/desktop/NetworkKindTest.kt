package app.artstock.desktop

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NetworkKindTest {
    @Test
    fun emulatorReportsATransportWithoutSecrets() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val kind = NetworkKind.current(ctx)
        assertTrue(kind == "wifi" || kind == "other" || kind == "offline" || kind == "cellular")
        assertFalse(kind.contains("secret", ignoreCase = true))
    }
}
