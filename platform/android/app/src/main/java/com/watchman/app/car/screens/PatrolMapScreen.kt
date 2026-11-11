package com.watchman.app.car.screens

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.ItemList
import androidx.car.app.model.OnContentRefreshListener
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.watchman.app.R
import com.watchman.app.car.CarLocation
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarMessages
import com.watchman.app.car.CarPatrolStateStore
import com.watchman.app.car.CarRepository
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarSessionStore
import com.watchman.app.car.CarSosNotifier
import com.watchman.app.car.CarTheme
import com.watchman.app.car.Dashboard
import com.watchman.app.car.FailKind
import com.watchman.app.car.LatLngAcc
import com.watchman.app.car.PatrolSnapshot
import kotlin.math.max
import kotlin.math.min

/**
 * The root screen: a map with a stats row, open SOS, nearby incidents and other patrollers.
 *
 * Template quota: a PlaceListMapTemplate update is only free when the title, the number of rows and
 * every row title stay the same. So the title is constant, the live stats live in the TEXT of the
 * fixed first row, and a timer refresh only rewrites texts. When rows would change it keeps the
 * current ones and says "New updates · tap refresh"; the change lands on a user refresh, on coming
 * back from another screen, or on the first load (all free).
 */
class PatrolMapScreen(carContext: CarContext) : Screen(carContext) {

    private val repository = CarRepository.get(carContext)
    private val handler = Handler(Looper.getMainLooper())

    private var shown: Dashboard? = null
    private var shownKeys: List<String> = emptyList()
    private var incoming: Dashboard? = null
    private var pendingUpdates = false
    private var offline = false
    private var lastOkMs = 0L
    private var failure: FailKind? = null
    private var snapshot: PatrolSnapshot? = null
    private var lastFix: LatLngAcc? = null
    private var lastFetchMs = 0L
    private var inFlight = false
    private var forceCommit = true
    private var refreshRequested = false
    private var lastRenderKey = ""
    private var lastMinute = -1L

