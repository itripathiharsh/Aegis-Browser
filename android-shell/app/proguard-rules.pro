# Preserve code structure rather than aggressive name scrambling so Play Protect / static scanners don't treat shrunk DEX as obfuscated malware.
-dontobfuscate
-keepattributes SourceFile,LineNumberTable

-keepclassmembers class com.aegis.browser.bridge.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.aegis.browser.adblock.** { *; }
-keep class com.aegis.browser.updater.** { *; }
