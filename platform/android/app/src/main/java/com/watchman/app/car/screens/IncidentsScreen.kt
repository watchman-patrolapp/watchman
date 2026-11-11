package com.watchman.app.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.OnContentRefreshListener
import androidx.car.app.model.PlaceListMapTemplate
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

/** Incidents only, nearest first, with severity markers. A row opens its detail. */
class IncidentsScreen(carContext: CarContext) : Screen(carContext) {

    private var inFlight = false
    private var failureText: String? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                if (CarDashboardCache.latest == null) refresh(userRequested = false)
            }
        })
    }

    private fun refresh(userRequested: Boolean) {
        if (inFlight) return
        inFlight = true
        val fix = CarLocation.lastKnown(carContext)
        CarRepository.get(carContext).dashboard(fix?.lat, fix?.lng) { result ->
            inFlight = false
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@dashboard
            when (result) {
                is CarResult.Ok -> {
                    failureText = null
                    CarDashboardCache.latest = result.value
                }
                is CarResult.Fail -> if (CarDashboardCache.latest == null) {
                    failureText = carContext.getString(CarMessages.forFail(result.kind))
                }
            }
            if (userRequested || lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
            }
        }
    }

    override fun onGetTemplate(): Template {
        failureText?.let {
            return CarUi.message(
                carContext,
                it,
                CarUi.problemIcon(carContext),
                Action.BACK,
                CarUi.action(carContext, R.string.car_try_again, R.drawable.ic_car_refresh, CarTheme.primary, primary = true) {
                    failureText = null
                    refresh(userRequested = true)
                    invalidate()
                },
            )
        }

        val builder = PlaceListMapTemplate.Builder()
            .setTitle(carContext.getString(R.string.car_nearby_title))
            .setHeaderAction(Action.BACK)
            .setOnContentRefreshListener(OnContentRefreshListener { refresh(userRequested = true) })
        if (CarLocation.hasPermission(carContext)) builder.setCurrentLocationEnabled(true)

        val data = CarDashboardCache.latest ?: return builder.setLoading(true).build()

        val now = System.currentTimeMillis()
        val incidents = data.incidents
            .sortedBy { it.distanceKm ?: Double.MAX_VALUE }
            .take(CarUi.placeListLimit(carContext))
        val list = ItemList.Builder().setNoItemsMessage(carContext.getString(R.string.car_no_incidents))
        for (pin in incidents) {
            val severity = CarLogic.severityFor(pin.type)
            val parts = mutableListOf<Pair<String, androidx.car.app.model.CarColor?>>()
            pin.atMs?.let { parts.add(Pair(CarLogic.timeAgo(it, now), null)) }
            if (pin.ackedByMe) parts.add(Pair(carContext.getString(R.string.car_acknowledged), CarTheme.success))
            list.addItem(
                CarUi.placeRow(
                    carContext,
                    pin.title.ifBlank { pin.type }.ifBlank { carContext.getString(R.string.car_label_incident) },
                    CarUi.detailText(pin.distanceKm, parts),
                    pin.lat,
                    pin.lng,
                    CarTheme.severityIcon(severity),
                    CarTheme.severityColor(severity),
                ) { screenManager.push(IncidentDetailScreen(carContext, DetailData.fromIncident(pin))) },
            )
        }
        return builder.setItemList(list.build()).build()
    }
}
