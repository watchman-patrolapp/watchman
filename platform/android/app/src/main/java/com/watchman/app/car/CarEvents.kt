package com.watchman.app.car

import android.content.Context
import com.watchman.app.widget.WidgetUpdater
import java.lang.ref.WeakReference

/**
 * Tells the phone's WebView that the car changed something (patrol started or ended, SOS, ...).
 * The Capacitor plugin sets [listener] while the WebView is alive; it is null otherwise, which the
 * check-in screen uses to warn that GPS tracking needs the phone app.
 *
 * [appContext] also refreshes home-screen widgets even when the WebView is dead, so an Android Auto
 * start/end still flips Watchman Patrol without waiting for the next 15-minute tick.
 */
object CarEvents {
    const val PATROL_STARTED = "patrol_started"
    const val PATROL_ENDED = "patrol_ended"
    const val SOS_SENT = "sos_sent"
    const val REPORT_SENT = "report_sent"
    const val INCIDENT_ACKED = "incident_acked"
    const val SOS_ACKED = "sos_acked"

    @Volatile
    @JvmStatic
    var listener: ((String) -> Unit)? = null

    @Volatile
    private var appContextRef: WeakReference<Context>? = null

    /** Remember the application context once (from the plugin load or car service). */
    @JvmStatic
    fun bindAppContext(context: Context) {
        val app = context.applicationContext ?: context
        appContextRef = WeakReference(app)
    }

    @JvmStatic
    fun emit(reason: String) {
        try {
            listener?.invoke(reason)
        } catch (ignored: Exception) {
            // The phone side is best effort.
        }
        try {
            appContextRef?.get()?.let { WidgetUpdater.onCarEvent(it, reason) }
        } catch (ignored: Exception) {
            // Widgets catch up on the next periodic refresh.
        }
    }
}
