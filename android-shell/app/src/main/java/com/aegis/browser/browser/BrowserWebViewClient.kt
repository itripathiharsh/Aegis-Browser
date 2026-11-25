package com.aegis.browser.browser

import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.text.TextUtils
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
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
    private val isIncognitoTab: () -> Boolean,
    private val isDesktopMode: () -> Boolean,
    private val getTheme: () -> String,
    private val onExternalSchemeRequested: (Uri) -> Boolean,
    private val onAutoClosePopupTab: (tabId: String, blockedUrl: String, rule: String) -> Unit,
    private val onVisitRecorded: (tabId: String, url: String, title: String?, host: String?) -> Unit,
    private val onStateChanged: (tabId: String, url: String, loading: Boolean, canBack: Boolean, canForward: Boolean) -> Unit,
    private val onRenderProcessGoneCb: (tabId: String, didCrash: Boolean) -> Unit = { _, _ -> }
) : WebViewClient() {

    private val currentPageUrl = AtomicReference<String?>(null)
    private val currentPageHost = AtomicReference<String?>(null)

    fun updateTrackedUrl(url: String?) {
        currentPageUrl.set(url)
        currentPageHost.set(AdBlockEngine.extractHost(url))
    }

    override fun onRenderProcessGone(
        view: WebView?,
        detail: RenderProcessGoneDetail?
    ): Boolean {
        val crashed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            detail?.didCrash() ?: true
        } else {
            true
        }
        onRenderProcessGoneCb(tabId, crashed)
        return true
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
                    pageHost = currentPageHost.get(),
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
            pageHost = currentPageHost.get(),
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
        val uri = req.url ?: return false
        val targetUrl = uri.toString()
        val pageUrl = currentPageUrl.get()

        val decision = adBlockEngine.evaluateNavigation(
            targetUrl = targetUrl,
            currentPageUrl = pageUrl,
            hasUserGesture = req.hasGesture()
        )

        if (decision.blocked) {
            logAndMaybeClosePopup(
                url = targetUrl,
                pageHost = currentPageHost.get(),
                rule = decision.matchedRule ?: "navigation-guard",
                category = BlockCategory.POPUP,
                closeIfPopup = true
            )
            return true
        }

        val lower = targetUrl.lowercase()
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            if (!isAutoPopupTab() && req.hasGesture() && isAllowedExternalScheme(lower)) {
                return onExternalSchemeRequested(uri)
            }
            if (isAutoPopupTab()) {
                logAndMaybeClosePopup(
                    url = targetUrl,
                    pageHost = currentPageHost.get(),
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
            if (url.startsWith("data:text/html")) return
            if (isAutoPopupTab()) {
                val navCheck = adBlockEngine.evaluateNavigation(
                    targetUrl = url,
                    currentPageUrl = null,
                    hasUserGesture = false
                )
                if (navCheck.blocked || AdBlockEngine.isSuspiciousAdRedirectUrl(url.lowercase())) {
                    logAndMaybeClosePopup(
                        url = url,
                        pageHost = currentPageHost.get(),
                        rule = navCheck.matchedRule ?: "popup-landed-redirect",
                        category = BlockCategory.POPUP,
                        closeIfPopup = true
                    )
                    return
                }
            }
            updateTrackedUrl(url)
            telemetry.resetTabCount(tabId)
            onStateChanged(
                tabId,
                url,
                true,
                view?.canGoBack() ?: false,
                view?.canGoForward() ?: false
            )
            injectPageHelpers(view, url)
        }
    }

    override fun onPageCommitVisible(view: WebView?, url: String?) {
        super.onPageCommitVisible(view, url)
        if (!url.isNullOrBlank() && !url.startsWith("data:text/html")) {
            updateTrackedUrl(url)
            injectPageHelpers(view, url)
        }
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        val finalUrl = url ?: currentPageUrl.get() ?: ""
        if (finalUrl.startsWith("data:text/html")) {
            onStateChanged(
                tabId,
                currentPageUrl.get() ?: "",
                false,
                view?.canGoBack() ?: false,
                view?.canGoForward() ?: false
            )
            return
        }
        if (finalUrl.isNotBlank()) {
            updateTrackedUrl(finalUrl)
            injectPageHelpers(view, finalUrl)
            if (!isIncognitoTab() &&
                !isAutoPopupTab() &&
                !AdBlockEngine.isSuspiciousAdRedirectUrl(finalUrl.lowercase()) &&
                !adBlockEngine.evaluateNavigation(finalUrl, null, false).blocked
            ) {
                onVisitRecorded(tabId, finalUrl, view?.title, currentPageHost.get())
            }
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
        if (!url.isNullOrBlank() && !url.startsWith("data:text/html")) {
            updateTrackedUrl(url)
            onStateChanged(
                tabId,
                url,
                false,
                view?.canGoBack() ?: false,
                view?.canGoForward() ?: false
            )
        }
    }

    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        super.onReceivedError(view, request, error)
        if (view == null || request == null || !request.isForMainFrame) return
        val code = error?.errorCode ?: return
        // Ignore intentionally aborted loads / cancelled requests
        if (code == ERROR_UNKNOWN || error.description?.toString()?.contains("ERR_ABORTED", ignoreCase = true) == true) return
        val failingUrl = request.url?.toString() ?: currentPageUrl.get() ?: return
        val desc = error.description?.toString().orEmpty().ifBlank { "Unable to reach server" }
        val isOffline = code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_TIMEOUT
        val html = buildErrorHtml(
            title = if (isOffline) "You appear to be offline" else "Page couldn't be loaded",
            subtitle = "Aegis Browser could not load ${TextUtils.htmlEncode(AdBlockEngine.extractHost(failingUrl) ?: failingUrl)}.",
            detail = TextUtils.htmlEncode(desc),
            retryUrl = TextUtils.htmlEncode(failingUrl),
            isWarning = false,
            isLight = getTheme() == "light"
        )
        view.loadDataWithBaseURL(failingUrl, html, "text/html", "utf-8", failingUrl)
    }

    override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler?,
        error: SslError?
    ) {
        // Never silently proceed on broken SSL certificates
        handler?.cancel()
        if (view == null) return
        val badUrl = error?.url ?: currentPageUrl.get() ?: "this site"
        val host = AdBlockEngine.extractHost(badUrl) ?: badUrl
        val html = buildErrorHtml(
            title = "Your connection is not private",
            subtitle = "Aegis blocked ${TextUtils.htmlEncode(host)} because its security certificate is invalid or expired.",
            detail = "Attackers might be trying to intercept information from this site.",
            retryUrl = TextUtils.htmlEncode(badUrl),
            isWarning = true,
            isLight = getTheme() == "light"
        )
        view.loadDataWithBaseURL(badUrl, html, "text/html", "utf-8", badUrl)
    }

    private fun logAndMaybeClosePopup(
        url: String,
        pageHost: String?,
        rule: String,
        category: BlockCategory,
        closeIfPopup: Boolean
    ) {
        val host = AdBlockEngine.extractHost(url) ?: url
        telemetry.recordBlocked(
            tabId = tabId,
            event = BlockedEvent(
                url = url,
                host = host,
                pageHost = pageHost ?: "",
                rule = rule,
                category = category,
                timestampMs = System.currentTimeMillis()
            )
        )
        if (closeIfPopup && isAutoPopupTab()) {
            onAutoClosePopupTab(tabId, url, rule)
        }
    }

    private fun injectPageHelpers(view: WebView?, pageUrl: String) {
        if (view == null) return
        if (isDesktopMode()) {
            view.evaluateJavascript(DESKTOP_VIEWPORT_SCRIPT, null)
        }

        val cfg = adBlockEngine.getConfig()
        val host = currentPageHost.get() ?: AdBlockEngine.extractHost(pageUrl)
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
                        "<!doctype html><html><head><style>html,body{margin:0;padding:0;background:#0F1115;display:none!important;}</style></head><body></body></html>".toByteArray()
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
        private val USER_EXTERNAL_SCHEMES = listOf("mailto:", "tel:", "sms:", "geo:")

        private fun isAllowedExternalScheme(lowerUrl: String): Boolean =
            USER_EXTERNAL_SCHEMES.any { lowerUrl.startsWith(it) }

        private fun buildErrorHtml(
            title: String,
            subtitle: String,
            detail: String,
            retryUrl: String,
            isWarning: Boolean,
            isLight: Boolean
        ): String {
            val bg = if (isLight) "#F5F6F8" else "#0F1115"
            val surface = if (isLight) "#FFFFFF" else "#161A22"
            val border = if (isLight) "rgba(15,23,42,0.10)" else "rgba(255,255,255,0.10)"
            val text = if (isLight) "#111827" else "#F3F4F6"
            val muted = if (isLight) "#4B5563" else "#9CA3AF"
            val accent = if (isWarning) "#DC2626" else "#F06428"
            return """
                <!doctype html>
                <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
                <style>
                  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:$bg;color:$text;font-family:system-ui,-apple-system,sans-serif;box-sizing:border-box}
                  .card{max-width:400px;width:100%;padding:24px;border-radius:16px;background:$surface;border:1px solid $border}
                  .badge{display:inline-flex;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;color:$accent;background:rgba(240,100,40,0.12);margin-bottom:12px}
                  h1{margin:0 0 8px;font-size:20px;line-height:1.25}
                  p{margin:0 0 12px;font-size:14px;line-height:1.5;color:$muted}
                  .detail{font-family:monospace;font-size:12px;word-break:break-word;margin-bottom:18px}
                  .actions{display:flex;gap:10px;flex-wrap:wrap}
                  button{min-height:42px;padding:0 16px;border-radius:10px;border:0;font-weight:600;font-size:14px;cursor:pointer}
                  .primary{background:$accent;color:#fff}
                  .secondary{background:transparent;color:$text;border:1px solid $border}
                </style></head>
                <body><div class="card">
                  <div class="badge">${if (isWarning) "Security Warning" else "Connection Issue"}</div>
                  <h1>$title</h1>
                  <p>$subtitle</p>
                  <p class="detail">$detail</p>
                  <div class="actions">
                    ${if (!isWarning) "<button class=\"primary\" onclick=\"location.href='$retryUrl'\">Try Again</button>" else "<button class=\"primary\" onclick=\"history.back()\">Go Back Safely</button>"}
                    <button class="secondary" onclick="history.back()">Back</button>
                  </div>
                </div></body></html>
            """.trimIndent()
        }

        private const val DESKTOP_VIEWPORT_SCRIPT = """
            (function(){
              try {
                var head = document.head || document.documentElement;
                if (!head) return;
                var m = document.querySelector('meta[name="viewport"]');
                if (!m) {
                  m = document.createElement('meta');
                  m.name = 'viewport';
                  head.appendChild(m);
                }
                m.setAttribute('content', 'width=1180, user-scalable=yes');
              } catch(_) {}
            })();
        """

        private val TRANSPARENT_GIF_1X1 = byteArrayOf(
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
            0x80.toByte(), 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte(),
            0x21, 0xF9.toByte(), 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B
        )
    }
}
