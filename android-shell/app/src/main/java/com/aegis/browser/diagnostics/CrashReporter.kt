package com.aegis.browser.diagnostics

import android.content.Context
import android.os.Build
import com.aegis.browser.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean

data class NonFatalDiagnosticEvent(
    val source: String,
    val message: String,
    val timestampIso: String
)

data class DiagnosticsSummary(
    val hasUnacknowledgedCrash: Boolean,
    val lastCrashSummary: String?,
    val lastCrashIso: String?,
    val lastCrashVersion: String?,
    val updatedFromVersion: String?,
    val nonFatalCount: Int,
    val recentErrors: List<NonFatalDiagnosticEvent>,
    val reportText: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("hasUnacknowledgedCrash", hasUnacknowledgedCrash)
        put("lastCrashSummary", lastCrashSummary ?: JSONObject.NULL)
        put("lastCrashIso", lastCrashIso ?: JSONObject.NULL)
        put("lastCrashVersion", lastCrashVersion ?: JSONObject.NULL)
        put("updatedFromVersion", updatedFromVersion ?: JSONObject.NULL)
        put("nonFatalCount", nonFatalCount)
        put(
            "recentErrors",
            JSONArray().apply {
                recentErrors.forEach { ev ->
                    put(
                        JSONObject().apply {
                            put("source", ev.source)
                            put("message", ev.message)
                            put("timestampIso", ev.timestampIso)
                        }
                    )
                }
            }
        )
        put("reportText", reportText)
    }
}

/**
 * Lightweight, privacy-safe crash & non-fatal failure log kept strictly local until the user
 * chooses to copy, email, or attach it to a GitHub issue. Never logs URLs, history, or cookies.
 */
object CrashReporter {
    private const val PREFS_NAME = "aegis_diagnostics"
    private const val KEY_CRASH_ALERT = "has_unack_crash"
    private const val KEY_CRASH_SUMMARY = "last_crash_summary"
    private const val KEY_CRASH_TRACE = "last_crash_trace"
    private const val KEY_CRASH_ISO = "last_crash_iso"
    private const val KEY_CRASH_VERSION = "last_crash_version"
    private const val KEY_CRASH_DEVICE = "last_crash_device"
    private const val KEY_NON_FATAL = "non_fatal_events"
    private const val KEY_LAST_VERSION_CODE = "last_version_code"
    private const val KEY_LAST_VERSION_NAME = "last_version_name"
    private const val MAX_TRACE_CHARS = 3_200
    private const val MAX_NON_FATAL = 8

    private val installed = AtomicBoolean(false)
    private val lock = Any()
    @Volatile
    private var previousHandler: Thread.UncaughtExceptionHandler? = null
    @Volatile
    private var updatedFromVersionSession: String? = null

