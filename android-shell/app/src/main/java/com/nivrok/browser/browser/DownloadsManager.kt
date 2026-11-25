package com.nivrok.browser.browser

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.URLUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class DownloadRecord(
    val id: String,
    val dmId: Long,
    val fileName: String,
    val url: String,
    val mimeType: String,
    val totalBytes: Long,
    val downloadedBytes: Long,
    val status: String, // downloading | completed | failed
    val startedAtMs: Long,
    val contentUri: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("dmId", dmId)
        put("fileName", fileName)
        put("url", url)
        put("mimeType", mimeType)
        put("totalBytes", totalBytes)
        put("downloadedBytes", downloadedBytes)
        put("status", status)
        put("startedAtMs", startedAtMs)
        put("contentUri", contentUri ?: JSONObject.NULL)
    }
}

class DownloadsRepository(
    private val context: Context,
    private val scope: CoroutineScope,
    private val onChanged: () -> Unit
) {
    private val prefs = context.getSharedPreferences("nivrok_downloads", Context.MODE_PRIVATE)
    private val lock = Any()
    private val records = loadInternal()
    private var pollJob: Job? = null

    fun getRecords(): List<DownloadRecord> = synchronized(lock) { records.toList() }

    fun getActiveCount(): Int = synchronized(lock) { records.count { it.status == "downloading" } }

    fun getTotalCount(): Int = synchronized(lock) { records.size }

    fun getRecordsJson(): JSONArray = synchronized(lock) {
        JSONArray().apply { records.forEach { put(it.toJson()) } }
    }

    fun startWebDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        contentLength: Long
    ) {
        if (url.startsWith("data:", ignoreCase = true)) {
            saveBlobDataUrl(
                dataUrl = url,
                rawFileName = URLUtil.guessFileName("download", contentDisposition, mimeType),
                rawMime = mimeType
            )
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) return

        val guessed = URLUtil.guessFileName(url, contentDisposition, mimeType)
            .ifBlank { "download-${System.currentTimeMillis()}" }
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
        val safeMime = mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream"

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            addOrUpdate(
                DownloadRecord(
                    id = "dl-${System.currentTimeMillis()}",
                    dmId = -1L,
                    fileName = guessed,
                    url = url,
                    mimeType = safeMime,
                    totalBytes = contentLength.coerceAtLeast(0L),
                    downloadedBytes = contentLength.coerceAtLeast(0L),
                    status = "completed",
                    startedAtMs = System.currentTimeMillis()
                )
            )
            openExternalUrl(url)
            return
        }

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        if (dm == null) {
            openExternalUrl(url)
            return
        }

        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle(guessed)
            setDescription("Downloading via Nivrok")
            setMimeType(safeMime)
            if (!userAgent.isNullOrBlank()) {
                addRequestHeader("User-Agent", userAgent)
            }
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, guessed)
        }

        val dmId = runCatching { dm.enqueue(request) }.getOrNull()
        if (dmId == null) {
            openExternalUrl(url)
            return
        }

        val rec = DownloadRecord(
            id = "dl-$dmId-${System.currentTimeMillis()}",
            dmId = dmId,
            fileName = guessed,
            url = url,
            mimeType = safeMime,
            totalBytes = contentLength.coerceAtLeast(0L),
            downloadedBytes = 0L,
            status = "downloading",
            startedAtMs = System.currentTimeMillis()
        )
        addOrUpdate(rec)
        ensurePolling(dm)
    }

    fun saveBlobDataUrl(dataUrl: String, rawFileName: String?, rawMime: String?) {
        if (!dataUrl.startsWith("data:", ignoreCase = true)) return
        scope.launch {
            val saved = withContext(Dispatchers.IO) {
                runCatching {
                    val commaIdx = dataUrl.indexOf(',')
                    if (commaIdx <= 0) return@runCatching null
                    val meta = dataUrl.substring(5, commaIdx)
                    val payload = dataUrl.substring(commaIdx + 1)
                    val headerMime = meta.substringBefore(';').takeIf { it.contains('/') }
                    val safeMime = rawMime?.takeIf { it.isNotBlank() }
                        ?: headerMime
                        ?: "application/octet-stream"
                    val isBase64 = meta.contains(";base64", ignoreCase = true)
                    val bytes = if (isBase64) {
                        Base64.decode(payload, Base64.DEFAULT)
                    } else {
                        Uri.decode(payload).toByteArray(Charsets.UTF_8)
                    }

                    val ext = extensionForMime(safeMime)
                    val baseName = rawFileName?.trim()?.takeIf { it.isNotEmpty() }
                        ?: "nivrok-export-${System.currentTimeMillis()}.$ext"
                    val safeName = baseName.replace(Regex("[^A-Za-z0-9._-]"), "_")

                    var uriStr: String? = null
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val resolver = context.contentResolver
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                            put(MediaStore.Downloads.MIME_TYPE, safeMime)
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        val itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        if (itemUri != null) {
                            resolver.openOutputStream(itemUri)?.use { out ->
                                out.write(bytes)
                            }
                            val finished = ContentValues().apply {
                                put(MediaStore.Downloads.IS_PENDING, 0)
                            }
                            resolver.update(itemUri, finished, null, null)
                            uriStr = itemUri.toString()
                        }
                    }

                    DownloadRecord(
                        id = "blob-${System.currentTimeMillis()}",
                        dmId = -1L,
                        fileName = safeName,
                        url = "blob://$safeName",
                        mimeType = safeMime,
                        totalBytes = bytes.size.toLong(),
                        downloadedBytes = bytes.size.toLong(),
                        status = if (uriStr != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) "completed" else "failed",
                        startedAtMs = System.currentTimeMillis(),
                        contentUri = uriStr
                    )
                }.getOrNull()
            }
            if (saved != null) {
                addOrUpdate(saved)
            }
        }
    }

    fun openDownload(id: String) {
        val target = synchronized(lock) { records.find { it.id == id } } ?: return
        if (target.status != "completed") {
            openSystemDownloads()
            return
        }

        // Security/Play Protect boundary: never programmatically invoke APK package installer
        if (target.fileName.lowercase().endsWith(".apk") ||
            target.mimeType.equals("application/vnd.android.package-archive", ignoreCase = true)
        ) {
            openSystemDownloads()
            return
        }

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        val resolvedUri = target.contentUri?.let { Uri.parse(it) }
            ?: if (target.dmId >= 0L) runCatching { dm?.getUriForDownloadedFile(target.dmId) }.getOrNull() else null

        if (resolvedUri == null) {
            openSystemDownloads()
            return
        }

        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(resolvedUri, target.mimeType.ifBlank { "*/*" })
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val launched = runCatching { context.startActivity(viewIntent) }.isSuccess
        if (!launched) {
            openSystemDownloads()
        }
    }

    fun openSystemDownloads() {
        val intent = Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(intent) }
    }

    fun removeEntry(id: String) {
        synchronized(lock) {
            val target = records.find { it.id == id }
            if (target != null && target.status == "downloading" && target.dmId >= 0L) {
                val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
                runCatching { dm?.remove(target.dmId) }
            }
            if (records.removeAll { it.id == id }) {
                persistLocked()
            }
        }
        onChanged()
    }

    fun clearCompleted() {
        synchronized(lock) {
            if (records.removeAll { it.status != "downloading" }) {
                persistLocked()
            }
        }
        onChanged()
    }

    private fun ensurePolling(dm: DownloadManager) {
        if (pollJob?.isActive == true) return
        pollJob = scope.launch {
            while (isActive) {
                val activeIds = synchronized(lock) {
                    records.filter { it.status == "downloading" && it.dmId >= 0L }.map { it.dmId }
                }
                if (activeIds.isEmpty()) break

                val updates = withContext(Dispatchers.IO) {
                    activeIds.mapNotNull { querySnapshot(dm, it) }
                }
                var changed = false
                synchronized(lock) {
                    for (u in updates) {
                        val idx = records.indexOfFirst { it.dmId == u.dmId }
                        if (idx >= 0) {
                            val cur = records[idx]
                            val nextStatus = when (u.status) {
                                DownloadManager.STATUS_SUCCESSFUL -> "completed"
                                DownloadManager.STATUS_FAILED -> "failed"
                                else -> "downloading"
                            }
                            val finishedUri = if (nextStatus == "completed" && cur.contentUri == null) {
                                runCatching { dm.getUriForDownloadedFile(u.dmId)?.toString() }.getOrNull()
                            } else {
                                cur.contentUri
                            }
                            val updated = cur.copy(
                                status = nextStatus,
                                downloadedBytes = u.downloadedBytes,
                                totalBytes = if (u.totalBytes > 0) u.totalBytes else cur.totalBytes,
                                contentUri = finishedUri
                            )
                            if (updated != cur) {
                                records[idx] = updated
                                changed = true
                            }
                        }
                    }
                    if (changed) persistLocked()
                }
                if (changed) onChanged()
                delay(500L)
            }
        }
    }

    private data class QuerySnapshot(
        val dmId: Long,
        val status: Int,
        val downloadedBytes: Long,
        val totalBytes: Long
    )

    private fun querySnapshot(dm: DownloadManager, dmId: Long): QuerySnapshot? {
        val query = DownloadManager.Query().setFilterById(dmId)
        dm.query(query)?.use { c ->
            if (!c.moveToFirst()) {
                return QuerySnapshot(dmId, DownloadManager.STATUS_FAILED, 0L, 0L)
            }
            val sIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val dIdx = c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val tIdx = c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            return QuerySnapshot(
                dmId = dmId,
                status = if (sIdx >= 0) c.getInt(sIdx) else DownloadManager.STATUS_RUNNING,
                downloadedBytes = if (dIdx >= 0) c.getLong(dIdx) else 0L,
                totalBytes = if (tIdx >= 0) c.getLong(tIdx) else 0L
            )
        }
        return null
    }

    private fun openExternalUrl(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(intent) }
    }

    private fun addOrUpdate(record: DownloadRecord) {
        synchronized(lock) {
            records.add(0, record)
            if (records.size > 60) {
                records.subList(60, records.size).clear()
            }
            persistLocked()
        }
        onChanged()
    }

    private fun persistLocked() {
        val arr = JSONArray()
        records.forEach { arr.put(it.toJson()) }
        prefs.edit().putString(KEY_DOWNLOADS, arr.toString()).apply()
    }

    private fun loadInternal(): MutableList<DownloadRecord> {
        val raw = prefs.getString(KEY_DOWNLOADS, null) ?: return mutableListOf()
        val list = mutableListOf<DownloadRecord>()
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val status = o.optString("status", "completed")
                list.add(
                    DownloadRecord(
                        id = o.optString("id"),
                        dmId = o.optLong("dmId", -1L),
                        fileName = o.optString("fileName"),
                        url = o.optString("url"),
                        mimeType = o.optString("mimeType", "application/octet-stream"),
                        totalBytes = o.optLong("totalBytes", 0L),
                        downloadedBytes = o.optLong("downloadedBytes", 0L),
                        status = if (status == "downloading") "completed" else status,
                        startedAtMs = o.optLong("startedAtMs", 0L),
                        contentUri = o.optString("contentUri").takeIf { it.isNotBlank() && it != "null" }
                    )
                )
            }
        }
        return list
    }

    companion object {
        private const val KEY_DOWNLOADS = "records_v1"

        private fun extensionForMime(mime: String): String = when {
            mime.contains("pdf") -> "pdf"
            mime.contains("png") -> "png"
            mime.contains("jpeg") || mime.contains("jpg") -> "jpg"
            mime.contains("webp") -> "webp"
            mime.contains("svg") -> "svg"
            mime.contains("json") -> "json"
            mime.contains("csv") -> "csv"
            mime.contains("text/plain") -> "txt"
            mime.contains("zip") -> "zip"
            mime.contains("mp4") -> "mp4"
            mime.contains("mp3") || mime.contains("mpeg") -> "mp3"
            else -> "bin"
        }
    }
}
