package com.watchman.app.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Template
import androidx.lifecycle.Lifecycle
import com.watchman.app.R
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarMessages
import com.watchman.app.car.CarRepository
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarTheme
import com.watchman.app.car.IncidentPin
import com.watchman.app.car.Patroller

/** What the detail pane needs, for either an incident or another patroller. */
data class DetailData(
    val kind: Kind,
    val id: String,
    val title: String,
    val type: String,
    val atMs: Long?,
    val distanceKm: Double?,
    val address: String,
    val lat: Double,
    val lng: Double,
    val acked: Boolean,
    val isLive: Boolean,
) {
    enum class Kind { INCIDENT, PATROLLER }

    companion object {
        fun fromIncident(pin: IncidentPin) = DetailData(
            Kind.INCIDENT, pin.id, pin.title, pin.type, pin.atMs, pin.distanceKm, pin.address,
            pin.lat, pin.lng, pin.ackedByMe, false,
        )

        fun fromPatroller(pin: Patroller) = DetailData(
            Kind.PATROLLER, pin.userId, pin.name, "", pin.atMs, pin.distanceKm, "",
            pin.lat, pin.lng, false, pin.isLive,
        )
    }
}

/** Type or name, when, distance, address. Navigate always; Acknowledge for incidents. */
class IncidentDetailScreen(carContext: CarContext, initial: DetailData) : Screen(carContext) {

    private var detail = initial
    private var busy = false

    private fun acknowledge() {
        if (detail.kind != DetailData.Kind.INCIDENT || detail.acked || busy) return
        busy = true
        CarRepository.get(carContext).ackIncident(detail.id) { result ->
            busy = false
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@ackIncident
            when (result) {
                is CarResult.Ok -> {
                    detail = detail.copy(acked = true)
                    CarDashboardCache.latest = CarDashboardCache.latest?.let { cache ->
                        cache.copy(
                            incidents = cache.incidents.map {
                                if (it.id == detail.id) it.copy(ackedByMe = true, ackCount = it.ackCount + 1) else it
                            },
                        )
                    }
                    CarUi.toast(carContext, R.string.car_acknowledged)
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
                }
                is CarResult.Fail -> CarUi.toast(carContext, CarMessages.forFail(result.kind))
            }
        }
    }

    override fun onGetTemplate(): Template {
        val now = System.currentTimeMillis()
        val isIncident = detail.kind == DetailData.Kind.INCIDENT
        val severity = CarLogic.severityFor(detail.type)
        val pane = Pane.Builder()

        if (isIncident) {
            val name = detail.title.ifBlank { detail.type }.ifBlank { carContext.getString(R.string.car_label_incident) }
            pane.addRow(
                CarUi.infoRow(
                    carContext,
                    carContext.getString(R.string.car_label_incident),
                    name,
                    CarTheme.severityIcon(severity),
                    CarTheme.severityColor(severity),
                ),
            )
        } else {
            pane.addRow(
                CarUi.infoRow(
                    carContext,
                    carContext.getString(R.string.car_label_patroller),
                    detail.title,
                    R.drawable.ic_car_pin_patroller,
                    if (detail.isLive) CarTheme.accent else CarTheme.muted,
                ),
            )
        }

        val when_ = when {
            !isIncident && detail.isLive -> carContext.getString(R.string.car_live)
            !isIncident -> carContext.getString(R.string.car_last_gps, detail.atMs?.let { CarLogic.timeAgo(it, now) }.orEmpty())
            else -> detail.atMs?.let { CarLogic.timeAgo(it, now) }.orEmpty()
        }
        pane.addRow(
            CarUi.infoRow(
                carContext,
                carContext.getString(if (isIncident) R.string.car_label_when else R.string.car_label_status),
                when_.ifBlank { "—" },
                R.drawable.ic_car_refresh,
                CarTheme.primary,
            ),
        )
        pane.addRow(
            CarUi.infoRow(carContext, carContext.getString(R.string.car_label_distance), CarLogic.formatKm(detail.distanceKm), R.drawable.ic_car_navigate, CarTheme.primary),
        )
        if (detail.address.isNotBlank()) {
            pane.addRow(
                CarUi.infoRow(carContext, carContext.getString(R.string.car_label_where), detail.address, R.drawable.ic_car_pin_incident, CarTheme.primary),
            )
        }

        pane.addAction(
            CarUi.action(carContext, R.string.car_navigate, R.drawable.ic_car_navigate, null, CarTheme.primary, primary = true) {
                CarUi.navigate(carContext, detail.lat, detail.lng)
            },
        )
        if (isIncident) {
            pane.addAction(
                CarUi.action(
                    carContext,
                    if (detail.acked) R.string.car_acknowledged else R.string.car_acknowledge,
                    R.drawable.ic_car_ack,
                    null,
                    CarTheme.success,
                ) { acknowledge() },
            )
        }

        return PaneTemplate.Builder(pane.build())
            .setTitle(carContext.getString(if (isIncident) R.string.car_incident_title else R.string.car_patroller_title))
            .setHeaderAction(Action.BACK)
            .build()
    }
}
