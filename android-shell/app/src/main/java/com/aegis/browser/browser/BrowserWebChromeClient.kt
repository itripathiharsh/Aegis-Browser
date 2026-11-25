package com.aegis.browser.browser

import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.adblock.BlockCategory
import com.aegis.browser.adblock.BlockedEvent
import com.aegis.browser.adblock.ShieldsTelemetry
import java.io.ByteArrayInputStream

class BrowserWebChromeClient(
    private val tabId: String,
    private val adBlockEngine: AdBlockEngine,
    private val telemetry: ShieldsTelemetry,
    private val onProgressChangedCb: (tabId: String, progress: Int) -> Unit,
    private val onTitleChangedCb: (tabId: String, title: String) -> Unit,
    private val onOpenNewPopupTabCb: (url: String, openerTabId: String) -> Unit,
    private val onCloseTabCb: (tabId: String) -> Unit,
    private val onShowFullscreenCb: (view: View, callback: CustomViewCallback) -> Unit,
    private val onHideFullscreenCb: () -> Unit,
    private val onShowFileChooserCb: (
        callback: ValueCallback<Array<Uri>>,
        params: FileChooserParams?
    ) -> Boolean,
    private val onPermissionRequestedCb: (PermissionRequest) -> Unit,
    private val onGeolocationRequestedCb: (
        origin: String,
        callback: GeolocationPermissions.Callback
    ) -> Unit
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

    override fun onCloseWindow(window: WebView?) {
        super.onCloseWindow(window)
        onCloseTabCb(tabId)
    }

    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?
    ): Boolean {
        val cb = filePathCallback ?: return false
        return onShowFileChooserCb(cb, fileChooserParams)
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

        val hitType = parentView.hitTestResult.type
        val isExplicitLinkTap = isUserGesture && (
            hitType == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
                hitType == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE
            )

        if (shieldsOn && !isExplicitLinkTap) {
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

        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        val probeWebView = WebView(parentView.context)
        var resolved = false

        val cleanupRunnable = Runnable {
            if (!resolved) {
                resolved = true
                runCatching { probeWebView.destroy() }
            }
        }
        mainHandler.postDelayed(cleanupRunnable, 2500L)

        fun resolveProbeUrl(targetUrl: String?) {
            if (resolved) return
            resolved = true
            mainHandler.removeCallbacks(cleanupRunnable)

            val urlStr = targetUrl?.trim().orEmpty()
            if (urlStr.isEmpty() || urlStr == "about:blank") {
                if (shieldsOn) {
                    telemetry.recordBlocked(
                        tabId = tabId,
                        event = BlockedEvent(
                            url = "about:blank",
                            host = pageHost ?: "popup",
                            pageHost = pageHost ?: "",
                            rule = "popup:blank-blocked",
                            category = BlockCategory.POPUP,
                            timestampMs = System.currentTimeMillis()
                        )
                    )
                }
                runCatching { probeWebView.destroy() }
                return
            }

            val decision = adBlockEngine.evaluateNavigation(
                targetUrl = urlStr,
                currentPageUrl = pageUrl,
                hasUserGesture = isExplicitLinkTap
            )
            if (decision.blocked || (shieldsOn && adBlockEngine.isSuspiciousAdRedirect(urlStr, pageUrl))) {
                val host = AdBlockEngine.extractHost(urlStr) ?: urlStr
                telemetry.recordBlocked(
                    tabId = tabId,
                    event = BlockedEvent(
                        url = urlStr,
                        host = host,
                        pageHost = pageHost ?: "",
                        rule = decision.matchedRule ?: "popup-target-blocked",
                        category = BlockCategory.POPUP,
                        timestampMs = System.currentTimeMillis()
                    )
                )
            } else if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
                onOpenNewPopupTabCb(urlStr, tabId)
            }
            runCatching { probeWebView.destroy() }
        }

        probeWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                w: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                resolveProbeUrl(request?.url?.toString())
                return true
            }

            override fun shouldInterceptRequest(
                w: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val reqUrl = request?.url?.toString()
                if (request?.isForMainFrame == true && !reqUrl.isNullOrBlank()) {
                    mainHandler.post { resolveProbeUrl(reqUrl) }
                    return WebResourceResponse("text/plain", "utf-8", 204, "Aborted", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                return super.shouldInterceptRequest(w, request)
            }

            override fun onPageStarted(w: WebView?, url: String?, favicon: Bitmap?) {
                resolveProbeUrl(url)
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
        val req = request ?: return
        val resources = req.resources ?: emptyArray()
        if (resources.size == 1 && resources[0] == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID) {
            req.grant(resources)
            return
        }
        onPermissionRequestedCb(req)
    }

    override fun onGeolocationPermissionsShowPrompt(
        origin: String?,
        callback: GeolocationPermissions.Callback?
    ) {
        if (origin.isNullOrBlank() || callback == null) {
            callback?.invoke(origin, false, false)
            return
        }
        onGeolocationRequestedCb(origin, callback)
    }
}
