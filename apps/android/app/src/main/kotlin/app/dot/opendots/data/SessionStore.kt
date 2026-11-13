package app.dot.opendots.data

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
 * Where the app remembers which OpenDots server it talks to and its session cookie. The cookie is encrypted with an
 * AES-GCM key that never leaves the Android Keystore; if the Keystore is unavailable the session simply is not
 * persisted (the user signs in again), it is never written in clear.
 */
interface SessionStore {
    var serverUrl: String?
    var sessionCookie: String?
    var themeMode: String
    var reduceTransparency: Boolean
    var lastAgentId: String?
}

class MemorySessionStore(
    override var serverUrl: String? = null,
    override var sessionCookie: String? = null,
    override var themeMode: String = "SYSTEM",
    override var reduceTransparency: Boolean = false,
    override var lastAgentId: String? = null,
) : SessionStore

class PrefsSessionStore(context: Context) : SessionStore {
    private val prefs = context.applicationContext.getSharedPreferences("opendots", Context.MODE_PRIVATE)

    override var serverUrl: String?
        get() = prefs.getString("server", null)
        set(value) = prefs.edit().putString("server", value).apply()

    override var themeMode: String
        get() = prefs.getString("theme", "SYSTEM") ?: "SYSTEM"
        set(value) = prefs.edit().putString("theme", value).apply()

    override var reduceTransparency: Boolean
        get() = prefs.getBoolean("reduceTransparency", false)
        set(value) = prefs.edit().putBoolean("reduceTransparency", value).apply()

    override var lastAgentId: String?
        get() = prefs.getString("agent", null)
        set(value) = prefs.edit().putString("agent", value).apply()

    private var memoryCookie: String? = null
    private var loaded = false

    override var sessionCookie: String?
        get() {
            if (!loaded) {
                loaded = true
                memoryCookie = prefs.getString("session", null)?.let { runCatching { decrypt(it) }.getOrNull() }
            }
            return memoryCookie
        }
        set(value) {
            loaded = true
            memoryCookie = value
            val sealed = value?.let { runCatching { encrypt(it) }.getOrNull() }
            prefs.edit().apply { if (sealed == null) remove("session") else putString("session", sealed) }.apply()
        }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val body = cipher.doFinal(plain.toByteArray())
        return Base64.encodeToString(cipher.iv + body, Base64.NO_WRAP)
    }

    private fun decrypt(sealed: String): String {
        val bytes = Base64.decode(sealed, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12)) }
        return String(cipher.doFinal(bytes, 12, bytes.size - 12))
    }

    private companion object {
        const val ALIAS = "opendots.session"
        const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
