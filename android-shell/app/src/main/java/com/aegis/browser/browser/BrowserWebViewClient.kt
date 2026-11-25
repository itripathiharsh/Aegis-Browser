package com.aegis.browser.browser

import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.adblock.BlockCategory
import com.aegis.browser.adblock.BlockedEvent
import com.aegis.browser.adblock.CosmeticInjector
import com.aegis.browser.adblock.ShieldsTelemetry
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicReference

class BrowserWebViewClient(
    private val tabId: String,
    private val adBlockEngine: AdBlockEngine,
    private val telemetry: ShieldsTelemetry,
    private val isAutoPopupTab: () -> Boolean,
    private val onAutoClosePopupTab: (tabId: String, blockedUrl: String, rule: String) -> Unit,
    private val onStateChanged: (tabId: String, url: String, loading: Boolean, canBack: Boolean, canForward: Boolean) -> Unit
) : WebViewClient() {

    private val currentPageUrl = AtomicReference<String?>(null)

    fun updateTrackedUrl(url: String?) {
        currentPageUrl.set(url)
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val req = request ?: return null
        val requestUrl = req.url?.toString() ?: return null
        val accept = req.requestHeaders["Accept"]
        val pageUrl = currentPageUrl.get()

        val decision = adBlockEngine.evaluateRequest(
            requestUrl = requestUrl,
            pageUrl = pageUrl,
            acceptHeader = accept,
            isMainFrame = req.isForMainFrame
        )

        if (!decision.blocked) {
            if (req.isForMainFrame && isAutoPopupTab() &&
                adBlockEngine.isSuspiciousAdRedirect(requestUrl, pageUrl)
            ) {
                logAndMaybeClosePopup(
                    url = requestUrl,
                    pageUrl = pageUrl,
                    rule = "heuristic:popup-redirect",
                    category = BlockCategory.POPUP,
                    closeIfPopup = true
                )
                return buildBlockedResponse(requestUrl, accept, isMainFrame = true)
            }
            return null
        }

        val rule = decision.matchedRule ?: "filter"
        logAndMaybeClosePopup(
            url = requestUrl,
            pageUrl = pageUrl,
            rule = rule,
            category = decision.category,
            closeIfPopup = req.isForMainFrame
        )

        return buildBlockedResponse(requestUrl, accept, isMainFrame = req.isForMainFrame)
    }

    override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest?
    ): Boolean {
        val req = request ?: return false
        val targetUrl = req.url?.toString() ?: return false
        val pageUrl = currentPageUrl.get()

        val decision = adBlockEngine.evaluateNavigation(
            targetUrl = targetUrl,
            currentPageUrl = pageUrl,
            hasUserGesture = req.hasGesture()
        )

        if (decision.blocked) {
            logAndMaybeClosePopup(
                url = targetUrl,
                pageUrl = pageUrl,
                rule = decision.matchedRule ?: "navigation-guard",
                category = BlockCategory.POPUP,
                closeIfPopup = true
            )
            return true
        }

        val lower = targetUrl.lowercase()
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            if (isAutoPopupTab()) {
                logAndMaybeClosePopup(
                    url = targetUrl,
                    pageUrl = pageUrl,
                    rule = "scheme:${lower.substringBefore(':')}",
                    category = BlockCategory.POPUP,
                    closeIfPopup = true
                )
            }
            return true
        }
        return false
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        if (!url.isNullOrBlank()) {
            if (isAutoPopupTab()) {
                val navCheck = adBlockEngine.evaluateNavigation(
                    targetUrl = url,
                    currentPageUrl = null,
                    hasUserGesture = false
                )
                if (navCheck.blocked || AdBlockEngine.isSuspiciousAdRedirectUrl(url.lowercase())) {
                    logAndMaybeClosePopup(
                        url = url,
                        pageUrl = currentPageUrl.get(),
                        rule = navCheck.matchedRule ?: "popup-landed-redirect",
                        category = BlockCategory.POPUP,
                        closeIfPopup = true
                    )
                    return
                }
            }
            currentPageUrl.set(url)
            telemetry.resetTabCount(tabId)
            onStateChanged(
                tabId,
                url,
                true,
                view?.canGoBack() ?: false,
                view?.canGoForward() ?: false
            )
            injectCosmeticAndScriptlets(view, url)
        }
    }

    override fun onPageCommitVisible(view: WebView?, url: String?) {
        super.onPageCommitVisible(view, url)
        if (!url.isNullOrBlank()) {
            injectCosmeticAndScriptlets(view, url)
        }
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        val finalUrl = url ?: currentPageUrl.get() ?: ""
        if (finalUrl.isNotBlank()) {
            currentPageUrl.set(finalUrl)
            injectCosmeticAndScriptlets(view, finalUrl)
        }
        onStateChanged(
            tabId,
            finalUrl,
            false,
            view?.canGoBack() ?: false,
            view?.canGoForward() ?: false
        )
    }

    override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
        super.doUpdateVisitedHistory(view, url, isReload)
        if (!url.isNullOrBlank()) {
            currentPageUrl.set(url)
            onStateChanged(
                tabId,
                url,
                false,
                view?.canGoBack() ?: false,
                view?.canGoForward() ?: false
            )
        }
    }

    private fun logAndMaybeClosePopup(
        url: String,
        pageUrl: String?,
        rule: String,
        category: BlockCategory,
        closeIfPopup: Boolean
    ) {
        val host = AdBlockEngine.extractHost(url) ?: url
        val pageHost = AdBlockEngine.extractHost(pageUrl) ?: ""
        telemetry.recordBlocked(
            tabId = tabId,
            event = BlockedEvent(
                url = url,
                host = host,
                pageHost = pageHost,
                rule = rule,
                category = category,
                timestampMs = System.currentTimeMillis()
            )
        )
        if (closeIfPopup && isAutoPopupTab()) {
            onAutoClosePopupTab(tabId, url, rule)
        }
    }

    private fun injectCosmeticAndScriptlets(view: WebView?, pageUrl: String) {
        if (view == null) return
        val cfg = adBlockEngine.getConfig()
        val host = AdBlockEngine.extractHost(pageUrl)
        if (!cfg.enabled || !cfg.isEnabledForHost(host)) return

        val selectors = if (cfg.cosmeticFiltering) {
            adBlockEngine.getCosmeticSelectorsForHost(host)
        } else {
            emptyList()
        }
        val js = CosmeticInjector.buildInjectionScript(
            selectors = selectors,
            enableAdSkipScriptlet = cfg.blockAdsAndTrackers || cfg.blockPopups
        )
        view.evaluateJavascript(js, null)
    }

    private fun buildBlockedResponse(
        requestUrl: String,
        accept: String?,
        isMainFrame: Boolean
    ): WebResourceResponse {
        val path = requestUrl.lowercase().substringBefore('?').substringBefore('#')
        val headers = mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Cache-Control" to "no-store"
        )

        return when {
            path.endsWith(".js") || path.endsWith(".mjs") ||
                accept?.contains("javascript", ignoreCase = true) == true -> {
                WebResourceResponse(
                    "application/javascript",
                    "utf-8",
                    200,
                    "OK",
                    headers,
                    ByteArrayInputStream("/* blocked by Aegis Shields */".toByteArray())
                )
            }
            path.endsWith(".css") || accept?.contains("text/css", ignoreCase = true) == true -> {
                WebResourceResponse(
                    "text/css",
                    "utf-8",
                    200,
                    "OK",
                    headers,
                    ByteArrayInputStream(ByteArray(0))
                )
            }
            path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg") ||
                path.endsWith(".gif") || path.endsWith(".webp") ||
                accept?.contains("image/", ignoreCase = true) == true -> {
                WebResourceResponse(
                    "image/gif",
                    null,
                    200,
                    "OK",
                    headers,
                    ByteArrayInputStream(TRANSPARENT_GIF_1X1)
                )
            }
            path.endsWith(".json") || accept?.contains("application/json", ignoreCase = true) == true -> {
                WebResourceResponse(
                    "application/json",
                    "utf-8",
                    200,
                    "OK",
                    headers,
                    ByteArrayInputStream("{}".toByteArray())
                )
            }
            path.contains("vast") || path.contains("vmap") || path.endsWith(".xml") -> {
                WebResourceResponse(
                    "application/xml",
                    "utf-8",
                    200,
                    "OK",
                    headers,
                    ByteArrayInputStream("<VAST version=\"3.0\"/>".toByteArray())
                )
            }
            isMainFrame || accept?.contains("text/html", ignoreCase = true) == true -> {
                WebResourceResponse(
                    "text/html",
                    "utf-8",
                    200,
                    "OK",
                    headers,
                    ByteArrayInputStream(
                        "<!doctype html><html><head><style>html,body{margin:0;padding:0;background:#090C10;display:none!important;}</style></head><body></body></html>".toByteArray()
                    )
                )
            }
            else -> {
                WebResourceResponse(
                    "text/plain",
                    "utf-8",
                    204,
                    "No Content",
                    headers,
                    ByteArrayInputStream(ByteArray(0))
                )
            }
        }
    }

    companion object {
        private val TRANSPARENT_GIF_1X1 = byteArrayOf(
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
            0x80.toByte(), 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte(),
            0x21, 0xF9.toByte(), 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B
        )
    }
}
