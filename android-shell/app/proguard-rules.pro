# Preserve app structure & names cleanly instead of malware-like name scrambling
-dontobfuscate
-keepattributes SourceFile,LineNumberTable

-keep class com.aegis.browser.** { *; }
-keepclassmembers class com.aegis.browser.bridge.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
