# Preserve app structure & names cleanly instead of malware-like name scrambling
-dontobfuscate
-keepattributes SourceFile,LineNumberTable

-keep class com.nivrok.browser.** { *; }
-keepclassmembers class com.nivrok.browser.bridge.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
