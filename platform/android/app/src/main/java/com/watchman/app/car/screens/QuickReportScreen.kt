package com.watchman.app.car.screens

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.Lifecycle
import com.watchman.app.R
import com.watchman.app.car.CarLocation
import com.watchman.app.car.CarMessages
import com.watchman.app.car.CarRepository
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarTheme
import com.watchman.app.car.ReportOutcome

/**
 * Four preset reports, one tap each, filed at the last known position. No text entry; the
 * patroller adds details on the phone later.
 */
class QuickReportScreen(carContext: CarContext) : Screen(carContext) {

    private class Kind(val wire: String, @StringRes val label: Int, @DrawableRes val icon: Int)

    private sealed class State {
        object Choose : State()
        object Loading : State()
        class Result(val text: String, val ok: Boolean) : State()
    }

    private var state: State = State.Choose

    private val kinds = listOf(
        Kind("suspicious_vehicle", R.string.car_report_suspicious_vehicle, R.drawable.ic_car_vehicle),
        Kind("suspicious_person", R.string.car_report_suspicious_person, R.drawable.ic_car_person),
        Kind("theft", R.string.car_report_theft, R.drawable.ic_car_theft),
        Kind("vandalism", R.string.car_report_vandalism, R.drawable.ic_car_vandalism),
    )

    private fun file(kind: Kind) {
        if (state == State.Loading) return
        state = State.Loading
        invalidate()
        val fix = CarLocation.lastKnown(carContext)
        CarRepository.get(carContext).quickReport(kind.wire, fix?.lat, fix?.lng, fix?.accuracy) { result ->
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@quickReport
            state = when (result) {
                is CarResult.Ok -> when (result.value) {
                    ReportOutcome.REPORTED -> State.Result(carContext.getString(R.string.car_msg_report_sent), true)
                    ReportOutcome.TOO_SOON -> State.Result(carContext.getString(R.string.car_msg_report_too_soon), false)
                }
                is CarResult.Fail -> State.Result(carContext.getString(CarMessages.forFail(result.kind)), false)
            }
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
        }
    }

    override fun onGetTemplate(): Template = when (val current = state) {
        State.Loading -> CarUi.loading(carContext)
        State.Choose -> {
            val list = ItemList.Builder()
            kinds.forEach { kind ->
                list.addItem(
                    Row.Builder()
                        .setTitle(carContext.getString(kind.label))
                        .setImage(CarTheme.icon(carContext, kind.icon, CarTheme.warning), Row.IMAGE_TYPE_ICON)
                        .setOnClickListener { file(kind) }
                        .build(),
                )
            }
            ListTemplate.Builder()
                .setTitle(carContext.getString(R.string.car_report_title))
                .setHeaderAction(Action.BACK)
                .setSingleList(list.build())
                .build()
        }
        is State.Result -> CarUi.message(
            carContext,
            current.text,
            if (current.ok) CarUi.okIcon(carContext) else CarUi.problemIcon(carContext),
            Action.BACK,
            CarUi.action(carContext, R.string.car_done, R.drawable.ic_car_ack, null, CarTheme.primary, primary = true) {
                screenManager.popToRoot()
            },
        )
    }
}
