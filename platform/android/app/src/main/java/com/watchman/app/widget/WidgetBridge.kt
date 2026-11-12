package com.watchman.app.widget

import android.content.Context

/** Java-friendly entry points for the Capacitor plugin. Everything heavy runs off the caller's thread. */
object WidgetBridge {
    private const val RENDER_MIN_INTERVAL_MS = 60_000L

    @Volatile
    private var lastRenderMs = 0L

    /** The phone ended (or has no) patrol. Update the cache now so the widget flips immediately. */
    @JvmStatic
    fun patrolEnded(context: Context, wasActive: Boolean) {
        val app = context.applicationContext ?: context
        WidgetUpdater.run {
            val cachedOn = WidgetStateStore.read(app).onPatrol
            if (wasActive || cachedOn) {
                WidgetStateStore.update(app) { it.copy(onPatrol = false, startMs = null, distanceKm = null) }
                WidgetUpdater.updateAllNow(app)
                WidgetScheduler.enqueueNow(app)
            }
        }
    }

    /**
     * The phone reports an active patrol (called often, with new km). Refresh when the patrol just
     * started; otherwise only redraw from cache at most once a minute so km keeps up cheaply.
     */
    @JvmStatic
    fun patrolSynced(context: Context, wasActive: Boolean) {
        val app = context.applicationContext ?: context
        if (!wasActive) {
            WidgetUpdater.run {
                WidgetStateStore.update(app) { it.copy(onPatrol = true) }
                WidgetUpdater.updateAllNow(app)
                WidgetScheduler.enqueueNow(app)
            }
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastRenderMs < RENDER_MIN_INTERVAL_MS) return
        lastRenderMs = now
        WidgetUpdater.run { WidgetUpdater.updateAllNow(app) }
    }

    /**
     * Session hand-off from the WebView. Stores the non-token profile fields the widgets need and
     * wipes the previous user's cache when the account changed. Refreshes only on a real change.
     */
    @JvmStatic
    fun profileSynced(
        context: Context,
        previousUserId: String?,
        userId: String,
        firstName: String?,
        canPatrol: Boolean?,
        orgName: String?,
    ) {
        val app = context.applicationContext ?: context
        WidgetUpdater.run {
            val accountChanged = previousUserId != null && previousUserId != userId
            if (accountChanged) WidgetStateStore.clear(app)
            val old = WidgetStateStore.read(app)
            val newFirst = firstName?.trim()?.takeIf { it.isNotEmpty() }
            val newOrg = orgName?.trim()?.takeIf { it.isNotEmpty() }
            val changed = accountChanged ||
                (newFirst != null && newFirst != old.firstName) ||
                (canPatrol != null && canPatrol != old.canPatrol) ||
                (newOrg != null && newOrg != old.orgName)
            if (!changed) return@run
            WidgetStateStore.update(app) {
                it.copy(
                    firstName = newFirst ?: it.firstName,
                    canPatrol = canPatrol ?: it.canPatrol,
                    orgName = newOrg ?: it.orgName,
                )
            }
            WidgetUpdater.updateAllNow(app)
            WidgetScheduler.enqueueNow(app)
        }
    }
}
