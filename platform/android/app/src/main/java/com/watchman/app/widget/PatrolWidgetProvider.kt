package com.watchman.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import com.watchman.app.R
import com.watchman.app.car.CarPatrolStateStore
import com.watchman.app.car.CarSessionStore
import java.util.Locale

/** Watchman Patrol. Patrollers only (canStartOrEndPatrol / car_can_patrol). */
class PatrolWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        WidgetUpdater.run {
            try {
                for (id in ids) {
                    manager.updateAppWidget(id, PatrolWidgetRenderer.build(context, manager.getAppWidgetOptions(id)))
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
                manager.updateAppWidget(id, PatrolWidgetRenderer.build(context, newOptions))
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
        if (!WidgetRepository.hasWidgets(context, NeighbourhoodWidgetProvider::class.java)) {
            WidgetScheduler.cancelAll(context)
        }
    }
}

object PatrolWidgetRenderer {
    private const val COMPACT_BELOW_DP = 130

    fun build(context: Context, options: Bundle?): RemoteViews {
        val minHeight = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
        val compact = minHeight in 1 until COMPACT_BELOW_DP
        val rv = RemoteViews(
            context.packageName,
            if (compact) R.layout.widget_patrol_compact else R.layout.widget_patrol,
        )
        val state = WidgetStateStore.read(context)
        val signedIn = CarSessionStore.read(context) != null

        rv.setOnClickPendingIntent(R.id.wp_root, WidgetIntents.link(context, "open", 100))

        if (!signedIn) {
            rv.setViewVisibility(R.id.wp_name, View.GONE)
            showMessage(rv, context.getString(R.string.widget_sign_in), context.getString(R.string.widget_sign_in_cd))
            rv.setOnClickPendingIntent(R.id.wp_root, WidgetIntents.link(context, "sign-in", 101))
            rv.setOnClickPendingIntent(R.id.wp_message, WidgetIntents.link(context, "sign-in", 101))
            return rv
        }

        setName(rv, state.firstName)

        if (state.canPatrol != true) {
            showMessage(
                rv,
                context.getString(R.string.widget_patrollers_only),
                context.getString(R.string.widget_patrollers_only_cd),
            )
            rv.setOnClickPendingIntent(R.id.wp_message, WidgetIntents.link(context, "open", 102))
            return rv
        }

        rv.setViewVisibility(R.id.wp_message, View.GONE)
        rv.setViewVisibility(R.id.wp_body, View.VISIBLE)

        val local = CarPatrolStateStore.read(context)?.takeIf { it.active && it.startTimeMs > 0L }
        val onPatrol = local != null || state.onPatrol
        val startMs = local?.startTimeMs ?: state.startMs
        val km = if (local != null) local.sessionDistanceKm else state.distanceKm

        if (onPatrol) {
            rv.setImageViewResource(R.id.wp_dot, R.drawable.widget_dot_on)
            rv.setViewVisibility(R.id.wp_status_on, View.VISIBLE)
            rv.setViewVisibility(R.id.wp_status_off, View.GONE)
            rv.setViewVisibility(R.id.wp_start, View.GONE)
            rv.setViewVisibility(R.id.wp_end, View.VISIBLE)
            rv.setOnClickPendingIntent(R.id.wp_end, WidgetIntents.link(context, "end-patrol", 110))
            if (startMs != null && startMs > 0L) {
                val elapsed = (System.currentTimeMillis() - startMs).coerceAtLeast(0L)
                // Real Chronometer: the launcher ticks it. No widget update per second.
                rv.setChronometer(R.id.wp_timer, SystemClock.elapsedRealtime() - elapsed, null, true)
                rv.setViewVisibility(R.id.wp_stats, View.VISIBLE)
                rv.setTextViewText(
                    R.id.wp_km,
                    context.getString(R.string.widget_km_format, String.format(Locale.US, "%.1f", km ?: 0.0)),
                )
            } else {
                rv.setChronometer(R.id.wp_timer, SystemClock.elapsedRealtime(), null, false)
                rv.setViewVisibility(R.id.wp_stats, View.GONE)
            }
        } else {
            rv.setImageViewResource(R.id.wp_dot, R.drawable.widget_dot_off)
            rv.setViewVisibility(R.id.wp_status_on, View.GONE)
            rv.setViewVisibility(R.id.wp_status_off, View.VISIBLE)
            rv.setViewVisibility(R.id.wp_start, View.VISIBLE)
            rv.setViewVisibility(R.id.wp_end, View.GONE)
            rv.setChronometer(R.id.wp_timer, SystemClock.elapsedRealtime(), null, false)
            rv.setViewVisibility(R.id.wp_stats, View.GONE)
            rv.setOnClickPendingIntent(R.id.wp_start, WidgetIntents.link(context, "start-patrol", 111))
        }
        rv.setOnClickPendingIntent(R.id.wp_report, WidgetIntents.link(context, "quick-report", 112))

        bindOnline(context, rv, state)
        return rv
    }

