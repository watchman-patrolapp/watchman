package com.watchman.app.widget

import android.net.Uri

/**
 * One-shot hand-off of a widget deep link (za.co.africuz.watchman://widget/<path>) to the WebView.
 * It is consumed exactly once, so a later resume or a relaunch from recents never starts or ends
 * a patrol again. Holds only a short route name, never user data.
 */
object WidgetLinks {
    private const val MAX_AGE_MS = 5L * 60 * 1000

    private val allowed = setOf(
        "start-patrol", "end-patrol", "quick-report", "resident-report",
        "sos", "sign-in", "open", "alerts",
    )

    @Volatile
    private var pendingPath: String? = null

    @Volatile
    private var pendingAtMs: Long = 0L

    /** Set by the Capacitor plugin while the WebView is alive; called when a link arrives. */
    @Volatile
    @JvmStatic
    var listener: (() -> Unit)? = null

    /** The route name for a widget URI, or null when the URI is not one of ours. */
    @JvmStatic
    fun parse(scheme: String, uri: Uri?): String? {
        if (uri == null || uri.scheme != scheme || uri.host != "widget") return null
        val path = uri.pathSegments.firstOrNull()?.lowercase() ?: return null
        return if (path in allowed) path else null
    }

    @JvmStatic
    fun offer(path: String) {
        pendingPath = path
        pendingAtMs = System.currentTimeMillis()
        try {
            listener?.invoke()
        } catch (ignored: Exception) {
        }
    }

    @JvmStatic
    @Synchronized
    fun consume(): String? {
        val path = pendingPath
        val at = pendingAtMs
        pendingPath = null
        pendingAtMs = 0L
        if (path == null || System.currentTimeMillis() - at > MAX_AGE_MS) return null
        return path
    }
}
