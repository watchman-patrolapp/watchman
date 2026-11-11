package com.watchman.app.car

import android.content.Context
import android.os.Looper
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Minimal Supabase REST client for the car process. Blocking: call it only from a background
 * thread (CarRepository does). It never logs tokens, headers or bodies.
 */
class SupabaseCarClient(context: Context) {

    private val appContext: Context = context.applicationContext ?: context

    private sealed class Raw {
        class Success(val json: JSONObject) : Raw()
        object Unauthorized : Raw()
        object Outdated : Raw()
        object Offline : Raw()
        object Error : Raw()
    }

    fun rpc(name: String, body: JSONObject): CarResult<JSONObject> {
        if (Looper.myLooper() == Looper.getMainLooper()) return CarResult.Fail(FailKind.UNKNOWN)

        var session = CarSessionStore.read(appContext) ?: return CarResult.Fail(FailKind.SIGNED_OUT)

        if (CarLogic.needsTokenRefresh(session.expiresAt, nowSec())) {
            when (val refreshed = refresh(session.accessToken, force = false)) {
                is CarResult.Ok -> session = refreshed.value
                is CarResult.Fail -> return CarResult.Fail(refreshed.kind)
            }
        }

        var raw = post(session, name, body)
        if (raw is Raw.Unauthorized) {
            when (val refreshed = refresh(session.accessToken, force = true)) {
                is CarResult.Ok -> {
                    session = refreshed.value
                    raw = post(session, name, body)
                }
                is CarResult.Fail -> return CarResult.Fail(refreshed.kind)
            }
        }

        return when (raw) {
            is Raw.Success -> CarResult.Ok(raw.json)
            Raw.Unauthorized -> CarResult.Fail(FailKind.SIGNED_OUT)
            Raw.Outdated -> CarResult.Fail(FailKind.SERVER_OUTDATED)
            Raw.Offline -> CarResult.Fail(FailKind.OFFLINE)
            Raw.Error -> CarResult.Fail(FailKind.UNKNOWN)
        }
    }

    /**
     * Single-flight refresh. Re-reads the store first because the phone's WebView may have just
     * synced a newer token; only talks to the network when the stored token is still the one that
     * was rejected (force) or is still due (not force).
     */
    private fun refresh(usedAccessToken: String, force: Boolean): CarResult<CarSession> =
        synchronized(REFRESH_LOCK) {
            val stored = CarSessionStore.read(appContext) ?: return@synchronized CarResult.Fail(FailKind.SIGNED_OUT)
            val alreadyNewer = stored.accessToken != usedAccessToken ||
                (!force && !CarLogic.needsTokenRefresh(stored.expiresAt, nowSec()))
            if (alreadyNewer) return@synchronized CarResult.Ok(stored)
            if (stored.refreshToken.isBlank()) return@synchronized CarResult.Fail(FailKind.SIGNED_OUT)

            val reply = try {
                val connection = open("${stored.supabaseUrl}/auth/v1/token?grant_type=refresh_token", stored.anonKey)
                try {
                    connection.outputStream.use {
                        it.write(JSONObject().put("refresh_token", stored.refreshToken).toString().toByteArray(Charsets.UTF_8))
                    }
                    val code = connection.responseCode
                    val text = readAll(if (code in 200..299) connection.inputStream else connection.errorStream)
                    Pair(code, text)
                } finally {
                    connection.disconnect()
                }
            } catch (ioe: IOException) {
                return@synchronized CarResult.Fail(FailKind.OFFLINE)
            } catch (other: Exception) {
                return@synchronized CarResult.Fail(FailKind.UNKNOWN)
            }

            when (reply.first) {
                200 -> {
                    try {
                        val json = JSONObject(reply.second)
                        val access = json.getString("access_token")
                        val refreshToken = json.getString("refresh_token")
                        val expiresAt = nowSec() + json.optLong("expires_in", 3600L)
                        if (!CarSessionStore.updateTokens(appContext, access, refreshToken, expiresAt)) {
                            return@synchronized CarResult.Fail(FailKind.SIGNED_OUT)
                        }
                        CarResult.Ok(
                            stored.copy(accessToken = access, refreshToken = refreshToken, expiresAt = expiresAt),
                        )
                    } catch (bad: Exception) {
                        CarResult.Fail(FailKind.UNKNOWN)
                    }
                }
                400, 401 -> {
                    // The phone may have synced a newer session while we were on the network.
                    val latest = CarSessionStore.read(appContext)
                    if (latest != null && latest.accessToken != stored.accessToken) {
                        CarResult.Ok(latest)
                    } else {
                        // Leave the store alone: the phone may still repair it.
                        CarResult.Fail(FailKind.SIGNED_OUT)
                    }
                }
                else -> CarResult.Fail(FailKind.UNKNOWN)
            }
        }

    private fun post(session: CarSession, name: String, body: JSONObject): Raw {
        return try {
            val connection = open("${session.supabaseUrl}/rest/v1/rpc/$name", session.anonKey)
            try {
                connection.setRequestProperty("Authorization", "Bearer ${session.accessToken}")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = connection.responseCode
                val text = readAll(if (code in 200..299) connection.inputStream else connection.errorStream)
                when {
                    code in 200..299 -> {
                        val json = try {
                            JSONObject(text)
                        } catch (bad: Exception) {
                            null
                        }
                        if (json == null) Raw.Error else Raw.Success(json)
                    }
                    code == 401 || text.contains("PGRST301") || text.contains("JWT") -> Raw.Unauthorized
                    code == 404 || text.contains("PGRST202") -> Raw.Outdated
                    else -> Raw.Error
                }
            } finally {
                connection.disconnect()
            }
        } catch (ioe: IOException) {
            Raw.Offline
        } catch (other: Exception) {
            Raw.Error
        }
    }

    private fun open(url: String, anonKey: String): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.doOutput = true
        connection.setRequestProperty("apikey", anonKey)
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Accept", "application/json")
        return connection
    }

    private fun readAll(stream: InputStream?): String {
        if (stream == null) return ""
        return stream.use { input ->
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_BODY_BYTES) break
                out.write(buffer, 0, read)
            }
            out.toString("UTF-8")
        }
    }

    private fun nowSec(): Long = System.currentTimeMillis() / 1000

    private companion object {
        const val CONNECT_TIMEOUT_MS = 8_000
        const val READ_TIMEOUT_MS = 10_000
        const val MAX_BODY_BYTES = 512 * 1024
        val REFRESH_LOCK = Any()
    }
}
