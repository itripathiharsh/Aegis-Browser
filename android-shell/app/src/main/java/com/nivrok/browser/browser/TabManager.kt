package com.nivrok.browser.browser

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.nivrok.browser.adblock.AdBlockEngine
import com.nivrok.browser.adblock.ShieldsTelemetry
import com.nivrok.browser.diagnostics.CrashReporter
import java.net.URLEncoder
import java.util.UUID
import kotlin.math.abs

data class TabSession(
    val id: String,
    @Volatile var title: String,
    @Volatile var url: String,
    @Volatile var isLoading: Boolean = false,
    @Volatile var progress: Int = 0,
    @Volatile var canGoBack: Boolean = false,
    @Volatile var canGoForward: Boolean = false,
    @Volatile var desktopMode: Boolean = false,
    @Volatile var incognito: Boolean = false,
    @Volatile var readerMode: Boolean = false,
    @Volatile var groupId: String? = null,
    @Volatile var groupTitle: String? = null,
    @Volatile var groupColor: String? = null,
    val openerTabId: String? = null,
    @Volatile var isAutoPopup: Boolean = false,
    val openedAtMs: Long = 0L,
    var webView: WebView? = null,
    var wrapperView: PullToRefreshWebContainer? = null,
    var webViewClient: BrowserWebViewClient? = null
) {
    val isInternalPage: Boolean
        get() = url.startsWith("nivrok://") || url.startsWith("aegis://")
}

data class ClosedTabRecord(
    val url: String,
    val title: String,
    val desktopMode: Boolean,
    val groupId: String?,
    val groupTitle: String?,
    val groupColor: String?
)

data class FindMatchState(
    val tabId: String = "",
    val query: String = "",
    val activeOrdinal: Int = 0,
    val totalMatches: Int = 0
)

data class ContextHitPayload(
    val tabId: String,
    val linkUrl: String?,
    val imageUrl: String?,
    val title: String?
)

