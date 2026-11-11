@file:Suppress("DEPRECATION")

package com.watchman.app.car

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The phone's Supabase session, handed to the car process. Never log any field of this class.
 */
data class CarSession(
    val accessToken: String,
    val refreshToken: String,
    /** Unix seconds; 0 when unknown. */
    val expiresAt: Long = 0L,
    val userId: String,
    val supabaseUrl: String,
    val anonKey: String,
    val email: String? = null,
    val userName: String? = null,
    val organizationId: String? = null,
) {
    fun displayLabel(): String = when {
        !userName.isNullOrBlank() -> userName.trim()
        !email.isNullOrBlank() -> email.trim()
        else -> ""
    }

    fun isPresent(): Boolean = accessToken.isNotBlank() && userId.isNotBlank()

    // Keep tokens out of any accidental toString() / log line.
    override fun toString(): String = "CarSession(userId=$userId)"
}

/** Tokens the car refreshed itself. Never log any field. */
data class NativeRefresh(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long,
    val userId: String,
) {
    override fun toString(): String = "NativeRefresh(userId=$userId)"
}

/**
 * Encrypted hand-off store. The Capacitor plugin writes it; the Android Auto session reads it,
 * even when the WebView is not running. Every failure degrades to "no session"; nothing throws.
 */
object CarSessionStore {

    private const val PREFS_NAME = "watchman_car_session"

    private const val KEY_ACCESS_TOKEN = "accessToken"
    private const val KEY_REFRESH_TOKEN = "refreshToken"
    private const val KEY_EXPIRES_AT = "expiresAt"
    private const val KEY_USER_ID = "userId"
    private const val KEY_SUPABASE_URL = "supabaseUrl"
    private const val KEY_ANON_KEY = "anonKey"
    private const val KEY_EMAIL = "email"
    private const val KEY_USER_NAME = "userName"
    private const val KEY_ORGANIZATION_ID = "organizationId"

    /** Epoch ms of the last car-side token refresh; save() clears it, so a JS sync resets it. */
    private const val KEY_NATIVE_REFRESHED_AT = "nativeRefreshedAt"

    private val lock = Any()

    @JvmStatic
    fun save(context: Context, session: CarSession) {
        synchronized(lock) {
            val prefs = openPrefs(context) ?: throw IllegalStateException("session store unavailable")
            val saved = prefs.edit()
                .clear()
                .putString(KEY_ACCESS_TOKEN, session.accessToken)
                .putString(KEY_REFRESH_TOKEN, session.refreshToken)
                .putLong(KEY_EXPIRES_AT, session.expiresAt)
                .putString(KEY_USER_ID, session.userId)
                .putString(KEY_SUPABASE_URL, session.supabaseUrl)
                .putString(KEY_ANON_KEY, session.anonKey)
                .putString(KEY_EMAIL, session.email)
                .putString(KEY_USER_NAME, session.userName)
                .putString(KEY_ORGANIZATION_ID, session.organizationId)
                .commit()
            if (!saved) throw IllegalStateException("session store write failed")
        }
    }

    @JvmStatic
    fun read(context: Context): CarSession? = synchronized(lock) {
        try {
            val prefs = openPrefs(context) ?: return@synchronized null
            val session = CarSession(
                accessToken = prefs.getString(KEY_ACCESS_TOKEN, null).orEmpty(),
                refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null).orEmpty(),
                expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L),
                userId = prefs.getString(KEY_USER_ID, null).orEmpty(),
                supabaseUrl = prefs.getString(KEY_SUPABASE_URL, null).orEmpty(),
                anonKey = prefs.getString(KEY_ANON_KEY, null).orEmpty(),
                email = prefs.getString(KEY_EMAIL, null),
                userName = prefs.getString(KEY_USER_NAME, null),
                organizationId = prefs.getString(KEY_ORGANIZATION_ID, null),
            )
            if (session.isPresent() && session.supabaseUrl.isNotBlank() && session.anonKey.isNotBlank()) {
                session
            } else {
                null
            }
        } catch (ignored: Exception) {
            null
        }
    }

    /**
     * Rewrites only the three token keys after the car process refreshed the session, and stamps
     * KEY_NATIVE_REFRESHED_AT. Does nothing when the store has no signed-in user (so a sign-out
     * is never undone by a late refresh). Returns whether it wrote.
     */
    @JvmStatic
    fun updateTokens(context: Context, accessToken: String, refreshToken: String, expiresAt: Long): Boolean =
        synchronized(lock) {
            val prefs = openPrefs(context) ?: return@synchronized false
            if (prefs.getString(KEY_USER_ID, null).isNullOrBlank()) return@synchronized false
            prefs.edit()
                .putString(KEY_ACCESS_TOKEN, accessToken)
                .putString(KEY_REFRESH_TOKEN, refreshToken)
                .putLong(KEY_EXPIRES_AT, expiresAt)
                .putLong(KEY_NATIVE_REFRESHED_AT, System.currentTimeMillis())
                .commit()
        }

    /** Tokens the car refreshed on its own, or null when the phone's own sync is still current. */
    @JvmStatic
    fun readNativeRefresh(context: Context): NativeRefresh? = synchronized(lock) {
        try {
            val prefs = openPrefs(context) ?: return@synchronized null
            if (prefs.getLong(KEY_NATIVE_REFRESHED_AT, 0L) <= 0L) return@synchronized null
            val refresh = NativeRefresh(
                accessToken = prefs.getString(KEY_ACCESS_TOKEN, null).orEmpty(),
                refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null).orEmpty(),
                expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L),
                userId = prefs.getString(KEY_USER_ID, null).orEmpty(),
            )
            if (refresh.accessToken.isBlank() || refresh.refreshToken.isBlank() || refresh.userId.isBlank()) null else refresh
        } catch (ignored: Exception) {
            null
        }
    }

    @JvmStatic
    fun clear(context: Context) {
        synchronized(lock) {
            val prefs = openPrefs(context) ?: throw IllegalStateException("session store unavailable")
            if (!prefs.edit().clear().commit()) throw IllegalStateException("session store clear failed")
        }
    }

    /** Opens the encrypted prefs. On failure, wipes the file once and retries, then gives up. */
    private fun openPrefs(context: Context): SharedPreferences? {
        val appContext = context.applicationContext ?: context
        return try {
            createPrefs(appContext)
        } catch (ignored: Exception) {
            try {
                appContext.deleteSharedPreferences(PREFS_NAME)
                createPrefs(appContext)
            } catch (retryFailed: Exception) {
                null
            }
        }
    }

    private fun createPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
}
