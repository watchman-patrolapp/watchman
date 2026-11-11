# Release minify (R8). Capacitor's android library also ships these plugin
# rules as consumer ProGuard files; they are repeated here so a release build
# still keeps the bridge if that wiring changes.

# Capacitor v3+ plugins are discovered by annotation.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}

-keep public class * extends com.getcapacitor.Plugin { *; }

# Capacitor v2 annotations. Deprecated, still referenced by older plugins.
-keep @com.getcapacitor.NativePlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}

# Cordova plugins copied in by cap sync.
-keep public class * extends org.apache.cordova.** {
    public <methods>;
    public <fields>;
}

# WebView Javascript interface used by the Capacitor bridge.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# Firebase Cloud Messaging is a dependency of @capacitor/push-notifications.
# The AAR ships its own consumer rules; these keep the service entry points.
-keep class com.google.firebase.messaging.** { *; }
-keep class com.google.firebase.iid.** { *; }
-keep class com.capacitorjs.plugins.pushnotifications.** { *; }
-dontwarn com.google.firebase.**

# Patrol background location (@capacitor-community/background-geolocation) and the
# in-app permission helper. The service is also named in the manifest.
-keep class com.equimaps.capacitor_background_geolocation.** { *; }
-keep class com.watchman.app.WatchmanPatrolPlugin { *; }
-dontwarn com.google.android.gms.**

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Android Auto car screens are created by the host through reflection-style lookups; keep them intact.
-keep class com.watchman.app.car.** { *; }
