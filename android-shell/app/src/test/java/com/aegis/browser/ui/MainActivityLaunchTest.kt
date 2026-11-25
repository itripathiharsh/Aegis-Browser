package com.aegis.browser.ui

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.browser.TabManager
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MainActivityLaunchTest {

    @Test
    fun mainActivityLoadsRealBundledFiltersAndPersistsBraveSearchEngine() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val engine = AdBlockEngine()
        engine.loadFromContext(context)
        assertTrue(
            "Bundled filter pack must contain 40,000+ real rules",
            engine.getStats().domainRuleCount >= 40_000
        )

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        assertFalse(activity.isFinishing)

        val bridge = activity.getNativeBridgeForTesting()
        val initialJson = JSONObject(bridge.getInitialState())

        assertEquals("android", initialJson.getString("platform"))
        assertTrue(initialJson.getJSONObject("filterStats").getInt("domainRuleCount") >= 40_000)

        // Switching to Brave must persist and drive Kotlin search resolution too
        bridge.setSearchEngine("brave")
        val updatedState = JSONObject(bridge.getInitialState())
        assertEquals("brave", updatedState.getString("searchEngine"))
        assertEquals(
            "https://search.brave.com/search?q=adblock+test",
            TabManager.resolveUserInput("adblock test", "brave")
        )

        // Real ad networks must be blocked
        val adProbe = JSONObject(
            bridge.testUrlAgainstFilters(
                "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
                "news.example.com"
            )
        )
        assertTrue(adProbe.getBoolean("blocked"))

        val adsterraProbe = JSONObject(
            bridge.testUrlAgainstFilters(
                "https://pl12345.highperformanceformat.com/invoke.js",
                "stream.example.com"
            )
        )
        assertTrue(adsterraProbe.getBoolean("blocked"))

        bridge.createTab("https://example.com")
        bridge.toggleSiteShields("example.com", false)
        bridge.toggleSiteShields("example.com", true)

        controller.pause().resume().stop().destroy()
    }

    @Test
    fun mainActivityLaunchesCleanlyFromExternalHttpViewIntent() {
        val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://search.brave.com"))
        val controller = Robolectric.buildActivity(MainActivity::class.java, viewIntent).setup()
        val activity = controller.get()
        assertFalse(activity.isFinishing)

        val state = JSONObject(activity.getNativeBridgeForTesting().getInitialState())
        assertTrue(state.getJSONArray("tabs").length() >= 2)

        controller.pause().stop().destroy()
    }

    @Test
    fun popupRedirectTabAutoClosesBackToOpenerTab() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val container = android.widget.FrameLayout(context)
        val engine = AdBlockEngine().apply { loadFromContext(context) }
        val telemetry = com.aegis.browser.adblock.ShieldsTelemetry {}
        val manager = TabManager(
            context = context,
            container = container,
            adBlockEngine = engine,
            telemetry = telemetry,
            initialSearchEngine = "brave",
            onTabsUpdated = {},
            onShowFullscreen = { _, _ -> },
            onHideFullscreen = {}
        )
        manager.ensureInitialTab()
        val openerId = manager.getActiveTabId()
        val popup = manager.createTab(
            initialInput = "https://example.org/promo",
            makeActive = true,
            openerTabId = openerId,
            isAutoPopup = true
        )
        assertEquals(2, manager.getTabs().size)
        assertEquals(popup.id, manager.getActiveTabId())

        manager.closePopupAndReturnToOpener(popup.id)
        assertEquals(1, manager.getTabs().size)
        assertEquals(openerId, manager.getActiveTabId())
        manager.destroyAll()
    }
}
