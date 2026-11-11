package com.watchman.app.car

import android.content.Context

/** What the phone knows about the current patrol, including GPS fixes not yet uploaded. */
data class PatrolSnapshot(
    val active: Boolean,
    val startTimeMs: Long,
    val sessionDistanceKm: Double,
    val lat: Double?,
    val lng: Double?,
    val accuracy: Double?,
    val recordedAtMs: Long,
    val userId: String,
    val updatedAtMs: Long,
)

/** Plain app-private prefs. Holds no tokens. */
object CarPatrolStateStore {
    private const val PREFS_NAME = "watchman_car_patrol"
    private const val KEY_ACTIVE = "active"
    private const val KEY_START = "startTimeMs"
    private const val KEY_KM = "sessionDistanceKm"
    private const val KEY_LAT = "lat"
    private const val KEY_LNG = "lng"
    private const val KEY_ACC = "accuracy"
    private const val KEY_RECORDED = "recordedAtMs"
    private const val KEY_USER = "userId"
    private const val KEY_UPDATED = "updatedAtMs"

    private val lock = Any()

    private fun prefs(context: Context) =
        (context.applicationContext ?: context).getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @JvmStatic
    fun save(context: Context, snapshot: PatrolSnapshot) {
        synchronized(lock) {
            val edit = prefs(context).edit().clear()
                .putBoolean(KEY_ACTIVE, snapshot.active)
                .putLong(KEY_START, snapshot.startTimeMs)
                .putFloat(KEY_KM, snapshot.sessionDistanceKm.toFloat())
                .putLong(KEY_RECORDED, snapshot.recordedAtMs)
                .putString(KEY_USER, snapshot.userId)
                .putLong(KEY_UPDATED, snapshot.updatedAtMs)
            snapshot.lat?.let { edit.putLong(KEY_LAT, java.lang.Double.doubleToRawLongBits(it)) }
            snapshot.lng?.let { edit.putLong(KEY_LNG, java.lang.Double.doubleToRawLongBits(it)) }
            snapshot.accuracy?.let { edit.putFloat(KEY_ACC, it.toFloat()) }
            edit.commit()
        }
    }

    /** Null when absent, or when it belongs to a different user than the car session. */
    @JvmStatic
    fun read(context: Context): PatrolSnapshot? = synchronized(lock) {
        try {
            val p = prefs(context)
            if (!p.contains(KEY_USER)) return@synchronized null
            val userId = p.getString(KEY_USER, null).orEmpty()
            val session = CarSessionStore.read(context)
            if (session == null || session.userId != userId) return@synchronized null
            PatrolSnapshot(
                active = p.getBoolean(KEY_ACTIVE, false),
                startTimeMs = p.getLong(KEY_START, 0L),
                sessionDistanceKm = p.getFloat(KEY_KM, 0f).toDouble(),
                lat = if (p.contains(KEY_LAT)) java.lang.Double.longBitsToDouble(p.getLong(KEY_LAT, 0L)) else null,
                lng = if (p.contains(KEY_LNG)) java.lang.Double.longBitsToDouble(p.getLong(KEY_LNG, 0L)) else null,
                accuracy = if (p.contains(KEY_ACC)) p.getFloat(KEY_ACC, 0f).toDouble() else null,
                recordedAtMs = p.getLong(KEY_RECORDED, 0L),
                userId = userId,
                updatedAtMs = p.getLong(KEY_UPDATED, 0L),
            )
        } catch (ignored: Exception) {
            null
        }
    }

    @JvmStatic
    fun clear(context: Context) {
        synchronized(lock) { prefs(context).edit().clear().commit() }
    }
}
