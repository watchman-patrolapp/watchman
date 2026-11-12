package com.watchman.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.watchman.app.widget.SosHoldActivity;
import com.watchman.app.widget.WidgetLinks;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WatchmanPatrolPlugin.class);
        // Remote WebView debugging follows the debuggable flag. Release builds
        // are not debuggable, so inspection stays off there.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        } else {
            WebView.setWebContentsDebuggingEnabled(false);
        }
        super.onCreate(savedInstanceState);
        // Android 15+ (targetSdk 35) forces edge-to-edge and the WebView reports
        // env(safe-area-inset-*) as 0. Publish the real bar sizes as CSS variables.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (view, windowInsets) -> {
            publishSystemBarInsets(windowInsets);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(decor);
        if (savedInstanceState == null) {
            captureWidgetLink(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        captureWidgetLink(intent);
        super.onNewIntent(intent);
    }

    /**
     * Widget taps arrive as za.co.africuz.watchman://widget/<path>. Keep the route for the WebView to
     * consume once, then strip the data so neither a resume nor Capacitor's launch-URL replay acts on
     * it again. The SOS route opens the native hold screen and never reaches the WebView.
     */
    private void captureWidgetLink(Intent intent) {
        if (intent == null) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        String path = WidgetLinks.parse(getString(R.string.custom_url_scheme), intent.getData());
        if (path == null) return;
        intent.setData(null);
        if ("sos".equals(path)) {
            startActivity(new Intent(this, SosHoldActivity.class));
        } else {
            WidgetLinks.offer(path);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        ViewCompat.requestApplyInsets(getWindow().getDecorView());
    }

    private void publishSystemBarInsets(WindowInsetsCompat windowInsets) {
        Insets status = windowInsets.getInsets(
                WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout()
        );
        Insets navigation = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        final int statusTop = status.top;
        final int navBottom = navigation.bottom;
        final int barLeft = Math.max(status.left, navigation.left);
        final int barRight = Math.max(status.right, navigation.right);
        webView.post(() -> {
            View parent = webView.getParent() instanceof View ? (View) webView.getParent() : webView;
            // Capacitor already pads the WebView for the status bar on older system
            // WebViews. Publishing that inset again pushes the header down twice.
            int cssTopPx = Math.max(0, statusTop - parent.getPaddingTop());
            int cssBottomPx = Math.max(0, navBottom - parent.getPaddingBottom());
            int cssLeftPx = Math.max(0, barLeft - parent.getPaddingLeft());
            int cssRightPx = Math.max(0, barRight - parent.getPaddingRight());
            int hasStatusBar = statusTop > 0 ? 1 : 0;
            String script = "(function(){var r=document.documentElement;if(!r)return;"
                    + "r.style.setProperty('--android-inset-top','" + px(cssTopPx) + "');"
                    + "r.style.setProperty('--android-inset-bottom','" + px(cssBottomPx) + "');"
                    + "r.style.setProperty('--android-inset-left','" + px(cssLeftPx) + "');"
                    + "r.style.setProperty('--android-inset-right','" + px(cssRightPx) + "');"
                    + "r.style.setProperty('--android-has-status-bar','" + hasStatusBar + "');"
                    + "})();";
            webView.evaluateJavascript(script, null);
        });
    }

    private String px(int pixels) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        return Math.round(pixels / density) + "px";
    }
}
