package app.artstock.desktop

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeystoreSecretsTest {
    @Test
    fun secretsAreEncryptedInPrefsAndRoundTrip() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val secret = "super-secret-oss"
        KeystoreSecrets.set(ctx, "secretAccessKey", secret)
        KeystoreSecrets.set(ctx, "accessKeyId", "AKIATEST")
        assertEquals(secret, KeystoreSecrets.get(ctx, "secretAccessKey"))
        assertEquals("AKIATEST", KeystoreSecrets.get(ctx, "accessKeyId"))
        assertFalse(KeystoreSecrets.prefsXmlContainsPlaintext(ctx, secret))
        val prefs =
            java.io.File(
                ctx.applicationInfo.dataDir,
                "shared_prefs/${KeystoreSecrets.PREFS_NAME}.xml",
            )
        assertTrue(prefs.exists())
        val xml = prefs.readText()
        assertFalse(xml.contains(secret))
        assertNotEquals(secret, xml)
    }
}
