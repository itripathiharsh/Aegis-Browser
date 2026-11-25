package com.nivrok.browser.diagnostics

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.nivrok.browser.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CrashReporterTest {

    private lateinit var context: Context

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        CrashReporter.clearDiagnostics(context)
        context.getSharedPreferences("nivrok_diagnostics", Context.MODE_PRIVATE)
            .edit()
            .remove("last_version_code")
            .remove("last_version_name")
            .commit()
    }

    @Test
    fun persistsCrashTraceSanitizesNonFatalUrlsAndClearsCleanly() {
        CrashReporter.persistUncaughtCrash(
            context,
            "main",
            IllegalStateException("Synthetic crash for test")
        )
        CrashReporter.recordNonFatal(
            context,
            "AppUpdater",
            "Failed fetching https://example.com/secret?token=123"
        )

        val summary = CrashReporter.getSummary(context)
        assertTrue(summary.hasUnacknowledgedCrash)
        assertTrue(summary.lastCrashSummary?.contains("IllegalStateException") == true)
        assertEquals(1, summary.nonFatalCount)
        assertTrue(summary.recentErrors[0].message.contains("<redacted-url>"))
        assertFalse(summary.recentErrors[0].message.contains("token=123"))

        CrashReporter.dismissCrashAlert(context)
        assertFalse(CrashReporter.getSummary(context).hasUnacknowledgedCrash)

        CrashReporter.clearDiagnostics(context)
        val cleared = CrashReporter.getSummary(context)
        assertNull(cleared.lastCrashSummary)
        assertEquals(0, cleared.nonFatalCount)
    }

    @Test
    fun detectsAppVersionUpgradeAcrossLaunches() {
        val prefs = context.getSharedPreferences("nivrok_diagnostics", Context.MODE_PRIVATE)
        prefs.edit()
            .putInt("last_version_code", BuildConfig.VERSION_CODE - 1)
            .putString("last_version_name", "1.0.7")
            .commit()

        val prev = CrashReporter.checkAndRecordVersionBoot(context)
        assertEquals("1.0.7", prev)
        assertEquals("1.0.7", CrashReporter.getUpdatedFromVersion())

        CrashReporter.clearUpdatedFromVersion()
        assertNull(CrashReporter.getUpdatedFromVersion())
    }
}