class TabManager(
    private val context: Context,
    private val container: FrameLayout,
    private val adBlockEngine: AdBlockEngine,
    private val telemetry: ShieldsTelemetry,
    private val dataStore: BrowserDataStore,
    private val downloadsRepo: DownloadsRepository,
    private val onTabsUpdated: () -> Unit,
    private val onShowFullscreen: (View, WebChromeClient.CustomViewCallback) -> Unit,
    private val onHideFullscreen: () -> Unit,
    private val onShowFileChooser: (ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams?) -> Boolean = { _, _ -> false },
    private val onPermissionRequested: (PermissionRequest) -> Unit = { it.deny() },
    private val onGeolocationRequested: (String, GeolocationPermissions.Callback) -> Unit = { o, cb -> cb.invoke(o, false, false) },
    private val onLinkLongPressed: (ContextHitPayload) -> Unit = {},
    private val onFindUpdated: (FindMatchState) -> Unit = {}
) {
    private val tabsLock = Any()
    private val tabs = mutableListOf<TabSession>()
    private val closedStack = ArrayDeque<ClosedTabRecord>()
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var activeTabId: String = ""

    @Volatile
    private var groupSeq: Int = 1

    fun getSearchEngine(): String = dataStore.getSettings().searchEngine

    fun ensureInitialTab() {
        val isEmpty = synchronized(tabsLock) { tabs.isEmpty() }
        if (!isEmpty) return

        val restored = dataStore.loadSavedTabs()
        if (restored.isNotEmpty()) {
            var targetActiveId: String? = null
            restored.forEach { snap ->
                val created = createTabInternal(
                    rawUrl = snap.url,
                    rawTitle = snap.title,
                    desktopMode = snap.desktopMode,
                    incognito = false,
                    groupId = snap.groupId,
                    groupTitle = snap.groupTitle,
                    groupColor = snap.groupColor,
                    makeActive = false,
                    openerTabId = null,
                    isAutoPopup = false,
                    loadImmediately = snap.isActive
                )
                if (snap.isActive) {
                    targetActiveId = created.id
                }
            }
            val chosen = targetActiveId ?: synchronized(tabsLock) { tabs.firstOrNull()?.id }
            if (chosen != null) {
                switchTab(chosen)
            }
            return
        }

        createTab("nivrok://home", makeActive = true)
    }

    fun getTabs(): List<TabSession> = synchronized(tabsLock) { tabs.toList() }

    fun getActiveTab(): TabSession? = synchronized(tabsLock) {
        tabs.find { it.id == activeTabId } ?: tabs.firstOrNull()
    }

    fun getActiveTabId(): String = activeTabId

    fun canReopenClosedTab(): Boolean = synchronized(tabsLock) { closedStack.isNotEmpty() }

    fun createTab(
        initialInput: String? = null,
        makeActive: Boolean = true,
        openerTabId: String? = null,
        isAutoPopup: Boolean = false,
        incognito: Boolean = false,
        groupId: String? = null,
        groupTitle: String? = null,
        groupColor: String? = null
    ): TabSession {
        val settings = dataStore.getSettings()
        val rawResolved = if (initialInput.isNullOrBlank()) {
            "nivrok://home"
        } else {
            resolveUserInput(initialInput, settings.searchEngine)
        }
        val desktop = settings.defaultDesktopMode
        val resolved = if (desktop && !rawResolved.startsWith("nivrok://")) {
            rewriteUrlForMode(rawResolved, desktop = true)
        } else {
            rawResolved
        }
        val title = if (resolved == "nivrok://home") {
            if (incognito) "Private Tab" else "Nivrok Start"
        } else {
            resolved
        }
        return createTabInternal(
            rawUrl = resolved,
            rawTitle = title,
            desktopMode = desktop,
            incognito = incognito,
            groupId = groupId,
            groupTitle = groupTitle,
            groupColor = groupColor,
            makeActive = makeActive,
            openerTabId = openerTabId,
            isAutoPopup = isAutoPopup,
            loadImmediately = !resolved.startsWith("nivrok://")
        )
    }

    private fun createTabInternal(
        rawUrl: String,
        rawTitle: String,
        desktopMode: Boolean,
        incognito: Boolean,
        groupId: String?,
        groupTitle: String?,
        groupColor: String?,
        makeActive: Boolean,
        openerTabId: String?,
        isAutoPopup: Boolean,
        loadImmediately: Boolean
    ): TabSession {
        val id = "tab-" + UUID.randomUUID().toString().take(8)
        val session = TabSession(
            id = id,
            title = rawTitle,
            url = rawUrl,
            desktopMode = desktopMode,
            incognito = incognito,
            groupId = groupId,
            groupTitle = groupTitle,
            groupColor = groupColor,
            openerTabId = openerTabId,
            isAutoPopup = isAutoPopup,
            openedAtMs = if (isAutoPopup) System.currentTimeMillis() else 0L
        )
        synchronized(tabsLock) {
            // Insert grouped child tabs right after sibling tabs in the same group
            if (groupId != null) {
                val lastGroupIdx = tabs.indexOfLast { it.groupId == groupId }
                if (lastGroupIdx >= 0) {
                    tabs.add(lastGroupIdx + 1, session)
                } else {
                    tabs.add(session)
                }
            } else {
                tabs.add(session)
            }
        }
        if (makeActive) {
            switchTab(id)
        } else {
            persistTabsSnapshot()
            onTabsUpdated()
        }
        if (loadImmediately && !session.isInternalPage) {
            loadUrlInTab(session, rawUrl)
        }
        return session
    }

    /**
     * Brave-style "Open in new tab in group": groups sourceTabId if ungrouped, then appends child tab to that group.
     */
    fun openInTabGroup(sourceTabId: String, targetUrl: String, makeActive: Boolean = false): TabSession {
        var resolvedGroupId: String? = null
        var resolvedGroupTitle: String? = null
        var resolvedGroupColor: String? = null

        synchronized(tabsLock) {
            val source = tabs.find { it.id == sourceTabId } ?: tabs.find { it.id == activeTabId }
            if (source != null) {
                if (source.groupId != null) {
                    resolvedGroupId = source.groupId
                    resolvedGroupTitle = source.groupTitle
                    resolvedGroupColor = source.groupColor
                } else {
                    val idx = groupSeq++
                    val hostLabel = AdBlockEngine.extractHost(source.url)
                        ?.removePrefix("www.")
                        ?.substringBefore('.')
                        ?.replaceFirstChar { it.uppercase() }
                        ?.takeIf { !source.isInternalPage && it.isNotBlank() }
                        ?: "Group $idx"
                    resolvedGroupId = "grp-" + UUID.randomUUID().toString().take(6)
                    resolvedGroupTitle = hostLabel
                    resolvedGroupColor = GROUP_COLORS[(idx - 1) % GROUP_COLORS.size]
                    source.groupId = resolvedGroupId
                    source.groupTitle = resolvedGroupTitle
                    source.groupColor = resolvedGroupColor
                }
            }
        }

        val child = createTab(
            initialInput = targetUrl,
            makeActive = makeActive,
            groupId = resolvedGroupId,
            groupTitle = resolvedGroupTitle,
            groupColor = resolvedGroupColor
        )
        persistTabsSnapshot()
        onTabsUpdated()
        return child
    }

    fun renameTabGroup(groupId: String, title: String) {
        val clean = title.trim().take(28)
        if (clean.isEmpty()) return
        synchronized(tabsLock) {
            tabs.filter { it.groupId == groupId }.forEach { it.groupTitle = clean }
        }
        persistTabsSnapshot()
        onTabsUpdated()
    }

    fun ungroupTab(tabId: String) {
        synchronized(tabsLock) {
            val tab = tabs.find { it.id == tabId } ?: return
            val gid = tab.groupId
            tab.groupId = null
            tab.groupTitle = null
            tab.groupColor = null
            if (gid != null) {
                val remaining = tabs.filter { it.groupId == gid }
                if (remaining.size <= 1) {
                    remaining.forEach {
                        it.groupId = null
                        it.groupTitle = null
                        it.groupColor = null
                    }
                }
            }
        }
        persistTabsSnapshot()
        onTabsUpdated()
    }

    fun closeTabGroup(groupId: String) {
        val ids = synchronized(tabsLock) {
            tabs.filter { it.groupId == groupId }.map { it.id }
        }
        ids.forEach { closeTab(it) }
    }

    fun switchTab(tabId: String) {
        val targetTab: TabSession
        val snapshot = synchronized(tabsLock) {
            targetTab = tabs.find { it.id == tabId } ?: return
            activeTabId = targetTab.id
            tabs.toList()
        }
        if (!targetTab.isInternalPage && targetTab.webView == null) {
            loadUrlInTab(targetTab, targetTab.url)
        }
        snapshot.forEach { tab ->
            val wrapper = tab.wrapperView
            val wv = tab.webView ?: return@forEach
            if (tab.id == activeTabId && !tab.isInternalPage) {
                wrapper?.visibility = View.VISIBLE
                wv.visibility = View.VISIBLE
                wv.onResume()
            } else {
                wrapper?.visibility = View.GONE
                wv.visibility = View.GONE
                wv.onPause()
            }
        }
        onFindUpdated(FindMatchState(tabId = activeTabId, query = "", activeOrdinal = 0, totalMatches = 0))
        persistTabsSnapshot()
        onTabsUpdated()
    }

    fun closePopupAndReturnToOpener(popupTabId: String) {
        val openerId: String?
        val exists: Boolean
        synchronized(tabsLock) {
            val target = tabs.find { it.id == popupTabId } ?: return
            openerId = target.openerTabId
            exists = openerId != null && tabs.any { it.id == openerId }
        }
        closeTab(popupTabId)
        if (exists && openerId != null) {
            switchTab(openerId)
        }
    }

    fun closeTab(tabId: String) {
        val removed: TabSession
        val nextActiveId: String?
        var clearIncognitoFootprint = false
        synchronized(tabsLock) {
            val idx = tabs.indexOfFirst { it.id == tabId }
            if (idx < 0) return
            removed = tabs.removeAt(idx)
            if (!removed.incognito && !removed.isAutoPopup && !removed.isInternalPage) {
                closedStack.addFirst(
                    ClosedTabRecord(
                        url = removed.url,
                        title = removed.title,
                        desktopMode = removed.desktopMode,
                        groupId = removed.groupId,
                        groupTitle = removed.groupTitle,
                        groupColor = removed.groupColor
                    )
                )
                while (closedStack.size > 15) closedStack.removeLast()
            }
            if (removed.incognito && tabs.none { it.incognito }) {
                clearIncognitoFootprint = true
            }
            nextActiveId = if (tabs.isEmpty()) {
                null
            } else if (activeTabId == tabId) {
                val openerId = removed.openerTabId
                if (openerId != null && tabs.any { it.id == openerId }) {
                    openerId
                } else {
                    tabs[idx.coerceAtMost(tabs.lastIndex)].id
                }
            } else {
                activeTabId
            }
        }

        removed.wrapperView?.let { wrapper ->
            container.removeView(wrapper)
        }
        removed.webView?.let { wv ->
            wv.stopLoading()
            if (removed.incognito) {
                wv.clearHistory()
                wv.clearFormData()
                wv.clearCache(true)
            }
            wv.destroy()
        }
        if (clearIncognitoFootprint) {
            runCatching { CookieManager.getInstance().flush() }
        }
        telemetry.removeTab(tabId)

        if (nextActiveId == null) {
            createTab("nivrok://home", makeActive = true)
            return
        }

        if (nextActiveId != activeTabId) {
            switchTab(nextActiveId)
        } else {
            persistTabsSnapshot()
            onTabsUpdated()
        }
    }

    fun reopenLastClosedTab(): TabSession? {
        val rec = synchronized(tabsLock) {
            if (closedStack.isEmpty()) null else closedStack.removeFirst()
        } ?: return null

        val keepGroup = synchronized(tabsLock) {
            rec.groupId != null && tabs.any { it.groupId == rec.groupId }
        }
        val restored = createTabInternal(
            rawUrl = rec.url,
            rawTitle = rec.title,
            desktopMode = rec.desktopMode,
            incognito = false,
            groupId = if (keepGroup) rec.groupId else null,
            groupTitle = if (keepGroup) rec.groupTitle else null,
            groupColor = if (keepGroup) rec.groupColor else null,
            makeActive = true,
            openerTabId = null,
            isAutoPopup = false,
            loadImmediately = true
        )
        persistTabsSnapshot()
        onTabsUpdated()
        return restored
    }

    fun navigate(tabId: String, rawInput: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        val rawResolved = resolveUserInput(rawInput, dataStore.getSettings().searchEngine)
        val resolved = if (tab.desktopMode && !rawResolved.startsWith("nivrok://")) {
            rewriteUrlForMode(rawResolved, desktop = true)
        } else {
            rawResolved
        }
        tab.isAutoPopup = false
        tab.readerMode = false
        tab.url = resolved
        if (resolved.startsWith("nivrok://")) {
            tab.isLoading = false
            tab.progress = 100
            tab.title = if (tab.incognito) "Private Tab" else "Nivrok Start"
            tab.wrapperView?.visibility = View.GONE
            tab.webView?.visibility = View.GONE
            tab.webView?.onPause()
            persistTabsSnapshot()
            onTabsUpdated()
            return
        }
        loadUrlInTab(tab, resolved)
    }

    fun goBack(tabId: String): Boolean {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return false
        val wv = tab.webView
        if (!tab.isInternalPage && wv != null && wv.canGoBack()) {
            tab.readerMode = false
            wv.goBack()
            return true
        }
        if (!tab.isInternalPage) {
            if (tab.openerTabId != null) {
                closePopupAndReturnToOpener(tab.id)
                return true
            }
            navigate(tab.id, "nivrok://home")
            return true
        }
        return false
    }

    fun goForward(tabId: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.isAutoPopup = false
        tab.readerMode = false
        tab.webView?.takeIf { it.canGoForward() }?.goForward()
    }

    fun reload(tabId: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.isAutoPopup = false
        tab.readerMode = false
        if (!tab.isInternalPage) {
            tab.webView?.reload()
        }
    }

    fun stopLoading(tabId: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.webView?.stopLoading()
        tab.isLoading = false
        onTabsUpdated()
    }

    fun setDesktopMode(tabId: String, desktop: Boolean) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.desktopMode = desktop
        val currentUrl = tab.url
        val targetUrl = if (!tab.isInternalPage) {
            rewriteUrlForMode(currentUrl, desktop)
        } else {
            currentUrl
        }
        tab.url = targetUrl
        tab.readerMode = false

        tab.webView?.let { wv ->
            applyUserAgentAndViewport(wv, desktop)
            if (!tab.isInternalPage) {
                tab.webViewClient?.updateTrackedUrl(targetUrl)
                wv.loadUrl(targetUrl)
            }
        }
        persistTabsSnapshot()
        onTabsUpdated()
    }

    fun findInPage(tabId: String, query: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        val wv = tab.webView ?: return
        if (query.isEmpty()) {
            clearFindInPage(tabId)
            return
        }
        wv.findAllAsync(query)
    }

    fun findNext(tabId: String, forward: Boolean) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.webView?.findNext(forward)
    }

    fun clearFindInPage(tabId: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.webView?.clearMatches()
        onFindUpdated(FindMatchState(tabId = tab.id, query = "", activeOrdinal = 0, totalMatches = 0))
    }

    fun toggleReaderMode(tabId: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        if (tab.isInternalPage) return
        val next = !tab.readerMode
        tab.readerMode = next
        val wv = tab.webView
        if (wv != null) {
            if (next) {
                val isLight = dataStore.getSettings().theme == "light"
                wv.evaluateJavascript(buildReaderScript(isLight), null)
            } else {
                wv.evaluateJavascript(EXIT_READER_SCRIPT, null)
            }
        }
        onTabsUpdated()
    }

    fun applyTextZoomToAllTabs(zoomPercent: Int) {
        val clean = zoomPercent.coerceIn(75, 160)
        getTabs().forEach { tab ->
            tab.webView?.settings?.textZoom = clean
        }
    }

    fun applyCookiePolicyToAllTabs() {
        val acceptThirdParty = !dataStore.getSettings().blockThirdPartyCookies
        val cm = CookieManager.getInstance()
        getTabs().forEach { tab ->
            tab.webView?.let { wv ->
                cm.setAcceptThirdPartyCookies(wv, if (tab.incognito) false else acceptThirdParty)
            }
        }
    }

    fun applyThemeToAllTabs(theme: String) {
        val bgColor = if (theme == "light") Color.parseColor("#F5F6F8") else Color.parseColor("#0F1115")
        getTabs().forEach { tab ->
            tab.webView?.setBackgroundColor(bgColor)
            tab.wrapperView?.updateIndicatorColors()
        }
    }

    fun clearAllCachesAndCookies() {
        runCatching {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            WebStorage.getInstance().deleteAllData()
        }
        getTabs().forEach { tab ->
            tab.webView?.clearCache(true)
        }
    }

    fun focusActiveWebView() {
        val tab = getActiveTab() ?: return
        if (!tab.isInternalPage) {
            tab.webView?.requestFocus()
        }
    }

    fun pauseAll() {
        persistTabsSnapshot()
        getTabs().forEach { it.webView?.onPause() }
    }

    fun resumeActive() {
        getActiveTab()?.takeIf { !it.isInternalPage }?.webView?.onResume()
    }

    fun persistTabsSnapshot() {
        val snapshot = synchronized(tabsLock) { tabs.toList() }
        dataStore.saveOpenTabs(snapshot, activeTabId)
    }

    fun destroyAll() {
        persistTabsSnapshot()
        val snapshot = synchronized(tabsLock) {
            val copy = tabs.toList()
            tabs.clear()
            copy
        }
        snapshot.forEach { tab ->
            tab.wrapperView?.let { container.removeView(it) }
            tab.webView?.destroy()
        }
    }

    private fun loadUrlInTab(tab: TabSession, url: String) {
        if (tab.webView == null) {
            val wv = createContentWebView(tab)
            val wrapper = PullToRefreshWebContainer(
                context = context,
                webView = wv,
                isDarkTheme = { dataStore.getSettings().theme != "light" },
                onRefresh = { reload(tab.id) }
            )
            tab.webView = wv
            tab.wrapperView = wrapper
            container.addView(
                wrapper,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
        }
        val wrapper = tab.wrapperView!!
        val wv = tab.webView!!

        if (tab.id == activeTabId) {
            wrapper.visibility = View.VISIBLE
            wv.visibility = View.VISIBLE
            wv.onResume()
        } else {
            wrapper.visibility = View.GONE
            wv.visibility = View.GONE
        }

        tab.isLoading = true
        tab.progress = 10
        tab.webViewClient?.updateTrackedUrl(url)
        wv.loadUrl(url)
        persistTabsSnapshot()
        onTabsUpdated()
    }

    private inner class BlobDownloadReceiver {
        @JavascriptInterface
        fun onBlobReady(dataUrl: String, fileName: String, mimeType: String) {
            downloadsRepo.saveBlobDataUrl(dataUrl, fileName, mimeType)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createContentWebView(tab: TabSession): WebView {
        val wv = WebView(context)
        val curSettings = dataStore.getSettings()
        val initialBg = if (curSettings.theme == "light") "#F5F6F8" else "#0F1115"
        wv.setBackgroundColor(Color.parseColor(initialBg))
        wv.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true

        val settings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        @Suppress("DEPRECATION")
        settings.saveFormData = !tab.incognito
        settings.setGeolocationEnabled(curSettings.allowSitePermissionPrompts && !tab.incognito)
        applyUserAgentAndViewport(wv, tab.desktopMode)
        settings.textZoom = curSettings.textZoom

        CookieManager.getInstance().setAcceptThirdPartyCookies(
            wv,
            if (tab.incognito) false else !curSettings.blockThirdPartyCookies
        )

        wv.addJavascriptInterface(BlobDownloadReceiver(), "__nivrokBlob")

        wv.setDownloadListener { url, userAgent, contentDisposition, mimetype, contentLength ->
            if (url.startsWith("blob:", ignoreCase = true)) {
                val safeMime = mimetype?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
                val safeFile = android.webkit.URLUtil.guessFileName("download", contentDisposition, mimetype)
                val escapedUrl = org.json.JSONObject.quote(url)
                val escapedName = org.json.JSONObject.quote(safeFile)
                val escapedMime = org.json.JSONObject.quote(safeMime)
                val script = """
                    (function(){
                      fetch($escapedUrl).then(function(r){ return r.blob(); }).then(function(blob){
                        var reader = new FileReader();
                        reader.onloadend = function(){
                          if (window.__nivrokBlob && typeof reader.result === 'string') {
                            window.__nivrokBlob.onBlobReady(reader.result, $escapedName, blob.type || $escapedMime);
                          }
                        };
                        reader.readAsDataURL(blob);
                      }).catch(function(){});
                    })();
                """.trimIndent()
                wv.evaluateJavascript(script, null)
            } else {
                downloadsRepo.startWebDownload(
                    url = url,
                    userAgent = userAgent,
                    contentDisposition = contentDisposition,
                    mimeType = mimetype,
                    contentLength = contentLength
                )
            }
        }

        wv.setFindListener { activeMatchOrdinal, numberOfMatches, _ ->
            onFindUpdated(
                FindMatchState(
                    tabId = tab.id,
                    query = "",
                    activeOrdinal = if (numberOfMatches > 0) activeMatchOrdinal + 1 else 0,
                    totalMatches = numberOfMatches
                )
            )
        }

        wv.setOnLongClickListener { view ->
            val hit = (view as? WebView)?.hitTestResult ?: return@setOnLongClickListener false
            val type = hit.type
            val extra = hit.extra
            when (type) {
                WebView.HitTestResult.SRC_ANCHOR_TYPE,
                WebView.HitTestResult.EMAIL_TYPE -> {
                    val url = if (type == WebView.HitTestResult.EMAIL_TYPE && extra != null && !extra.startsWith("mailto:")) {
                        "mailto:$extra"
                    } else {
                        extra
                    }
                    if (!url.isNullOrBlank()) {
                        onLinkLongPressed(ContextHitPayload(tab.id, url, null, null))
                        return@setOnLongClickListener true
                    }
                }
                WebView.HitTestResult.IMAGE_TYPE -> {
                    if (!extra.isNullOrBlank()) {
                        onLinkLongPressed(ContextHitPayload(tab.id, null, extra, null))
                        return@setOnLongClickListener true
                    }
                }
                WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                    val msg = Message.obtain(
                        Handler(Looper.getMainLooper()) { m ->
                            val data = m.data
                            val link = data.getString("url")
                            val img = data.getString("src") ?: extra
                            val title = data.getString("title")
                            onLinkLongPressed(ContextHitPayload(tab.id, link, img, title))
                            true
                        }
                    )
                    (view as WebView).requestFocusNodeHref(msg)
                    return@setOnLongClickListener true
                }
            }
            false
        }

        val client = BrowserWebViewClient(
            tabId = tab.id,
            adBlockEngine = adBlockEngine,
            telemetry = telemetry,
            isAutoPopupTab = {
                val target = synchronized(tabsLock) { tabs.find { it.id == tab.id } }
                target != null && target.isAutoPopup &&
                    (System.currentTimeMillis() - target.openedAtMs) < 15_000L
            },
            isIncognitoTab = {
                synchronized(tabsLock) { tabs.find { it.id == tab.id }?.incognito } ?: false
            },
            isDesktopMode = {
                synchronized(tabsLock) { tabs.find { it.id == tab.id }?.desktopMode } ?: false
            },
            getTheme = { dataStore.getSettings().theme },
            onExternalSchemeRequested = { uri ->
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                runCatching { context.startActivity(intent) }.isSuccess
            },
            onAutoClosePopupTab = { id, _, _ ->
                wv.post { closePopupAndReturnToOpener(id) }
            },
            onVisitRecorded = { id, visitedUrl, pageTitle, host ->
                val target = synchronized(tabsLock) { tabs.find { it.id == id } }
                if (target != null && !target.isInternalPage && !target.incognito &&
                    !target.isAutoPopup && target.openerTabId == null
                ) {
                    val safeForRec = !adBlockEngine.evaluateNavigation(visitedUrl, null, false).blocked &&
                        !AdBlockEngine.isSuspiciousAdRedirectUrl(visitedUrl.lowercase())
                    dataStore.recordVisit(
                        url = visitedUrl,
                        rawTitle = pageTitle ?: target.title,
                        host = host,
                        allowRecommendation = safeForRec
                    )
                }
            },
            onStateChanged = { id, updatedUrl, loading, canBack, canForward ->
                val target = synchronized(tabsLock) { tabs.find { it.id == id } } ?: return@BrowserWebViewClient
                if (updatedUrl.isNotBlank()) target.url = updatedUrl
                target.isLoading = loading
                target.canGoBack = canBack
                target.canGoForward = canForward
                if (!loading) persistTabsSnapshot()
                onTabsUpdated()
            },
            onRenderProcessGoneCb = { id, didCrash ->
                val target = synchronized(tabsLock) { tabs.find { it.id == id } } ?: return@BrowserWebViewClient
                val msg = if (didCrash) {
                    "WebView renderer crashed; automatically restoring tab."
                } else {
                    "WebView renderer reclaimed by Android memory manager; restoring tab."
                }
                CrashReporter.recordNonFatal(context, "WebViewRenderer", msg)
                wv.post {
                    target.wrapperView?.let { container.removeView(it) }
                    target.webView?.destroy()
                    target.webView = null
                    target.wrapperView = null
                    target.webViewClient = null
                    if (!target.isInternalPage && target.url.startsWith("http")) {
                        loadUrlInTab(target, target.url)
                    } else {
                        target.isLoading = false
                        onTabsUpdated()
                    }
                }
            }
        )
        tab.webViewClient = client
        wv.webViewClient = client

        wv.webChromeClient = BrowserWebChromeClient(
            tabId = tab.id,
            adBlockEngine = adBlockEngine,
            telemetry = telemetry,
            onProgressChangedCb = { id, progress ->
                val target = synchronized(tabsLock) { tabs.find { it.id == id } }
                target?.let { t ->
                    val shouldPush = progress >= 100 || progress <= 15 || abs(progress - t.progress) >= 15
                    t.progress = progress
                    if (progress >= 100) t.isLoading = false
                    if (shouldPush) onTabsUpdated()
                }
            },
            onTitleChangedCb = { id, title ->
                val target = synchronized(tabsLock) { tabs.find { it.id == id } }
                target?.let { t ->
                    t.title = title
                    if (!t.incognito) {
                        dataStore.updateVisitTitle(t.url, title)
                    }
                    persistTabsSnapshot()
                    onTabsUpdated()
                }
            },
            onOpenNewPopupTabCb = { newUrl, openerId ->
                createTab(
                    initialInput = newUrl,
                    makeActive = true,
                    openerTabId = openerId,
                    isAutoPopup = true,
                    incognito = tab.incognito
                )
            },
            onCloseTabCb = { id ->
                closePopupAndReturnToOpener(id)
            },
            onShowFullscreenCb = onShowFullscreen,
            onHideFullscreenCb = onHideFullscreen,
            onShowFileChooserCb = onShowFileChooser,
            onPermissionRequestedCb = onPermissionRequested,
            onGeolocationRequestedCb = onGeolocationRequested
        )

        return wv
    }

    private fun applyUserAgentAndViewport(wv: WebView, desktop: Boolean) {
        val settings = wv.settings
        val defaultUa = runCatching { WebSettings.getDefaultUserAgent(context) }.getOrNull()
            ?: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

        if (desktop) {
            settings.userAgentString = DESKTOP_USER_AGENT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.layoutAlgorithm = WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING
            settings.textZoom = dataStore.getSettings().textZoom
            runCatching { wv.setInitialScale(40) }
            runCatching {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
                    val meta = UserAgentMetadata.Builder()
                        .setMobile(false)
                        .setPlatform("Windows")
                        .setArchitecture("x86")
                        .setBitness(64)
                        .build()
                    WebSettingsCompat.setUserAgentMetadata(settings, meta)
                }
            }
        } else {
            settings.userAgentString = defaultUa.replace("; wv", "")
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.textZoom = dataStore.getSettings().textZoom
            runCatching { wv.setInitialScale(0) }
            runCatching {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
                    val meta = UserAgentMetadata.Builder()
                        .setMobile(true)
                        .setPlatform("Android")
                        .build()
                    WebSettingsCompat.setUserAgentMetadata(settings, meta)
                }
            }
        }
    }

    companion object {
        const val DESKTOP_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

        private val GROUP_COLORS = listOf("#3B82F6", "#F06428", "#10B981", "#8B5CF6", "#EC4899")

        private val ENGINE_TEMPLATES = mapOf(
            "brave" to "https://search.brave.com/search?q=",
            "duckduckgo" to "https://duckduckgo.com/?q=",
            "startpage" to "https://www.startpage.com/do/search?q=",
            "google" to "https://www.google.com/search?q="
        )

        fun normalizeEngine(raw: String?): String {
            val clean = raw?.trim()?.lowercase().orEmpty()
            return if (clean in ENGINE_TEMPLATES) clean else "duckduckgo"
        }

        fun rewriteUrlForMode(url: String, desktop: Boolean): String {
            val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return url
            val host = uri.host?.lowercase() ?: return url
            val newHost = if (desktop) {
                when {
                    host == "m.youtube.com" -> "www.youtube.com"
                    host.startsWith("mobile.") -> "www." + host.removePrefix("mobile.")
                    host.startsWith("m.") && host != "m.me" -> "www." + host.removePrefix("m.")
                    else -> host
                }
            } else {
                when {
                    host == "www.youtube.com" -> "m.youtube.com"
                    else -> host
                }
            }
            if (newHost == host) return url
            return uri.buildUpon().authority(newHost).build().toString()
        }

        fun resolveUserInput(raw: String, engineId: String = "duckduckgo"): String {
            val trimmed = raw.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("nivrok://") || trimmed.startsWith("aegis://")) return "nivrok://home"

            val lower = trimmed.lowercase()
            if (lower.startsWith("http://") || lower.startsWith("https://")) {
                return trimmed
            }

            val looksLikeHost = !trimmed.contains(' ') &&
                (trimmed.contains('.') || lower == "localhost" || lower.startsWith("localhost:"))
            if (looksLikeHost) {
                return if (lower.startsWith("localhost")) "http://$trimmed" else "https://$trimmed"
            }

            val template = ENGINE_TEMPLATES[normalizeEngine(engineId)] ?: ENGINE_TEMPLATES.getValue("duckduckgo")
            val encoded = URLEncoder.encode(trimmed, "UTF-8")
            return "$template$encoded"
        }

        private const val EXIT_READER_SCRIPT = """
            (function(){
              var ov = document.getElementById('__nivrok_reader_overlay');
              if (ov) ov.remove();
            })();
        """

        private fun buildReaderScript(isLight: Boolean): String {
            val bg = if (isLight) "#FBFBF9" else "#12141A"
            val fg = if (isLight) "#1B1F24" else "#E5E7EB"
            val muted = if (isLight) "#57606A" else "#9CA3AF"
            val border = if (isLight) "rgba(0,0,0,0.09)" else "rgba(255,255,255,0.10)"
            return """
                (function(){
                  if (document.getElementById('__nivrok_reader_overlay')) return;
                  var title = document.querySelector('h1')?.innerText || document.title || location.hostname;
                  var container = document.querySelector('article, main, [role="main"]') || document.body;
                  var blocks = Array.from(container.querySelectorAll('h1,h2,h3,p,li,blockquote'))
                    .map(function(el){
                      var txt = (el.innerText || '').trim();
                      if (txt.length < 24 && !/^H[1-3]$/.test(el.tagName)) return '';
                      var tag = el.tagName.toLowerCase();
                      var d = document.createElement('div');
                      d.textContent = txt;
                      return '<' + tag + '>' + d.innerHTML + '</' + tag + '>';
                    })
                    .filter(Boolean)
                    .slice(0, 220)
                    .join('');
                  if (!blocks) {
                    var p = document.createElement('p');
                    p.textContent = (document.body.innerText || '').slice(0, 6000);
                    blocks = p.outerHTML;
                  }
                  var ov = document.createElement('div');
                  ov.id = '__nivrok_reader_overlay';
                  ov.setAttribute('style','position:fixed;inset:0;z-index:2147483647;overflow-y:auto;background:$bg;color:$fg;padding:24px 20px 64px;font-family:Georgia,serif;line-height:1.72;font-size:18px;box-sizing:border-box;');
                  var tNode = document.createElement('div'); tNode.textContent = title;
                  var hNode = document.createElement('div'); hNode.textContent = location.hostname;
                  ov.innerHTML = '<div style="max-width:64ch;margin:0 auto;">'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;margin-bottom:20px;border-bottom:1px solid $border;font-family:system-ui,sans-serif;font-size:13px;color:$muted;">'
                    + '<span>Reader View · ' + hNode.innerHTML + '</span>'
                    + '<button onclick="var e=document.getElementById(this.dataset.target);if(e)e.remove();" data-target="__nivrok_reader_overlay" style="background:transparent;color:$fg;border:1px solid $border;border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer;">Exit Reader</button>'
                    + '</div>'
                    + '<h1 style="font-family:system-ui,sans-serif;font-size:26px;line-height:1.25;margin:0 0 18px;">' + tNode.innerHTML + '</h1>'
                    + '<div>' + blocks + '</div>'
                    + '</div>';
                  document.documentElement.appendChild(ov);
                })();
            """.trimIndent()
        }
    }
}
