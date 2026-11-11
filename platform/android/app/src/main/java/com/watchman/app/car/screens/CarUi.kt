package com.watchman.app.car.screens

import android.content.Intent
import android.net.Uri
import android.text.Spannable
import android.text.SpannableStringBuilder
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.CarLocation as MapLocation
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ForegroundCarColorSpan
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Metadata
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.constraints.ConstraintManager
import com.watchman.app.R
import com.watchman.app.car.CarTheme
import com.watchman.app.car.Dashboard
import kotlin.math.min
import kotlin.math.roundToInt

/** The latest dashboard, shared so the Nearby screen does not need its own fetch. Main thread only. */
internal object CarDashboardCache {
    var latest: Dashboard? = null
}

/** Small builders shared by the car screens. Strings come from car_strings.xml only. */
internal object CarUi {

    fun action(
        ctx: CarContext,
        @StringRes label: Int,
        @DrawableRes icon: Int,
        tint: CarColor?,
        background: CarColor? = null,
        primary: Boolean = false,
        onClick: () -> Unit,
    ): Action {
        val builder = Action.Builder()
            .setTitle(ctx.getString(label))
            .setIcon(CarTheme.icon(ctx, icon, tint))
            .setOnClickListener { onClick() }
        if (background != null) builder.setBackgroundColor(background)
        if (primary) builder.setFlags(Action.FLAG_PRIMARY)
        return builder.build()
    }

    fun message(
        ctx: CarContext,
        message: CharSequence,
        icon: CarIcon?,
        header: Action,
        vararg actions: Action,
    ): Template {
        val builder = MessageTemplate.Builder(message)
            .setTitle(ctx.getString(R.string.app_name))
            .setHeaderAction(header)
        if (icon != null) builder.setIcon(icon)
        actions.forEach { builder.addAction(it) }
        return builder.build()
    }

    /** A MessageTemplate in its loading state. Never carries an icon or actions. */
    fun loading(ctx: CarContext, header: Action = Action.BACK): Template =
        MessageTemplate.Builder(ctx.getString(R.string.car_loading))
            .setTitle(ctx.getString(R.string.app_name))
            .setHeaderAction(header)
            .setLoading(true)
            .build()

    fun okIcon(ctx: CarContext): CarIcon = CarTheme.icon(ctx, R.drawable.ic_car_ack, CarTheme.success)

    fun problemIcon(ctx: CarContext): CarIcon = CarTheme.icon(ctx, R.drawable.ic_car_close, CarTheme.danger)

    fun marker(ctx: CarContext, @DrawableRes icon: Int, color: CarColor): PlaceMarker =
        PlaceMarker.Builder()
            .setIcon(CarTheme.icon(ctx, icon, color), PlaceMarker.TYPE_ICON)
            .setColor(color)
            .build()

    fun place(ctx: CarContext, lat: Double, lng: Double, @DrawableRes icon: Int, color: CarColor): Place =
        Place.Builder(MapLocation.create(lat, lng)).setMarker(marker(ctx, icon, color)).build()

    /**
     * A browsable place row: a place marker, no image. Browsable rows never need a distance span,
     * but ours carry one whenever a distance is known.
     */
    fun placeRow(
        ctx: CarContext,
        title: String,
        text: CharSequence,
        lat: Double,
        lng: Double,
        @DrawableRes icon: Int,
        color: CarColor,
        onClick: () -> Unit,
    ): Row =
        Row.Builder()
            .setTitle(title)
            .addText(text)
            .setBrowsable(true)
            .setMetadata(Metadata.Builder().setPlace(place(ctx, lat, lng, icon, color)).build())
            .setOnClickListener { onClick() }
            .build()

    /** A browsable row with an image and no place. */
    fun imageRow(
        ctx: CarContext,
        title: CharSequence,
        texts: List<CharSequence>,
        @DrawableRes icon: Int,
        tint: CarColor?,
        onClick: () -> Unit,
    ): Row {
        val builder = Row.Builder()
            .setTitle(title)
            .setImage(CarTheme.icon(ctx, icon, tint), Row.IMAGE_TYPE_ICON)
            .setBrowsable(true)
            .setOnClickListener { onClick() }
        texts.forEach { builder.addText(it) }
        return builder.build()
    }

    /** A non-clickable label/value row for panes. */
    fun infoRow(ctx: CarContext, label: CharSequence, value: CharSequence, @DrawableRes icon: Int, tint: CarColor?): Row =
        Row.Builder()
            .setTitle(label)
            .addText(value)
            .setImage(CarTheme.icon(ctx, icon, tint), Row.IMAGE_TYPE_ICON)
            .build()

    /**
     * "1.2 km · 14 min ago · Acknowledged". The distance is a DistanceSpan (the host formats it),
     * parts may carry a colour.
     */
    fun detailText(distanceKm: Double?, parts: List<Pair<String, CarColor?>>): CharSequence {
        val sb = SpannableStringBuilder()
        if (distanceKm != null) {
            sb.append(" ")
            sb.setSpan(DistanceSpan.create(distanceOf(distanceKm)), 0, 1, Spannable.SPAN_INCLUSIVE_INCLUSIVE)
        }
        for ((text, color) in parts) {
            if (sb.isNotEmpty()) sb.append(" · ")
            val start = sb.length
            sb.append(text)
            if (color != null) {
                sb.setSpan(ForegroundCarColorSpan.create(color), start, sb.length, Spannable.SPAN_INCLUSIVE_EXCLUSIVE)
            }
        }
        return sb
    }

    private fun distanceOf(km: Double): Distance = when {
        km < 1.0 -> Distance.create((km * 1000).roundToInt().coerceAtLeast(1).toDouble(), Distance.UNIT_METERS)
        km < 10.0 -> Distance.create(Math.round(km * 10) / 10.0, Distance.UNIT_KILOMETERS_P1)
        else -> Distance.create(km.roundToInt().toDouble(), Distance.UNIT_KILOMETERS)
    }

    fun navigate(ctx: CarContext, lat: Double, lng: Double) {
        try {
            ctx.startCarApp(Intent(CarContext.ACTION_NAVIGATE, Uri.parse("geo:$lat,$lng")))
        } catch (failed: Exception) {
            toast(ctx, R.string.car_toast_nav_failed)
        }
    }

    fun toast(ctx: CarContext, @StringRes message: Int) {
        try {
            CarToast.makeText(ctx, message, CarToast.LENGTH_LONG).show()
        } catch (ignored: Exception) {
            // A toast is never worth a crash.
        }
    }

    /** At most six rows of ours, and never more than the host allows for a place list. */
    fun placeListLimit(ctx: CarContext): Int = try {
        min(6, ctx.getCarService(ConstraintManager::class.java).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST))
    } catch (ignored: Exception) {
        6
    }

    fun listLimit(ctx: CarContext): Int = try {
        min(6, ctx.getCarService(ConstraintManager::class.java).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST))
    } catch (ignored: Exception) {
        6
    }

    fun paneLimit(ctx: CarContext): Int = try {
        ctx.getCarService(ConstraintManager::class.java).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PANE)
    } catch (ignored: Exception) {
        4
    }
}
