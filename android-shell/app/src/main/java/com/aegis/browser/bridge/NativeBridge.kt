package com.aegis.browser.bridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.adblock.FilterListUpdater
import com.aegis.browser.adblock.ShieldsConfig
import com.aegis.browser.adblock.ShieldsTelemetry
import com.aegis.browser.browser.BrowserDataStore
import com.aegis.browser.browser.BrowserSettings
import com.aegis.browser.browser.ContextHitPayload
import com.aegis.browser.browser.DownloadsRepository
import com.aegis.browser.browser.FindMatchState
import com.aegis.browser.browser.TabManager
import com.aegis.browser.updater.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class PendingPermissionUi(
    val id: String,
    val origin: String,
    val label: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("origin", origin)
        put("label", label)
    }
}

class NativeBridge(
    private val context: Context? = null,
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
    private val onThemeChanged: (String) -> Unit = {},
    private val onRespondSitePermission: (id: String, allow: Boolean) -> Unit = { _, _ -> }
) {
    @Volatile
    private var pendingContextMenu: ContextHitPayload? = null

    @Volatile
    private var findState: FindMatchState = FindMatchState()

    @Volatile
    private var pendingPermission: PendingPermissionUi? = null

    fun setPendingContextMenu(payload: ContextHitPayload?) {
        pendingContextMenu = payload
        runOnUi { onPushStateToUi() }
    }

    fun updateFindMatches(update: FindMatchState) {
        findState = findState.copy(
            tabId = update.tabId,
            activeOrdinal = update.activeOrdinal,
            totalMatches = update.totalMatches
        )
        runOnUi { onPushStateToUi() }
    }

    fun setPendingPermission(prompt: PendingPermissionUi?) {
        pendingPermission = prompt
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun getInitialState(): String = buildStateJson().toString()

    @JavascriptInterface
    fun navigate(tabId: String, input: String) {
        runOnUi {
            findState = FindMatchState()
            tabManager.navigate(tabId, input)
        }
    }

    @JavascriptInterface
    fun goBack(tabId: String) {
        runOnUi {
            findState = FindMatchState()
            tabManager.goBack(tabId)
        }
    }

    @JavascriptInterface
    fun goForward(tabId: String) {
        runOnUi {
            findState = FindMatchState()
            tabManager.goForward(tabId)
        }
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
    fun createIncognitoTab(url: String?) {
        runOnUi { tabManager.createTab(url, makeActive = true, incognito = true) }
    }

    @JavascriptInterface
    fun openInTabGroup(sourceTabId: String, url: String, makeActive: Boolean) {
        runOnUi { tabManager.openInTabGroup(sourceTabId, url, makeActive) }
    }

    @JavascriptInterface
    fun renameTabGroup(groupId: String, title: String) {
        runOnUi { tabManager.renameTabGroup(groupId, title) }
    }

    @JavascriptInterface
    fun ungroupTab(tabId: String) {
        runOnUi { tabManager.ungroupTab(tabId) }
    }

    @JavascriptInterface
    fun closeTabGroup(groupId: String) {
        runOnUi { tabManager.closeTabGroup(groupId) }
    }

    @JavascriptInterface
    fun reopenClosedTab() {
        runOnUi { tabManager.reopenLastClosedTab() }
    }

    @JavascriptInterface
    fun switchTab(tabId: String) {
        runOnUi {
            findState = FindMatchState()
            tabManager.switchTab(tabId)
        }
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
    fun toggleReaderMode(tabId: String) {
        runOnUi { tabManager.toggleReaderMode(tabId) }
    }

    @JavascriptInterface
    fun findInPage(tabId: String, query: String) {
        runOnUi {
            findState = FindMatchState(tabId = tabId, query = query, activeOrdinal = 0, totalMatches = 0)
            tabManager.findInPage(tabId, query)
            onPushStateToUi()
        }
    }

    @JavascriptInterface
    fun findNextMatch(tabId: String, forward: Boolean) {
        runOnUi { tabManager.findNext(tabId, forward) }
    }

    @JavascriptInterface
    fun clearFindInPage(tabId: String) {
        runOnUi {
            findState = FindMatchState()
            tabManager.clearFindInPage(tabId)
            onPushStateToUi()
        }
    }

    @JavascriptInterface
    fun dismissContextMenu() {
        pendingContextMenu = null
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun respondPermissionPrompt(id: String, allow: Boolean) {
        pendingPermission = null
        runOnUi {
            onRespondSitePermission(id, allow)
            onPushStateToUi()
        }
    }

    @JavascriptInterface
    fun shareUrl(url: String, title: String?) {
        val ctx = context ?: return
        if (url.isBlank() || url.startsWith("aegis://")) return
        runOnUi {
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, url)
                if (!title.isNullOrBlank()) {
                    putExtra(Intent.EXTRA_SUBJECT, title)
                }
            }
            val chooser = Intent.createChooser(sendIntent, title ?: "Share link").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            runCatching { ctx.startActivity(chooser) }
        }
    }

    @JavascriptInterface
    fun copyText(text: String) {
        val ctx = context ?: return
        if (text.isBlank()) return
        runOnUi {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("Aegis Browser", text))
        }
    }

    @JavascriptInterface
    fun getBookmarks(): String = dataStore.getBookmarksJson().toString()

    @JavascriptInterface
    fun addBookmark(title: String, url: String, tag: String?) {
        dataStore.addBookmark(title, url, tag ?: "Saved")
        runOnUi { onPushStateToUi() }
    }

    @JavascriptInterface
    fun removeBookmark(id: String) {
        if (dataStore.removeBookmark(id)) {
            runOnUi { onPushStateToUi() }
        }
    }

    @JavascriptInterface
    fun importLegacyBookmarks(jsonStr: String) {
        if (dataStore.importBookmarksIfUnset(jsonStr)) {
            runOnUi { onPushStateToUi() }
        }
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
                saveHistory = obj.optBoolean("saveHistory", cur.saveHistory),
                textZoom = obj.optInt("textZoom", cur.textZoom),
                allowSitePermissionPrompts = obj.optBoolean("allowSitePermissionPrompts", cur.allowSitePermissionPrompts),
                restoreTabsOnStart = obj.optBoolean("restoreTabsOnStart", cur.restoreTabsOnStart)
            )
            val saved = dataStore.updateSettings(next)
            runOnUi {
                tabManager.applyCookiePolicyToAllTabs()
                tabManager.applyTextZoomToAllTabs(saved.textZoom)
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
    fun downloadUrl(url: String) {
        downloadsRepo.startWebDownload(
            url = url,
            userAgent = null,
            contentDisposition = null,
            mimeType = null,
            contentLength = -1L
        )
    }

    @JavascriptInterface
    fun openDownloadedFile(id: String) {
        runOnUi { downloadsRepo.openDownload(id) }
    }

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
                    put("incognito", tab.incognito)
                    put("readerMode", tab.readerMode)
                    put("groupId", tab.groupId ?: JSONObject.NULL)
                    put("groupTitle", tab.groupTitle ?: JSONObject.NULL)
                    put("groupColor", tab.groupColor ?: JSONObject.NULL)
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

        val ctxMenuObj = pendingContextMenu?.let { ctx ->
            JSONObject().apply {
                put("tabId", ctx.tabId)
                put("linkUrl", ctx.linkUrl ?: JSONObject.NULL)
                put("imageUrl", ctx.imageUrl ?: JSONObject.NULL)
                put("title", ctx.title ?: JSONObject.NULL)
            }
        } ?: JSONObject.NULL

        val findObj = if (findState.tabId.isNotBlank() && findState.query.isNotEmpty()) {
            JSONObject().apply {
                put("tabId", findState.tabId)
                put("query", findState.query)
                put("activeOrdinal", findState.activeOrdinal)
                put("totalMatches", findState.totalMatches)
            }
        } else {
            JSONObject.NULL
        }

        val permObj = pendingPermission?.toJson() ?: JSONObject.NULL

        val currentSettings = dataStore.getSettings()
        return JSONObject().apply {
            put("platform", "android")
            put("searchEngine", currentSettings.searchEngine)
            put("settings", currentSettings.toJson())
            put("activeTabId", tabManager.getActiveTabId())
            put("tabs", tabsArr)
            put("bookmarks", dataStore.getBookmarksJson())
            put("canReopenClosedTab", tabManager.canReopenClosedTab())
            put("recommendations", recsArr)
            put("downloadsSummary", downloadsSummaryObj)
            put("pendingContextMenu", ctxMenuObj)
            put("findState", findObj)
            put("pendingPermission", permObj)
            put("shields", shieldsObj)
            put("filterStats", statsObj)
            put("filterSources", sourcesArr)
            put("telemetry", telemetryObj)
            put("appUpdate", appUpdater.getState().toJson())
        }
    }
}
