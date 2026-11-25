package com.aegis.browser.updater

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import com.aegis.browser.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicReference

data class AppUpdateState(
    val status: String = "idle", // idle | checking | available | up_to_date | downloading | awaiting_permission | ready_to_install | error | unconfigured
    val popupVisible: Boolean = false,
    val installedVersion: String = BuildConfig.VERSION_NAME,
    val installedVersionCode: Int = BuildConfig.VERSION_CODE,
    val githubRepo: String = BuildConfig.GITHUB_REPO,
    val latestVersion: String? = null,
    val releaseTitle: String? = null,
    val changelog: String? = null,
    val downloadUrl: String? = null,
    val assetName: String? = null,
    val assetSizeBytes: Long = 0L,
    val downloadedBytes: Long = 0L,
    val progressPercent: Int = 0,
    val message: String? = null,
    val checkedAtIso: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("status", status)
        put("popupVisible", popupVisible)
        put("installedVersion", installedVersion)
        put("installedVersionCode", installedVersionCode)
        put("githubRepo", githubRepo)
        put("latestVersion", latestVersion ?: JSONObject.NULL)
        put("releaseTitle", releaseTitle ?: JSONObject.NULL)
        put("changelog", changelog ?: JSONObject.NULL)
        put("downloadUrl", downloadUrl ?: JSONObject.NULL)
        put("assetName", assetName ?: JSONObject.NULL)
        put("assetSizeBytes", assetSizeBytes)
        put("downloadedBytes", downloadedBytes)
        put("progressPercent", progressPercent)
        put("message", message ?: JSONObject.NULL)
        put("checkedAtIso", checkedAtIso ?: JSONObject.NULL)
    }
}

/**
 * GitHub Releases OTA updater using Android's system DownloadManager (and Downloads/notification handoff)
 * so the browser never requires REQUEST_INSTALL_PACKAGES or package-dropper intents.
 */
