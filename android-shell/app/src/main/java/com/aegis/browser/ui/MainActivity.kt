package com.aegis.browser.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
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
import com.aegis.browser.bridge.PendingPermissionUi
import com.aegis.browser.browser.BrowserDataStore
import com.aegis.browser.browser.DownloadsRepository
import com.aegis.browser.browser.TabManager
import com.aegis.browser.diagnostics.CrashReporter
import com.aegis.browser.updater.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val initialFiltersLatch = CountDownLatch(1)

    private lateinit var rootFrame: FrameLayout
    private lateinit var browserStack: LinearLayout
    private lateinit var chromeUiWebView: WebView
    private lateinit var contentContainer: FrameLayout
    private lateinit var fullscreenVideoContainer: FrameLayout

    private lateinit var adBlockEngine: AdBlockEngine
    private lateinit var filterUpdater: FilterListUpdater
    private lateinit var telemetry: ShieldsTelemetry
    private lateinit var appUpdater: AppUpdater
    private lateinit var dataStore: BrowserDataStore
    private lateinit var downloadsRepo: DownloadsRepository
    private lateinit var tabManager: TabManager
    private lateinit var nativeBridge: NativeBridge

    private var customVideoView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPromptId: String? = null
    private var pendingWebPermission: PermissionRequest? = null
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null

    private var overlayExpanded: Boolean = true
    private var lastBarHeightPx: Int = 0
    private var uiReady: Boolean = false
    private var pushScheduled: Boolean = false
    private var askedPostNotifForUpdate: Boolean = false

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val cb = pendingFileCallback
        pendingFileCallback = null
        if (cb != null) {
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            val fallbackClip = if (uris == null && result.resultCode == RESULT_OK) {
                extractClipUris(result.data)
            } else {
                uris
            }
            cb.onReceiveValue(fallbackClip)
        }
    }

    private val runtimePermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val allGranted = grants.values.all { it }
        finishPendingSitePermission(allow = allGranted)
    }

    private val updateNotificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        if (::appUpdater.isInitialized) {
            appUpdater.startDownloadAndInstall()
        }
    }

    private val pushRunnable = Runnable {
        pushScheduled = false
        pushStateToUiImmediate()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashReporter.install(applicationContext)
        CrashReporter.checkAndRecordVersionBoot(applicationContext)

        WindowCompat.setDecorFitsSystemWindows(window, true)

        lastBarHeightPx = dpToPx(54)

        adBlockEngine = AdBlockEngine()
        adBlockEngine.updateConfig(loadShieldsConfig())
        filterUpdater = FilterListUpdater(applicationContext, adBlockEngine)
        dataStore = BrowserDataStore(applicationContext)
        val initialTheme = dataStore.getSettings().theme
        val initialBg = Color.parseColor(if (initialTheme == "light") "#F5F6F8" else "#0F1115")

        @Suppress("DEPRECATION")
        window.statusBarColor = initialBg
        @Suppress("DEPRECATION")
        window.navigationBarColor = initialBg
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = initialTheme == "light"
            isAppearanceLightNavigationBars = initialTheme == "light"
        }

        // Compile 52,000+ bundled rules off the main thread so cold launch feels instant
        scope.launch {
            withContext(Dispatchers.IO) {
                try {
                    adBlockEngine.loadFromContext(applicationContext, filterUpdater.getLastUpdatedIso())
                } finally {
                    initialFiltersLatch.countDown()
                }
            }
            scheduleStatePush()
        }

        telemetry = ShieldsTelemetry {
            scheduleStatePush()
        }

        downloadsRepo = DownloadsRepository(
            context = applicationContext,
            scope = scope,
            onChanged = { scheduleStatePush() }
        )

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
            setBackgroundColor(initialBg)
        }

        browserStack = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(initialBg)
        }

        chromeUiWebView = WebView(this).apply {
            setBackgroundColor(initialBg)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isFocusable = true
            isFocusableInTouchMode = true
        }

        contentContainer = FrameLayout(this).apply {
            setBackgroundColor(initialBg)
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
            dataStore = dataStore,
            downloadsRepo = downloadsRepo,
            onTabsUpdated = {
                updateViewportSplit()
                scheduleStatePush()
            },
            onShowFullscreen = { view, callback ->
                enterFullscreenVideo(view, callback)
            },
            onHideFullscreen = {
                exitFullscreenVideo()
            },
            onShowFileChooser = { callback, params ->
                launchWebFileChooser(callback, params)
            },
            onPermissionRequested = { request ->
                handleWebPermissionRequest(request)
            },
            onGeolocationRequested = { origin, callback ->
                handleGeolocationRequest(origin, callback)
            },
            onLinkLongPressed = { payload ->
                nativeBridge.setPendingContextMenu(payload)
            },
            onFindUpdated = { findState ->
                nativeBridge.updateFindMatches(findState)
            }
        )

        nativeBridge = NativeBridge(
            context = this,
            runOnUi = { block -> runOnUiThread(block) },
            scope = scope,
            tabManager = tabManager,
            adBlockEngine = adBlockEngine,
            filterUpdater = filterUpdater,
            telemetry = telemetry,
            appUpdater = appUpdater,
            dataStore = dataStore,
            downloadsRepo = downloadsRepo,
            saveShieldsConfig = { cfg -> persistShieldsConfig(cfg) },
            onLayoutModeChanged = { expanded, barHeightPx ->
                overlayExpanded = expanded
                if (barHeightPx in dpToPx(44)..dpToPx(320)) {
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
            },
            onThemeChanged = { theme ->
                applySystemTheme(theme)
            },
            onRespondSitePermission = { id, allow ->
                handlePermissionPromptDecision(id, allow)
            },
            onStartUpdateRequested = {
                handleStartUpdateRequested()
            }
        )

        applySystemTheme(dataStore.getSettings().theme)
        tabManager.ensureInitialTab()
        configureChromeUiWebView()
        handleIncomingIntent(intent)
        updateViewportSplit()

        // Silent background release check + 24h automatic upstream filter sync
        scope.launch {
            delay(1500L)
            appUpdater.checkForUpdates(manual = false)
            delay(2000L)
            if (dataStore.getSettings().autoSyncFilters) {
                val syncResult = filterUpdater.syncIfStale(24L * 3600_000L)
                if (syncResult != null && syncResult.syncedSources > 0) {
                    scheduleStatePush()
                }
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

    internal fun awaitInitialFiltersForTesting(timeoutMs: Long = 5000L): Boolean =
        initialFiltersLatch.await(timeoutMs, TimeUnit.MILLISECONDS)

    private fun launchWebFileChooser(
        callback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams?
    ): Boolean {
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = callback

        val baseIntent = runCatching { params?.createIntent() }.getOrNull()
            ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }
        if (params?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            baseIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        val launched = runCatching {
            fileChooserLauncher.launch(Intent.createChooser(baseIntent, "Select file"))
        }.isSuccess
        if (!launched) {
            pendingFileCallback?.onReceiveValue(null)
            pendingFileCallback = null
        }
        return launched
    }

    private fun extractClipUris(data: Intent?): Array<Uri>? {
        val clip = data?.clipData ?: return data?.data?.let { arrayOf(it) }
        val uris = mutableListOf<Uri>()
        for (i in 0 until clip.itemCount) {
            clip.getItemAt(i)?.uri?.let { uris.add(it) }
        }
        return if (uris.isNotEmpty()) uris.toTypedArray() else null
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        if (!dataStore.getSettings().allowSitePermissionPrompts ||
            tabManager.getActiveTab()?.incognito == true
        ) {
            request.deny()
            return
        }
        clearPendingPermissionRequests()
        val id = "perm-" + UUID.randomUUID().toString().take(8)
        pendingPromptId = id
        pendingWebPermission = request
        val resources = request.resources ?: emptyArray()
        val label = buildList {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in resources) add("Camera")
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in resources) add("Microphone")
        }.ifEmpty { listOf("Media hardware") }.joinToString(" & ")
        val host = request.origin?.host?.takeIf { it.isNotBlank() } ?: "This site"
        nativeBridge.setPendingPermission(PendingPermissionUi(id, host, label))
    }

    private fun handleGeolocationRequest(
        origin: String,
        callback: GeolocationPermissions.Callback
    ) {
        if (!dataStore.getSettings().allowSitePermissionPrompts ||
            tabManager.getActiveTab()?.incognito == true
        ) {
            callback.invoke(origin, false, false)
            return
        }
        clearPendingPermissionRequests()
        val id = "perm-" + UUID.randomUUID().toString().take(8)
        pendingPromptId = id
        pendingGeoOrigin = origin
        pendingGeoCallback = callback
        val host = runCatching { Uri.parse(origin).host }.getOrNull() ?: origin
        nativeBridge.setPendingPermission(PendingPermissionUi(id, host, "Location"))
    }

    private fun handlePermissionPromptDecision(id: String, allow: Boolean) {
        if (pendingPromptId != id) return
        if (!allow) {
            finishPendingSitePermission(allow = false)
            return
        }

        val needed = mutableListOf<String>()
        pendingWebPermission?.resources?.forEach { res ->
            if (res == PermissionRequest.RESOURCE_VIDEO_CAPTURE) {
                needed.add(Manifest.permission.CAMERA)
            } else if (res == PermissionRequest.RESOURCE_AUDIO_CAPTURE) {
                needed.add(Manifest.permission.RECORD_AUDIO)
            }
        }
        if (pendingGeoCallback != null) {
            needed.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }

        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            finishPendingSitePermission(allow = true)
        } else {
            runtimePermissionsLauncher.launch(missing.toTypedArray())
        }
    }

    private fun finishPendingSitePermission(allow: Boolean) {
        val webReq = pendingWebPermission
        val geoCb = pendingGeoCallback
        val geoOrigin = pendingGeoOrigin
        pendingPromptId = null
        pendingWebPermission = null
        pendingGeoCallback = null
        pendingGeoOrigin = null

        if (webReq != null) {
            runCatching {
                if (allow) webReq.grant(webReq.resources) else webReq.deny()
            }
        }
        if (geoCb != null && geoOrigin != null) {
            runCatching {
                geoCb.invoke(geoOrigin, allow, false)
            }
        }
    }

    private fun clearPendingPermissionRequests() {
        finishPendingSitePermission(allow = false)
        nativeBridge.setPendingPermission(null)
    }

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

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                val scheme = uri.scheme?.lowercase().orEmpty()
                if (scheme == "mailto" || scheme == "tel" || scheme == "sms") {
                    runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        })
                    }
                    return true
                }
                return false
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
        mainHandler.postDelayed(pushRunnable, 220L)
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

    private fun applySystemTheme(theme: String) {
        val isLight = theme == "light"
        val bgColor = Color.parseColor(if (isLight) "#F5F6F8" else "#0F1115")
        @Suppress("DEPRECATION")
        window.statusBarColor = bgColor
        @Suppress("DEPRECATION")
        window.navigationBarColor = bgColor
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = isLight
            isAppearanceLightNavigationBars = isLight
        }
        if (::rootFrame.isInitialized) rootFrame.setBackgroundColor(bgColor)
        if (::browserStack.isInitialized) browserStack.setBackgroundColor(bgColor)
        if (::chromeUiWebView.isInitialized) chromeUiWebView.setBackgroundColor(bgColor)
        if (::contentContainer.isInitialized) contentContainer.setBackgroundColor(bgColor)
        if (::tabManager.isInitialized) tabManager.applyThemeToAllTabs(theme)
    }

    private fun dpToPx(dp: Int): Int =
        (dp * resources.displayMetrics.density).toInt()

    private fun handleStartUpdateRequested() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !askedPostNotifForUpdate &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            askedPostNotifForUpdate = true
            updateNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        appUpdater.startDownloadAndInstall()
    }

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
        clearPendingPermissionRequests()
        scope.cancel()
        if (::tabManager.isInitialized) tabManager.destroyAll()
        if (::chromeUiWebView.isInitialized) chromeUiWebView.destroy()
        super.onDestroy()
    }
}
