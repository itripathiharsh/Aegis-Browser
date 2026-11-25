package com.aegis.browser.updater

import org.json.JSONArray

data class ParsedSemver(
    val major: Int,
    val minor: Int,
    val patch: Int,
    val preRelease: String?
) : Comparable<ParsedSemver> {
    override fun compareTo(other: ParsedSemver): Int {
        if (major != other.major) return major.compareTo(other.major)
        if (minor != other.minor) return minor.compareTo(other.minor)
        if (patch != other.patch) return patch.compareTo(other.patch)
        return when {
            preRelease == null && other.preRelease == null -> 0
            preRelease == null -> 1
            other.preRelease == null -> -1
            else -> preRelease.compareTo(other.preRelease, ignoreCase = true)
        }
    }
}

data class ApkReleaseAsset(
    val name: String,
    val downloadUrl: String,
    val sizeBytes: Long
)

object SemverComparator {

    fun normalizeTag(raw: String): String {
        return raw.trim()
            .removePrefix("v")
            .removePrefix("V")
            .substringBefore('+')
            .replace(Regex("-debug$", RegexOption.IGNORE_CASE), "")
    }

    fun parse(raw: String): ParsedSemver? {
        val cleaned = normalizeTag(raw)
        if (cleaned.isEmpty()) return null
        val dashIdx = cleaned.indexOf('-')
        val core = if (dashIdx >= 0) cleaned.substring(0, dashIdx) else cleaned
        val pre = if (dashIdx >= 0 && dashIdx + 1 < cleaned.length) {
            cleaned.substring(dashIdx + 1)
        } else {
            null
        }
        val parts = core.split('.')
        if (parts.isEmpty()) return null
        val major = parts.getOrNull(0)?.toIntOrNull() ?: return null
        val minor = parts.getOrNull(1)?.toIntOrNull() ?: 0
        val patch = parts.getOrNull(2)?.toIntOrNull() ?: 0
        return ParsedSemver(major, minor, patch, pre)
    }

    fun isNewerVersion(latestTag: String, currentVersion: String): Boolean {
        val latest = parse(latestTag) ?: return false
        val current = parse(currentVersion) ?: return false
        return latest > current
    }

    fun pickBestApkAsset(assets: JSONArray): ApkReleaseAsset? {
        var fallback: ApkReleaseAsset? = null
        for (i in 0 until assets.length()) {
            val obj = assets.optJSONObject(i) ?: continue
            val name = obj.optString("name", "")
            val url = obj.optString("browser_download_url", "")
            val size = obj.optLong("size", 0L)
            if (!name.endsWith(".apk", ignoreCase = true) || url.isBlank()) continue

            val candidate = ApkReleaseAsset(name = name, downloadUrl = url, sizeBytes = size)
            val lowerName = name.lowercase()
            if (!lowerName.contains("debug") && !lowerName.contains("unsigned")) {
                return candidate
            }
            if (fallback == null) {
                fallback = candidate
            }
        }
        return fallback
    }
}
