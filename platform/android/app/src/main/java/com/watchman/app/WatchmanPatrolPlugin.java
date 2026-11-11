package com.watchman.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.watchman.app.car.CarSession;
import com.watchman.app.car.CarSessionStore;

/**
 * Runtime location, notification, and battery-exemption prompts for a signed-on patrol.
 * Reject messages are codes only. The web layer never shows them to a patroller.
 */
@CapacitorPlugin(
        name = "WatchmanPatrol",
        permissions = {
                @Permission(
                        alias = "foreground",
                        strings = {
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        }
                ),
                @Permission(
                        alias = "background",
                        strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
                ),
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS }
                )
        }
)
public class WatchmanPatrolPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestForeground(PluginCall call) {
        if (foregroundGranted()) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("foreground", call, "permissionCallback");
    }

    @PluginMethod
    public void requestBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || backgroundGranted()) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("background", call, "permissionCallback");
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || notificationGranted()) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("notifications", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (isIgnoringBattery()) {
            call.resolve(statusObject());
            return;
        }
        try {
            Intent request = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            request.setData(Uri.parse("package:" + getContext().getPackageName()));
            startPrompt(request);
            call.resolve(statusObject());
        } catch (Exception ignored) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                startPrompt(fallback);
                call.resolve(statusObject());
            } catch (Exception fallbackFailed) {
                call.reject("Could not open battery settings", "BATTERY_PROMPT_FAILED");
            }
        }
    }

    /**
     * Hands the phone's Supabase session to the Android Auto process. Reject messages are
     * codes only; never put a token in a message or a log line.
     */
    @PluginMethod
    public void syncSession(PluginCall call) {
        String accessToken = trimmedOrEmpty(call.getString("accessToken"));
        String userId = trimmedOrEmpty(call.getString("userId"));
        String supabaseUrl = trimmedOrEmpty(call.getString("supabaseUrl"));
        String anonKey = trimmedOrEmpty(call.getString("anonKey"));
        if (accessToken.isEmpty() || userId.isEmpty() || supabaseUrl.isEmpty() || anonKey.isEmpty()) {
            call.reject("INVALID_SESSION", "INVALID_SESSION");
            return;
        }
        try {
            // org.json coerces Integer / Long / Double, so a JS number always lands here.
            long expiresAt = call.getData().optLong("expiresAt", 0L);
            CarSessionStore.save(
                    getContext(),
                    new CarSession(
                            accessToken,
                            trimmedOrEmpty(call.getString("refreshToken")),
                            expiresAt,
                            userId,
                            supabaseUrl,
                            anonKey,
                            nullIfBlank(call.getString("email")),
                            nullIfBlank(call.getString("userName")),
                            nullIfBlank(call.getString("organizationId"))
                    )
            );
            call.resolve();
        } catch (Exception failed) {
            call.reject("SESSION_STORE_FAILED", "SESSION_STORE_FAILED");
        }
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        try {
            CarSessionStore.clear(getContext());
            call.resolve();
        } catch (Exception failed) {
            call.reject("SESSION_STORE_FAILED", "SESSION_STORE_FAILED");
        }
    }

    private static String trimmedOrEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    private static String nullIfBlank(String value) {
        String trimmed = trimmedOrEmpty(value);
        return trimmed.isEmpty() ? null : trimmed;
    }

    private void startPrompt(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (getActivity() != null) {
            getActivity().startActivity(intent);
            return;
        }
        getContext().startActivity(intent);
    }

    private JSObject statusObject() {
        JSObject status = new JSObject();
        status.put("sdkInt", Build.VERSION.SDK_INT);
        status.put("foreground", foregroundGranted() ? "granted" : "denied");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            status.put("background", "granted");
        } else {
            status.put("background", backgroundGranted() ? "granted" : "denied");
        }
        if (Build.VERSION.SDK_INT < 33) {
            status.put("notifications", "granted");
        } else {
            status.put("notifications", notificationGranted() ? "granted" : "denied");
        }
        status.put("ignoringBatteryOptimizations", isIgnoringBattery());
        return status;
    }

    private boolean foregroundGranted() {
        return has(Manifest.permission.ACCESS_FINE_LOCATION)
                || has(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private boolean backgroundGranted() {
        return has(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean notificationGranted() {
        return has(Manifest.permission.POST_NOTIFICATIONS);
    }

    private boolean has(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private boolean isIgnoringBattery() {
        PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (manager == null) return false;
        return manager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
