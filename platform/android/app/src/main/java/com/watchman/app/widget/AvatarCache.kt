package com.watchman.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Small circular avatar bitmaps on disk. Runs on the refresh worker only. Short timeouts, https
 * only, no auth headers, never throws. A failed download leaves the placeholder.
 */
object AvatarCache {
    const val MAX_AVATARS = 3
    private const val SIZE_PX = 96
    private const val MAX_BYTES = 256 * 1024
    private const val TIMEOUT_MS = 4_000
    private const val MAX_AGE_MS = 6L * 60 * 60 * 1000

    /** Returns one file name per id (up to [MAX_AVATARS]); "" means use the placeholder. */
    fun sync(context: Context, userIds: List<String>, urlByUser: Map<String, String>): List<String> {
        val dir = File((context.applicationContext ?: context).filesDir, WidgetStateStore.AVATAR_DIR)
        dir.mkdirs()
        val names = ArrayList<String>()
        for (id in userIds.take(MAX_AVATARS)) {
            val url = urlByUser[id]?.trim().orEmpty()
            if (url.isEmpty() || !url.startsWith("https://")) {
                names.add("")
                continue
            }
            val name = fileName(id)
            val file = File(dir, name)
            val fresh = file.isFile && System.currentTimeMillis() - file.lastModified() < MAX_AGE_MS
            if (!fresh) download(url, file)
            names.add(if (file.isFile) name else "")
        }
        dir.listFiles()?.forEach { if (it.name !in names) it.delete() }
        return names
    }

    fun load(context: Context, name: String): Bitmap? {
        if (name.isEmpty()) return null
        return try {
            val file = File(File((context.applicationContext ?: context).filesDir, WidgetStateStore.AVATAR_DIR), name)
            if (file.isFile) BitmapFactory.decodeFile(file.path) else null
        } catch (ignored: Exception) {
            null
        }
    }

    private fun fileName(userId: String): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(userId.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }.take(24) + ".png"
    }

    private fun download(url: String, target: File) {
        try {
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.instanceFollowRedirects = false
                if (connection.responseCode !in 200..299) return
                val bytes = connection.inputStream.use { input ->
                    val out = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(4096)
                    var total = 0
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_BYTES) return
                        out.write(buffer, 0, read)
                    }
                    out.toByteArray()
                }
                val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
                val circle = circular(decoded)
                target.outputStream().use { circle.compress(Bitmap.CompressFormat.PNG, 100, it) }
            } finally {
                connection.disconnect()
            }
        } catch (ignored: Exception) {
            // Placeholder instead.
        }
    }

    private fun circular(source: Bitmap): Bitmap {
        val side = minOf(source.width, source.height)
        val left = (source.width - side) / 2
        val top = (source.height - side) / 2
        val out = Bitmap.createBitmap(SIZE_PX, SIZE_PX, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawCircle(SIZE_PX / 2f, SIZE_PX / 2f, SIZE_PX / 2f, paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        canvas.drawBitmap(source, Rect(left, top, left + side, top + side), Rect(0, 0, SIZE_PX, SIZE_PX), paint)
        return out
    }
}
