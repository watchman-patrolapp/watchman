package com.watchman.app.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.watchman.app.R
import com.watchman.app.car.CarEvents
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarMessages
import com.watchman.app.car.CarRepository
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarTheme
import com.watchman.app.car.StartOutcome
import com.watchman.app.car.Vehicle

/** Starts a patrol. Loading first, then the result; a vehicle choice is a separate screen. */
class CheckInScreen(carContext: CarContext, private val vehicleId: String?) : Screen(carContext) {

    private sealed class State {
        object Loading : State()
        class Message(val text: String, val ok: Boolean, val retry: Boolean) : State()
    }

    private var state: State = State.Loading

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) = submit()
        })
    }

    private fun submit() {
        state = State.Loading
        CarRepository.get(carContext).startPatrol(vehicleId) { result ->
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@startPatrol
            when (result) {
                is CarResult.Ok -> when (val outcome = result.value) {
                    is StartOutcome.Started -> {
                        val at = outcome.startMs ?: System.currentTimeMillis()
                        var text = carContext.getString(R.string.car_patrol_started, CarLogic.formatClock(at))
                        // With the phone bridge alive the app starts GPS itself; otherwise one short hint.
                        if (CarEvents.listener == null) text += "\n" + carContext.getString(R.string.car_msg_gps_phone)
                        state = State.Message(text, ok = true, retry = false)
                    }
                    is StartOutcome.AlreadyActive ->
                        state = State.Message(carContext.getString(R.string.car_patrol_already_active), ok = true, retry = false)
                    is StartOutcome.NeedsVehicle -> {
                        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                            screenManager.pop()
                            screenManager.push(VehiclePickerScreen(carContext, outcome.vehicles))
                        }
                        return@startPatrol
                    }
                }
                is CarResult.Fail ->
                    state = State.Message(carContext.getString(CarMessages.forFail(result.kind)), ok = false, retry = true)
            }
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
        }
    }

    override fun onGetTemplate(): Template {
        return when (val current = state) {
            State.Loading -> CarUi.loading(carContext)
            is State.Message -> {
                val actions = mutableListOf<Action>()
                if (current.retry) {
                    actions.add(
                        CarUi.action(carContext, R.string.car_try_again, R.drawable.ic_car_refresh, CarTheme.primary, primary = true) {
                            submit()
                            invalidate()
                        },
                    )
                }
                actions.add(
                    CarUi.action(carContext, R.string.car_done, R.drawable.ic_car_ack, CarTheme.success, primary = !current.retry) {
                        screenManager.popToRoot()
                    },
                )
                CarUi.message(
                    carContext,
                    current.text,
                    if (current.ok) CarUi.okIcon(carContext) else CarUi.problemIcon(carContext),
                    Action.BACK,
                    *actions.toTypedArray(),
                )
            }
        }
    }
}

/** Up to six vehicles. Tapping one replaces this screen with a check-in for that vehicle. */
class VehiclePickerScreen(carContext: CarContext, private val vehicles: List<Vehicle>) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val list = ItemList.Builder()
        vehicles.take(CarUi.listLimit(carContext)).forEach { vehicle ->
            val builder = Row.Builder()
                .setTitle(CarLogic.formatVehicleLabel(vehicle.label))
                .setImage(CarTheme.icon(carContext, CarTheme.vehicleIcon(vehicle.vehicleType, vehicle.label), CarTheme.primary), Row.IMAGE_TYPE_ICON)
                .setOnClickListener {
                    screenManager.pop()
                    screenManager.push(CheckInScreen(carContext, vehicle.id))
                }
            if (vehicle.registration.isNotBlank()) builder.addText(CarLogic.formatRegistration(vehicle.registration))
            list.addItem(builder.build())
        }
        return ListTemplate.Builder()
            .setTitle(carContext.getString(R.string.car_choose_vehicle))
            .setHeaderAction(Action.BACK)
            .setSingleList(list.build())
            .build()
    }
}
