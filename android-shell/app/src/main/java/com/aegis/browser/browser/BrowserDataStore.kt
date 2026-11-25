package com.aegis.browser.browser

import android.content.Context
import com.aegis.browser.adblock.AdBlockEngine
import org.json.JSONArray
import org.json.JSONObject

data class BrowserSettings(
    val searchEngine: String = "duckduckgo",
    val theme: String = "dark",
    val blockThirdPartyCookies: Boolean = true,
    val defaultDesktopMode: Boolean = false,
    val showRecommendations: Boolean = true,
    val autoSyncFilters: Boolean = true,
    val saveHistory: Boolean = true
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("searchEngine", searchEngine)
        put("theme", theme)
        put("blockThirdPartyCookies", blockThirdPartyCookies)
        put("defaultDesktopMode", defaultDesktopMode)
        put("showRecommendations", showRecommendations)
        put("autoSyncFilters", autoSyncFilters)
        put("saveHistory", saveHistory)
    }
}

data class HistoryEntry(
    val id: String,
    val url: String,
    val title: String,
    val host: String,
    val visitedAtMs: Long
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("url", url)
        put("title", title)
        put("host", host)
        put("visitedAtMs", visitedAtMs)
    }
}

data class RecommendedSite(
    val url: String,
    val title: String,
    val host: String,
    val visits: Int,
    val lastVisitedMs: Long
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("url", url)
        put("title", title)
        put("host", host)
        put("visits", visits)
        put("lastVisitedMs", lastVisitedMs)
    }
}

class BrowserDataStore(context: Context) {

    private val prefs = context.getSharedPreferences("aegis_browser_data", Context.MODE_PRIVATE)
    private val legacyPrefs = context.getSharedPreferences("aegis_shields", Context.MODE_PRIVATE)
    private val lock = Any()

    private var settings: BrowserSettings = loadSettingsInternal()
    private val history: MutableList<HistoryEntry> = loadHistoryInternal()
    private val recommendations: MutableMap<String, RecommendedSite> = loadRecommendationsInternal()

    fun getSettings(): BrowserSettings = synchronized(lock) { settings }

    fun updateSettings(next: BrowserSettings): BrowserSettings = synchronized(lock) {
        val cleanEngine = TabManager.normalizeEngine(next.searchEngine)
        val cleanTheme = normalizeTheme(next.theme)
        settings = next.copy(searchEngine = cleanEngine, theme = cleanTheme)
        prefs.edit()
            .putString(KEY_SETTINGS, settings.toJson().toString())
            .apply()
        legacyPrefs.edit()
            .putString("search_engine", cleanEngine)
            .apply()
        settings
    }

    fun setSearchEngine(engineId: String): BrowserSettings = synchronized(lock) {
        updateSettings(settings.copy(searchEngine = TabManager.normalizeEngine(engineId)))
    }

    fun recordVisit(
        url: String,
        rawTitle: String?,
        host: String?,
        allowRecommendation: Boolean = true
    ) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        val cleanHost = host?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return
        val cleanTitle = rawTitle?.trim()?.takeIf { it.isNotEmpty() && !it.startsWith("http") }
            ?: cleanHost.removePrefix("www.")
        val now = System.currentTimeMillis()