    fun install(context: Context) {
        if (!installed.compareAndSet(false, true)) return
        val appContext = context.applicationContext
        val existing = Thread.getDefaultUncaughtExceptionHandler()
        previousHandler = existing

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                persistUncaughtCrash(appContext, thread.name, throwable)
            }
            existing?.uncaughtException(thread, throwable)
        }
    }

    /**
     * Records the running version code/name and detects in-place upgrades so Aegis can greet the
     * user cleanly right after installing a new APK release.
     */
    fun checkAndRecordVersionBoot(context: Context): String? {
        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val prevCode = prefs.getInt(KEY_LAST_VERSION_CODE, 0)
            val prevName = prefs.getString(KEY_LAST_VERSION_NAME, null)
            val upgradedFrom = if (prevCode in 1 until BuildConfig.VERSION_CODE && !prevName.isNullOrBlank()) {
                prevName
            } else {
                null
            }
            if (prevCode != BuildConfig.VERSION_CODE || prevName != BuildConfig.VERSION_NAME) {
                prefs.edit()
                    .putInt(KEY_LAST_VERSION_CODE, BuildConfig.VERSION_CODE)
                    .putString(KEY_LAST_VERSION_NAME, BuildConfig.VERSION_NAME)
                    .apply()
            }
            if (upgradedFrom != null) {
                updatedFromVersionSession = upgradedFrom
            }
            return upgradedFrom
        }
    }

    fun getUpdatedFromVersion(): String? = updatedFromVersionSession

    fun clearUpdatedFromVersion() {
        updatedFromVersionSession = null
    }

    fun persistUncaughtCrash(context: Context, threadName: String, throwable: Throwable) {
        val summary = "${throwable.javaClass.simpleName}: ${throwable.message ?: "No details"}".take(220)
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        val rawTrace = "Thread: $threadName\n${sw.toString()}".take(MAX_TRACE_CHARS)
        val device = "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE}, API ${Build.VERSION.SDK_INT})"

        synchronized(lock) {
            context.applicationContext
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_CRASH_ALERT, true)
                .putString(KEY_CRASH_SUMMARY, summary)
                .putString(KEY_CRASH_TRACE, rawTrace)
                .putString(KEY_CRASH_ISO, currentIsoUtc())
                .putString(KEY_CRASH_VERSION, "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                .putString(KEY_CRASH_DEVICE, device)
                .commit()
        }
    }

    fun recordNonFatal(
        context: Context,
        source: String,
        message: String,
        throwable: Throwable? = null
    ) {
        val cleanSource = source.trim().take(48).ifEmpty { "Native" }
        val extra = throwable?.let { " (${it.javaClass.simpleName}: ${it.message ?: ""})" }.orEmpty()
        val sanitizedMessage = sanitizeNoUrls("$message$extra").take(260)
        val nowIso = currentIsoUtc()

        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val arr = runCatching {
                JSONArray(prefs.getString(KEY_NON_FATAL, "[]") ?: "[]")
            }.getOrElse { JSONArray() }

            val next = JSONArray()
            next.put(
                JSONObject().apply {
                    put("source", cleanSource)
                    put("message", sanitizedMessage)
                    put("timestampIso", nowIso)
                }
            )
            val limit = minOf(arr.length(), MAX_NON_FATAL - 1)
            for (i in 0 until limit) {
                next.put(arr.get(i))
            }
            prefs.edit().putString(KEY_NON_FATAL, next.toString()).apply()
        }
    }

    fun dismissCrashAlert(context: Context) {
        synchronized(lock) {
            context.applicationContext
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_CRASH_ALERT, false)
                .apply()
        }
    }

    fun clearDiagnostics(context: Context) {
        synchronized(lock) {
            context.applicationContext
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_CRASH_ALERT, false)
                .remove(KEY_CRASH_SUMMARY)
                .remove(KEY_CRASH_TRACE)
                .remove(KEY_CRASH_ISO)
                .remove(KEY_CRASH_VERSION)
                .remove(KEY_CRASH_DEVICE)
                .remove(KEY_NON_FATAL)
                .apply()
        }
    }

    fun getSummary(context: Context): DiagnosticsSummary {
        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val hasCrash = prefs.getBoolean(KEY_CRASH_ALERT, false)
            val crashSummary = prefs.getString(KEY_CRASH_SUMMARY, null)
            val crashTrace = prefs.getString(KEY_CRASH_TRACE, null)
            val crashIso = prefs.getString(KEY_CRASH_ISO, null)
            val crashVer = prefs.getString(KEY_CRASH_VERSION, null)
            val crashDevice = prefs.getString(KEY_CRASH_DEVICE, null)

            val events = mutableListOf<NonFatalDiagnosticEvent>()
            runCatching {
                val arr = JSONArray(prefs.getString(KEY_NON_FATAL, "[]") ?: "[]")
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    events.add(
                        NonFatalDiagnosticEvent(
                            source = o.optString("source"),
                            message = o.optString("message"),
                            timestampIso = o.optString("timestampIso")
                        )
                    )
                }
            }

            val report = buildReportString(
                crashSummary = crashSummary,
                crashIso = crashIso,
                crashVer = crashVer,
                crashDevice = crashDevice,
                crashTrace = crashTrace,
                events = events
            )

            return DiagnosticsSummary(
                hasUnacknowledgedCrash = hasCrash,
                lastCrashSummary = crashSummary,
                lastCrashIso = crashIso,
                lastCrashVersion = crashVer,
                updatedFromVersion = updatedFromVersionSession,
                nonFatalCount = events.size,
                recentErrors = events,
                reportText = report
            )
        }
    }

    private fun buildReportString(
        crashSummary: String?,
        crashIso: String?,
        crashVer: String?,
        crashDevice: String?,
        crashTrace: String?,
        events: List<NonFatalDiagnosticEvent>
    ): String {
        val sb = StringBuilder()
        sb.appendLine("Aegis Browser Diagnostics Report")
        sb.appendLine("App: v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        sb.appendLine("Android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        sb.appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL}")
        sb.appendLine("Generated: ${currentIsoUtc()}")
        sb.appendLine()
        if (!crashSummary.isNullOrBlank()) {
            sb.appendLine("--- Last Uncaught Crash ---")
            sb.appendLine("When: ${crashIso ?: "unknown"}")
            if (!crashVer.isNullOrBlank()) sb.appendLine("Crash App Version: $crashVer")
            if (!crashDevice.isNullOrBlank()) sb.appendLine("Crash Device: $crashDevice")
            sb.appendLine("Summary: $crashSummary")
            if (!crashTrace.isNullOrBlank()) {
                sb.appendLine(crashTrace.take(1800))
            }
            sb.appendLine()
        } else {
            sb.appendLine("Crash Status: No uncaught crashes recorded.")
            sb.appendLine()
        }

        if (events.isNotEmpty()) {
            sb.appendLine("--- Recent Non-Fatal Events (${events.size}) ---")
            events.forEach { ev ->
                sb.appendLine("[${ev.timestampIso}] ${ev.source}: ${ev.message}")
            }
        } else {
            sb.appendLine("Non-Fatal Events: None recorded.")
        }
        return sb.toString().trim()
    }

    private fun sanitizeNoUrls(raw: String): String =
        raw.replace(Regex("https?://[^\\s)]+"), "<redacted-url>")
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun currentIsoUtc(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}
