package com.aegis.browser.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import com.aegis.browser.adblock.AdBlockEngine
import com.aegis.browser.adblock.FilterListUpdater
import com.aegis.browser.adblock.ShieldsConfig
import com.aegis.browser.adblock.ShieldsTelemetry
import com.aegis.browser.bridge.NativeBridge
import com.aegis.browser.browser.TabManager
import com.aegis.browser.updater.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray

class MainActivity : AppCompatActivity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var rootFrame: FrameLayout
    private lateinit var browserStack: LinearLayout
    private lateinit var chromeUiWebView: WebView
    private lateinit var contentContainer: FrameLayout
    private lateinit var fullscreenVideoContainer: FrameLayout

    private lateinit var adBlockEngine: AdBlockEngine
    private lateinit var filterUpdater: FilterListUpdater
    private lateinit var telemetry: ShieldsTelemetry
    private lateinit var appUpdater: AppUpdater
    private lateinit var tabManager: TabManager
    private lateinit var nativeBridge: NativeBridge

    private var customVideoView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private var overlayExpanded: Boolean = true
    private var lastBarHeightPx: Int = 0
    private var uiReady: Boolean = false
    private var pushScheduled: Boolean = false

    private val pushRunnable = Runnable {
        pushScheduled = false
        pushStateToUiImmediate()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, true)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.parseColor("#0B0E14")
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.parseColor("#0B0E14")
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        lastBarHeightPx = dpToPx(56)

        adBlockEngine = AdBlockEngine()
        adBlockEngine.updateConfig(loadShieldsConfig())
        filterUpdater = FilterListUpdater(applicationContext, adBlockEngine)
        adBlockEngine.loadFromContext(applicationContext, filterUpdater.getLastUpdatedIso())

        telemetry = ShieldsTelemetry {
            scheduleStatePush()
        }

        appUpdater = AppUpdater(
            context = this,
            scope = scope,
            onStateChanged = {
                runOnUiThread {
                    updateViewportSplit()
                    if (appUpdater.getState().status == "downloading") {
                        pushStateToUiImmediate()
                    } else {
                        scheduleStatePush()
                    }
                }
            }
        )

        rootFrame = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0B0E14"))
        }

        browserStack = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0E14"))
        }

        chromeUiWebView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0E14"))
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isFocusable = true
            isFocusableInTouchMode = true
        }

        contentContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0B0E14"))
            visibility = View.GONE
        }

        fullscreenVideoContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
        }

        browserStack.addView(
            chromeUiWebView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        browserStack.addView(
            contentContainer,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        rootFrame.addView(
            browserStack,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        rootFrame.addView(
            fullscreenVideoContainer,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        setContentView(rootFrame)

        ViewCompat.setOnApplyWindowInsetsListener(rootFrame) { v, insets ->
            val sysBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            v.setPadding(sysBars.left, sysBars.top, sysBars.right, sysBars.bottom)
            insets
        }

        tabManager = TabManager(
            context = this,
            container = contentContainer,
            adBlockEngine = adBlockEngine,
            telemetry = telemetry,
            initialSearchEngine = loadSearchEngine(),
            onTabsUpdated = {
                updateViewportSplit()
                scheduleStatePush()
            },
            onShowFullscreen = { view, callback ->
                enterFullscreenVideo(view, callback)
            },
            onHideFullscreen = {
                exitFullscreenVideo()
            }
        )

        nativeBridge = NativeBridge(
            runOnUi = { block -> runOnUiThread(block) },
            scope = scope,
            tabManager = tabManager,
            adBlockEngine = adBlockEngine,
            filterUpdater = filterUpdater,
            telemetry = telemetry,
            appUpdater = appUpdater,
            saveShieldsConfig = { cfg -> persistShieldsConfig(cfg) },
            saveSearchEngine = { eng -> persistSearchEngine(eng) },
            onLayoutModeChanged = { expanded, barHeightPx ->
                overlayExpanded = expanded
                if (barHeightPx in dpToPx(44)..dpToPx(240)) {
                    lastBarHeightPx = barHeightPx
                }
                updateViewportSplit()
            },
            onPushStateToUi = { scheduleStatePush() },
            onFilterSyncCompleted = { syncJson ->
                if (uiReady) {
                    val safeSync = syncJson.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
                    chromeUiWebView.evaluateJavascript(
                        "window.__AEGIS_ON_SYNC__ && window.__AEGIS_ON_SYNC__($safeSync);",
                        null
                    )
                }
            }
        )

        tabManager.ensureInitialTab()
        configureChromeUiWebView()
        handleIncomingIntent(intent)
        updateViewportSplit()

        // Silent background release check + 24h automatic upstream filter sync
        scope.launch {
            delay(1500L)
            appUpdater.checkForUpdates(manual = false)
            delay(1500L)
            val syncResult = filterUpdater.syncIfStale(24L * 3600_000L)
            if (syncResult != null && syncResult.syncedSources > 0) {
                scheduleStatePush()
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customVideoView != null) {
                    exitFullscreenVideo()
                    return
                }
                if (appUpdater.getState().popupVisible) {
                    appUpdater.dismissModal()
                    return
                }
                if (overlayExpanded && tabManager.getActiveTab()?.isInternalPage == false) {
                    chromeUiWebView.evaluateJavascript(
                        "window.__AEGIS_CLOSE_OVERLAY__ && window.__AEGIS_CLOSE_OVERLAY__();",
                        null
                    )
                    return
                }
                val activeId = tabManager.getActiveTabId()
                if (tabManager.goBack(activeId)) {
                    return
                }
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        })
    }

    internal fun getNativeBridgeForTesting(): NativeBridge = nativeBridge

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureChromeUiWebView() {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        chromeUiWebView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        chromeUiWebView.addJavascriptInterface(nativeBridge, "AegisNative")

        chromeUiWebView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                uiReady = true
                pushStateToUiImmediate()
            }
        }

        chromeUiWebView.loadUrl("https://appassets.androidplatform.net/assets/ui/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        val dataUrl = intent?.dataString ?: return
        if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) {
            tabManager.createTab(dataUrl, makeActive = true)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SEARCH, KeyEvent.KEYCODE_BOOKMARK -> {
                    chromeUiWebView.requestFocus()
                    chromeUiWebView.evaluateJavascript(
                        "window.__AEGIS_FOCUS_OMNIBOX__ && window.__AEGIS_FOCUS_OMNIBOX__();",
                        null
                    )
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun updateViewportSplit() {
        if (!::tabManager.isInitialized ||
            !::chromeUiWebView.isInitialized ||
            !::contentContainer.isInitialized ||
            !::appUpdater.isInitialized
        ) {
            return
        }

        val activeIsInternal = tabManager.getActiveTab()?.isInternalPage ?: true
        val expandChrome = overlayExpanded || activeIsInternal || appUpdater.getState().popupVisible

        val chromeLp = chromeUiWebView.layoutParams as LinearLayout.LayoutParams
        if (expandChrome) {
            if (chromeLp.height != ViewGroup.LayoutParams.MATCH_PARENT) {
                chromeLp.height = ViewGroup.LayoutParams.MATCH_PARENT
                chromeUiWebView.layoutParams = chromeLp
            }
            if (contentContainer.visibility != View.GONE) {
                contentContainer.visibility = View.GONE
            }
        } else {
            val targetH = lastBarHeightPx.coerceAtLeast(dpToPx(48))
            if (chromeLp.height != targetH) {
                chromeLp.height = targetH
                chromeUiWebView.layoutParams = chromeLp
            }
            if (contentContainer.visibility != View.VISIBLE) {
                contentContainer.visibility = View.VISIBLE
            }
        }
    }

    private fun enterFullscreenVideo(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customVideoView != null) {
            callback.onCustomViewHidden()
            return
        }
        customVideoView = view
        customViewCallback = callback
        browserStack.visibility = View.GONE
        fullscreenVideoContainer.visibility = View.VISIBLE
        fullscreenVideoContainer.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        WindowInsetsControllerCompat(window, rootFrame).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun exitFullscreenVideo() {
        val view = customVideoView ?: return
        fullscreenVideoContainer.removeView(view)
        fullscreenVideoContainer.visibility = View.GONE
        browserStack.visibility = View.VISIBLE
        customVideoView = null
        runCatching { customViewCallback?.onCustomViewHidden() }
        customViewCallback = null
        WindowInsetsControllerCompat(window, rootFrame).show(WindowInsetsCompat.Type.systemBars())
    }

    private fun scheduleStatePush() {
        if (!uiReady || pushScheduled) return
        pushScheduled = true
        mainHandler.postDelayed(pushRunnable, 120L)
    }

    private fun pushStateToUiImmediate() {
        if (!uiReady || !::nativeBridge.isInitialized || !::chromeUiWebView.isInitialized) return
        val json = nativeBridge.buildStateJson().toString()
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029")
        chromeUiWebView.evaluateJavascript(
            "window.__AEGIS_ON_STATE__ && window.__AEGIS_ON_STATE__($json);",
            null
        )
    }

    private fun loadSearchEngine(): String =
        getSharedPreferences("aegis_shields", MODE_PRIVATE)
            .getString("search_engine", "duckduckgo") ?: "duckduckgo"

    private fun persistSearchEngine(engineId: String) {
        getSharedPreferences("aegis_shields", MODE_PRIVATE)
            .edit()
            .putString("search_engine", engineId)
            .apply()
    }

    private fun loadShieldsConfig(): ShieldsConfig {
        val prefs = getSharedPreferences("aegis_shields", MODE_PRIVATE)
        val rawHosts = prefs.getString("disabled_hosts", "[]") ?: "[]"
        val disabled = mutableSetOf<String>()
        runCatching {
            val arr = JSONArray(rawHosts)
            for (i in 0 until arr.length()) {
                val h = arr.optString(i).trim().lowercase()
                if (h.isNotEmpty()) disabled.add(h)
            }
        }
        return ShieldsConfig(
            enabled = prefs.getBoolean("enabled", true),
            blockAdsAndTrackers = prefs.getBoolean("block_ads_trackers", true),
            blockPopups = prefs.getBoolean("block_popups", true),
            cosmeticFiltering = prefs.getBoolean("cosmetic_filtering", true),
            disabledHosts = disabled
        )
    }

    private fun persistShieldsConfig(cfg: ShieldsConfig) {
        val arr = JSONArray().apply { cfg.disabledHosts.forEach { put(it) } }
        getSharedPreferences("aegis_shields", MODE_PRIVATE)
            .edit()
            .putBoolean("enabled", cfg.enabled)
            .putBoolean("block_ads_trackers", cfg.blockAdsAndTrackers)
            .putBoolean("block_popups", cfg.blockPopups)
            .putBoolean("cosmetic_filtering", cfg.cosmeticFiltering)
            .putString("disabled_hosts", arr.toString())
            .apply()
    }

    private fun dpToPx(dp: Int): Int =
        (dp * resources.displayMetrics.density).toInt()

    override fun onPause() {
        super.onPause()
        if (::tabManager.isInitialized) tabManager.pauseAll()
        if (::chromeUiWebView.isInitialized) chromeUiWebView.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::chromeUiWebView.isInitialized) chromeUiWebView.onResume()
        if (::tabManager.isInitialized) tabManager.resumeActive()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(pushRunnable)
        scope.cancel()
        if (::tabManager.isInitialized) tabManager.destroyAll()
        if (::chromeUiWebView.isInitialized) chromeUiWebView.destroy()
        super.onDestroy()
    }
}
