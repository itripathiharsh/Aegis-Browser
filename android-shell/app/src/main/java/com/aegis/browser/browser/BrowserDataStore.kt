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
    val saveHistory: Boolean = true,
    val textZoom: Int = 100,
    val allowSitePermissionPrompts: Boolean = true,
    val restoreTabsOnStart: Boolean = true
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("searchEngine", searchEngine)
        put("theme", theme)
        put("blockThirdPartyCookies", blockThirdPartyCookies)
        put("defaultDesktopMode", defaultDesktopMode)
        put("showRecommendations", showRecommendations)
        put("autoSyncFilters", autoSyncFilters)
        put("saveHistory", saveHistory)
        put("textZoom", textZoom)
        put("allowSitePermissionPrompts", allowSitePermissionPrompts)
        put("restoreTabsOnStart", restoreTabsOnStart)
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

data class BookmarkEntry(
    val id: String,
    val title: String,
    val url: String,
    val tag: String = "Saved",
    val pinned: Boolean = true
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("title", title)
        put("url", url)
        put("tag", tag)
        put("pinned", pinned)
    }
}

data class SavedTabSnapshot(
    val url: String,
    val title: String,
    val desktopMode: Boolean = false,
    val groupId: String? = null,
    val groupTitle: String? = null,
    val groupColor: String? = null,
    val isActive: Boolean = false
)

class BrowserDataStore(context: Context) {

    private val prefs = context.getSharedPreferences("aegis_browser_data", Context.MODE_PRIVATE)
    private val legacyPrefs = context.getSharedPreferences("aegis_shields", Context.MODE_PRIVATE)
    private val lock = Any()

    private var settings: BrowserSettings = loadSettingsInternal()
    private val history: MutableList<HistoryEntry> = loadHistoryInternal()
    private val recommendations: MutableMap<String, RecommendedSite> = loadRecommendationsInternal()
    private val bookmarks: MutableList<BookmarkEntry> = loadBookmarksInternal()

    fun getSettings(): BrowserSettings = synchronized(lock) { settings }

    fun updateSettings(next: BrowserSettings): BrowserSettings = synchronized(lock) {
        val cleanEngine = TabManager.normalizeEngine(next.searchEngine)
        val cleanTheme = normalizeTheme(next.theme)
        val cleanZoom = next.textZoom.coerceIn(75, 160)
        settings = next.copy(searchEngine = cleanEngine, theme = cleanTheme, textZoom = cleanZoom)
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

    // === Bookmarks (Native Persistence) ===

    fun getBookmarksJson(): JSONArray = synchronized(lock) {
        JSONArray().apply { bookmarks.forEach { put(it.toJson()) } }
    }

    fun addBookmark(rawTitle: String, rawUrl: String, tag: String = "Saved"): BookmarkEntry? {
        val cleanUrl = rawUrl.trim()
        if (cleanUrl.isEmpty() || cleanUrl.startsWith("aegis://")) return null
        val hostTitle = AdBlockEngine.extractHost(cleanUrl)?.removePrefix("www.") ?: cleanUrl
        val cleanTitle = rawTitle.trim().ifEmpty { hostTitle }

        synchronized(lock) {
            if (bookmarks.any { it.url == cleanUrl }) return null
            val entry = BookmarkEntry(
                id = "bm-${System.currentTimeMillis()}-${cleanUrl.hashCode()}",
                title = cleanTitle,
                url = cleanUrl,
                tag = tag.ifBlank { "Saved" },
                pinned = true
            )
            bookmarks.add(0, entry)
            persistBookmarksLocked()
            return entry
        }
    }

    fun removeBookmark(id: String): Boolean = synchronized(lock) {
        val changed = bookmarks.removeAll { it.id == id || it.url == id }
        if (changed) persistBookmarksLocked()
        changed
    }

    fun importBookmarksIfUnset(jsonStr: String): Boolean {
        synchronized(lock) {
            if (prefs.getBoolean(KEY_BOOKMARKS_MIGRATED, false)) return false
            val imported = mutableListOf<BookmarkEntry>()
            runCatching {
                val arr = JSONArray(jsonStr)
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    val bUrl = o.optString("url").trim()
                    if (bUrl.isNotEmpty() && !bUrl.startsWith("aegis://")) {
                        imported.add(
                            BookmarkEntry(
                                id = o.optString("id").ifBlank { "bm-$i-${System.currentTimeMillis()}" },
                                title = o.optString("title").ifBlank { bUrl },
                                url = bUrl,
                                tag = o.optString("tag", "Saved"),
                                pinned = o.optBoolean("pinned", true)
                            )
                        )
                    }
                }
            }
            if (imported.isNotEmpty()) {
                bookmarks.clear()
                bookmarks.addAll(imported)
                persistBookmarksLocked()
            }
            prefs.edit().putBoolean(KEY_BOOKMARKS_MIGRATED, true).apply()
            return imported.isNotEmpty()
        }
    }

