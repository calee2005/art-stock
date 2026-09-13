package app.artstock.desktop

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * After reading Keystore credentials, probe an S3-compatible endpoint.
 * HMAC proves we hold the secret; the secret is never logged.
 */
object OssProbe {
    const val ACCESS_KEY_NAME = "accessKeyId"
    const val SECRET_KEY_NAME = "secretAccessKey"
    private const val PROBE_MSG = "art-stock-oss-probe"

    @JvmStatic
    fun hmacHex(secret: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(PROBE_MSG.toByteArray(Charsets.UTF_8)).joinToString("") { b ->
            "%02x".format(b)
        }
    }

    @JvmStatic
    fun connect(context: Context, endpoint: String, bucket: String): Boolean {
        val access = KeystoreSecrets.get(context, ACCESS_KEY_NAME) ?: return false
        val secret = KeystoreSecrets.get(context, SECRET_KEY_NAME) ?: return false
        val base = endpoint.trimEnd('/')
        val url = URL("$base/$bucket/.artstock/v1/manifest.json")
        val sig = hmacHex(secret)
        val latch = java.util.concurrent.CountDownLatch(1)
        val result = booleanArrayOf(false)
        Thread {
            try {
                val conn = url.openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "GET"
                    conn.connectTimeout = 8000
                    conn.readTimeout = 8000
                    conn.setRequestProperty("X-ArtStock-KeyId", access)
                    conn.setRequestProperty("X-ArtStock-Sig", sig)
                    result[0] = conn.responseCode in 200..299
                } finally {
                    conn.disconnect()
                }
            } catch (_: Exception) {
                result[0] = false
            } finally {
                latch.countDown()
            }
        }.start()
        latch.await(10, java.util.concurrent.TimeUnit.SECONDS)
        return result[0]
    }
}
