package com.watchman.app.widget

import android.Manifest
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.watchman.app.R
import com.watchman.app.car.CarEvents
import com.watchman.app.car.CarResult
import com.watchman.app.car.CarSessionStore
import com.watchman.app.car.FailKind
import com.watchman.app.car.SupabaseCarClient
import java.util.concurrent.Executors
import kotlin.math.ceil
import org.json.JSONObject

/**
 * Full-screen SOS. Opening it never sends anything. The user must hold the button for the full
 * 10 seconds; releasing, back, home or the screen turning off cancels. Only a completed hold calls
 * widget_send_resident_sos. Every failure shows short friendly copy plus a SAPS 10111 call button;
 * raw errors are never shown.
 */
class SosHoldActivity : AppCompatActivity(), HoldRingView.Listener {

    private enum class Phase { IDLE, HOLDING, SENDING, DONE }

    private lateinit var ring: HoldRingView
    private lateinit var status: TextView
    private lateinit var tryAgain: Button
    private lateinit var openApp: Button
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var phase = Phase.IDLE
    private var animator: ValueAnimator? = null
    private var cancelledByUser = false
    private var lastSecond = -1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        setContentView(buildUi())

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Back cancels a hold. It never sends, and it is ignored while a send is running.
                if (phase == Phase.SENDING) return
                cancelHold(announce = false)
                finish()
            }
        })

        if (CarSessionStore.read(this) == null) {
            ring.visibility = View.GONE
            status.text = getString(R.string.sos_signed_out)
            openApp.visibility = View.VISIBLE
        }
    }

    override fun onPause() {
        // Home, recents or screen off cancel an in-progress hold.
        cancelHold(announce = false)
        super.onPause()
    }

    override fun onDestroy() {
        animator?.cancel()
        handler.removeCallbacksAndMessages(null)
        executor.shutdown()
        super.onDestroy()
    }

    // --- hold ------------------------------------------------------------------------------

    override fun onPress() {
        if (phase != Phase.IDLE) return
        phase = Phase.HOLDING
        cancelledByUser = false
        lastSecond = -1
        tryAgain.visibility = View.GONE
        ring.tone = HoldRingView.Tone.HOLDING
        ring.subLabel = ""
        status.text = getString(R.string.sos_holding)
        ring.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        ring.announceForAccessibility(getString(R.string.sos_countdown_cd_format, HOLD_SECONDS))

        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = HOLD_MS
            interpolator = LinearInterpolator()
            addUpdateListener {
                val fraction = it.animatedFraction
                ring.progress = fraction
                val left = ceil(HOLD_SECONDS * (1f - fraction)).toInt().coerceIn(1, HOLD_SECONDS)
                if (left != lastSecond) {
                    lastSecond = left
                    ring.label = left.toString()
                    ring.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    if (left == HOLD_SECONDS / 2) {
                        ring.announceForAccessibility(getString(R.string.sos_countdown_cd_format, left))
                    }
                }
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    if (!cancelledByUser && phase == Phase.HOLDING) completeHold()
                }
            })
            start()
        }
    }

    override fun onRelease() {
        if (phase == Phase.HOLDING) cancelHold(announce = true)
    }

    private fun cancelHold(announce: Boolean) {
        if (phase != Phase.HOLDING) return
        cancelledByUser = true
        animator?.cancel()
        animator = null
        phase = Phase.IDLE
        resetRing()
        status.text = getString(R.string.sos_cancelled)
        if (announce) ring.announceForAccessibility(getString(R.string.sos_cancelled))
    }

    private fun resetRing() {
        ring.progress = 0f
        ring.label = "SOS"
        ring.subLabel = "HOLD"
        ring.tone = HoldRingView.Tone.IDLE
    }

    // --- send ------------------------------------------------------------------------------

    private fun completeHold() {
        phase = Phase.SENDING
        buzzDone()
        ring.progress = 1f
        ring.label = "…"
        ring.subLabel = ""
        ring.tone = HoldRingView.Tone.BUSY
        status.text = getString(R.string.sos_sending)
        val app = applicationContext
        executor.execute {
            val outcome = send(app)
            handler.post { showOutcome(outcome) }
        }
    }

    private enum class Outcome { SENT, OFFLINE, SIGNED_OUT, FAILED }

    private fun send(context: Context): Outcome {
        val fix = lastKnownLocation(context)
        val body = JSONObject()
            .put("p_lat", fix?.latitude ?: JSONObject.NULL)
            .put("p_lng", fix?.longitude ?: JSONObject.NULL)
            .put("p_accuracy", if (fix != null && fix.hasAccuracy()) fix.accuracy.toDouble() else JSONObject.NULL)
        return try {
            when (val result = SupabaseCarClient(context).rpc("widget_send_resident_sos", body)) {
                is CarResult.Ok -> when (result.value.optString("status")) {
                    "sent", "already_sent" -> Outcome.SENT
                    "signed_out" -> Outcome.SIGNED_OUT
                    else -> Outcome.FAILED
                }
                is CarResult.Fail -> when (result.kind) {
                    FailKind.OFFLINE -> Outcome.OFFLINE
                    FailKind.SIGNED_OUT -> Outcome.SIGNED_OUT
                    else -> Outcome.FAILED
                }
            }
        } catch (ignored: Exception) {
            Outcome.FAILED
        }
    }

    private fun showOutcome(outcome: Outcome) {
        when (outcome) {
            Outcome.SENT -> {
                phase = Phase.DONE
                ring.progress = 1f
                ring.label = "✓"
                ring.subLabel = ""
                ring.tone = HoldRingView.Tone.DONE
                status.text = getString(R.string.sos_sent) + "\n" + getString(R.string.sos_sent_detail)
                ring.announceForAccessibility(getString(R.string.sos_sent))
                CarEvents.emit(CarEvents.SOS_SENT)
                WidgetUpdater.refreshAsync(applicationContext)
                handler.postDelayed({ finish() }, 2_500L)
            }
            Outcome.OFFLINE -> fail(R.string.sos_offline)
            Outcome.SIGNED_OUT -> {
                fail(R.string.sos_signed_out)
                openApp.visibility = View.VISIBLE
            }
            Outcome.FAILED -> fail(R.string.sos_failed)
        }
    }

    private fun fail(message: Int) {
        phase = Phase.IDLE
        resetRing()
        status.text = getString(message)
        ring.announceForAccessibility(getString(message))
        tryAgain.visibility = View.VISIBLE
    }

    private fun lastKnownLocation(context: Context): Location? {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return null
        return try {
            val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            manager.getProviders(true)
                .mapNotNull { provider ->
                    try {
                        manager.getLastKnownLocation(provider)
                    } catch (ignored: SecurityException) {
                        null
                    }
                }
                .maxByOrNull { it.time }
        } catch (ignored: Exception) {
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun buzzDone() {
        ring.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS,
        )
        try {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 120, 80, 220), -1))
            } else {
                vibrator.vibrate(longArrayOf(0, 120, 80, 220), -1)
            }
        } catch (ignored: Exception) {
            // Haptics are a bonus.
        }
    }

    // --- UI --------------------------------------------------------------------------------

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(0xFF0B1220.toInt())
            setPadding(dp(24), dp(48), dp(24), dp(32))
        }
        root.addView(
            TextView(this).apply {
                text = getString(R.string.sos_title)
                setTextColor(0xFFF1F5F9.toInt())
                textSize = 24f
                gravity = Gravity.CENTER
                isFocusable = true
                accessibilityHeading(this)
            },
        )
        status = TextView(this).apply {
            text = getString(R.string.sos_prompt)
            setTextColor(0xFFCBD5E1.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(12)
        })

        ring = HoldRingView(this).apply {
            listener = this@SosHoldActivity
            subLabel = "HOLD"
            contentDescription = getString(R.string.sos_button_cd)
        }
        root.addView(ring, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, 0, 1f).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(16)
            bottomMargin = dp(16)
        })

        tryAgain = actionButton(getString(R.string.sos_try_again), 0xFF334155.toInt()) {
            tryAgain.visibility = View.GONE
            status.text = getString(R.string.sos_prompt)
        }.also { it.visibility = View.GONE }
        root.addView(tryAgain, buttonParams())

        openApp = actionButton(getString(R.string.sos_open_app), 0xFF0F766E.toInt()) {
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("${getString(R.string.custom_url_scheme)}://widget/sign-in"))
                    .setClass(this, com.watchman.app.MainActivity::class.java),
            )
            finish()
        }.also { it.visibility = View.GONE }
        root.addView(openApp, buttonParams())

        root.addView(
            actionButton(getString(R.string.sos_call), 0xFFB91C1C.toInt()) {
                startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:10111")))
            },
            buttonParams(),
        )
        root.addView(
            actionButton(getString(R.string.sos_close), 0xFF1E293B.toInt()) {
                cancelHold(announce = false)
                if (phase != Phase.SENDING) finish()
            },
            buttonParams(),
        )
        resetRing()
        return root
    }

    private fun accessibilityHeading(view: View) {
        androidx.core.view.ViewCompat.setAccessibilityHeading(view, true)
    }

    private fun buttonParams() =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(8) }

    private fun actionButton(text: String, color: Int, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            setTextColor(0xFFFFFFFF.toInt())
            isAllCaps = false
            textSize = 16f
            setBackgroundColor(color)
            setOnClickListener { onClick() }
        }

    private companion object {
        const val HOLD_SECONDS = 10
        const val HOLD_MS = HOLD_SECONDS * 1000L
    }
}
