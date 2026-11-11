package com.watchman.app.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.watchman.app.R
import com.watchman.app.car.CarLocation
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarMessages
import com.watchman.app.car.CarRepository
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarTheme
import com.watchman.app.car.SosPin

/**
 * One open SOS: who, when, how far, where. Navigate opens the maps app; Acknowledge tells the
 * group someone is responding. Opened from a map row, or from the "SOS nearby" notification
 * (then only the id is known and the pin is loaded first).
 */
class SosAlertScreen(
    carContext: CarContext,
    val sosId: String,
    initial: SosPin?,
) : Screen(carContext) {

    private var pin: SosPin? = initial ?: CarDashboardCache.latest?.sos?.firstOrNull { it.id == sosId }
    private var lookupFailedText: String? = null
    private var busy = false

    init {
        if (pin == null) {
            lifecycle.addObserver(object : DefaultLifecycleObserver {
                override fun onCreate(owner: LifecycleOwner) = lookup()
            })
        }
    }

    private fun lookup() {
        val fix = CarLocation.lastKnown(carContext)
        CarRepository.get(carContext).dashboard(fix?.lat, fix?.lng) { result ->
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@dashboard
            when (result) {
                is CarResult.Ok -> {
                    CarDashboardCache.latest = result.value
                    pin = result.value.sos.firstOrNull { it.id == sosId }
                    if (pin == null) lookupFailedText = carContext.getString(R.string.car_msg_generic)
                }
                is CarResult.Fail -> lookupFailedText = carContext.getString(CarMessages.forFail(result.kind))
            }
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
        }
    }

    private fun acknowledge() {
        val current = pin ?: return
        if (busy || current.acknowledged) return
        busy = true
        CarRepository.get(carContext).ackSos(current.id) { result ->
            busy = false
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@ackSos
            when (result) {
                is CarResult.Ok -> {
                    pin = current.copy(acknowledged = true, ackedByMe = true)
                    CarDashboardCache.latest = CarDashboardCache.latest?.let { cache ->
                        cache.copy(sos = cache.sos.map { if (it.id == current.id) it.copy(acknowledged = true, ackedByMe = true) else it })
                    }
                    CarUi.toast(carContext, R.string.car_acknowledged)
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
                }
                is CarResult.Fail -> CarUi.toast(carContext, CarMessages.forFail(result.kind))
            }
        }
    }

    override fun onGetTemplate(): Template {
        val done = CarUi.action(carContext, R.string.car_done, R.drawable.ic_car_ack, null, CarTheme.primary, primary = true) {
            screenManager.popToRoot()
        }
        lookupFailedText?.let {
            return CarUi.message(carContext, it, CarUi.problemIcon(carContext), Action.BACK, done)
        }
        val current = pin ?: return CarUi.loading(carContext)

        val now = System.currentTimeMillis()
        val pane = Pane.Builder()
        pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_from), current.senderName, R.drawable.ic_car_person, CarTheme.danger))
        pane.addRow(
            CarUi.infoRow(
                carContext,
                carContext.getString(R.string.car_label_when),
                current.createdMs?.let { CarLogic.timeAgo(it, now) } ?: "—",
                R.drawable.ic_car_refresh,
                CarTheme.primary,
            ),
        )
        pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_distance), CarLogic.formatKm(current.distanceKm), R.drawable.ic_car_navigate, CarTheme.primary))
        if (current.address.isNotBlank()) {
            pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_where), current.address, R.drawable.ic_car_pin_incident, CarTheme.primary))
        }

        val lat = current.lat
        val lng = current.lng
        var actions = 0
        if (lat != null && lng != null) {
            pane.addAction(
                CarUi.action(carContext, R.string.car_navigate, R.drawable.ic_car_navigate, null, CarTheme.primary, primary = true) {
                    CarUi.navigate(carContext, lat, lng)
                },
            )
            actions++
        }
        if (!current.acknowledged && !current.isMine) {
            pane.addAction(
                CarUi.action(carContext, R.string.car_acknowledge, R.drawable.ic_car_ack, null, CarTheme.success) { acknowledge() },
            )
            actions++
        }
        if (actions == 0) pane.addAction(done)

        return PaneTemplate.Builder(pane.build())
            .setTitle(carContext.getString(R.string.car_sos_alert_title))
            .setHeaderAction(Action.BACK)
            .build()
    }
}
