package com.watchman.app.car

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator
import com.watchman.app.car.screens.PatrolMapScreen
import com.watchman.app.car.screens.SosAlertScreen

class WatchmanCarAppService : CarAppService() {

    override fun createHostValidator(): HostValidator {
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        return if (debuggable) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }
    }

    override fun onCreateSession(): Session = WatchmanCarSession()
}

class WatchmanCarSession : Session() {

    override fun onCreateScreen(intent: Intent): Screen {
        // Cold start from the "SOS nearby" notification: the screen returned here ends up on top,
        // so push the map first and return the alert.
        val sosId = CarSosNotifier.sosIdFrom(intent.data)
        if (sosId != null) {
            carContext.getCarService(ScreenManager::class.java).push(PatrolMapScreen(carContext))
            return SosAlertScreen(carContext, sosId, null)
        }
        return PatrolMapScreen(carContext)
    }

    override fun onNewIntent(intent: Intent) {
        val sosId = CarSosNotifier.sosIdFrom(intent.data) ?: return
        val screenManager = carContext.getCarService(ScreenManager::class.java)
        val top = screenManager.top
        if (top is SosAlertScreen && top.sosId == sosId) return
        screenManager.push(SosAlertScreen(carContext, sosId, null))
    }
}
