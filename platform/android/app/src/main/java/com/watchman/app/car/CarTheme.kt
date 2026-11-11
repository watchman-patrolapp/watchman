package com.watchman.app.car

import android.content.Context
import androidx.annotation.DrawableRes
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.core.graphics.drawable.IconCompat
import com.watchman.app.R

/**
 * Brand colours for the car (light, dark). Source of truth: web/src/index.css and favicon.svg.
 * The host switches light/dark itself and may still override colours for contrast.
 */
object CarTheme {
    private fun color(light: Long, dark: Long): CarColor =
        CarColor.createCustom(light.toInt(), dark.toInt())

    val primary: CarColor = color(0xFF0F766E, 0xFF5EEAD4)
    val accent: CarColor = color(0xFF0D9488, 0xFF2DD4BF)
    val danger: CarColor = color(0xFFB91C1C, 0xFFF87171)
    val sosAction: CarColor = color(0xFFB91C1C, 0xFFDC2626)
    val warning: CarColor = color(0xFFD97706, 0xFFFBBF24)
    val info: CarColor = color(0xFF1D4ED8, 0xFF60A5FA)
    val success: CarColor = color(0xFF047857, 0xFF34D399)
    val muted: CarColor = color(0xFF4B5563, 0xFF9CA3AF)

    fun icon(context: Context, @DrawableRes id: Int, tint: CarColor? = null): CarIcon {
        val builder = CarIcon.Builder(IconCompat.createWithResource(context, id))
        if (tint != null) builder.setTint(tint)
        return builder.build()
    }

    /** Full-colour app-mark bitmap, never tinted. */
    fun logo(context: Context): CarIcon = icon(context, R.drawable.ic_car_logo_full, null)

    /** Large green check for "patrol complete". */
    fun complete(context: Context): CarIcon = icon(context, R.drawable.ic_car_complete, success)

    @DrawableRes
    fun vehicleIcon(type: String?, label: String?): Int = when (CarLogic.vehicleIconKey(type, label)) {
        "walk" -> R.drawable.ic_car_walk
        "bike" -> R.drawable.ic_car_bike
        "motorcycle" -> R.drawable.ic_car_motorcycle
        else -> R.drawable.ic_car_vehicle
    }

    fun severityColor(severity: Severity): CarColor = when (severity) {
        Severity.CRITICAL -> danger
        Severity.HIGH -> warning
        Severity.LOW -> info
    }

    @DrawableRes
    fun severityIcon(severity: Severity): Int = when (severity) {
        Severity.CRITICAL -> R.drawable.ic_car_sos
        Severity.HIGH, Severity.LOW -> R.drawable.ic_car_pin_incident
    }
}
