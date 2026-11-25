package com.aegis.browser.browser

import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.adblock.BlockCategory
import com.aegis.browser.adblock.BlockedEvent
import com.aegis.browser.adblock.ShieldsTelemetry

class BrowserWebChromeClient(
    private val tabId: String,
    private val adBlockEngine: AdBlockEngine,
    private val telemetry: ShieldsTelemetry,
    private val onProgressChangedCb: (tabId: String, progress: Int) -> Unit,
    private val onTitleChangedCb: (tabId: String, title: String) -> Unit,
    private val onOpenNewTabCb: (url: String) -> Unit,
    private val onShowFullscreenCb: (view: View, callback: CustomViewCallback) -> Unit,
    private val onHideFullscreenCb: () -> Unit
) : WebChromeClient() {

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onProgressChanged(view: WebView?, newProgress: Int) {
        super.onProgressChanged(view, newProgress)
        onProgressChangedCb(tabId, newProgress)
    }

    override fun onReceivedTitle(view: WebView?, title: String?) {
        super.onReceivedTitle(view, title)
        if (!title.isNullOrBlank()) {
            onTitleChangedCb(tabId, title)
        }
    }

    override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?
    ): Boolean {
        val parentView = view ?: return false
        val pageUrl = parentView.url
        val pageHost = AdBlockEngine.extractHost(pageUrl)
        val cfg = adBlockEngine.getConfig()
        val shieldsOn = cfg.enabled && cfg.blockPopups && cfg.isEnabledForHost(pageHost)

        if (shieldsOn) {
            // Block programmatic pop-unders and body-click hijack windows
            val hitType = parentView.hitTestResult.type
            val isExplicitLinkTap = isUserGesture && (
                hitType == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
                    hitType == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE
                )
            if (!isExplicitLinkTap) {
                telemetry.recordBlocked(
                    tabId = tabId,
                    event = BlockedEvent(
                        url = pageUrl ?: "window.open",
                        host = pageHost ?: "popup",
                        pageHost = pageHost ?: "",
                        rule = "onCreateWindow:popunder-blocked",
                        category = BlockCategory.POPUP,
                        timestampMs = System.currentTimeMillis()
                    )
                )
                return false
            }
        }

        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        val probeWebView = WebView(parentView.context)
        var resolved = false

        val cleanupRunnable = Runnable {
            if (!resolved) {
                resolved = true
                runCatching { probeWebView.destroy() }
            }
        }
        mainHandler.postDelayed(cleanupRunnable, 3000L)

        probeWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                w: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val targetUrl = request?.url?.toString() ?: return true
                if (!resolved) {
                    resolved = true
                    mainHandler.removeCallbacks(cleanupRunnable)

                    val decision = adBlockEngine.evaluateNavigation(
                        targetUrl = targetUrl,
                        currentPageUrl = pageUrl,
                        hasUserGesture = true
                    )
                    if (decision.blocked) {
                        val host = AdBlockEngine.extractHost(targetUrl) ?: targetUrl
                        telemetry.recordBlocked(
                            tabId = tabId,
                            event = BlockedEvent(
                                url = targetUrl,
                                host = host,
                                pageHost = pageHost ?: "",
                                rule = decision.matchedRule ?: "popup-target-blocked",
                                category = BlockCategory.POPUP,
                                timestampMs = System.currentTimeMillis()
                            )
                        )
                    } else if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
                        onOpenNewTabCb(targetUrl)
                    }
                    runCatching { probeWebView.destroy() }
                }
                return true
            }
        }

        transport.webView = probeWebView
        resultMsg.sendToTarget()
        return true
    }

    override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
        if (view != null && callback != null) {
            onShowFullscreenCb(view, callback)
        } else {
            super.onShowCustomView(view, callback)
        }
    }

    override fun onHideCustomView() {
        onHideFullscreenCb()
    }

    override fun onPermissionRequest(request: PermissionRequest?) {
        // Deny unsolicited intrusive web permissions (notifications, MIDI, protected media prompts unless needed)
        val resources = request?.resources ?: return
        val allowed = resources.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }.toTypedArray()
        if (allowed.isNotEmpty()) {
            request.grant(allowed)
        } else {
            request.deny()
        }
    }
}
