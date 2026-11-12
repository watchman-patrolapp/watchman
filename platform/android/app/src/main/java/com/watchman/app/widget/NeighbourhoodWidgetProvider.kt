package com.watchman.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import com.watchman.app.R
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarSessionStore

/** Watchman Neighbourhood. For residents; shows an anonymous patrol light, never who is on patrol. */
class NeighbourhoodWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        WidgetUpdater.run {
            try {
                for (id in ids) {
                    manager.updateAppWidget(id, NeighbourhoodWidgetRenderer.build(context, manager.getAppWidgetOptions(id)))
                }
            } finally {
                pending.finish()
            }
        }
        WidgetScheduler.ensurePeriodic(context)
        WidgetScheduler.enqueueNow(context)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        newOptions: Bundle?,
    ) {
        val pending = goAsync()
        WidgetUpdater.run {
            try {
                manager.updateAppWidget(id, NeighbourhoodWidgetRenderer.build(context, newOptions))
            } finally {
                pending.finish()
            }
        }
    }

    override fun onEnabled(context: Context) {
        WidgetScheduler.ensurePeriodic(context)
        WidgetScheduler.enqueueNow(context)
    }

    override fun onDisabled(context: Context) {
        if (!WidgetRepository.hasWidgets(context, PatrolWidgetProvider::class.java)) {
            WidgetScheduler.cancelAll(context)
        }
    }
}

object NeighbourhoodWidgetRenderer {
    private const val COMPACT_BELOW_DP = 170
    private const val NON_SOS_ALERT_MAX_MS = 10L * 60 * 60 * 1000

    fun build(context: Context, options: Bundle?): RemoteViews {
        val minHeight = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
        val compact = minHeight in 1 until COMPACT_BELOW_DP
        val rv = RemoteViews(
            context.packageName,
            if (compact) R.layout.widget_neighbourhood_compact else R.layout.widget_neighbourhood,
        )
        val state = WidgetStateStore.read(context)
        val signedIn = CarSessionStore.read(context) != null

        rv.setOnClickPendingIntent(R.id.wr_root, WidgetIntents.link(context, "open", 200))

        if (!signedIn) {
            rv.setViewVisibility(R.id.wr_org, View.GONE)
            rv.setViewVisibility(R.id.wr_patrol, View.GONE)
            rv.setViewVisibility(R.id.wr_card, View.GONE)
            rv.setViewVisibility(R.id.wr_buttons, View.GONE)
            rv.setViewVisibility(R.id.wr_message, View.VISIBLE)
            rv.setTextViewText(R.id.wr_message, context.getString(R.string.widget_sign_in))
            rv.setContentDescription(R.id.wr_message, context.getString(R.string.widget_sign_in_cd))
            rv.setOnClickPendingIntent(R.id.wr_root, WidgetIntents.link(context, "sign-in", 201))
            rv.setOnClickPendingIntent(R.id.wr_message, WidgetIntents.link(context, "sign-in", 201))
            return rv
        }

        rv.setViewVisibility(R.id.wr_message, View.GONE)
        rv.setViewVisibility(R.id.wr_patrol, View.VISIBLE)
        rv.setViewVisibility(R.id.wr_card, View.VISIBLE)
        rv.setViewVisibility(R.id.wr_buttons, View.VISIBLE)

        rv.setViewVisibility(R.id.wr_org, View.VISIBLE)
        rv.setTextViewText(
            R.id.wr_org,
            state.orgName ?: context.getString(R.string.widget_neighbourhood_fallback),
        )

        // Anonymous indicator: on or off, nothing else.
        if (state.patrolActive) {
            rv.setImageViewResource(R.id.wr_patrol_icon, R.drawable.ic_widget_torch_patroller_on)
            rv.setViewVisibility(R.id.wr_patrol_on, View.VISIBLE)
            rv.setViewVisibility(R.id.wr_patrol_off, View.GONE)
            rv.setContentDescription(R.id.wr_patrol, context.getString(R.string.widget_patrol_indicator_on_cd))
        } else {
            rv.setImageViewResource(R.id.wr_patrol_icon, R.drawable.ic_widget_torch_patroller_off)
            rv.setViewVisibility(R.id.wr_patrol_on, View.GONE)
            rv.setViewVisibility(R.id.wr_patrol_off, View.VISIBLE)
            rv.setContentDescription(R.id.wr_patrol, context.getString(R.string.widget_patrol_indicator_off_cd))
        }

        val alertText = alertLine(context, state)
        rv.setTextViewText(R.id.wr_alert_text, alertText ?: context.getString(R.string.widget_no_alerts))
        rv.setContentDescription(
            R.id.wr_alert_row,
            if (alertText != null) context.getString(R.string.widget_alert_cd_format, alertText)
            else context.getString(R.string.widget_no_alerts_cd),
        )
        val notice = state.noticeHeadline
        rv.setTextViewText(R.id.wr_notice_text, notice ?: context.getString(R.string.widget_no_notices))
        rv.setContentDescription(
            R.id.wr_notice_row,
            if (notice != null) context.getString(R.string.widget_notice_cd_format, notice)
            else context.getString(R.string.widget_no_notices_cd),
        )
        rv.setOnClickPendingIntent(R.id.wr_alert_row, WidgetIntents.link(context, "alerts", 210))
        rv.setOnClickPendingIntent(R.id.wr_notice_row, WidgetIntents.link(context, "open", 211))

        rv.setOnClickPendingIntent(R.id.wr_sos, WidgetIntents.sosHold(context, 212))
        rv.setOnClickPendingIntent(R.id.wr_report, WidgetIntents.link(context, "resident-report", 213))
        return rv
    }

    /** "Suspicious vehicle · Kragga Kamma Rd · 12 min ago". Never coordinates; SOS has no street. */
    private fun alertLine(context: Context, state: WidgetState): String? {
        val title = state.alertTitle ?: return null
        val at = state.alertAtMs
        val now = System.currentTimeMillis()
        if (!state.alertIsSos && at != null && now - at > NON_SOS_ALERT_MAX_MS) return null
        val sep = context.getString(R.string.widget_alert_street_sep)
        val parts = ArrayList<String>()
        parts.add(title)
        state.alertStreet?.let { parts.add(it) }
        if (at != null) parts.add(CarLogic.timeAgo(at, now))
        return parts.joinToString(sep)
    }
}
