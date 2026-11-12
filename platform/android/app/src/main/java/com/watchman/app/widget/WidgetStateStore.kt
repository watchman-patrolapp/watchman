package com.watchman.app.widget

import android.content.Context
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Last-known widget content. App-private prefs; holds no tokens and no phone numbers.
 * Cleared on sign-out so names, avatars, alert text and the org name never outlive the session.
 */
data class WidgetState(
    val firstName: String? = null,
    /** null until the first successful profile sync or refresh. */
    val canPatrol: Boolean? = null,
    val orgName: String? = null,
    val onPatrol: Boolean = false,
    val startMs: Long? = null,
    val distanceKm: Double? = null,
    val onlineCount: Int = 0,
    /** Cached avatar file names (up to 3); "" means draw the placeholder. */
    val avatarFiles: List<String> = emptyList(),
    val patrolActive: Boolean = false,
    val alertTitle: String? = null,
    val alertStreet: String? = null,
    val alertAtMs: Long? = null,
    val alertIsSos: Boolean = false,
    val noticeHeadline: String? = null,
    val updatedAtMs: Long = 0L,
)

object WidgetStateStore {
    private const val PREFS_NAME = "watchman_widget_state"
    private const val KEY_STATE = "state"
    const val AVATAR_DIR = "widget_avatars"

    private val lock = Any()

    private fun prefs(context: Context) =
        (context.applicationContext ?: context).getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @JvmStatic
    fun read(context: Context): WidgetState = synchronized(lock) {
        try {
            val text = prefs(context).getString(KEY_STATE, null) ?: return@synchronized WidgetState()
            fromJson(JSONObject(text))
        } catch (ignored: Exception) {
            WidgetState()
        }
    }

    fun update(context: Context, change: (WidgetState) -> WidgetState) {
        synchronized(lock) {
            val next = change(read(context))
            prefs(context).edit().putString(KEY_STATE, toJson(next).toString()).commit()
        }
    }

    /** Wipes cached PII and the avatar files. */
    @JvmStatic
    fun clear(context: Context) {
        synchronized(lock) {
            prefs(context).edit().clear().commit()
            val app = context.applicationContext ?: context
            File(app.filesDir, AVATAR_DIR).deleteRecursively()
        }
    }

    private fun toJson(s: WidgetState): JSONObject {
        val o = JSONObject()
        s.firstName?.let { o.put("firstName", it) }
        s.canPatrol?.let { o.put("canPatrol", it) }
        s.orgName?.let { o.put("orgName", it) }
        o.put("onPatrol", s.onPatrol)
        s.startMs?.let { o.put("startMs", it) }
        s.distanceKm?.let { o.put("distanceKm", it) }
        o.put("onlineCount", s.onlineCount)
        o.put("avatarFiles", JSONArray(s.avatarFiles))
        o.put("patrolActive", s.patrolActive)
        s.alertTitle?.let { o.put("alertTitle", it) }
        s.alertStreet?.let { o.put("alertStreet", it) }
        s.alertAtMs?.let { o.put("alertAtMs", it) }
        o.put("alertIsSos", s.alertIsSos)
        s.noticeHeadline?.let { o.put("noticeHeadline", it) }
        o.put("updatedAtMs", s.updatedAtMs)
        return o
    }

    private fun fromJson(o: JSONObject): WidgetState {
        val files = ArrayList<String>()
        o.optJSONArray("avatarFiles")?.let { a ->
            for (i in 0 until a.length()) files.add(a.optString(i))
        }
        return WidgetState(
            firstName = str(o, "firstName"),
            canPatrol = if (o.has("canPatrol")) o.optBoolean("canPatrol") else null,
            orgName = str(o, "orgName"),
            onPatrol = o.optBoolean("onPatrol", false),
            startMs = if (o.has("startMs")) o.optLong("startMs") else null,
            distanceKm = if (o.has("distanceKm")) o.optDouble("distanceKm") else null,
            onlineCount = o.optInt("onlineCount", 0),
            avatarFiles = files,
            patrolActive = o.optBoolean("patrolActive", false),
            alertTitle = str(o, "alertTitle"),
            alertStreet = str(o, "alertStreet"),
            alertAtMs = if (o.has("alertAtMs")) o.optLong("alertAtMs") else null,
            alertIsSos = o.optBoolean("alertIsSos", false),
            noticeHeadline = str(o, "noticeHeadline"),
            updatedAtMs = o.optLong("updatedAtMs", 0L),
        )
    }

    private fun str(o: JSONObject, key: String): String? =
        if (!o.has(key) || o.isNull(key)) null else o.optString(key).takeIf { it.isNotBlank() }
}
