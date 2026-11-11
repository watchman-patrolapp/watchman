package com.watchman.app.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import com.watchman.app.R
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarTheme
import com.watchman.app.car.OnlinePatroller

/** Who is on patrol, since when, and in what. Names and times only; GPS is not needed. */
class OnlinePatrollersScreen(carContext: CarContext, private val patrollers: List<OnlinePatroller>) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val now = System.currentTimeMillis()
        val list = ItemList.Builder()
        if (patrollers.isEmpty()) {
            list.setNoItemsMessage(carContext.getString(R.string.car_online_none))
        } else {
            patrollers.take(CarUi.listLimit(carContext)).forEach { p ->
                val title = if (p.isMe) {
                    if (p.name.isBlank()) carContext.getString(R.string.car_you) else carContext.getString(R.string.car_you_named, p.name)
                } else {
                    p.name
                }
                val row = Row.Builder()
                    .setTitle(title)
                    .setImage(
                        CarTheme.icon(carContext, CarTheme.vehicleIcon(p.vehicleType, p.vehicleLabel), if (p.isMe) CarTheme.primary else CarTheme.accent),
                        Row.IMAGE_TYPE_ICON,
                    )
                p.startMs?.let {
                    row.addText(
                        carContext.getString(
                            R.string.car_since_elapsed,
                            CarLogic.formatClock(it),
                            CarLogic.formatElapsed((now - it) / 1000),
                        ),
                    )
                }
                p.vehicleLabel?.takeIf { it.isNotBlank() }?.let { row.addText(CarLogic.formatVehicleLabel(it)) }
                list.addItem(row.build())
            }
        }
        return ListTemplate.Builder()
            .setTitle(carContext.getString(R.string.car_online_screen_title))
            .setHeaderAction(Action.BACK)
            .setSingleList(list.build())
            .build()
    }
}

/** A glance at one recent patrol message. No reply, no text entry. */
class PatrolMessageScreen(carContext: CarContext, private val message: com.watchman.app.car.RecentMessage) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val now = System.currentTimeMillis()
        val body = StringBuilder(message.senderName)
        message.atMs?.let { body.append(" · ").append(CarLogic.timeAgo(it, now)) }
        if (message.preview.isNotBlank()) body.append('\n').append(message.preview)
        return CarUi.message(
            carContext,
            body.toString(),
            CarTheme.icon(carContext, R.drawable.ic_car_report, CarTheme.info),
            Action.BACK,
            CarUi.action(carContext, R.string.car_done, R.drawable.ic_car_ack, null, CarTheme.primary, primary = true) {
                screenManager.pop()
            },
        )
    }
}
