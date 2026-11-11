package com.watchman.app.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Template
import com.watchman.app.R
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarPatrolStateStore
import com.watchman.app.car.CarTheme

/** Elapsed, distance, start and vehicle for the current patrol (today's date when idle). Opened from the stats row. */
class PatrolStatusScreen(carContext: CarContext) : Screen(carContext) {

    private val snapshot = CarPatrolStateStore.read(carContext)?.takeIf { it.active }

    override fun onGetTemplate(): Template {
        val now = System.currentTimeMillis()
        val me = CarDashboardCache.latest?.me
        val onPatrol = me?.onPatrol ?: (snapshot != null)
        val startMs = if (me != null) me.startMs else snapshot?.startTimeMs?.takeIf { it > 0 }
        val km = if (me != null) {
            if (me.onPatrol) CarLogic.displayKm(me.distanceKm, snapshot?.sessionDistanceKm, snapshot?.startTimeMs ?: 0L, me.startMs ?: 0L) else null
        } else {
            snapshot?.sessionDistanceKm
        }

        val pane = Pane.Builder()
        if (onPatrol) {
            // Two rows may be all a small host paints: the numbers that matter go first.
            val elapsed = if (startMs != null) CarLogic.formatElapsed((now - startMs) / 1000) else "—"
            pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_elapsed), elapsed, R.drawable.ic_car_refresh, CarTheme.primary))
            pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_distance), CarLogic.formatKm(km ?: 0.0), R.drawable.ic_car_navigate, CarTheme.primary))
            val started = if (startMs != null) CarLogic.formatDateTime(startMs) else CarLogic.formatDate(now)
            pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_started), started, R.drawable.ic_car_check_in, CarTheme.primary))
            val vehicleLabel = me?.vehicleLabel
            pane.addRow(
                CarUi.infoRow(
                    carContext,
                    carContext.getString(R.string.car_label_vehicle),
                    vehicleLabel?.let { CarLogic.formatVehicleLabel(it) } ?: carContext.getString(R.string.car_no_vehicle),
                    CarTheme.vehicleIcon(CarDashboardCache.latest?.onlinePatrollers?.firstOrNull { it.isMe }?.vehicleType, vehicleLabel),
                    CarTheme.primary,
                ),
            )
        } else {
            pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_date), CarLogic.formatDate(now), R.drawable.ic_car_nearby, CarTheme.primary))
        }
        if (onPatrol) {
            pane.addAction(
                CarUi.action(carContext, R.string.car_end_patrol, R.drawable.ic_car_end_patrol, null, CarTheme.sosAction, primary = true) {
                    screenManager.push(EndPatrolConfirmScreen(carContext))
                },
            )
        } else {
            pane.addAction(
                CarUi.action(carContext, R.string.car_check_in, R.drawable.ic_car_check_in, null, CarTheme.primary, primary = true) {
                    screenManager.push(CheckInScreen(carContext, null))
                },
            )
        }
        pane.addAction(CarUi.action(carContext, R.string.car_done, R.drawable.ic_car_ack, CarTheme.success) { screenManager.pop() })

        return PaneTemplate.Builder(pane.build())
            .setTitle(carContext.getString(R.string.car_status_title))
            .setHeaderAction(Action.BACK)
            .build()
    }
}
