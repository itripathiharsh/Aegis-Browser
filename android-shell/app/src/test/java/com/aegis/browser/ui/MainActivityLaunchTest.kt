package com.aegis.browser.ui

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.browser.BrowserDataStore
import com.aegis.browser.browser.BrowserSettings
import com.aegis.browser.browser.DownloadsRepository
import com.aegis.browser.browser.TabManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.json.JSONArray
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
        assertTrue(activity.awaitInitialFiltersForTesting())

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
        val dataStore = com.aegis.browser.browser.BrowserDataStore(context)
        val downloadsRepo = com.aegis.browser.browser.DownloadsRepository(
            context = context,
            scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate),
            onChanged = {}
        )
        val manager = TabManager(
            context = context,
            container = container,
            adBlockEngine = engine,
            telemetry = telemetry,
            dataStore = dataStore,
            downloadsRepo = downloadsRepo,
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

    @Test
    fun desktopModeRewritesMobileUrlsAndAppliesDesktopUserAgent() {
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            TabManager.rewriteUrlForMode("https://m.youtube.com/watch?v=dQw4w9WgXcQ", desktop = true)
        )
        assertEquals(
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            TabManager.rewriteUrlForMode("https://www.youtube.com/watch?v=dQw4w9WgXcQ", desktop = false)
        )
        assertEquals(
            "https://www.wikipedia.org/wiki/Main_Page",
            TabManager.rewriteUrlForMode("https://mobile.wikipedia.org/wiki/Main_Page", desktop = true)
        )

        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val container = android.widget.FrameLayout(context)
        val engine = AdBlockEngine().apply { loadFromContext(context) }
        val telemetry = com.aegis.browser.adblock.ShieldsTelemetry {}
        val dataStore = BrowserDataStore(context)
        val downloadsRepo = DownloadsRepository(
            context = context,
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
            onChanged = {}
        )
        val manager = TabManager(
            context = context,
            container = container,
            adBlockEngine = engine,
            telemetry = telemetry,
            dataStore = dataStore,
            downloadsRepo = downloadsRepo,
            onTabsUpdated = {},
            onShowFullscreen = { _, _ -> },
            onHideFullscreen = {}
        )
        val tab = manager.createTab("https://m.youtube.com/watch?v=1", makeActive = true)
        manager.setDesktopMode(tab.id, true)
        assertTrue(tab.desktopMode)
        assertEquals("https://www.youtube.com/watch?v=1", tab.url)
        assertEquals(TabManager.DESKTOP_USER_AGENT, tab.webView?.settings?.userAgentString)
        manager.destroyAll()
    }

    @Test
    fun browserDataStoreAndBridgeManageHistoryRecommendationsDownloadsAndSettings() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val dataStore = BrowserDataStore(context)
        dataStore.clearHistoryAndRecommendations()

        // Search engines (including bare Brave homepage) and rotating ad-mirrors must NEVER enter recommendations
        dataStore.recordVisit("https://duckduckgo.com/?q=privacy", "privacy at DuckDuckGo", "duckduckgo.com")
        dataStore.recordVisit("https://search.brave.com/", "Brave Search", "search.brave.com")
        dataStore.recordVisit("https://new16.hdhub4u.cl/redirect", "New16", "new16.hdhub4u.cl")
        dataStore.recordVisit("https://github.com/itripathiharsh/Aegis-Browser", "GitHub - Aegis", "github.com")
        // Rapid repeat call within 15s must not double-count visits
        dataStore.recordVisit("https://github.com/itripathiharsh/Aegis-Browser", "GitHub - Aegis", "github.com")

        assertEquals(4, dataStore.getHistoryJson().length())
        val recs = dataStore.getTopRecommendations()
        assertEquals(1, recs.size)
        assertEquals("github.com", recs[0].host)
        assertEquals(1, recs[0].visits)

        dataStore.dismissRecommendation("github.com")
        assertEquals(0, dataStore.getTopRecommendations().size)

        // Legacy poisoned recommendations in prefs must be scrubbed automatically on init
        val rawPrefs = context.getSharedPreferences("aegis_browser_data", android.content.Context.MODE_PRIVATE)
        rawPrefs.edit().putString(
            "recommendations_v1",
            org.json.JSONArray().apply {
                put(JSONObject().apply {
                    put("url", "https://new16.hdhub4u.cl/")
                    put("title", "New16")
                    put("host", "new16.hdhub4u.cl")
                    put("visits", 6)
                })
                put(JSONObject().apply {
                    put("url", "https://search.brave.com/")
                    put("title", "Brave Search")
                    put("host", "search.brave.com")
                    put("visits", 2)
                })
                put(JSONObject().apply {
                    put("url", "https://hdhub4u.kz/")
                    put("title", "HDHub4u")
                    put("host", "hdhub4u.kz")
                    put("visits", 2)
                })
            }.toString()
        ).commit()
        val scrubbedStore = BrowserDataStore(context)
        val cleanedRecs = scrubbedStore.getTopRecommendations()
        assertEquals(1, cleanedRecs.size)
        assertEquals("hdhub4u.kz", cleanedRecs[0].host)

        // Stream player interception is removed; MP4 links stay direct
        assertEquals(
            "https://example.com/video.mp4",
            TabManager.resolveUserInput("https://example.com/video.mp4", "brave")
        )

        dataStore.updateSettings(
            BrowserSettings(
                searchEngine = "google",
                theme = "light",
                blockThirdPartyCookies = true,
                defaultDesktopMode = true,
                showRecommendations = false,
                autoSyncFilters = false,
                saveHistory = false
            )
        )
        assertEquals(0, dataStore.getTopRecommendations().size)
        assertEquals("google", dataStore.getSettings().searchEngine)
        assertEquals("light", dataStore.getSettings().theme)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        assertTrue(activity.awaitInitialFiltersForTesting())
        val bridge = activity.getNativeBridgeForTesting()

        val initialState = JSONObject(bridge.getInitialState())
        assertTrue(initialState.has("settings"))
        assertTrue(initialState.has("recommendations"))
        assertTrue(initialState.has("downloadsSummary"))

        bridge.updateSettings(
            JSONObject().apply {
                put("searchEngine", "startpage")
                put("theme", "light")
                put("blockThirdPartyCookies", true)
                put("defaultDesktopMode", false)
                put("showRecommendations", true)
                put("autoSyncFilters", true)
                put("saveHistory", true)
            }.toString()
        )
        val updatedState = bridge.buildStateJson()
        assertEquals("startpage", updatedState.getString("searchEngine"))
        assertEquals("light", updatedState.getJSONObject("settings").getString("theme"))

        val historyArr = JSONArray(bridge.getHistory())
        if (historyArr.length() > 0) {
            val firstId = historyArr.getJSONObject(0).getString("id")
            bridge.deleteHistoryItem(firstId)
        }
        bridge.clearHistory()
        assertEquals(0, JSONArray(bridge.getHistory()).length())
        assertEquals(0, JSONArray(bridge.getDownloads()).length())

        bridge.addBookmark("Kotlin", "https://kotlinlang.org", "Code")
        val bookmarksArr = JSONArray(bridge.getBookmarks())
        assertTrue(bookmarksArr.length() >= 1)
        assertTrue(updatedState.has("bookmarks"))
        assertTrue(updatedState.has("canReopenClosedTab"))

        controller.pause().stop().destroy()
    }

    @Test
    fun tabGroupsIncognitoReopenAndBookmarksWorkCleanly() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val dataStore = BrowserDataStore(context)
        dataStore.clearHistoryAndRecommendations()

        val added = dataStore.addBookmark("Aegis Repo", "https://github.com/itripathiharsh/Aegis-Browser", "Code")
        assertTrue(added != null)
        assertEquals(
            "https://github.com/itripathiharsh/Aegis-Browser",
            dataStore.getBookmarksJson().getJSONObject(0).getString("url")
        )
        assertTrue(dataStore.removeBookmark(added!!.id))

        dataStore.updateSettings(
            BrowserSettings(
                searchEngine = "brave",
                theme = "light",
                textZoom = 125,
                allowSitePermissionPrompts = true,
                restoreTabsOnStart = true
            )
        )
        assertEquals(125, dataStore.getSettings().textZoom)

        val container = android.widget.FrameLayout(context)
        val engine = AdBlockEngine().apply { loadFromContext(context) }
        val telemetry = com.aegis.browser.adblock.ShieldsTelemetry {}
        val downloadsRepo = DownloadsRepository(
            context = context,
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
            onChanged = {}
        )
        val manager = TabManager(
            context = context,
            container = container,
            adBlockEngine = engine,
            telemetry = telemetry,
            dataStore = dataStore,
            downloadsRepo = downloadsRepo,
            onTabsUpdated = {},
            onShowFullscreen = { _, _ -> },
            onHideFullscreen = {}
        )

        val opener = manager.createTab("https://en.wikipedia.org/wiki/Kotlin", makeActive = true)
        val groupedChild = manager.openInTabGroup(opener.id, "https://en.wikipedia.org/wiki/Android", makeActive = false)
        assertTrue(opener.groupId != null)
        assertEquals(opener.groupId, groupedChild.groupId)
        assertEquals(opener.groupColor, groupedChild.groupColor)

        manager.renameTabGroup(opener.groupId!!, "Research")
        assertEquals("Research", groupedChild.groupTitle)

        manager.closeTab(groupedChild.id)
        assertTrue(manager.canReopenClosedTab())
        val reopened = manager.reopenLastClosedTab()
        assertEquals("https://en.wikipedia.org/wiki/Android", reopened?.url)
        assertEquals(opener.groupId, reopened?.groupId)

        val inc = manager.createTab("https://example.org/private", makeActive = true, incognito = true)
        assertTrue(inc.incognito)
        manager.ungroupTab(opener.id)
        assertEquals(null, opener.groupId)

        manager.destroyAll()
    }
}