    private fun bindOnline(context: Context, rv: RemoteViews, state: WidgetState) {
        val count = state.onlineCount
        val avatarIds = intArrayOf(R.id.wp_avatar1, R.id.wp_avatar2, R.id.wp_avatar3)
        // Logo glow: cyan when patrollers are online, orange when none.
        rv.setImageViewResource(R.id.wp_logo, if (count > 0) R.drawable.ic_widget_logo else R.drawable.ic_widget_logo_off)
        if (count > 0) {
            rv.setImageViewResource(R.id.wp_people, R.drawable.ic_widget_people_on)
            rv.setViewVisibility(R.id.wp_online_on, View.VISIBLE)
            rv.setViewVisibility(R.id.wp_online_off, View.GONE)
            rv.setTextViewText(R.id.wp_online_on, context.getString(R.string.widget_online_format, count))
            rv.setContentDescription(R.id.wp_online, context.getString(R.string.widget_online_cd_format, count))
            for (i in avatarIds.indices) {
                if (i < count) {
                    rv.setViewVisibility(avatarIds[i], View.VISIBLE)
                    val bitmap = AvatarCache.load(context, state.avatarFiles.getOrNull(i).orEmpty())
                    if (bitmap != null) {
                        rv.setImageViewBitmap(avatarIds[i], bitmap)
                    } else {
                        rv.setImageViewResource(avatarIds[i], R.drawable.ic_widget_person)
                    }
                } else {
                    rv.setViewVisibility(avatarIds[i], View.GONE)
                }
            }
            if (count > avatarIds.size) {
                rv.setViewVisibility(R.id.wp_more, View.VISIBLE)
                rv.setTextViewText(R.id.wp_more, context.getString(R.string.widget_more_format, count - avatarIds.size))
            } else {
                rv.setViewVisibility(R.id.wp_more, View.GONE)
            }
        } else {
            rv.setImageViewResource(R.id.wp_people, R.drawable.ic_widget_people_off)
            rv.setViewVisibility(R.id.wp_online_on, View.GONE)
            rv.setViewVisibility(R.id.wp_online_off, View.VISIBLE)
            rv.setContentDescription(R.id.wp_online, context.getString(R.string.widget_no_patrollers))
            for (id in avatarIds) rv.setViewVisibility(id, View.GONE)
            rv.setViewVisibility(R.id.wp_more, View.GONE)
        }
    }

    private fun setName(rv: RemoteViews, firstName: String?) {
        if (firstName.isNullOrBlank()) {
            rv.setViewVisibility(R.id.wp_name, View.GONE)
        } else {
            rv.setViewVisibility(R.id.wp_name, View.VISIBLE)
            rv.setTextViewText(R.id.wp_name, firstName)
        }
    }

    private fun showMessage(rv: RemoteViews, text: String, description: String) {
        rv.setViewVisibility(R.id.wp_body, View.GONE)
        rv.setViewVisibility(R.id.wp_message, View.VISIBLE)
        rv.setTextViewText(R.id.wp_message, text)
        rv.setContentDescription(R.id.wp_message, description)
    }
}
