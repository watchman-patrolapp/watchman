package com.watchman.app.car

import android.Manifest
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.car.app.notification.CarAppExtender
import androidx.car.app.notification.CarNotificationManager
import androidx.car.app.notification.CarPendingIntent
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.watchman.app.R
import java.util.Collections

/**
 * Tells the driver about a new SOS nearby with a heads-up car notification, because SOS must not
 * wait for a map refresh. Tapping it opens the SOS alert screen (and resets the template quota).
 * At most once per SOS id per process; skipped quietly without notification permission.
 */
object CarSosNotifier {
    const val CHANNEL_ID = "watchman_car_sos"
    private const val SCHEME = "watchman-car"
    private const val HOST = "sos"

    private val notified: MutableSet<String> = Collections.synchronizedSet(HashSet())

    /** The SOS id in a `watchman-car://sos/<id>` link, or null for any other intent data. */
    fun sosIdFrom(data: Uri?): String? {
        if (data == null || data.scheme != SCHEME || data.host != HOST) return null
        return data.lastPathSegment?.takeIf { it.isNotBlank() }
    }

    fun notifyIfNew(context: Context, sos: SosPin) {
        if (sos.isMine || sos.acknowledged) return
        if (!notified.add(sos.id)) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        try {
            val manager = CarNotificationManager.from(context)
            manager.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
                    .setName(context.getString(R.string.car_sos_notification_channel))
                    .build(),
            )

            val intent = Intent(Intent.ACTION_VIEW)
                .setComponent(ComponentName(context, WatchmanCarAppService::class.java))
                .setData(Uri.parse("$SCHEME://$HOST/${sos.id}"))
            val carIntent = CarPendingIntent.getCarApp(
                context,
                sos.id.hashCode(),
                intent,
                PendingIntent.FLAG_IMMUTABLE,
            )

            val distance = sos.distanceKm?.let { CarLogic.formatKm(it) }
            val text = if (distance != null) "${sos.senderName} · $distance" else sos.senderName

            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_patrol_notification)
                .setContentTitle(context.getString(R.string.car_sos_notification_title))
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .extend(
                    CarAppExtender.Builder()
                        .setImportance(NotificationManagerCompat.IMPORTANCE_HIGH)
                        .setContentIntent(carIntent)
                        .build(),
                )
            manager.notify(sos.id.hashCode(), builder)
        } catch (ignored: Exception) {
            // A failed notification must never take the map down. Allow another try next refresh.
            notified.remove(sos.id)
        }
    }
}