        synchronized(lock) {
            if (settings.saveHistory) {
                val top = history.firstOrNull()
                if (top != null && top.url == url && (now - top.visitedAtMs) < 30_000L) {
                    history[0] = top.copy(
                        title = if (cleanTitle.length >= top.title.length) cleanTitle else top.title,
                        visitedAtMs = now
                    )
                } else {
                    history.add(
                        0,
                        HistoryEntry(
                            id = "h-${now}-${url.hashCode()}",
                            url = url,
                            title = cleanTitle,
                            host = cleanHost,
                            visitedAtMs = now
                        )
                    )
                    if (history.size > MAX_HISTORY) {
                        history.subList(MAX_HISTORY, history.size).clear()
                    }
                }
                persistHistoryLocked()
            }

            // Never pollute Recommendations with search engines, popup redirects, or ad-mirror hosts
            if (allowRecommendation && !isExcludedFromRecommendations(cleanHost, url)) {
                val prev = recommendations[cleanHost]
                val nextVisits = if (prev != null && (now - prev.lastVisitedMs) < 15_000L) {
                    prev.visits
                } else {
                    (prev?.visits ?: 0) + 1
                }
                val canonicalUrl = if (url.length <= 90) url else "https://$cleanHost/"
                recommendations[cleanHost] = RecommendedSite(
                    url = canonicalUrl,
                    title = cleanHost.removePrefix("www.")
                        .substringBefore('.')
                        .replaceFirstChar { it.uppercase() }
                        .let { brand ->
                            if (cleanTitle.length in 2..28) cleanTitle else brand
                        },
                    host = cleanHost,
                    visits = nextVisits,
                    lastVisitedMs = now
                )
                if (recommendations.size > MAX_REC_HOSTS) {
                    val victim = recommendations.values.minByOrNull { it.lastVisitedMs }?.host
                    if (victim != null) recommendations.remove(victim)
                }
                persistRecommendationsLocked()
            }
        }
    }

    fun updateVisitTitle(url: String, title: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        val clean = title.trim()
        if (clean.isEmpty() || clean.startsWith("http://") || clean.startsWith("https://")) return
        synchronized(lock) {
            val idx = history.indexOfFirst { it.url == url }
            if (idx >= 0) {
                history[idx] = history[idx].copy(title = clean)
                persistHistoryLocked()
            }
        }
    }

    fun getHistoryJson(): JSONArray = synchronized(lock) {
        JSONArray().apply {
            history.forEach { put(it.toJson()) }
        }
    }

    fun getTopRecommendations(limit: Int = 8): List<RecommendedSite> = synchronized(lock) {
        if (!settings.showRecommendations) return emptyList()
        recommendations.values
            .sortedWith(
                compareByDescending<RecommendedSite> { it.visits }
                    .thenByDescending { it.lastVisitedMs }
            )
            .take(limit)
    }

    fun deleteHistoryEntry(id: String) {
        synchronized(lock) {
            if (history.removeAll { it.id == id }) {
                persistHistoryLocked()
            }
        }
    }

    fun dismissRecommendation(host: String) {
        val clean = host.trim().lowercase()
        if (clean.isEmpty()) return
        synchronized(lock) {
            if (recommendations.remove(clean) != null) {
                persistRecommendationsLocked()
            }
        }
    }

    fun clearHistoryAndRecommendations() {
        synchronized(lock) {
            history.clear()
            recommendations.clear()
            prefs.edit()
                .remove(KEY_HISTORY)
                .remove(KEY_RECS)
                .apply()
        }
    }

    private fun isExcludedFromRecommendations(host: String, url: String): Boolean {
        val clean = host.trim().lowercase().removePrefix("www.")
        val base = AdBlockEngine.registrableDomain(clean)
        if (base in SEARCH_ENGINE_BASES ||
            clean == "search.brave.com" ||
            clean.startsWith("google.") ||
            clean.startsWith("yandex.")
        ) {
            return true
        }
        if (clean == "localhost" || RAW_IP_REGEX.matches(clean)) return true
        if (SUSPICIOUS_REC_SUBDOMAIN_REGEX.containsMatchIn(clean)) return true
        return AdBlockEngine.isSuspiciousAdRedirectUrl(url.lowercase())
    }

    private fun persistHistoryLocked() {
        val arr = JSONArray()
        history.forEach { arr.put(it.toJson()) }
        prefs.edit().putString(KEY_HISTORY, arr.toString()).apply()
    }

    private fun persistRecommendationsLocked() {
        val arr = JSONArray()
        recommendations.values.forEach { arr.put(it.toJson()) }
        prefs.edit().putString(KEY_RECS, arr.toString()).apply()
    }

    private fun loadSettingsInternal(): BrowserSettings {
        val raw = prefs.getString(KEY_SETTINGS, null)
        val fallbackEngine = legacyPrefs.getString("search_engine", "duckduckgo") ?: "duckduckgo"
        if (raw.isNullOrBlank()) {
            return BrowserSettings(searchEngine = TabManager.normalizeEngine(fallbackEngine))
        }
        return runCatching {
            val obj = JSONObject(raw)
            BrowserSettings(
                searchEngine = TabManager.normalizeEngine(obj.optString("searchEngine", fallbackEngine)),
                theme = normalizeTheme(obj.optString("theme", "dark")),
                blockThirdPartyCookies = obj.optBoolean("blockThirdPartyCookies", true),
                defaultDesktopMode = obj.optBoolean("defaultDesktopMode", false),
                showRecommendations = obj.optBoolean("showRecommendations", true),
                autoSyncFilters = obj.optBoolean("autoSyncFilters", true),
                saveHistory = obj.optBoolean("saveHistory", true)
            )
        }.getOrDefault(BrowserSettings(searchEngine = TabManager.normalizeEngine(fallbackEngine)))
    }

    private fun loadHistoryInternal(): MutableList<HistoryEntry> {
        val raw = prefs.getString(KEY_HISTORY, null) ?: return mutableListOf()
        val list = mutableListOf<HistoryEntry>()
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val entryUrl = o.optString("url")
                if (!entryUrl.startsWith("aegis://player")) {
                    list.add(
                        HistoryEntry(
                            id = o.optString("id"),
                            url = entryUrl,
                            title = o.optString("title"),
                            host = o.optString("host"),
                            visitedAtMs = o.optLong("visitedAtMs", 0L)
                        )
                    )
                }
            }
        }
        return list
    }

    private fun loadRecommendationsInternal(): MutableMap<String, RecommendedSite> {
        val raw = prefs.getString(KEY_RECS, null) ?: return linkedMapOf()
        val map = linkedMapOf<String, RecommendedSite>()
        var pruned = false
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val host = o.optString("host").trim().lowercase()
                val recUrl = o.optString("url")
                if (host.isNotBlank() && !isExcludedFromRecommendations(host, recUrl)) {
                    map[host] = RecommendedSite(
                        url = recUrl,
                        title = o.optString("title"),
                        host = host,
                        visits = o.optInt("visits", 1),
                        lastVisitedMs = o.optLong("lastVisitedMs", 0L)
                    )
                } else if (host.isNotBlank()) {
                    pruned = true
                }
            }
        }
        if (pruned) {
            val cleanedArr = JSONArray()
            map.values.forEach { cleanedArr.put(it.toJson()) }
            prefs.edit().putString(KEY_RECS, cleanedArr.toString()).apply()
        }
        return map
    }

    companion object {
        private const val KEY_SETTINGS = "settings_v1"
        private const val KEY_HISTORY = "history_v1"
        private const val KEY_RECS = "recommendations_v1"
        private const val MAX_HISTORY = 200
        private const val MAX_REC_HOSTS = 40

        private val SEARCH_ENGINE_BASES = setOf(
            "duckduckgo.com",
            "brave.com",
            "google.com",
            "startpage.com",
            "bing.com",
            "yahoo.com",
            "yandex.ru",
            "yandex.com",
            "ecosia.org",
            "qwant.com",
            "baidu.com",
            "ask.com"
        )

        private val SUSPICIOUS_REC_SUBDOMAIN_REGEX = Regex(
            "^(new\\d+|ad\\d*|ads\\d*|pop\\d*|popunder\\d*|clk\\d*|trk\\d*|track\\d*|redir\\d*|redirect\\d*|promo\\d*|aff\\d*)\\."
        )
        private val RAW_IP_REGEX = Regex("^\\d+\\.\\d+\\.\\d+\\.\\d+$")

        fun normalizeTheme(raw: String?): String =
            if (raw?.trim()?.lowercase() == "light") "light" else "dark"
    }
}
