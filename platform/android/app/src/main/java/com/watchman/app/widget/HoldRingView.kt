package com.watchman.app.widget

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View

/**
 * Big round SOS button with a ring that fills while it is held. It only reports press and
 * release; the Activity owns the 10 second timer and decides whether anything is sent.
 */
class HoldRingView(context: Context) : View(context) {

    interface Listener {
        fun onPress()
        fun onRelease()
    }

    enum class Tone { IDLE, HOLDING, BUSY, DONE }

    var listener: Listener? = null

    var progress: Float = 0f
        set(value) {
            field = value.coerceIn(0f, 1f)
            invalidate()
        }

    var label: String = "SOS"
        set(value) {
            field = value
            invalidate()
        }

    var subLabel: String = ""
        set(value) {
            field = value
            invalidate()
        }

    var tone: Tone = Tone.IDLE
        set(value) {
            field = value
            invalidate()
        }

    private val density = resources.displayMetrics.density
    private val stroke = 12f * density
    private val oval = RectF()

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = stroke
        color = 0x33FFFFFF
    }
    private val arcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = stroke
        strokeCap = Paint.Cap.ROUND
        color = 0xFFFCA5A5.toInt()
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textAlign = Paint.Align.CENTER
        isFakeBoldText = true
    }
    private val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFE4E6.toInt()
        textAlign = Paint.Align.CENTER
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = (280f * density).toInt()
        setMeasuredDimension(resolveSize(size, widthMeasureSpec), resolveSize(size, heightMeasureSpec))
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val radius = minOf(width, height) / 2f - stroke
        oval.set(cx - radius, cy - radius, cx + radius, cy + radius)
        canvas.drawOval(oval, trackPaint)
        if (progress > 0f) canvas.drawArc(oval, -90f, 360f * progress, false, arcPaint)

        fillPaint.color = when (tone) {
            Tone.IDLE -> 0xFFDC2626.toInt()
            Tone.HOLDING -> 0xFFEF4444.toInt()
            Tone.BUSY -> 0xFF7F1D1D.toInt()
            Tone.DONE -> 0xFF16A34A.toInt()
        }
        canvas.drawCircle(cx, cy, radius - stroke * 1.4f, fillPaint)

        val numeric = label.isNotEmpty() && label[0].isDigit()
        textPaint.textSize = (if (numeric) 84f else 52f) * density
        val textY = cy - (textPaint.ascent() + textPaint.descent()) / 2f - (if (subLabel.isEmpty()) 0f else 10f * density)
        canvas.drawText(label, cx, textY, textPaint)
        if (subLabel.isNotEmpty()) {
            subPaint.textSize = 16f * density
            canvas.drawText(subLabel, cx, textY + 28f * density, subPaint)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                listener?.onPress()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                listener?.onRelease()
                if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
            }
        }
        return true
    }

    // A bare tap must do nothing; this only keeps accessibility services happy.
    override fun performClick(): Boolean = super.performClick()
}
