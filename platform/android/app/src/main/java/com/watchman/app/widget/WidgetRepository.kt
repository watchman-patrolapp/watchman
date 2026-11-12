package com.watchman.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import com.watchman.app.car.CarLogic
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarSessionStore
import com.watchman.app.car.SupabaseCarClient
import org.json.JSONObject

/**
 * Blocking widget data fetch. Call from the refresh worker only. Never logs; a failed fetch
 * leaves the cached state untouched so the widget does not blank when offline.
 */
object WidgetRepository {

    fun hasWidgets(context: Context, provider: Class<*>): Boolean = try {
        val manager = AppWidgetManager.getInstance(context)
        manager.getAppWidgetIds(ComponentName(context, provider)).isNotEmpty()
    } catch (ignored: Exception) {
        false
    }

    fun refresh(context: Context) {
        val app = context.applicationContext ?: context
        if (CarSessionStore.read(app) == null) {
            WidgetStateStore.clear(app)
            return
        }
        val client = SupabaseCarClient(app)
        if (hasWidgets(app, NeighbourhoodWidgetProvider::class.java)) refreshResident(app, client)
        if (hasWidgets(app, PatrolWidgetProvider::class.java)) refreshPatroller(app, client)
        // Both layouts may need the profile fields; if only one provider exists the other
        // call is skipped on purpose to keep this to one or two requests.
    }

    private fun refreshResident(context: Context, client: SupabaseCarClient) {
        val result = client.rpc("widget_resident_snapshot", JSONObject())
        if (result !is CarResult.Ok) return
        val json = result.value
        if (json.optString("status") != "ok") return
        val alert = json.optJSONObject("latest_alert")
        val notice = json.optJSONObject("latest_notice")
        WidgetStateStore.update(context) { old ->
            old.copy(
                firstName = str(json, "first_name") ?: old.firstName,
                canPatrol = if (json.has("can_patrol")) json.optBoolean("can_patrol") else old.canPatrol,
                orgName = str(json, "org_name"),
                patrolActive = json.optBoolean("patrol_active", false),
                alertTitle = alert?.let { str(it, "title") },
                alertStreet = alert?.let { str(it, "street") },
                alertAtMs = alert?.let { CarLogic.parseIsoMs(str(it, "at")) },
                alertIsSos = alert?.optBoolean("is_sos", false) ?: false,
                noticeHeadline = notice?.let { str(it, "headline") },
                updatedAtMs = System.currentTimeMillis(),
            )
        }
    }

    private fun refreshPatroller(context: Context, client: SupabaseCarClient) {
        val dash = client.rpc("car_dashboard", JSONObject().put("p_lat", JSONObject.NULL).put("p_lng", JSONObject.NULL))
        if (dash is CarResult.Fail) {
            // An old server without the car RPCs: leave the cache alone.
            return
        }
        val json = (dash as CarResult.Ok).value
        when (json.optString("status")) {
            "not_patroller" -> {
                WidgetStateStore.update(context) {
                    it.copy(
                        canPatrol = false,
                        onPatrol = false,
                        startMs = null,
                        distanceKm = null,
                        onlineCount = 0,
                        avatarFiles = emptyList(),
                        updatedAtMs = System.currentTimeMillis(),
                    )
                }
                return
            }
            "ok" -> Unit
            else -> return
        }

        val me = json.optJSONObject("me")
        val onPatrol = me?.optBoolean("on_patrol", false) ?: false
        val startMs = me?.let { CarLogic.parseIsoMs(str(it, "start_time")) }
        val km = me?.let { if (it.has("distance_km") && !it.isNull("distance_km")) it.optDouble("distance_km") else null }

        val onlineIds = ArrayList<String>()
        val online = json.optJSONArray("online_patrollers")
        if (online != null) {
            for (i in 0 until online.length()) {
                val id = online.optJSONObject(i)?.let { str(it, "user_id") } ?: continue
                onlineIds.add(id)
            }
        }

        // Avatars: user_id and avatar_url only. The phone column is never read.
        val urls = HashMap<String, String>()
        if (onlineIds.isNotEmpty()) {
            val rows = client.rpcRows("get_active_patroller_avatars", JSONObject())
            if (rows is CarResult.Ok) {
                for (i in 0 until rows.value.length()) {
                    val row = rows.value.optJSONObject(i) ?: continue
                    val id = str(row, "user_id") ?: continue
                    val url = str(row, "avatar_url") ?: continue
                    urls[id] = url
                }
            }
        }
        val files = AvatarCache.sync(context, onlineIds, urls)

        WidgetStateStore.update(context) {
            it.copy(
                canPatrol = true,
                onPatrol = onPatrol,
                startMs = if (onPatrol) startMs else null,
                distanceKm = if (onPatrol) km else null,
                onlineCount = onlineIds.size,
                avatarFiles = files,
                updatedAtMs = System.currentTimeMillis(),
            )
        }
    }

    private fun str(o: JSONObject, key: String): String? =
        if (!o.has(key) || o.isNull(key)) null else o.optString(key).trim().takeIf { it.isNotEmpty() }
}
