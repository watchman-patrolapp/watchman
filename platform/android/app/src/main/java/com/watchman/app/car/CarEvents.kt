package com.watchman.app.car

/**
 * Tells the phone's WebView that the car changed something (patrol started or ended, SOS, ...).
 * The Capacitor plugin sets [listener] while the WebView is alive; it is null otherwise, which the
 * check-in screen uses to warn that GPS tracking needs the phone app.
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

    @JvmStatic
    fun emit(reason: String) {
        try {
            listener?.invoke(reason)
        } catch (ignored: Exception) {
            // The phone side is best effort.
        }
    }
}
