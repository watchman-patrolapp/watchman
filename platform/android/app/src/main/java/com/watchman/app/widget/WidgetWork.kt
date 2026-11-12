package com.watchman.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.watchman.app.car.CarEvents
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Periodic (about 15 min) and one-shot widget refresh. No second-level updates anywhere. */
object WidgetScheduler {
    private const val PERIODIC = "watchman_widget_periodic"
    private const val ONE_SHOT = "watchman_widget_now"

    private val connected: Constraints =
        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun ensurePeriodic(context: Context) {
        try {
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(connected)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        } catch (ignored: Exception) {
            // Widgets still render from cache.
        }
    }

    fun enqueueNow(context: Context) {
        try {
            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setConstraints(connected)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(ONE_SHOT, ExistingWorkPolicy.REPLACE, request)
        } catch (ignored: Exception) {
        }
    }

    fun cancelAll(context: Context) {
        try {
            val manager = WorkManager.getInstance(context.applicationContext)
            manager.cancelUniqueWork(PERIODIC)
            manager.cancelUniqueWork(ONE_SHOT)
        } catch (ignored: Exception) {
        }
    }
}

class WidgetRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        try {
            WidgetRepository.refresh(applicationContext)
        } catch (ignored: Exception) {
            // Keep the cache; never surface a reason.
        }
        WidgetUpdater.updateAllNow(applicationContext)
        return Result.success()
    }
}

/** Renders both providers from the cache. Cheap; call off the main thread. */
object WidgetUpdater {
    private val executor = Executors.newSingleThreadExecutor()

    fun updateAllNow(context: Context) {
        val app = context.applicationContext ?: context
        val manager = AppWidgetManager.getInstance(app)
        try {
            val patrol = manager.getAppWidgetIds(ComponentName(app, PatrolWidgetProvider::class.java))
            for (id in patrol) {
                manager.updateAppWidget(id, PatrolWidgetRenderer.build(app, manager.getAppWidgetOptions(id)))
            }
            val resident = manager.getAppWidgetIds(ComponentName(app, NeighbourhoodWidgetProvider::class.java))
            for (id in resident) {
                manager.updateAppWidget(id, NeighbourhoodWidgetRenderer.build(app, manager.getAppWidgetOptions(id)))
            }
        } catch (ignored: Exception) {
            // A launcher hiccup must not crash the app.
        }
    }

    fun run(block: () -> Unit) {
        try {
            executor.execute {
                try {
                    block()
                } catch (ignored: Exception) {
                }
            }
        } catch (ignored: Exception) {
        }
    }

    /** Render from cache now, then fetch fresh data. */
    fun refreshAsync(context: Context) {
        val app = context.applicationContext ?: context
        run {
            updateAllNow(app)
            WidgetScheduler.enqueueNow(app)
        }
    }

    /** Sign-out / account switch: drop cached PII and redraw as signed out. */
    fun clearAsync(context: Context) {
        val app = context.applicationContext ?: context
        run {
            WidgetStateStore.clear(app)
            updateAllNow(app)
        }
    }

    /** Called after an Android Auto write, so the widget follows without the WebView. */
    fun onCarEvent(context: Context, reason: String) {
        val app = context.applicationContext ?: context
        run {
            when (reason) {
                CarEvents.PATROL_STARTED -> WidgetStateStore.update(app) { it.copy(onPatrol = true) }
                CarEvents.PATROL_ENDED -> WidgetStateStore.update(app) {
                    it.copy(onPatrol = false, startMs = null, distanceKm = null)
                }
            }
            updateAllNow(app)
            WidgetScheduler.enqueueNow(app)
        }
    }
}