    // === Tab Session Restore ===

    fun saveOpenTabs(tabs: List<TabSession>, activeTabId: String) {
        if (!getSettings().restoreTabsOnStart) return
        val arr = JSONArray()
        tabs.filter { !it.incognito && !it.isAutoPopup }.forEach { t ->
            arr.put(
                JSONObject().apply {
                    put("url", t.url)
                    put("title", t.title)
                    put("desktopMode", t.desktopMode)
                    put("groupId", t.groupId ?: JSONObject.NULL)
                    put("groupTitle", t.groupTitle ?: JSONObject.NULL)
                    put("groupColor", t.groupColor ?: JSONObject.NULL)
                    put("isActive", t.id == activeTabId)
                }
            )
        }
        prefs.edit().putString(KEY_SAVED_TABS, arr.toString()).apply()
    }

    fun loadSavedTabs(): List<SavedTabSnapshot> {
        if (!getSettings().restoreTabsOnStart) return emptyList()
        val raw = prefs.getString(KEY_SAVED_TABS, null) ?: return emptyList()
        val result = mutableListOf<SavedTabSnapshot>()
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val u = o.optString("url")
                if (u.isNotBlank() && !u.startsWith("aegis://player")) {
                    result.add(
                        SavedTabSnapshot(
                            url = u,
                            title = o.optString("title", "Aegis Start"),
                            desktopMode = o.optBoolean("desktopMode", false),
                            groupId = o.optString("groupId").takeIf { it.isNotBlank() && it != "null" },
                            groupTitle = o.optString("groupTitle").takeIf { it.isNotBlank() && it != "null" },
                            groupColor = o.optString("groupColor").takeIf { it.isNotBlank() && it != "null" },
                            isActive = o.optBoolean("isActive", false)
                        )
                    )
                }
            }
        }
        return result
    }

    // === History & Recommendations ===

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
        JSONArray().apply { history.forEach { put(it.toJson()) } }
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

    private fun persistBookmarksLocked() {
        val arr = JSONArray()
        bookmarks.forEach { arr.put(it.toJson()) }
        prefs.edit().putString(KEY_BOOKMARKS, arr.toString()).apply()
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
                saveHistory = obj.optBoolean("saveHistory", true),
                textZoom = obj.optInt("textZoom", 100).coerceIn(75, 160),
                allowSitePermissionPrompts = obj.optBoolean("allowSitePermissionPrompts", true),
                restoreTabsOnStart = obj.optBoolean("restoreTabsOnStart", true)
            )
        }.getOrDefault(BrowserSettings(searchEngine = TabManager.normalizeEngine(fallbackEngine)))
    }

    private fun loadBookmarksInternal(): MutableList<BookmarkEntry> {
        val raw = prefs.getString(KEY_BOOKMARKS, null)
        if (raw == null) {
            return DEFAULT_BOOKMARKS.toMutableList()
        }
        val list = mutableListOf<BookmarkEntry>()
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val bUrl = o.optString("url")
                if (bUrl.isNotBlank() && !bUrl.startsWith("aegis://player")) {
                    list.add(
                        BookmarkEntry(
                            id = o.optString("id"),
                            title = o.optString("title"),
                            url = bUrl,
                            tag = o.optString("tag", "Saved"),
                            pinned = o.optBoolean("pinned", true)
                        )
                    )
                }
            }
        }
        return list
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
        private const val KEY_BOOKMARKS = "bookmarks_v1"
        private const val KEY_BOOKMARKS_MIGRATED = "bookmarks_migrated_v1"
        private const val KEY_SAVED_TABS = "saved_tabs_v1"
        private const val MAX_HISTORY = 200
        private const val MAX_REC_HOSTS = 40

        private val DEFAULT_BOOKMARKS = listOf(
            BookmarkEntry("bm-yt", "YouTube", "https://m.youtube.com", "Video", true),
            BookmarkEntry("bm-wiki", "Wikipedia", "https://en.wikipedia.org", "Wiki", true),
            BookmarkEntry("bm-github", "GitHub", "https://github.com", "Code", true),
            BookmarkEntry("bm-reddit", "Reddit", "https://www.reddit.com", "Social", true),
            BookmarkEntry("bm-bbc", "BBC News", "https://www.bbc.com", "News", true)
        )

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
