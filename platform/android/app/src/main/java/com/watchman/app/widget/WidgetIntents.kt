package com.watchman.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.watchman.app.MainActivity
import com.watchman.app.R

/** PendingIntents for the widgets. Taps only; nothing here sends or starts anything by itself. */
object WidgetIntents {

    /** Opens the app at za.co.africuz.watchman://widget/<path>. The WebView acts on it once ready. */
    fun link(context: Context, path: String, requestCode: Int): PendingIntent {
        val scheme = context.getString(R.string.custom_url_scheme)
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://widget/$path"))
            .setClass(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Opens the full-screen hold screen. A tap only opens it; the 10 second hold sends. */
    fun sosHold(context: Context, requestCode: Int): PendingIntent {
        val intent = Intent(context, SosHoldActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
