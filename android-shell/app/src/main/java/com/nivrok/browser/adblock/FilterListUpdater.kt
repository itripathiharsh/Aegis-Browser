package com.nivrok.browser.adblock

import android.content.Context
import com.nivrok.browser.diagnostics.CrashReporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.GZIPInputStream

class FilterListUpdater(
    private val context: Context,
    private val engine: AdBlockEngine
) {
    private val prefs by lazy {
        context.getSharedPreferences("nivrok_filter_meta", Context.MODE_PRIVATE)
    }

    fun getLastUpdatedIso(): String? = prefs.getString("last_updated_iso", null)

    fun loadSources(): List<FilterSourceConfig> {
        val raw = runCatching {
            context.assets.open("filters/sources.json").bufferedReader().use { it.readText() }
        }.getOrNull() ?: return emptyList()

        return runCatching {
            val root = JSONObject(raw)
            val arr = root.optJSONArray("sources") ?: JSONArray()
            val result = mutableListOf<FilterSourceConfig>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val id = obj.getString("id")
                val catStr = obj.optString("category", "ads")
                val cat = when (catStr) {
                    "trackers" -> BlockCategory.TRACKER
                    "popups" -> BlockCategory.POPUP
                    else -> BlockCategory.AD
                }
                result.add(
                    FilterSourceConfig(
                        id = id,
                        name = obj.getString("name"),
                        category = cat,
                        url = obj.getString("url"),
                        enabled = prefs.getBoolean("src_enabled_$id", obj.optBoolean("enabled", true)),
                        lastSyncedIso = prefs.getString("src_synced_$id", null),
                        cachedRuleCount = prefs.getInt("src_count_$id", 0)
                    )
                )
            }
            result
        }.getOrDefault(emptyList())
    }

    suspend fun syncIfStale(maxAgeMs: Long = 24L * 3600_000L): FilterSyncResult? {
        val lastCheckMs = prefs.getLong("last_sync_attempt_ms", 0L)
        if (System.currentTimeMillis() - lastCheckMs < maxAgeMs) {
            return null
        }
        return syncEnabledLists()
    }

    suspend fun syncEnabledLists(): FilterSyncResult = withContext(Dispatchers.IO) {
        val sources = loadSources().filter { it.enabled }
        val cacheDir = File(context.filesDir, "filters").apply { mkdirs() }
        var synced = 0
        var failed = 0
        val nowIso = currentIsoUtc()
        prefs.edit().putLong("last_sync_attempt_ms", System.currentTimeMillis()).apply()

        for (source in sources) {
            val ok = runCatching {
                val content = downloadTextGuarded(source.url, maxBytes = 12 * 1024 * 1024)
                if (!looksLikeFilterList(content)) {
                    throw IllegalStateException("Response is not a valid filter list")
                }
                val ruleCount = content.lineSequence().count {
                    val t = it.trim()
                    t.isNotEmpty() && !t.startsWith("!") && !t.startsWith("#")
                }
                val targetFile = File(cacheDir, "${source.id}-${source.category.wireName}.txt")
                val tmpFile = File(cacheDir, "${source.id}.tmp")
                tmpFile.writeText(content)
                if (!tmpFile.renameTo(targetFile)) {
                    targetFile.writeText(content)
                    tmpFile.delete()
                }
                prefs.edit()
                    .putString("src_synced_${source.id}", nowIso)
                    .putInt("src_count_${source.id}", ruleCount)
                    .apply()
            }.onFailure { err ->
                CrashReporter.recordNonFatal(
                    context = context,
                    source = "FilterSync",
                    message = "${source.id}: ${err.message ?: "Sync failed"}",
                    throwable = err
                )
            }.isSuccess

            if (ok) synced++ else failed++
        }

        if (synced > 0) {
            prefs.edit().putString("last_updated_iso", nowIso).apply()
            engine.loadFromContext(context, nowIso)
        }

        val stats = engine.getStats()
        val total = stats.domainRuleCount + stats.patternRuleCount
        val msg = if (synced > 0) {
            "Updated $synced filter lists ($total active rules)"
        } else {
            "Offline or mirror unreachable; using bundled local rules ($total rules)"
        }

        FilterSyncResult(
            syncedSources = synced,
            failedSources = failed,
            totalRules = total,
            lastUpdatedIso = getLastUpdatedIso() ?: nowIso,
            message = msg
        )
    }

    private fun downloadTextGuarded(urlStr: String, maxBytes: Int): String {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            connectTimeout = 12_000
            readTimeout = 15_000
            instanceFollowRedirects = true
            setRequestProperty("Accept-Encoding", "gzip")
            setRequestProperty("User-Agent", "Nivrok/1.0")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                throw IllegalStateException("HTTP $code from $urlStr")
            }
            val rawStream: InputStream = if (conn.contentEncoding.equals("gzip", ignoreCase = true)) {
                GZIPInputStream(conn.inputStream)
            } else {
                conn.inputStream
            }
            rawStream.use { input ->
                val buffer = ByteArray(16_384)
                val out = java.io.ByteArrayOutputStream()
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    total += read
                    if (total > maxBytes) {
                        throw IllegalStateException("Filter list exceeded $maxBytes bytes cap")
                    }
                    out.write(buffer, 0, read)
                }
                return out.toString(Charsets.UTF_8.name())
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun looksLikeFilterList(content: String): Boolean {
        val trimmed = content.trimStart()
        if (trimmed.startsWith("<!DOCTYPE", ignoreCase = true) ||
            trimmed.startsWith("<html", ignoreCase = true)
        ) {
            return false
        }
        return content.contains("||") || content.contains("0.0.0.0 ") || content.contains("[Adblock")
    }

    private fun currentIsoUtc(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}