    private val tick = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            if (CarLogic.shouldAutoRefresh(lastFetchMs, now)) fetch()
            val minute = now / 60_000L
            if (minute != lastMinute) {
                lastMinute = minute
                renderIfChanged()
            }
            handler.postDelayed(this, AUTO_REFRESH_MS)
        }
    }

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = begin()
            override fun onStop(owner: LifecycleOwner) = handler.removeCallbacksAndMessages(null)
            override fun onDestroy(owner: LifecycleOwner) = handler.removeCallbacksAndMessages(null)
        })
    }

    private fun begin() {
        // Coming back from another screen may change content freely.
        forceCommit = true
        if (CarSessionStore.read(carContext) == null) {
            failure = FailKind.SIGNED_OUT
            return
        }
        if (failure == FailKind.SIGNED_OUT) failure = null
        snapshot = CarPatrolStateStore.read(carContext)
        lastMinute = System.currentTimeMillis() / 60_000L
        fetch()
        handler.removeCallbacks(tick)
        handler.postDelayed(tick, AUTO_REFRESH_MS)
    }

    private fun fetch() {
        if (inFlight) return
        val fix = CarLocation.lastKnown(carContext)
        if (fix != null) lastFix = fix
        snapshot = CarPatrolStateStore.read(carContext)
        inFlight = true
        lastFetchMs = System.currentTimeMillis()
        repository.dashboard(fix?.lat, fix?.lng) { result ->
            inFlight = false
            if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@dashboard
            onResult(result)
        }
    }

    private fun onResult(result: CarResult<Dashboard>) {
        when (result) {
            is CarResult.Ok -> {
                failure = null
                offline = false
                lastOkMs = System.currentTimeMillis()
                incoming = result.value
                CarDashboardCache.latest = result.value
                applyIncoming(free = forceCommit || refreshRequested)
                forceCommit = false
                result.value.sos.forEach { CarSosNotifier.notifyIfNew(carContext, it) }
            }
            is CarResult.Fail -> when (result.kind) {
                FailKind.OFFLINE, FailKind.UNKNOWN -> {
                    if (shown == null) failure = result.kind else offline = true
                }
                else -> failure = result.kind
            }
        }
        if (refreshRequested) {
            refreshRequested = false
            safeInvalidate()
        } else {
            renderIfChanged()
        }
    }

    private fun applyIncoming(free: Boolean) {
        val data = incoming ?: return
        val candidate = candidateKeys(data)
        val current = shown
        if (current == null || free || current.me.onPatrol != data.me.onPatrol) {
            // The on-patrol flip changes the first row's title: one counted update, and rare.
            shown = data
            shownKeys = candidate
            pendingUpdates = false
            return
        }
        if (candidate.toSet() == shownKeys.toSet()) {
            // Same rows, maybe reordered by distance: keep the order on screen.
            val sameTitles = shownKeys.all { titleFor(it, data) == titleFor(it, current) }
            if (sameTitles) {
                shown = data
                pendingUpdates = false
            } else {
                pendingUpdates = true
            }
        } else {
            pendingUpdates = true
        }
    }

    private fun onContentRefresh() {
        forceCommit = true
        refreshRequested = true
        if (inFlight) return
        if (System.currentTimeMillis() - lastFetchMs >= MIN_USER_REFRESH_MS) {
            fetch()
        } else {
            applyIncoming(free = true)
            forceCommit = false
            refreshRequested = false
            safeInvalidate()
        }
    }

    private fun renderIfChanged() {
        if (buildModel().key != lastRenderKey) safeInvalidate()
    }

    private fun safeInvalidate() {
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) invalidate()
    }

    // --- model ------------------------------------------------------------------------------

    private class Model(val template: Template, val key: String)

    override fun onGetTemplate(): Template {
        val model = buildModel()
        lastRenderKey = model.key
        return model.template
    }

    private fun buildModel(): Model {
        failure?.let { return failureModel(it) }

        val data = shown
        val onPatrol = data?.me?.onPatrol ?: (snapshot?.active == true)
        val strip = actionStrip(onPatrol)
        // Constant title + APP_ICON on every render (free refresh); the host ActionStrip overlaps
        // this header band instead of the status row.
        val builder = PlaceListMapTemplate.Builder()
            .setTitle(carContext.getString(R.string.app_name))
            .setHeaderAction(Action.APP_ICON)
            .setActionStrip(strip)
            .setOnContentRefreshListener(OnContentRefreshListener { onContentRefresh() })
        applyAnchor(builder)

        val snap = snapshot
        if (data == null && (snap == null || !snap.active)) {
            return Model(builder.setLoading(true).build(), "loading|$onPatrol")
        }

        val now = System.currentTimeMillis()
        val items = ItemList.Builder()
        val signature = StringBuilder()

        val stats = statsRow(data, snap, now)
        items.addItem(stats.first)
        signature.append(stats.second).append('\n')
        val online = onlineRow(data, onPatrol)
        items.addItem(online.first)
        signature.append(online.second).append('\n')

        if (data != null) {
            for (key in shownKeys) {
                val built = rowFor(key, data, now) ?: continue
                items.addItem(built.first)
                signature.append(built.second).append('\n')
            }
        }
        signature.append(if (onPatrol) "P" else "I")
        return Model(builder.setItemList(items.build()).build(), signature.toString())
    }

    private fun failureModel(kind: FailKind): Model {
        val message = carContext.getString(CarMessages.forFail(kind))
        val template = CarUi.message(
            carContext,
            message,
            CarTheme.logo(carContext),
            Action.APP_ICON,
            CarUi.action(carContext, R.string.car_try_again, R.drawable.ic_car_refresh, CarTheme.primary, primary = true) {
                failure = null
                begin()
                safeInvalidate()
            },
        )
        return Model(template, "fail|$kind|$message")
    }

    private fun applyAnchor(builder: PlaceListMapTemplate.Builder) {
        if (CarLocation.hasPermission(carContext)) builder.setCurrentLocationEnabled(true)
        val snap = snapshot
        val snapPoint = if (snap?.lat != null && snap.lng != null) LatLngAcc(snap.lat, snap.lng, snap.accuracy) else null
        val data = shown ?: CarDashboardCache.latest
        val anchor = CarLogic.pickMapAnchor(lastFix, data?.me?.lastFix, snapPoint, data?.orgCenter) ?: return
        // The anchor centres the map and its marker is the driver's own pin.
        builder.setAnchor(CarUi.place(carContext, anchor.lat, anchor.lng, R.drawable.ic_car_pin_patroller, CarTheme.primary))
    }

    private fun actionStrip(onPatrol: Boolean): ActionStrip {
        val first = if (onPatrol) {
            CarUi.action(carContext, R.string.car_end_patrol, R.drawable.ic_car_end_patrol, CarTheme.primary) {
                screenManager.push(EndPatrolConfirmScreen(carContext))
            }
        } else {
            CarUi.action(carContext, R.string.car_check_in, R.drawable.ic_car_check_in, CarTheme.primary) {
                screenManager.push(CheckInScreen(carContext, null))
            }
        }
        val data = shown
        val strip = ActionStrip.Builder()
            .addAction(first)
            .addAction(
                CarUi.action(carContext, R.string.car_report, R.drawable.ic_car_report, CarTheme.warning) {
                    screenManager.push(QuickReportScreen(carContext))
                },
            )
            // Red tint only: the host may reject a background on a map ActionStrip item.
            .addAction(
                CarUi.action(carContext, R.string.car_sos, R.drawable.ic_car_sos, CarTheme.sosAction) {
                    screenManager.push(SosConfirmScreen(carContext))
                },
            )
        if (data != null && CarLogic.showNearby(data.sos.size, data.incidents.map { it.distanceKm })) {
            strip.addAction(
                CarUi.action(carContext, R.string.car_nearby, R.drawable.ic_car_nearby, CarTheme.accent) {
                    screenManager.push(IncidentsScreen(carContext))
                },
            )
        }
        return strip.build()
    }
    /** Row 1: always first, always browsable, title is the patrol state, one stats line in the TEXT. */
    private fun statsRow(data: Dashboard?, snap: PatrolSnapshot?, now: Long): Pair<Row, String> {
        val me = data?.me
        val activeSnap = snap?.takeIf { it.active }
        val onPatrol = me?.onPatrol ?: (activeSnap != null)
        val startMs = if (me != null) me.startMs else activeSnap?.startTimeMs?.takeIf { it > 0 }
        val km = if (me != null) {
            if (me.onPatrol) {
                CarLogic.displayKm(me.distanceKm, activeSnap?.sessionDistanceKm, activeSnap?.startTimeMs ?: 0L, me.startMs ?: 0L)
            } else {
                null
            }
        } else {
            activeSnap?.sessionDistanceKm
        }
        val stats = CarLogic.formatPatrolStats(onPatrol, startMs, now, km)
        val system = when {
            offline -> carContext.getString(R.string.car_offline_updated, CarLogic.formatClock(lastOkMs))
            pendingUpdates -> carContext.getString(R.string.car_new_updates)
            else -> null
        }
        val title = carContext.getString(if (onPatrol) R.string.car_row_on_patrol else R.string.car_row_not_on_patrol)
        val builder = Row.Builder()
            .setTitle(title)
            .setImage(CarTheme.logo(carContext), Row.IMAGE_TYPE_SMALL)
            .setBrowsable(true)
            .setOnClickListener { screenManager.push(PatrolStatusScreen(carContext)) }
        stats?.let { builder.addText(it) }
        system?.let { builder.addText(it) }
        return Pair(builder.build(), "$title|${stats.orEmpty()}|${system.orEmpty()}")
    }

    /** Row 2: constant title, the count lives in the text. */
    private fun onlineRow(data: Dashboard?, onPatrol: Boolean): Pair<Row, String> {
        val title = carContext.getString(R.string.car_online_title)
        val count = data?.onlinePatrollers?.size ?: if (onPatrol) 1 else 0
        val text = if (count > 0) carContext.getString(R.string.car_online_count, count) else carContext.getString(R.string.car_online_none)
        val row = CarUi.imageRow(carContext, title, listOf(text), R.drawable.ic_car_pin_patroller, CarTheme.accent) {
            screenManager.push(OnlinePatrollersScreen(carContext, (shown ?: CarDashboardCache.latest)?.onlinePatrollers.orEmpty()))
        }
        return Pair(row, "$title|$text")
    }

    /** Only rows with something to say: open SOS, recent chat, nearby incidents (in that order). */
    private fun candidateKeys(data: Dashboard): List<String> {
        val slots = max(0, CarUi.placeListLimit(carContext) - FIXED_ROWS)
        val sos = data.sos.take(min(3, slots))
        var remaining = slots - sos.size
        val messages = data.recentMessages
            .filterNot { m ->
                m.preview.trimStart().startsWith("SOS", ignoreCase = true) ||
                    (m.isCritical && data.sos.any { it.senderName == m.senderName })
            }
            .take(min(2, remaining))
        remaining -= messages.size
        val incidents = data.incidents.take(max(0, remaining))
        return sos.map { "sos:${it.id}" } + messages.map { "msg:${it.id}" } + incidents.map { "inc:${it.id}" }
    }

    private fun titleFor(key: String, data: Dashboard): String = when {
        key.startsWith("sos:") -> {
            val pin = data.sos.firstOrNull { it.id == key.removePrefix("sos:") }
            carContext.getString(R.string.car_sos_row_title, pin?.senderName.orEmpty())
        }
        key.startsWith("msg:") -> {
            val msg = data.recentMessages.firstOrNull { it.id == key.removePrefix("msg:") }
            carContext.getString(R.string.car_message_row_title, msg?.senderName.orEmpty())
        }
        else -> {
            val pin = data.incidents.firstOrNull { it.id == key.removePrefix("inc:") }
            pin?.title?.ifBlank { pin.type }?.ifBlank { carContext.getString(R.string.car_label_incident) }.orEmpty()
        }
    }

    /** A row plus the plain text it shows (for the render signature). */
    private fun rowFor(key: String, data: Dashboard, now: Long): Pair<Row, String>? {
        val title = titleFor(key, data)
        when {
            key.startsWith("sos:") -> {
                val pin = data.sos.firstOrNull { it.id == key.removePrefix("sos:") } ?: return null
                val parts = mutableListOf<Pair<String, androidx.car.app.model.CarColor?>>()
                pin.createdMs?.let { parts.add(Pair(CarLogic.timeAgo(it, now), null)) }
                if (pin.acknowledged) parts.add(Pair(carContext.getString(R.string.car_acknowledged), CarTheme.success))
                val text = CarUi.detailText(pin.distanceKm, parts)
                val open = { screenManager.push(SosAlertScreen(carContext, pin.id, pin)); Unit }
                val row = if (pin.lat != null && pin.lng != null) {
                    CarUi.placeRow(carContext, title, text, pin.lat, pin.lng, R.drawable.ic_car_sos, CarTheme.danger, open)
                } else {
                    CarUi.imageRow(carContext, title, listOf(text), R.drawable.ic_car_sos, CarTheme.danger, open)
                }
                return Pair(row, "$title|$text")
            }
            key.startsWith("msg:") -> {
                val msg = data.recentMessages.firstOrNull { it.id == key.removePrefix("msg:") } ?: return null
                // Glance only: time-ago, never the message body.
                val text = msg.atMs?.let { CarLogic.timeAgo(it, now) }.orEmpty()
                val color = if (msg.isCritical) CarTheme.danger else CarTheme.info
                val row = CarUi.imageRow(carContext, title, if (text.isEmpty()) emptyList() else listOf(text), R.drawable.ic_car_report, color) {
                    screenManager.push(PatrolMessageScreen(carContext, msg))
                }
                return Pair(row, "$title|$text")
            }
            else -> {
                val pin = data.incidents.firstOrNull { it.id == key.removePrefix("inc:") } ?: return null
                val severity = CarLogic.severityFor(pin.type)
                val parts = mutableListOf<Pair<String, androidx.car.app.model.CarColor?>>()
                pin.atMs?.let { parts.add(Pair(CarLogic.timeAgo(it, now), null)) }
                if (pin.ackedByMe) parts.add(Pair(carContext.getString(R.string.car_acknowledged), CarTheme.success))
                val text = CarUi.detailText(pin.distanceKm, parts)
                val row = CarUi.placeRow(
                    carContext,
                    title,
                    text,
                    pin.lat,
                    pin.lng,
                    CarTheme.severityIcon(severity),
                    CarTheme.severityColor(severity),
                ) { screenManager.push(IncidentDetailScreen(carContext, DetailData.fromIncident(pin))) }
                return Pair(row, "$title|$text")
            }
        }
    }

    private companion object {
        const val AUTO_REFRESH_MS = 15_000L
        const val MIN_USER_REFRESH_MS = 10_000L
        const val FIXED_ROWS = 2
    }
}
