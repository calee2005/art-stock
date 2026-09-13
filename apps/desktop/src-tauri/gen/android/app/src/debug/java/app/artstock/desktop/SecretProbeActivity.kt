package app.artstock.desktop

import android.app.Activity
import android.os.Bundle
import java.io.File
import java.security.MessageDigest

/**
 * Debug-only ADB hook. Never writes secret material to logcat or probe-status.
 */
class SecretProbeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val out = File(filesDir, "probe-status.txt")
        try {
            val status =
                when (intent.getStringExtra("op") ?: "status") {
                    "set" -> {
                        val key = extra("key")
                        val value = extra("value")
                        KeystoreSecrets.set(this, key, value)
                        "set-ok"
                    }
                    "get-hash" -> {
                        val key = extra("key")
                        val value = KeystoreSecrets.get(this, key)
                        if (value == null) "get-hash missing" else "get-hash ${sha256(value)}"
                    }
                    "assert-no-plaintext" -> {
                        val needle = extra("needle")
                        if (KeystoreSecrets.prefsXmlContainsPlaintext(this, needle)) {
                            "PLAINTEXT-LEAK"
                        } else {
                            "no-plaintext"
                        }
                    }
                    "probe-oss" -> {
                        val endpoint = extra("endpoint")
                        val bucket = intent.getStringExtra("bucket") ?: "art"
                        if (OssProbe.connect(this, endpoint, bucket)) "oss-ok" else "oss-fail"
                    }
                    else -> "unknown-op"
                }
            out.writeText(status)
        } catch (err: Exception) {
            out.writeText("error:${err.javaClass.simpleName}")
        }
        finish()
    }

    private fun extra(name: String): String =
        intent.getStringExtra(name) ?: error("missing extra $name")

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
