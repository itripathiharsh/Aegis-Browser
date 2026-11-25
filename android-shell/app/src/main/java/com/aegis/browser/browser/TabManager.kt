package com.aegis.browser.browser

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.adblock.ShieldsTelemetry
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
    val openerTabId: String? = null,
    @Volatile var isAutoPopup: Boolean = false,
    val openedAtMs: Long = 0L,
    var webView: WebView? = null,
    var webViewClient: BrowserWebViewClient? = null
) {
    val isInternalPage: Boolean
        get() = url.startsWith("aegis://")
}

class TabManager(
    private val context: Context,
    private val container: FrameLayout,
    private val adBlockEngine: AdBlockEngine,
    private val telemetry: ShieldsTelemetry,
    private val dataStore: BrowserDataStore,
    private val downloadsRepo: DownloadsRepository,
    private val onTabsUpdated: () -> Unit,
    private val onShowFullscreen: (View, WebChromeClient.CustomViewCallback) -> Unit,
    private val onHideFullscreen: () -> Unit
) {
    private val tabsLock = Any()
    private val tabs = mutableListOf<TabSession>()

    @Volatile
    private var activeTabId: String = ""

    fun getSearchEngine(): String = dataStore.getSettings().searchEngine

    fun ensureInitialTab() {
        val isEmpty = synchronized(tabsLock) { tabs.isEmpty() }
        if (isEmpty) {
            createTab("aegis://home", makeActive = true)
        }
    }

    fun getTabs(): List<TabSession> = synchronized(tabsLock) { tabs.toList() }

    fun getActiveTab(): TabSession? = synchronized(tabsLock) {
        tabs.find { it.id == activeTabId } ?: tabs.firstOrNull()
    }

    fun getActiveTabId(): String = activeTabId

    fun createTab(
        initialInput: String? = null,
        makeActive: Boolean = true,
        openerTabId: String? = null,
        isAutoPopup: Boolean = false
    ): TabSession {
        val id = "tab-" + UUID.randomUUID().toString().take(8)
        val settings = dataStore.getSettings()
        val rawResolved = if (initialInput.isNullOrBlank()) {
            "aegis://home"
        } else {
            resolveUserInput(initialInput, settings.searchEngine)
        }
        val desktop = settings.defaultDesktopMode
        val resolved = if (desktop && !rawResolved.startsWith("aegis://")) {
            rewriteUrlForMode(rawResolved, desktop = true)
        } else {
            rawResolved
        }
        val title = if (resolved == "aegis://home") "Aegis Start" else resolved
        val session = TabSession(
            id = id,
            title = title,
            url = resolved,
            desktopMode = desktop,
            openerTabId = openerTabId,
            isAutoPopup = isAutoPopup,
            openedAtMs = if (isAutoPopup) System.currentTimeMillis() else 0L
        )
        synchronized(tabsLock) {
            tabs.add(session)
        }
        if (makeActive) {
            switchTab(id)
        } else {
            onTabsUpdated()
        }
        if (!session.isInternalPage) {
            loadUrlInTab(session, resolved)
        }
        return session
    }

    fun switchTab(tabId: String) {
        val snapshot = synchronized(tabsLock) {
            val target = tabs.find { it.id == tabId } ?: return
            activeTabId = target.id
            tabs.toList()
        }
        snapshot.forEach { tab ->
            val wv = tab.webView ?: return@forEach
            if (tab.id == activeTabId && !tab.isInternalPage) {
                wv.visibility = View.VISIBLE
                wv.onResume()
            } else {
                wv.visibility = View.GONE
                wv.onPause()
            }
        }
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
        synchronized(tabsLock) {
            val idx = tabs.indexOfFirst { it.id == tabId }
            if (idx < 0) return
            removed = tabs.removeAt(idx)
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

        removed.webView?.let { wv ->
            container.removeView(wv)
            wv.stopLoading()
            wv.destroy()
        }
        telemetry.removeTab(tabId)

        if (nextActiveId == null) {
            createTab("aegis://home", makeActive = true)
            return
        }

        if (nextActiveId != activeTabId) {
            switchTab(nextActiveId)
        } else {
            onTabsUpdated()
        }
    }

    fun navigate(tabId: String, rawInput: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        val rawResolved = resolveUserInput(rawInput, dataStore.getSettings().searchEngine)
        val resolved = if (tab.desktopMode && !rawResolved.startsWith("aegis://")) {
            rewriteUrlForMode(rawResolved, desktop = true)
        } else {
            rawResolved
        }
        tab.isAutoPopup = false
        tab.url = resolved
        if (resolved.startsWith("aegis://")) {
            tab.isLoading = false
            tab.progress = 100
            tab.title = if (resolved.startsWith("aegis://player")) "Aegis Video Player" else "Aegis Start"
            tab.webView?.visibility = View.GONE
            tab.webView?.onPause()
            onTabsUpdated()
            return
        }
        loadUrlInTab(tab, resolved)
    }

    fun goBack(tabId: String): Boolean {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return false
        val wv = tab.webView
        if (!tab.isInternalPage && wv != null && wv.canGoBack()) {
            wv.goBack()
            return true
        }
        if (!tab.isInternalPage) {
            if (tab.openerTabId != null) {
                closePopupAndReturnToOpener(tab.id)
                return true
            }
            navigate(tab.id, "aegis://home")
            return true
        }
        return false
    }

    fun goForward(tabId: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.isAutoPopup = false
        tab.webView?.takeIf { it.canGoForward() }?.goForward()
    }

    fun reload(tabId: String) {
        val tab = synchronized(tabsLock) { tabs.find { it.id == tabId } } ?: getActiveTab() ?: return
        tab.isAutoPopup = false
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

        tab.webView?.let { wv ->
            applyUserAgentAndViewport(wv, desktop)
            if (!tab.isInternalPage) {
                tab.webViewClient?.updateTrackedUrl(targetUrl)
                wv.loadUrl(targetUrl)
            }
        }
        onTabsUpdated()
    }

    fun applyCookiePolicyToAllTabs() {
        val acceptThirdParty = !dataStore.getSettings().blockThirdPartyCookies
        val cm = CookieManager.getInstance()
        getTabs().forEach { tab ->
            tab.webView?.let { wv ->
                cm.setAcceptThirdPartyCookies(wv, acceptThirdParty)
            }
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
        getTabs().forEach { it.webView?.onPause() }
    }

    fun resumeActive() {
        getActiveTab()?.takeIf { !it.isInternalPage }?.webView?.onResume()
    }

    fun destroyAll() {
        val snapshot = synchronized(tabsLock) {
            val copy = tabs.toList()
            tabs.clear()
            copy
        }
        snapshot.forEach { tab ->
            tab.webView?.let { wv ->
                container.removeView(wv)
                wv.destroy()
            }
        }
    }

    private fun loadUrlInTab(tab: TabSession, url: String) {
        val wv = tab.webView ?: createContentWebView(tab).also { created ->
            tab.webView = created
            container.addView(
                created,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
        }

        if (tab.id == activeTabId) {
            wv.visibility = View.VISIBLE
            wv.onResume()
        } else {
            wv.visibility = View.GONE
        }

        tab.isLoading = true
        tab.progress = 10
        tab.webViewClient?.updateTrackedUrl(url)
        wv.loadUrl(url)
        onTabsUpdated()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createContentWebView(tab: TabSession): WebView {
        val wv = WebView(context)
        wv.setBackgroundColor(Color.parseColor("#0B0E14"))
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
        applyUserAgentAndViewport(wv, tab.desktopMode)

        CookieManager.getInstance().setAcceptThirdPartyCookies(
            wv,
            !dataStore.getSettings().blockThirdPartyCookies
        )

        wv.setDownloadListener { url, userAgent, contentDisposition, mimetype, contentLength ->
            downloadsRepo.startWebDownload(
                url = url,
                userAgent = userAgent,
                contentDisposition = contentDisposition,
                mimeType = mimetype,
                contentLength = contentLength
            )
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
            isDesktopMode = {
                synchronized(tabsLock) { tabs.find { it.id == tab.id }?.desktopMode } ?: false
            },
            onAutoClosePopupTab = { id, _, _ ->
                wv.post { closePopupAndReturnToOpener(id) }
            },
            onVisitRecorded = { id, visitedUrl, pageTitle, host ->
                val target = synchronized(tabsLock) { tabs.find { it.id == id } }
                if (target != null && !target.isInternalPage) {
                    dataStore.recordVisit(visitedUrl, pageTitle ?: target.title, host)
                }
            },
            onStateChanged = { id, updatedUrl, loading, canBack, canForward ->
                val target = synchronized(tabsLock) { tabs.find { it.id == id } } ?: return@BrowserWebViewClient
                if (updatedUrl.isNotBlank()) target.url = updatedUrl
                target.isLoading = loading
                target.canGoBack = canBack
                target.canGoForward = canForward
                onTabsUpdated()
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
                    dataStore.updateVisitTitle(t.url, title)
                    onTabsUpdated()
                }
            },
            onOpenNewPopupTabCb = { newUrl, openerId ->
                createTab(
                    initialInput = newUrl,
                    makeActive = true,
                    openerTabId = openerId,
                    isAutoPopup = true
                )
            },
            onCloseTabCb = { id ->
                closePopupAndReturnToOpener(id)
            },
            onShowFullscreenCb = onShowFullscreen,
            onHideFullscreenCb = onHideFullscreen
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
            settings.textZoom = 100
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
            settings.textZoom = 100
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
            if (trimmed.isEmpty()) return "aegis://home"
            if (trimmed.startsWith("aegis://")) return trimmed

            val lower = trimmed.lowercase()
            if (lower.startsWith("http://") || lower.startsWith("https://")) {
                return if (isDirectStreamUrl(lower)) {
                    "aegis://player?src=" + Uri.encode(trimmed)
                } else {
                    trimmed
                }
            }

            val looksLikeHost = !trimmed.contains(' ') &&
                (trimmed.contains('.') || lower == "localhost" || lower.startsWith("localhost:"))
            if (looksLikeHost) {
                val url = if (lower.startsWith("localhost")) "http://$trimmed" else "https://$trimmed"
                return if (isDirectStreamUrl(url.lowercase())) {
                    "aegis://player?src=" + Uri.encode(url)
                } else {
                    url
                }
            }

            val template = ENGINE_TEMPLATES[normalizeEngine(engineId)] ?: ENGINE_TEMPLATES.getValue("duckduckgo")
            val encoded = URLEncoder.encode(trimmed, "UTF-8")
            return "$template$encoded"
        }

        private fun isDirectStreamUrl(lowerUrl: String): Boolean {
            val clean = lowerUrl.substringBefore('?').substringBefore('#')
            return clean.endsWith(".m3u8") || clean.endsWith(".mp4")
        }
    }
}
