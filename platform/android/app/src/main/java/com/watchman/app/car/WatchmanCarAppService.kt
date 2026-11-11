package com.watchman.app.car

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator

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
    override fun onCreateScreen(intent: Intent): Screen = WatchmanCarStubScreen(carContext)
}

class WatchmanCarStubScreen(carContext: CarContext) : Screen(carContext) {

    override fun onGetTemplate(): Template =
        MessageTemplate.Builder(
            "Watchman is connected. The live patrol map is coming soon; use the phone app for now."
        )
            .setTitle("Watchman")
            .setHeaderAction(Action.APP_ICON)
            .build()
}
