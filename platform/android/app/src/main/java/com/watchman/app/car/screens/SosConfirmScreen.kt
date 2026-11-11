package com.watchman.app.car.screens

import android.os.SystemClock
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Template
import androidx.lifecycle.Lifecycle
import com.watchman.app.R
import com.watchman.app.car.CarLocation
import com.watchman.app.car.CarMessages
import com.watchman.app.car.CarRepository
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarTheme
import com.watchman.app.car.SosOutcome

/**
 * SOS always takes two deliberate taps: "Send SOS", then "Confirm SOS" between 0.7 s and 10 s later.
 * A confirm that is too fast (a double tap) or too late falls back to the first step.
 * No hold gesture, no text entry.
 */
class SosConfirmScreen(carContext: CarContext) : Screen(carContext) {

    private sealed class State {
        object First : State()
        object Second : State()
        object Loading : State()
        class Failed(val text: String) : State()
    }

    private var state: State = State.First
    private var firstTapAt = 0L

    private fun firstTap() {
        firstTapAt = SystemClock.elapsedRealtime()
        state = State.Second
        invalidate()
    }

    private fun secondTap() {
        val gap = SystemClock.elapsedRealtime() - firstTapAt
        if (gap < MIN_GAP_MS || gap > MAX_GAP_MS) {
            state = State.First
            invalidate()
            return
        }
        send()
    }

    private fun send() {
        state = State.Loading
        invalidate()
        val fix = CarLocation.lastKnown(carContext)
        CarRepository.get(carContext).sendSos(fix?.lat, fix?.lng, fix?.accuracy) { result ->
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@sendSos
            when (result) {
                is CarResult.Ok -> if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                    screenManager.pop()
                    screenManager.push(SosSentScreen(carContext, result.value))
                }
                is CarResult.Fail -> {
                    state = State.Failed(carContext.getString(CarMessages.forFail(result.kind)))
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
                }
            }
        }
    }

    override fun onGetTemplate(): Template {
        val cancel = CarUi.action(carContext, R.string.car_cancel, R.drawable.ic_car_close, CarTheme.muted) {
            screenManager.pop()
        }
        val sosIcon = CarTheme.icon(carContext, R.drawable.ic_car_sos, CarTheme.danger)
        return when (val current = state) {
            State.Loading -> CarUi.loading(carContext)
            State.First -> CarUi.message(
                carContext,
                carContext.getString(R.string.car_sos_confirm_first),
                sosIcon,
                Action.BACK,
                CarUi.action(carContext, R.string.car_send_sos, R.drawable.ic_car_sos, null, CarTheme.sosAction, primary = true) { firstTap() },
                cancel,
            )
            State.Second -> CarUi.message(
                carContext,
                carContext.getString(R.string.car_sos_confirm_second),
                sosIcon,
                Action.BACK,
                CarUi.action(carContext, R.string.car_confirm_sos, R.drawable.ic_car_sos, null, CarTheme.sosAction, primary = true) { secondTap() },
                cancel,
            )
            is State.Failed -> CarUi.message(
                carContext,
                current.text,
                CarUi.problemIcon(carContext),
                Action.BACK,
                CarUi.action(carContext, R.string.car_try_again, R.drawable.ic_car_refresh, CarTheme.primary, primary = true) {
                    state = State.First
                    invalidate()
                },
                cancel,
            )
        }
    }

    private companion object {
        const val MIN_GAP_MS = 700L
        const val MAX_GAP_MS = 10_000L
    }
}

/** Shown after an SOS went out (or one had just gone out). */
class SosSentScreen(carContext: CarContext, private val outcome: SosOutcome) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        val text = carContext.getString(
            if (outcome == SosOutcome.SENT) R.string.car_msg_sos_sent else R.string.car_msg_sos_already,
        )
        return CarUi.message(
            carContext,
            text,
            CarTheme.icon(carContext, R.drawable.ic_car_sos, CarTheme.danger),
            Action.BACK,
            CarUi.action(carContext, R.string.car_done, R.drawable.ic_car_ack, null, CarTheme.primary, primary = true) {
                screenManager.popToRoot()
            },
        )
    }
}
