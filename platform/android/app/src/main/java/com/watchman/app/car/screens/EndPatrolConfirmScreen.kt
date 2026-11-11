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
import com.watchman.app.car.EndOutcome
import com.watchman.app.car.PatrolSummary

/** "End your patrol?" then loading, then the summary (or an error with Try again). */
class EndPatrolConfirmScreen(carContext: CarContext) : Screen(carContext) {

    private sealed class State {
        object Confirm : State()
        object Loading : State()
        class Failed(val text: String) : State()
    }

    private var state: State = State.Confirm

    private fun end() {
        state = State.Loading
        invalidate()
        CarRepository.get(carContext).endPatrol { result ->
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@endPatrol
            when (result) {
                is CarResult.Ok -> {
                    val summary = (result.value as? EndOutcome.Ended)?.summary
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                        // Back to the root first, so no stale Status or Confirm screen is left under the summary.
                        screenManager.popToRoot()
                        screenManager.push(PatrolSummaryScreen(carContext, summary))
                    }
                }
                is CarResult.Fail -> {
                    state = State.Failed(carContext.getString(CarMessages.forFail(result.kind)))
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
                }
            }
        }
    }

    override fun onGetTemplate(): Template = when (val current = state) {
        State.Loading -> CarUi.loading(carContext)
        State.Confirm -> CarUi.message(
            carContext,
            carContext.getString(R.string.car_end_confirm),
            CarTheme.icon(carContext, R.drawable.ic_car_end_patrol, CarTheme.danger),
            Action.BACK,
            CarUi.action(carContext, R.string.car_end_patrol, R.drawable.ic_car_end_patrol, null, CarTheme.sosAction, primary = true) { end() },
            CarUi.action(carContext, R.string.car_cancel, R.drawable.ic_car_close, CarTheme.muted) { screenManager.pop() },
        )
        is State.Failed -> CarUi.message(
            carContext,
            current.text,
            CarUi.problemIcon(carContext),
            Action.BACK,
            CarUi.action(carContext, R.string.car_try_again, R.drawable.ic_car_refresh, CarTheme.primary, primary = true) { end() },
            CarUi.action(carContext, R.string.car_cancel, R.drawable.ic_car_close, CarTheme.muted) { screenManager.pop() },
        )
    }
}

/** Date, logged in, logged off, duration and distance. Null means the patrol had already ended. */
class PatrolSummaryScreen(carContext: CarContext, private val summary: PatrolSummary?) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val done = CarUi.action(carContext, R.string.car_done, R.drawable.ic_car_ack, null, CarTheme.primary, primary = true) {
            screenManager.popToRoot()
        }
        if (summary == null) {
            return CarUi.message(
                carContext,
                carContext.getString(R.string.car_patrol_ended_already),
                CarTheme.complete(carContext),
                Action.BACK,
                done,
            )
        }
        val pane = Pane.Builder().setImage(CarTheme.complete(carContext))
        val duration = CarLogic.formatElapsed(summary.durationMinutes * 60L)
        val distance = CarLogic.formatKm(summary.distanceKm)

        // Duration and distance first: a small host may only paint two rows under the image.
        pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_duration), duration, R.drawable.ic_car_refresh, CarTheme.primary))
        pane.addRow(CarUi.infoRow(carContext, carContext.getString(R.string.car_label_distance), distance, R.drawable.ic_car_navigate, CarTheme.primary))
        pane.addRow(
            CarUi.infoRow(
                carContext,
                carContext.getString(R.string.car_label_patrol_time),
                CarLogic.formatTimeRange(summary.startMs, summary.endMs),
                R.drawable.ic_car_check_in,
                CarTheme.primary,
            ),
        )
        pane.addAction(done)

        return PaneTemplate.Builder(pane.build())
            .setTitle(carContext.getString(R.string.car_summary_title))
            .setHeaderAction(Action.BACK)
            .build()
    }
}
