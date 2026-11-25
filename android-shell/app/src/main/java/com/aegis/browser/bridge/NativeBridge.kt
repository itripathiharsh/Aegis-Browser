package com.aegis.browser.bridge

import android.webkit.JavascriptInterface
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.adblock.FilterListUpdater
import com.aegis.browser.adblock.ShieldsConfig
import com.aegis.browser.adblock.ShieldsTelemetry
import com.aegis.browser.browser.BrowserDataStore
import com.aegis.browser.browser.BrowserSettings
import com.aegis.browser.browser.DownloadsRepository
import com.aegis.browser.browser.TabManager
import com.aegis.browser.updater.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class NativeBridge(
    private val runOnUi: (() -> Unit) -> Unit,
    private val scope: CoroutineScope,
    private val tabManager: TabManager,
    private val adBlockEngine: AdBlockEngine,
    private val filterUpdater: FilterListUpdater,
    private val telemetry: ShieldsTelemetry,
    private val appUpdater: AppUpdater,
    private val dataStore: BrowserDataStore,
    private val downloadsRepo: DownloadsRepository,
    private val saveShieldsConfig: (ShieldsConfig) -> Unit,
    private val onLayoutModeChanged: (expanded: Boolean, barHeightPx: Int) -> Unit,
    private val onPushStateToUi: () -> Unit,
    private val onFilterSyncCompleted: (String) -> Unit,
    private val onThemeChanged: (String) -> Unit = {}
) {

    @JavascriptInterface
    fun getInitialState(): String = buildStateJson().toString()

    @JavascriptInterface
    fun navigate(tabId: String, input: String) {
        runOnUi { tabManager.navigate(tabId, input) }
    }

    @JavascriptInterface
    fun goBack(tabId: String) {
        runOnUi { tabManager.goBack(tabId) }
    }

    @JavascriptInterface
    fun goForward(tabId: String) {
        runOnUi { tabManager.goForward(tabId) }
    }

    @JavascriptInterface
    fun reload(tabId: String) {
        runOnUi { tabManager.reload(tabId) }
    }

    @JavascriptInterface
    fun stopLoading(tabId: String) {
        runOnUi { tabManager.stopLoading(tabId) }
    }

    @JavascriptInterface
    fun createTab(url: String?) {
        runOnUi { tabManager.createTab(url, makeActive = true) }
    }

    @JavascriptInterface
    fun switchTab(tabId: String) {
        runOnUi { tabManager.switchTab(tabId) }
    }

    @JavascriptInterface
    fun closeTab(tabId: String) {
        runOnUi { tabManager.closeTab(tabId) }
    }

    @JavascriptInterface
    fun setDesktopMode(tabId: String, desktop: Boolean) {
        runOnUi { tabManager.setDesktopMode(tabId, desktop) }
    }

    @JavascriptInterface
    fun setSearchEngine(engineId: String) {
        dataStore.setSearchEngine(engineId)
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun updateSettings(jsonStr: String) {
        runCatching {
            val obj = JSONObject(jsonStr)
            val cur = dataStore.getSettings()
            val next = BrowserSettings(
                searchEngine = obj.optString("searchEngine", cur.searchEngine),
                theme = obj.optString("theme", cur.theme),
                blockThirdPartyCookies = obj.optBoolean("blockThirdPartyCookies", cur.blockThirdPartyCookies),
                defaultDesktopMode = obj.optBoolean("defaultDesktopMode", cur.defaultDesktopMode),
                showRecommendations = obj.optBoolean("showRecommendations", cur.showRecommendations),
                autoSyncFilters = obj.optBoolean("autoSyncFilters", cur.autoSyncFilters),
                saveHistory = obj.optBoolean("saveHistory", cur.saveHistory)
            )
            val saved = dataStore.updateSettings(next)
            runOnUi {
                tabManager.applyCookiePolicyToAllTabs()
                onThemeChanged(saved.theme)
                onPushStateToUi()
            }
        }
    }

    @JavascriptInterface
    fun setOverlayExpanded(expanded: Boolean, barHeightPx: Int) {
        runOnUi { onLayoutModeChanged(expanded, barHeightPx) }
    }

    @JavascriptInterface
    fun focusContent() {
        runOnUi { tabManager.focusActiveWebView() }
    }

    @JavascriptInterface
    fun setShieldsConfig(jsonStr: String) {
        runCatching {
            val obj = JSONObject(jsonStr)
            val disabledArr = obj.optJSONArray("disabledHosts") ?: JSONArray()
            val disabledSet = mutableSetOf<String>()
            for (i in 0 until disabledArr.length()) {
                val h = disabledArr.optString(i).trim().lowercase()
                if (h.isNotEmpty()) disabledSet.add(h)
            }
            val cfg = ShieldsConfig(
                enabled = obj.optBoolean("enabled", true),
                blockAdsAndTrackers = obj.optBoolean("blockAdsAndTrackers", true),
                blockPopups = obj.optBoolean("blockPopups", true),
                cosmeticFiltering = obj.optBoolean("cosmeticFiltering", true),
                disabledHosts = disabledSet
            )
            adBlockEngine.updateConfig(cfg)
            saveShieldsConfig(cfg)
            runOnUi { onPushStateToUi() }
        }
    }

    @JavascriptInterface
    fun toggleSiteShields(host: String, enabled: Boolean) {
        val clean = host.trim().lowercase()
        if (clean.isEmpty()) return
        val cur = adBlockEngine.getConfig()
        val nextHosts = cur.disabledHosts.toMutableSet()
        if (enabled) nextHosts.remove(clean) else nextHosts.add(clean)
        val updated = cur.copy(disabledHosts = nextHosts)
        adBlockEngine.updateConfig(updated)
        saveShieldsConfig(updated)
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun syncFilterLists() {
        scope.launch {
            val res = filterUpdater.syncEnabledLists()
            val payload = JSONObject().apply {
                put("syncedSources", res.syncedSources)
                put("failedSources", res.failedSources)
                put("totalRules", res.totalRules)
                put("lastUpdatedIso", res.lastUpdatedIso)
                put("message", res.message)
            }.toString()
            runOnUi {
                onFilterSyncCompleted(payload)
                onPushStateToUi()
            }
        }
    }

    @JavascriptInterface
    fun testUrlAgainstFilters(url: String, pageHost: String): String {
        val pageUrl = if (pageHost.isNotBlank()) "https://$pageHost/" else null
        val decision = adBlockEngine.evaluateRequest(
            requestUrl = url,
            pageUrl = pageUrl,
            acceptHeader = null,
            isMainFrame = false
        )
        return JSONObject().apply {
            put("blocked", decision.blocked)
            put("matchedRule", decision.matchedRule ?: JSONObject.NULL)
            put("category", decision.category.wireName)
        }.toString()
    }

    @JavascriptInterface
    fun getHistory(): String = dataStore.getHistoryJson().toString()

    @JavascriptInterface
    fun deleteHistoryItem(id: String) {
        dataStore.deleteHistoryEntry(id)
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun clearHistory() {
        dataStore.clearHistoryAndRecommendations()
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun dismissRecommendation(host: String) {
        dataStore.dismissRecommendation(host)
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun getDownloads(): String = downloadsRepo.getRecordsJson().toString()

    @JavascriptInterface
    fun openSystemDownloads() {
        runOnUi { downloadsRepo.openSystemDownloads() }
    }

    @JavascriptInterface
    fun removeDownload(id: String) {
        downloadsRepo.removeEntry(id)
    }

    @JavascriptInterface
    fun clearCompletedDownloads() {
        downloadsRepo.clearCompleted()
    }

    @JavascriptInterface
    fun clearCacheAndCookies() {
        runOnUi {
            tabManager.clearAllCachesAndCookies()
            onPushStateToUi()
        }
    }

    @JavascriptInterface
    fun checkForUpdates(manual: Boolean) {
        runOnUi { appUpdater.checkForUpdates(manual) }
    }

    @JavascriptInterface
    fun downloadAndInstallUpdate() {
        runOnUi { appUpdater.startDownloadAndInstall() }
    }

    @JavascriptInterface
    fun cancelUpdateDownload() {
        runOnUi { appUpdater.cancelDownload() }
    }

    @JavascriptInterface
    fun dismissUpdateModal() {
        runOnUi { appUpdater.dismissModal() }
    }

    @JavascriptInterface
    fun retryPendingInstall() {
        runOnUi { appUpdater.openDownloadedUpdate() }
    }

    fun buildStateJson(): JSONObject {
        val tabsArr = JSONArray()
        tabManager.getTabs().forEach { tab ->
            tabsArr.put(
                JSONObject().apply {
                    put("id", tab.id)
                    put("title", tab.title)
                    put("url", tab.url)
                    put("isLoading", tab.isLoading)
                    put("progress", tab.progress)
                    put("canGoBack", tab.canGoBack)
                    put("canGoForward", tab.canGoForward)
                    put("desktopMode", tab.desktopMode)
                    put("blockedCount", telemetry.getTabCount(tab.id))
                }
            )
        }

        val cfg = adBlockEngine.getConfig()
        val disabledArr = JSONArray().apply {
            cfg.disabledHosts.forEach { put(it) }
        }
        val shieldsObj = JSONObject().apply {
            put("enabled", cfg.enabled)
            put("blockAdsAndTrackers", cfg.blockAdsAndTrackers)
            put("blockPopups", cfg.blockPopups)
            put("cosmeticFiltering", cfg.cosmeticFiltering)
            put("disabledHosts", disabledArr)
        }

        val stats = adBlockEngine.getStats()
        val statsObj = JSONObject().apply {
            put("domainRuleCount", stats.domainRuleCount)
            put("patternRuleCount", stats.patternRuleCount)
            put("exceptionRuleCount", stats.exceptionRuleCount)
            put("cosmeticSelectorCount", stats.cosmeticSelectorCount)
            put("lastUpdatedIso", stats.lastUpdatedIso ?: JSONObject.NULL)
        }

        val sourcesArr = JSONArray()
        filterUpdater.loadSources().forEach { s ->
            sourcesArr.put(
                JSONObject().apply {
                    put("id", s.id)
                    put("name", s.name)
                    put("category", s.category.wireName)
                    put("url", s.url)
                    put("enabled", s.enabled)
                    put("lastSyncedIso", s.lastSyncedIso ?: JSONObject.NULL)
                    put("cachedRuleCount", s.cachedRuleCount)
                }
            )
        }

        val recentArr = JSONArray()
        telemetry.getRecentEvents().take(15).forEach { ev ->
            recentArr.put(
                JSONObject().apply {
                    put("url", ev.url)
                    put("host", ev.host)
                    put("pageHost", ev.pageHost)
                    put("rule", ev.rule)
                    put("category", ev.category.wireName)
                    put("timestampMs", ev.timestampMs)
                }
            )
        }

        val telemetryObj = JSONObject().apply {
            put("totalBlocked", telemetry.getTotalBlocked())
            put("adsBlocked", telemetry.getAdsBlocked())
            put("trackersBlocked", telemetry.getTrackersBlocked())
            put("popupsBlocked", telemetry.getPopupsBlocked())
            put("recentEvents", recentArr)
        }

        val recsArr = JSONArray()
        dataStore.getTopRecommendations(8).forEach { rec ->
            recsArr.put(rec.toJson())
        }

        val downloadsSummaryObj = JSONObject().apply {
            put("activeCount", downloadsRepo.getActiveCount())
            put("totalCount", downloadsRepo.getTotalCount())
        }

        val currentSettings = dataStore.getSettings()
        return JSONObject().apply {
            put("platform", "android")
            put("searchEngine", currentSettings.searchEngine)
            put("settings", currentSettings.toJson())
            put("activeTabId", tabManager.getActiveTabId())
            put("tabs", tabsArr)
            put("recommendations", recsArr)
            put("downloadsSummary", downloadsSummaryObj)
            put("shields", shieldsObj)
            put("filterStats", statsObj)
            put("filterSources", sourcesArr)
            put("telemetry", telemetryObj)
            put("appUpdate", appUpdater.getState().toJson())
        }
    }
}
