package com.watchman.app.car

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

enum class Severity { CRITICAL, HIGH, LOW }

/**
 * Pure helpers for the car screens. No android.* and no org.json, so JUnit can run them on the JVM.
 * Time uses java.util only (minSdk 24 has no java.time without desugaring).
 */
object CarLogic {

    private const val EARTH_RADIUS_KM = 6371.0088

    fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return EARTH_RADIUS_KM * 2 * asin(min(1.0, sqrt(a)))
    }

    /** "0.4 km" under 10, else "12 km"; null gives an em dash. */
    fun formatKm(km: Double?): String = when {
        km == null || km.isNaN() -> "—"
        km < 10 -> String.format(Locale.US, "%.1f km", max(0.0, km))
        else -> String.format(Locale.US, "%.0f km", km)
    }

    /** "8m" or "1h 05m". */
    fun formatElapsed(seconds: Long): String {
        val totalMinutes = max(0L, seconds) / 60
        if (totalMinutes < 60) return "${totalMinutes}m"
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        return String.format(Locale.US, "%dh %02dm", hours, minutes)
    }

    /** Plate as shown in the car: trimmed and uppercase. Blank stays blank. */
    fun formatRegistration(text: String?): String = text?.trim()?.uppercase(Locale.ROOT).orEmpty()

    /**
     * "Jeep · czk408ec" becomes "Jeep · CZK408EC". Without a separator only a plate-looking string
     * (no spaces, letters/digits/dashes with at least one digit) is uppercased.
     */
    fun formatVehicleLabel(label: String?): String {
        val text = label?.trim().orEmpty()
        if (text.isEmpty()) return text
        val sep = " · "
        val i = text.lastIndexOf(sep)
        if (i >= 0) {
            return text.substring(0, i + sep.length) + text.substring(i + sep.length).uppercase(Locale.ROOT)
        }
        val looksLikePlate = PLATE.matches(text) && text.any { it.isDigit() }
        return if (looksLikePlate) text.uppercase(Locale.ROOT) else text
    }

    private val PLATE = Regex("^[A-Za-z0-9-]+$")

    fun formatClock(epochMs: Long, zone: TimeZone = TimeZone.getDefault()): String =
        format("HH:mm", epochMs, zone)

    /** "Wed 11 Nov". */
    fun formatDate(epochMs: Long, zone: TimeZone = TimeZone.getDefault()): String =
        format("EEE d MMM", epochMs, zone)

    private fun format(pattern: String, epochMs: Long, zone: TimeZone): String {
        val formatter = SimpleDateFormat(pattern, Locale.ENGLISH)
        formatter.timeZone = zone
        return formatter.format(Date(epochMs))
    }

    /** The single stats subtitle: "21:04 · 1h 05m · 12.4 km". Null when idle. */
    fun formatPatrolStats(
        onPatrol: Boolean,
        startMs: Long?,
        nowMs: Long,
        km: Double?,
        zone: TimeZone = TimeZone.getDefault(),
    ): String? {
        if (!onPatrol || startMs == null) return null
        val elapsed = formatElapsed((nowMs - startMs) / 1000)
        val distance = String.format(Locale.US, "%.1f km", max(0.0, km ?: 0.0))
        return "${formatClock(startMs, zone)} · $elapsed · $distance"
    }

    /** "Thu 12 Nov · 00:20". */
    fun formatDateTime(epochMs: Long, zone: TimeZone = TimeZone.getDefault()): String =
        "${formatDate(epochMs, zone)} · ${formatClock(epochMs, zone)}"

    /** "Thu 12 Nov · 00:20–00:28"; across midnight both dates are shown. */
    fun formatTimeRange(startMs: Long, endMs: Long, zone: TimeZone = TimeZone.getDefault()): String {
        val startDate = formatDate(startMs, zone)
        return if (startDate == formatDate(endMs, zone)) {
            "$startDate · ${formatClock(startMs, zone)}–${formatClock(endMs, zone)}"
        } else {
            "${formatDateTime(startMs, zone)} – ${formatDateTime(endMs, zone)}"
        }
    }

    private fun validPoint(p: LatLngAcc?): LatLngAcc? {
        if (p == null || p.lat.isNaN() || p.lng.isNaN() || p.lat.isInfinite() || p.lng.isInfinite()) return null
        if (p.lat < -90.0 || p.lat > 90.0 || p.lng < -180.0 || p.lng > 180.0) return null
        if (p.lat == 0.0 && p.lng == 0.0) return null
        return p
    }

    /**
     * Where to centre the home map: live/system fix, then the server's last point, then the phone's
     * patrol snapshot (any age), then the neighbourhood centre. Null means leave the map alone.
     */
    fun pickMapAnchor(
        liveFix: LatLngAcc?,
        serverFix: LatLngAcc?,
        snapshotFix: LatLngAcc?,
        orgCenter: LatLngAcc?,
    ): LatLngAcc? = validPoint(liveFix) ?: validPoint(serverFix) ?: validPoint(snapshotFix) ?: validPoint(orgCenter)

    /** Nearby only earns a place in the action strip when it has something to show. */
    const val NEARBY_INCIDENT_KM = 5.0

    fun showNearby(openSosCount: Int, incidentDistancesKm: List<Double?>): Boolean =
        openSosCount > 0 || incidentDistancesKm.any { it == null || it <= NEARBY_INCIDENT_KM }

    /** "walk", "bike", "motorcycle" or "car", from the stored type first and the label as a fallback. */
    fun vehicleIconKey(type: String?, label: String?): String {
        val t = type?.trim()?.lowercase(Locale.ROOT).orEmpty()
        val l = label?.trim()?.lowercase(Locale.ROOT).orEmpty()
        when (t) {
            "on_foot", "horse" -> return "walk"
            "bicycle", "electric_scooter", "segway" -> return "bike"
            "motorcycle" -> return "motorcycle"
            "" -> Unit
            else -> if (t != "car" || l.isEmpty()) return "car"
        }
        return when {
            l.contains("on foot") || l == "walking" || l == "foot" -> "walk"
            l.contains("motorbike") || l.contains("motorcycle") || l.contains("scooter") ||
                (l.contains("bike") && l.contains("motor")) -> "motorcycle"
            l.contains("bicycle") || l.contains("bike") -> "bike"
            else -> "car"
        }
    }

    fun severityFor(type: String?): Severity = when (type?.trim()?.lowercase(Locale.ROOT)) {
        "sos" -> Severity.CRITICAL
        "theft", "suspicious vehicle", "suspicious activity" -> Severity.HIGH
        else -> Severity.LOW
    }

    fun shouldAutoRefresh(lastMs: Long, nowMs: Long, minMs: Long = 15_000L): Boolean =
        lastMs <= 0L || nowMs - lastMs >= minMs

    fun needsTokenRefresh(expiresAtSec: Long, nowSec: Long, skewSec: Long = 20L): Boolean =
        expiresAtSec <= 0L || nowSec >= expiresAtSec - skewSec

    /**
     * The car shows the larger of the server figure and the phone snapshot, but only when both
     * describe the same patrol (start times within 60 s). Otherwise the server figure stands.
     */
    fun displayKm(
        serverKm: Double?,
        snapshotKm: Double?,
        snapshotStartMs: Long,
        serverStartMs: Long,
    ): Double? {
        if (snapshotKm == null || snapshotStartMs <= 0L || serverStartMs <= 0L) return serverKm
        if (abs(snapshotStartMs - serverStartMs) > 60_000L) return serverKm
        return max(serverKm ?: 0.0, snapshotKm)
    }

    /** Two templates only count as a free refresh when this string is unchanged. */
    fun rowSignature(title: String, rowTitles: List<String>): String =
        title + "\u001f" + rowTitles.size + "\u001f" + rowTitles.joinToString("\u001e")

    fun timeAgo(atMs: Long, nowMs: Long): String {
        val seconds = (nowMs - atMs) / 1000
        if (seconds < 60) return "now"
        val minutes = seconds / 60
        if (minutes < 60) return "$minutes min ago"
        return "${minutes / 60} h ago"
    }

    /**
     * Parses a Postgres timestamptz as PostgREST prints it ("2026-11-11T19:04:12.345678+00:00",
     * also "Z" and "+02"). Returns null when it does not look like a timestamp.
     */
    fun parseIsoMs(text: String?): Long? {
        if (text.isNullOrBlank()) return null
        val match = ISO.matchEntire(text.trim()) ?: return null
        val g = match.groupValues
        val fraction = match.groupValues[7]
        val zone = match.groupValues[8]
        val millis = if (fraction.isEmpty()) 0 else (fraction + "00").substring(0, 3).toInt()
        val offsetMinutes = when {
            zone.isEmpty() || zone == "Z" -> 0
            else -> {
                val sign = if (zone[0] == '-') -1 else 1
                val digits = zone.substring(1).replace(":", "")
                val hh = digits.substring(0, 2).toInt()
                val mm = if (digits.length >= 4) digits.substring(2, 4).toInt() else 0
                sign * (hh * 60 + mm)
            }
        }
        val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT)
        calendar.clear()
        calendar.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
        calendar.set(Calendar.MILLISECOND, millis)
        return calendar.timeInMillis - offsetMinutes * 60_000L
    }

    private val ISO = Regex(
        "^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?(Z|[+-]\\d{2}(?::?\\d{2})?)?$",
    )
}
