package app.artstock.desktop

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Remote credentials: AES-GCM with a non-exportable Android Keystore key.
 * Ciphertext may live in SharedPreferences; plaintext secrets must not.
 */
object KeystoreSecrets {
    init {
        System.loadLibrary("art_stock_lib")
    }

    /** Store JavaVM + Application context before any Tauri `secure_store_*` IPC. */
    @JvmStatic
    external fun nativeAttach(context: Context)

    const val PREFS_NAME = "artstock.secrets.enc"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val MASTER_ALIAS = "artstock.master"
    private const val GCM_IV_LEN = 12
    private const val GCM_TAG_BITS = 128
    private val KEY_RE = Regex("^[A-Za-z0-9._-]{1,128}$")

    @JvmStatic
    fun set(context: Context, key: String, value: String) {
        require(KEY_RE.matches(key)) { "secret key must be [A-Za-z0-9._-]" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val packed = ByteArray(iv.size + encrypted.size)
        System.arraycopy(iv, 0, packed, 0, iv.size)
        System.arraycopy(encrypted, 0, packed, iv.size, encrypted.size)
        context
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(key, Base64.encodeToString(packed, Base64.NO_WRAP))
            .commit()
    }

    @JvmStatic
    fun get(context: Context, key: String): String? {
        require(KEY_RE.matches(key)) { "secret key must be [A-Za-z0-9._-]" }
        val packedB64 =
            context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(key, null) ?: return null
        val raw = Base64.decode(packedB64, Base64.NO_WRAP)
        require(raw.size > GCM_IV_LEN) { "ciphertext too short" }
        val iv = raw.copyOfRange(0, GCM_IV_LEN)
        val ct = raw.copyOfRange(GCM_IV_LEN, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }

    @JvmStatic
    fun prefsXmlContainsPlaintext(context: Context, needle: String): Boolean {
        val prefs = java.io.File(context.applicationInfo.dataDir, "shared_prefs/$PREFS_NAME.xml")
        if (!prefs.exists()) {
            return false
        }
        return prefs.readText().contains(needle)
    }

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(MASTER_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                MASTER_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return gen.generateKey()
    }
}
