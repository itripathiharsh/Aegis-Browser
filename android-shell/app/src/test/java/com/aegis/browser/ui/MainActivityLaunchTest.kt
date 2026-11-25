package com.aegis.browser.ui

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.aegis.browser.adblock.AdBlockEngine
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
    fun mainActivityLaunchesAndExposesInitialBridgeState() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val engine = AdBlockEngine()
        engine.loadFromContext(context)
        assertTrue(engine.getStats().domainRuleCount > 0)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        assertFalse(activity.isFinishing)

        val bridge = activity.getNativeBridgeForTesting()
        val initialJson = JSONObject(bridge.getInitialState())

        assertEquals("android", initialJson.getString("platform"))
        assertTrue(initialJson.getJSONArray("tabs").length() >= 1)
        val firstTab = initialJson.getJSONArray("tabs").getJSONObject(0)
        assertEquals("aegis://home", firstTab.getString("url"))

        val stats = initialJson.getJSONObject("filterStats")
        assertTrue(stats.getInt("domainRuleCount") > 0)

        val appUpdate = initialJson.getJSONObject("appUpdate")
        assertEquals("itripathiharsh/Aegis-Browser", appUpdate.getString("githubRepo"))

        // Exercise ad filter probe and tab navigation cleanly on main looper
        val probe = JSONObject(
            bridge.testUrlAgainstFilters(
                "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
                "news.example.com"
            )
        )
        assertTrue(probe.getBoolean("blocked"))

        bridge.createTab("https://example.com")
        bridge.toggleSiteShields("example.com", false)
        bridge.toggleSiteShields("example.com", true)

        controller.pause().resume().stop().destroy()
    }

    @Test
    fun mainActivityLaunchesCleanlyFromExternalHttpViewIntent() {
        val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://duckduckgo.com"))
        val controller = Robolectric.buildActivity(MainActivity::class.java, viewIntent).setup()
        val activity = controller.get()
        assertFalse(activity.isFinishing)

        val state = JSONObject(activity.getNativeBridgeForTesting().getInitialState())
        assertTrue(state.getJSONArray("tabs").length() >= 2)

        controller.pause().stop().destroy()
    }
}
