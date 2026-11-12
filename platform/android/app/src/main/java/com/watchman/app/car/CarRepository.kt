package com.watchman.app.car

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * Typed wrappers over the car_* RPCs. Network work runs on a background executor; every callback
 * is delivered on the main thread. After a successful write it tells the phone via [CarEvents].
 */
class CarRepository private constructor(context: Context) {

    private val appContext: Context = context.applicationContext ?: context
    private val client = SupabaseCarClient(appContext)
    private val executor = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())

    fun dashboard(lat: Double?, lng: Double?, callback: (CarResult<Dashboard>) -> Unit) {
        val body = JSONObject()
            .put("p_lat", lat ?: JSONObject.NULL)
            .put("p_lng", lng ?: JSONObject.NULL)
        call("car_dashboard", body, null, ::parseDashboard, callback)
    }

    fun startPatrol(vehicleId: String?, callback: (CarResult<StartOutcome>) -> Unit) {
        val body = JSONObject().put("p_vehicle_id", vehicleId ?: JSONObject.NULL)
        call("car_start_patrol", body, ::startReason, ::parseStart, callback)
    }

    fun endPatrol(callback: (CarResult<EndOutcome>) -> Unit) {
        call("car_end_patrol", JSONObject(), { if (it is EndOutcome.Ended) CarEvents.PATROL_ENDED else null }, ::parseEnd) { result ->
            callback(result)
        }
    }

    fun sendSos(lat: Double?, lng: Double?, accuracy: Double?, callback: (CarResult<SosOutcome>) -> Unit) {
        val body = JSONObject()
            .put("p_lat", lat ?: JSONObject.NULL)
            .put("p_lng", lng ?: JSONObject.NULL)
            .put("p_accuracy", accuracy ?: JSONObject.NULL)
        call("car_send_sos", body, { if (it == SosOutcome.SENT) CarEvents.SOS_SENT else null }, ::parseSos, callback)
    }

    fun ackIncident(id: String, callback: (CarResult<AckOutcome>) -> Unit) {
        call(
            "car_ack_incident",
            JSONObject().put("p_incident_id", id),
            { if (it == AckOutcome.ACKNOWLEDGED) CarEvents.INCIDENT_ACKED else null },
            ::parseAck,
            callback,
        )
    }

    fun ackSos(id: String, callback: (CarResult<AckOutcome>) -> Unit) {
        call(
            "car_ack_sos",
            JSONObject().put("p_sos_id", id),
            { if (it == AckOutcome.ACKNOWLEDGED) CarEvents.SOS_ACKED else null },
            ::parseAck,
            callback,
        )
    }

    fun quickReport(kind: String, lat: Double?, lng: Double?, accuracy: Double?, callback: (CarResult<ReportOutcome>) -> Unit) {
        val body = JSONObject()
            .put("p_kind", kind)
            .put("p_lat", lat ?: JSONObject.NULL)
            .put("p_lng", lng ?: JSONObject.NULL)
            .put("p_accuracy", accuracy ?: JSONObject.NULL)
        call("car_quick_report", body, { if (it == ReportOutcome.REPORTED) CarEvents.REPORT_SENT else null }, ::parseReport, callback)
    }

    private fun startReason(outcome: StartOutcome): String? =
        if (outcome is StartOutcome.Started) CarEvents.PATROL_STARTED else null

    private fun <T> call(
        name: String,
        body: JSONObject,
        reason: ((T) -> String?)?,
        parse: (JSONObject) -> CarResult<T>,
        callback: (CarResult<T>) -> Unit,
    ) {
        executor.execute {
            val result: CarResult<T> = try {
                when (val raw = client.rpc(name, body)) {
                    is CarResult.Ok -> parse(raw.value)
                    is CarResult.Fail -> CarResult.Fail(raw.kind)
                }
            } catch (bad: Exception) {
                CarResult.Fail(FailKind.UNKNOWN)
            }
            if (result is CarResult.Ok && result.value is EndOutcome.Ended) {
                CarPatrolStateStore.clear(appContext)
            }
            main.post {
                if (result is CarResult.Ok && reason != null) {
                    // CarEvents.emit also refreshes home widgets via the app-context hook.
                    reason(result.value)?.let { CarEvents.emit(it) }
                }
                callback(result)
            }
        }
    }

    // --- parsing -------------------------------------------------------------------------

    private fun failFor(status: String?): CarResult.Fail =
        CarResult.Fail(CarMessages.failForStatus(status) ?: FailKind.UNKNOWN)

    private fun parseDashboard(json: JSONObject): CarResult<Dashboard> {
        val status = json.optString("status")
        if (status != "ok") return failFor(status)
        val meJson = json.optJSONObject("me") ?: return CarResult.Fail(FailKind.UNKNOWN)
        val fix = meJson.optJSONObject("last_fix")
        val me = Me(
            userId = str(meJson, "user_id").orEmpty(),
            userName = str(meJson, "user_name").orEmpty(),
            onPatrol = meJson.optBoolean("on_patrol", false),
            startMs = CarLogic.parseIsoMs(str(meJson, "start_time")),
            vehicleLabel = str(meJson, "vehicle_label"),
            distanceKm = dbl(meJson, "distance_km"),
            lastFix = fix?.let {
                val lat = dbl(it, "lat")
                val lng = dbl(it, "lng")
                if (lat != null && lng != null) LatLngAcc(lat, lng, null) else null
            },
        )
        val patrollers = each(json.optJSONArray("patrollers")) { o ->
            val lat = dbl(o, "lat")
            val lng = dbl(o, "lng")
            if (lat == null || lng == null) null else Patroller(
                userId = str(o, "user_id").orEmpty(),
                name = str(o, "user_name").orEmpty().ifBlank { "Patroller" },
                lat = lat,
                lng = lng,
                atMs = CarLogic.parseIsoMs(str(o, "at")),
                isLive = o.optBoolean("is_live", false),
                distanceKm = dbl(o, "distance_km"),
            )
        }
        val incidents = each(json.optJSONArray("incidents")) { o ->
            val lat = dbl(o, "lat")
            val lng = dbl(o, "lng")
            val id = str(o, "id")
            if (lat == null || lng == null || id == null) null else IncidentPin(
                id = id,
                type = str(o, "type").orEmpty(),
                title = str(o, "title").orEmpty(),
                address = str(o, "address").orEmpty(),
                atMs = CarLogic.parseIsoMs(str(o, "at")),
                lat = lat,
                lng = lng,
                distanceKm = dbl(o, "distance_km"),
                ackedByMe = o.optBoolean("acked_by_me", false),
                ackCount = o.optInt("ack_count", 0),
            )
        }
        val sos = each(json.optJSONArray("sos")) { o ->
            val id = str(o, "id")
            if (id == null) null else SosPin(
                id = id,
                incidentId = str(o, "incident_id").orEmpty(),
                createdMs = CarLogic.parseIsoMs(str(o, "created_at")),
                acknowledged = !o.isNull("acknowledged_at"),
                ackedByMe = o.optBoolean("acked_by_me", false),
                isMine = o.optBoolean("is_mine", false),
                senderName = str(o, "sender_name").orEmpty().ifBlank { "Someone" },
                lat = dbl(o, "lat"),
                lng = dbl(o, "lng"),
                address = str(o, "address").orEmpty(),
                distanceKm = dbl(o, "distance_km"),
            )
        }
        val orgCenter = json.optJSONObject("org_center")?.let {
            val lat = dbl(it, "lat")
            val lng = dbl(it, "lng")
            if (lat != null && lng != null) LatLngAcc(lat, lng, null) else null
        }
        val online = if (json.optJSONArray("online_patrollers") != null) {
            each(json.optJSONArray("online_patrollers")) { o ->
                val id = str(o, "user_id") ?: return@each null
                OnlinePatroller(
                    userId = id,
                    name = str(o, "user_name").orEmpty().ifBlank { "Patroller" },
                    startMs = CarLogic.parseIsoMs(str(o, "start_time")),
                    vehicleLabel = str(o, "vehicle_label"),
                    vehicleType = str(o, "vehicle_type"),
                    isMe = o.optBoolean("is_me", false),
                    lat = dbl(o, "lat"),
                    lng = dbl(o, "lng"),
                    atMs = CarLogic.parseIsoMs(str(o, "at")),
                    isLive = o.optBoolean("is_live", false),
                )
            }
        } else {
            // SQL not applied yet: best effort from the pin-only list plus the caller.
            val others = patrollers.map {
                OnlinePatroller(it.userId, it.name, null, null, null, false, it.lat, it.lng, it.atMs, it.isLive)
            }
            val mine = if (me.onPatrol) {
                listOf(
                    OnlinePatroller(
                        me.userId, me.userName.ifBlank { "Patroller" }, me.startMs, me.vehicleLabel, null, true,
                        me.lastFix?.lat, me.lastFix?.lng, null, false,
                    ),
                )
            } else {
                emptyList()
            }
            mine + others
        }
        val messages = each(json.optJSONArray("recent_messages")) { o ->
            val id = str(o, "id") ?: return@each null
            RecentMessage(
                id = id,
                senderName = str(o, "sender_name").orEmpty().ifBlank { "Someone" },
                atMs = CarLogic.parseIsoMs(str(o, "at")),
                preview = str(o, "preview").orEmpty(),
                isCritical = o.optBoolean("is_critical", false),
            )
        }
        return CarResult.Ok(
            Dashboard(
                me, patrollers, incidents, sos,
                CarLogic.parseIsoMs(str(json, "server_time")) ?: System.currentTimeMillis(),
                orgCenter, online, messages,
            ),
        )
    }

    private fun parseStart(json: JSONObject): CarResult<StartOutcome> = when (val status = json.optString("status")) {
        "started" -> CarResult.Ok(StartOutcome.Started(CarLogic.parseIsoMs(str(json, "start_time")), str(json, "vehicle_label")))
        "already_active" -> CarResult.Ok(StartOutcome.AlreadyActive(CarLogic.parseIsoMs(str(json, "start_time"))))
        "needs_vehicle" -> CarResult.Ok(
            StartOutcome.NeedsVehicle(
                each(json.optJSONArray("vehicles")) { o ->
                    val id = str(o, "id")
                    if (id == null) null else Vehicle(
                        id = id,
                        label = str(o, "label").orEmpty().ifBlank { "Vehicle" },
                        registration = str(o, "registration").orEmpty(),
                        vehicleType = str(o, "vehicle_type"),
                    )
                },
            ),
        )
        else -> failFor(status)
    }

    private fun parseEnd(json: JSONObject): CarResult<EndOutcome> = when (val status = json.optString("status")) {
        "ended" -> {
            val start = CarLogic.parseIsoMs(str(json, "start_time"))
            val end = CarLogic.parseIsoMs(str(json, "end_time"))
            if (start == null || end == null) {
                CarResult.Fail(FailKind.UNKNOWN)
            } else {
                CarResult.Ok(
                    EndOutcome.Ended(
                        PatrolSummary(start, end, json.optInt("duration_minutes", 0), dbl(json, "distance_km") ?: 0.0),
                    ),
                )
            }
        }
        "not_active" -> CarResult.Ok(EndOutcome.NotActive)
        else -> failFor(status)
    }

    private fun parseSos(json: JSONObject): CarResult<SosOutcome> = when (val status = json.optString("status")) {
        "sent" -> CarResult.Ok(SosOutcome.SENT)
        "already_sent" -> CarResult.Ok(SosOutcome.ALREADY_SENT)
        else -> failFor(status)
    }

    private fun parseAck(json: JSONObject): CarResult<AckOutcome> = when (val status = json.optString("status")) {
        "acknowledged" -> CarResult.Ok(AckOutcome.ACKNOWLEDGED)
        "already_acknowledged" -> CarResult.Ok(AckOutcome.ALREADY)
        else -> failFor(status)
    }

    private fun parseReport(json: JSONObject): CarResult<ReportOutcome> = when (val status = json.optString("status")) {
        "reported" -> CarResult.Ok(ReportOutcome.REPORTED)
        "too_soon" -> CarResult.Ok(ReportOutcome.TOO_SOON)
        else -> failFor(status)
    }

    private fun str(o: JSONObject, key: String): String? =
        if (!o.has(key) || o.isNull(key)) null else o.optString(key).takeIf { it.isNotEmpty() }

    private fun dbl(o: JSONObject, key: String): Double? {
        if (!o.has(key) || o.isNull(key)) return null
        val value = o.optDouble(key, Double.NaN)
        return if (value.isNaN()) null else value
    }

    private fun <T : Any> each(array: JSONArray?, map: (JSONObject) -> T?): List<T> {
        if (array == null) return emptyList()
        val out = ArrayList<T>(array.length())
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            map(item)?.let { out.add(it) }
        }
        return out
    }

    companion object {
        @Volatile
        private var instance: CarRepository? = null

        fun get(context: Context): CarRepository =
            instance ?: synchronized(this) {
                instance ?: CarRepository(context).also { instance = it }
            }
    }
}
