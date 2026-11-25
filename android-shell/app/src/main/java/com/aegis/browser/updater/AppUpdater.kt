package com.aegis.browser.updater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.aegis.browser.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
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

class AppUpdater(
    private val context: Context,
    private val scope: CoroutineScope,
    private val onStateChanged: () -> Unit,
    private val onRequestInstallPermission: (Intent) -> Unit
) {
    private val stateRef = AtomicReference(AppUpdateState())
    private var downloadJob: Job? = null
    private var pendingApkFile: File? = null

    fun getState(): AppUpdateState = stateRef.get()

    fun checkForUpdates(manual: Boolean) {
        val repo = BuildConfig.GITHUB_REPO.trim()
        if (repo.isEmpty() || repo == "OWNER/REPO" || !repo.contains('/')) {
            if (manual) {
                updateState {
                    copy(
                        status = "unconfigured",
                        popupVisible = false,
                        message = "Set githubRepo slug in build.gradle.kts (or push via GitHub Actions) to enable OTA checks.",
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

        downloadJob?.cancel()
        downloadJob = scope.launch {
            updateState {
                copy(
                    status = "downloading",
                    popupVisible = true,
                    downloadedBytes = 0L,
                    progressPercent = 0,
                    message = "Downloading ${assetName ?: "update.apk"}..."
                )
            }

            try {
                val apkFile = withContext(Dispatchers.IO) {
                    downloadApkToCache(url, current.assetSizeBytes)
                }
                pendingApkFile = apkFile
                triggerInstall(apkFile)
            } catch (_: CancellationException) {
                updateState {
                    copy(
                        status = "available",
                        downloadedBytes = 0L,
                        progressPercent = 0,
                        message = "Download canceled."
                    )
                }
            } catch (err: Exception) {
                updateState {
                    copy(
                        status = "error",
                        popupVisible = true,
                        message = "Download failed: ${err.message ?: "Unknown error"}"
                    )
                }
            }
        }
    }

    fun cancelDownload() {
        downloadJob?.cancel()
        downloadJob = null
    }

    fun dismissModal() {
        updateState {
            copy(popupVisible = false)
        }
    }

    fun retryPendingInstall() {
        val file = pendingApkFile ?: File(File(context.cacheDir, "updates"), "aegis-update.apk")
        if (file.exists() && file.length() > 64 * 1024L) {
            triggerInstall(file)
        } else {
            startDownloadAndInstall()
        }
    }

    fun onInstallPermissionReturned() {
        val state = stateRef.get()
        if (state.status == "awaiting_permission") {
            retryPendingInstall()
        }
    }

    private fun triggerInstall(apkFile: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            updateState {
                copy(
                    status = "awaiting_permission",
                    popupVisible = true,
                    progressPercent = 100,
                    message = "Enable 'Install unknown apps' for Aegis Browser to finish updating."
                )
            }
            val permIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            )
            onRequestInstallPermission(permIntent)
            return
        }

        val authority = "${context.packageName}.fileprovider"
        val contentUri = FileProvider.getUriForFile(context, authority, apkFile)
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(installIntent)
        updateState {
            copy(
                status = "ready_to_install",
                popupVisible = false,
                progressPercent = 100,
                message = "Android installer opened."
            )
        }
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

    private fun downloadApkToCache(urlStr: String, expectedSize: Long): File {
        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        val partFile = File(updatesDir, "aegis-update.apk.part")
        val finalFile = File(updatesDir, "aegis-update.apk")
        if (partFile.exists()) partFile.delete()

        val conn = openFollowingRedirects(urlStr)
        try {
            val contentLength = conn.contentLengthLong.takeIf { it > 0 } ?: expectedSize
            var downloaded = 0L
            var lastEmitMs = 0L
            var lastPct = -1

            conn.inputStream.use { input ->
                FileOutputStream(partFile).use { out ->
                    val buf = ByteArray(32_768)
                    while (true) {
                        val n = input.read(buf)
                        if (n == -1) break
                        out.write(buf, 0, n)
                        downloaded += n

                        val pct = if (contentLength > 0) {
                            ((downloaded * 100L) / contentLength).toInt().coerceIn(0, 100)
                        } else {
                            0
                        }
                        val now = System.currentTimeMillis()
                        if (pct != lastPct && (now - lastEmitMs >= 120L || pct == 100)) {
                            lastPct = pct
                            lastEmitMs = now
                            updateState {
                                copy(
                                    downloadedBytes = downloaded,
                                    assetSizeBytes = if (contentLength > 0) contentLength else assetSizeBytes,
                                    progressPercent = pct
                                )
                            }
                        }
                    }
                }
            }

            if (partFile.length() < 64 * 1024L || !hasZipMagicHeader(partFile)) {
                partFile.delete()
                throw IllegalStateException("Downloaded file is not a valid APK package.")
            }

            if (finalFile.exists()) finalFile.delete()
            if (!partFile.renameTo(finalFile)) {
                partFile.copyTo(finalFile, overwrite = true)
                partFile.delete()
            }
            return finalFile
        } finally {
            conn.disconnect()
        }
    }

    private fun openFollowingRedirects(startUrl: String): HttpURLConnection {
        var currentUrl = startUrl
        repeat(6) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "AegisBrowser/${BuildConfig.VERSION_NAME}")
                setRequestProperty("Accept", "application/octet-stream")
            }
            val code = conn.responseCode
            if (code in 300..399) {
                val loc = conn.getHeaderField("Location")
                conn.disconnect()
                if (loc.isNullOrBlank()) throw IllegalStateException("Empty redirect from $currentUrl")
                currentUrl = URL(URL(currentUrl), loc).toString()
            } else if (code in 200..299) {
                return conn
            } else {
                conn.disconnect()
                throw IllegalStateException("HTTP $code downloading APK")
            }
        }
        throw IllegalStateException("Too many redirects downloading APK")
    }

    private fun hasZipMagicHeader(file: File): Boolean {
        val header = ByteArray(4)
        file.inputStream().use { if (it.read(header) < 4) return false }
        return header[0] == 0x50.toByte() &&
            header[1] == 0x4B.toByte() &&
            header[2] == 0x03.toByte() &&
            header[3] == 0x04.toByte()
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
