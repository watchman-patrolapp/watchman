package com.watchman.app.car

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat

/** Last known position only. No location requests and no new permissions. */
object CarLocation {
    private const val FRESH_MS = 2 * 60_000L
    private const val SNAPSHOT_FRESH_MS = 5 * 60_000L

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun lastKnown(context: Context, nowMs: Long = System.currentTimeMillis()): LatLngAcc? {
        val system = systemFix(context)
        if (system != null && nowMs - system.time <= FRESH_MS) {
            return LatLngAcc(system.latitude, system.longitude, if (system.hasAccuracy()) system.accuracy.toDouble() else null)
        }
        val snapshot = CarPatrolStateStore.read(context)
        if (snapshot != null && snapshot.lat != null && snapshot.lng != null &&
            snapshot.recordedAtMs > 0 && nowMs - snapshot.recordedAtMs <= SNAPSHOT_FRESH_MS
        ) {
            return LatLngAcc(snapshot.lat, snapshot.lng, snapshot.accuracy)
        }
        // A stale system fix is still better than nothing for sorting by distance.
        return system?.let {
            LatLngAcc(it.latitude, it.longitude, if (it.hasAccuracy()) it.accuracy.toDouble() else null)
        }
    }

    private fun systemFix(context: Context): Location? {
        if (!hasPermission(context)) return null
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        val providers = mutableListOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        if (Build.VERSION.SDK_INT >= 31) providers.add(LocationManager.FUSED_PROVIDER)
        var best: Location? = null
        for (provider in providers) {
            try {
                val fix = manager.getLastKnownLocation(provider) ?: continue
                if (best == null || fix.time > best.time) best = fix
            } catch (ignored: SecurityException) {
                // Permission was revoked between the check and the call.
            } catch (ignored: Exception) {
                // Provider not available on this device.
            }
        }
        return best
    }
}
