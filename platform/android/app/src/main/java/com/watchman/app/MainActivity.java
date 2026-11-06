package com.watchman.app;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

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
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        int top = Math.round(status.top / density);
        int bottom = Math.round(navigation.bottom / density);
        int left = Math.round(Math.max(status.left, navigation.left) / density);
        int right = Math.round(Math.max(status.right, navigation.right) / density);
        String script = "(function(){var r=document.documentElement;if(!r)return;"
                + "r.style.setProperty('--android-inset-top','" + top + "px');"
                + "r.style.setProperty('--android-inset-bottom','" + bottom + "px');"
                + "r.style.setProperty('--android-inset-left','" + left + "px');"
                + "r.style.setProperty('--android-inset-right','" + right + "px');"
                + "})();";
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