class AppUpdater(
    private val context: Context,
    private val scope: CoroutineScope,
    private val onStateChanged: () -> Unit
) {
    private val stateRef = AtomicReference(AppUpdateState())
    private var downloadJob: Job? = null
    private var activeDownloadId: Long = -1L

    fun getState(): AppUpdateState = stateRef.get()

    fun checkForUpdates(manual: Boolean) {
        val repo = BuildConfig.GITHUB_REPO.trim()
        if (repo.isEmpty() || repo == "OWNER/REPO" || !repo.contains('/')) {
            if (manual) {
                updateState {
                    copy(
                        status = "unconfigured",
                        popupVisible = false,
                        message = "Set githubRepo slug in build.gradle.kts to enable OTA checks.",
                        checkedAtIso = currentIsoUtc()
                    )
                }
            }
            return
        }

        if (stateRef.get().status == "downloading") return

        updateState {
            copy(
                status = "checking",
                message = "Checking GitHub Releases for $repo..."
            )
        }

        scope.launch {
            val result = withContext(Dispatchers.IO) {
                fetchLatestRelease(repo)
            }
            result.fold(
                onSuccess = { release ->
                    val now = currentIsoUtc()
                    if (release == null) {
                        updateState {
                            copy(
                                status = "up_to_date",
                                popupVisible = false,
                                message = "No published releases found yet for $repo.",
                                checkedAtIso = now
                            )
                        }
                        return@fold
                    }

                    val newer = SemverComparator.isNewerVersion(
                        release.tagName,
                        BuildConfig.VERSION_NAME
                    )
                    if (newer && release.asset != null) {
                        updateState {
                            copy(
                                status = "available",
                                popupVisible = true,
                                latestVersion = release.tagName,
                                releaseTitle = release.title,
                                changelog = release.body,
                                downloadUrl = release.asset.downloadUrl,
                                assetName = release.asset.name,
                                assetSizeBytes = release.asset.sizeBytes,
                                downloadedBytes = 0L,
                                progressPercent = 0,
                                message = "Update ${release.tagName} is ready to download.",
                                checkedAtIso = now
                            )
                        }
                    } else {
                        updateState {
                            copy(
                                status = "up_to_date",
                                popupVisible = false,
                                latestVersion = release.tagName,
                                message = "You are running the latest version (${BuildConfig.VERSION_NAME}).",
                                checkedAtIso = now
                            )
                        }
                    }
                },
                onFailure = { err ->
                    updateState {
                        copy(
                            status = if (manual) "error" else "idle",
                            popupVisible = if (manual) popupVisible else false,
                            message = if (manual) {
                                "Update check failed: ${err.message ?: "Network error"}"
                            } else {
                                null
                            },
                            checkedAtIso = currentIsoUtc()
                        )
                    }
                }
            )
        }
    }

    fun startDownloadAndInstall() {
        val current = stateRef.get()
        val url = current.downloadUrl
        if (url.isNullOrBlank()) {
            updateState {
                copy(status = "error", message = "No APK download URL available for this release.")
            }
            return
        }
        if (current.status == "downloading") return

        // Legacy Android 7-9 without WRITE_EXTERNAL_STORAGE hands off safely to system HTTPS browser/downloader
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            openUrlExternally(url)
            updateState {
                copy(
                    status = "ready_to_install",
                    popupVisible = true,
                    progressPercent = 100,
                    message = "Download started in your system downloader. Open it when finished to update."
                )
            }
            return
        }

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        if (dm == null) {
            openUrlExternally(url)
            return
        }

        val safeFileName = (current.assetName ?: "AegisBrowser-${current.latestVersion ?: "latest"}.apk")
            .replace(Regex("[^A-Za-z0-9._-]"), "_")

        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle(current.releaseTitle ?: "Aegis Browser ${current.latestVersion ?: ""}")
            setDescription("Downloading $safeFileName")
            setMimeType("application/vnd.android.package-archive")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeFileName)
        }

        val downloadId = runCatching { dm.enqueue(request) }.getOrNull()
        if (downloadId == null) {
            openUrlExternally(url)
            return
        }

        activeDownloadId = downloadId
        downloadJob?.cancel()
        downloadJob = scope.launch {
            updateState {
                copy(
                    status = "downloading",
                    popupVisible = true,
                    downloadedBytes = 0L,
                    progressPercent = 0,
                    message = "Downloading $safeFileName to Downloads..."
                )
            }

            try {
                while (isActive) {
                    val snapshot = withContext(Dispatchers.IO) { queryDownload(dm, downloadId) }
                    when (snapshot.status) {
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            updateState {
                                copy(
                                    status = "ready_to_install",
                                    popupVisible = true,
                                    downloadedBytes = if (snapshot.totalBytes > 0) snapshot.totalBytes else assetSizeBytes,
                                    assetSizeBytes = if (snapshot.totalBytes > 0) snapshot.totalBytes else assetSizeBytes,
                                    progressPercent = 100,
                                    message = "Downloaded $safeFileName to Downloads. Tap the download notification or Open Downloads to install."
                                )
                            }
                            break
                        }
                        DownloadManager.STATUS_FAILED -> {
                            updateState {
                                copy(
                                    status = "error",
                                    popupVisible = true,
                                    message = "Download failed (code ${snapshot.reason})."
                                )
                            }
                            break
                        }
                        -1 -> {
                            updateState {
                                copy(
                                    status = "available",
                                    downloadedBytes = 0L,
                                    progressPercent = 0,
                                    message = "Download canceled."
                                )
                            }
                            break
                        }
                        else -> {
                            val total = snapshot.totalBytes.takeIf { it > 0 } ?: current.assetSizeBytes
                            val pct = if (total > 0) {
                                ((snapshot.downloadedBytes * 100L) / total).toInt().coerceIn(0, 99)
                            } else {
                                0
                            }
                            updateState {
                                copy(
                                    downloadedBytes = snapshot.downloadedBytes,
                                    assetSizeBytes = if (total > 0) total else assetSizeBytes,
                                    progressPercent = pct
                                )
                            }
                        }
                    }
                    delay(300L)
                }
            } catch (_: CancellationException) {
                runCatching { dm.remove(downloadId) }
                updateState {
                    copy(
                        status = "available",
                        downloadedBytes = 0L,
                        progressPercent = 0,
                        message = "Download canceled."
                    )
                }
            }
        }
    }

    fun cancelDownload() {
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        if (activeDownloadId >= 0L) {
            runCatching { dm?.remove(activeDownloadId) }
            activeDownloadId = -1L
        }
        downloadJob?.cancel()
        downloadJob = null
    }

    fun dismissModal() {
        updateState {
            copy(popupVisible = false)
        }
    }

    fun openDownloadedUpdate() {
        val intent = Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val opened = runCatching { context.startActivity(intent) }.isSuccess
        if (!opened) {
            stateRef.get().downloadUrl?.let { openUrlExternally(it) }
        }
        dismissModal()
    }

    private fun openUrlExternally(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(intent) }
    }

    private data class DmSnapshot(
        val status: Int,
        val downloadedBytes: Long,
        val totalBytes: Long,
        val reason: Int
    )

    private fun queryDownload(dm: DownloadManager, id: Long): DmSnapshot {
        val query = DownloadManager.Query().setFilterById(id)
        dm.query(query)?.use { cursor ->
            if (!cursor.moveToFirst()) return DmSnapshot(-1, 0L, 0L, 0)
            val statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val dlIdx = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val totalIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            val reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
            return DmSnapshot(
                status = if (statusIdx >= 0) cursor.getInt(statusIdx) else -1,
                downloadedBytes = if (dlIdx >= 0) cursor.getLong(dlIdx) else 0L,
                totalBytes = if (totalIdx >= 0) cursor.getLong(totalIdx) else 0L,
                reason = if (reasonIdx >= 0) cursor.getInt(reasonIdx) else 0
            )
        }
        return DmSnapshot(-1, 0L, 0L, 0)
    }

    private data class RemoteRelease(
        val tagName: String,
        val title: String,
        val body: String,
        val asset: ApkReleaseAsset?
    )

    private fun fetchLatestRelease(repo: String): Result<RemoteRelease?> = runCatching {
        val apiUrl = "https://api.github.com/repos/$repo/releases/latest"
        val conn = (URL(apiUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 12_000
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "AegisBrowser/${BuildConfig.VERSION_NAME}")
        }
        try {
            val code = conn.responseCode
            if (code == 404) {
                return@runCatching null
            }
            if (code !in 200..299) {
                throw IllegalStateException("GitHub API HTTP $code")
            }
            val raw = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(raw)
            val tag = json.optString("tag_name", "").trim()
            if (tag.isEmpty()) return@runCatching null
            val title = json.optString("name", tag).ifBlank { tag }
            val body = json.optString("body", "").ifBlank { "Performance, ad-block, and stability improvements." }
            val assets = json.optJSONArray("assets")
            val apkAsset = if (assets != null) SemverComparator.pickBestApkAsset(assets) else null
            RemoteRelease(tagName = tag, title = title, body = body, asset = apkAsset)
        } finally {
            conn.disconnect()
        }
    }

    private inline fun updateState(transform: AppUpdateState.() -> AppUpdateState) {
        val next = stateRef.get().transform()
        stateRef.set(next)
        onStateChanged()
    }

    private fun currentIsoUtc(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}
