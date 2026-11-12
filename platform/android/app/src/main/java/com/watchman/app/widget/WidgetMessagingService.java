package com.watchman.app.widget;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Locale;
import java.util.Map;

/**
 * Replaces the push-notifications plugin's FirebaseMessagingService (same behaviour: the super
 * call hands the message to the plugin and token updates still reach user_push_tokens). After
 * that it asks for a one-shot widget refresh when the push is about SOS, an emergency, a notice,
 * or an incident status change. The refresh runs in WorkManager, so it works without the WebView.
 * Nothing from the payload is logged.
 */
public class WidgetMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        try {
            if (isWidgetRelevant(remoteMessage.getData())) {
                WidgetUpdater.INSTANCE.refreshAsync(getApplicationContext());
            }
        } catch (Exception ignored) {
            // The widget catches up on its next periodic refresh.
        }
    }

    /**
     * Pushes carry data.kind when the sender sets it. The current edge functions identify the
     * message by data.tag (sos_street, emergency_chat), or send incidentId / status.
     */
    static boolean isWidgetRelevant(Map<String, String> data) {
        if (data == null || data.isEmpty()) return false;
        String kind = lower(data.get("kind"));
        if (kind.equals("sos") || kind.equals("emergency") || kind.equals("broadcast")
                || kind.equals("incident_status")) {
            return true;
        }
        String tag = lower(data.get("tag"));
        if (tag.startsWith("sos") || tag.contains("emergency") || tag.contains("broadcast")) {
            return true;
        }
        return data.containsKey("incidentId") || "true".equals(lower(data.get("isCritical")));
    }

    private static String lower(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
