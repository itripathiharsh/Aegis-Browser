package com.nivrok.browser.adblock

enum class BlockCategory(val wireName: String) {
    AD("ads"),
    TRACKER("trackers"),
    POPUP("popups"),
    COSMETIC("cosmetic")
}

data class ShieldsConfig(
    val enabled: Boolean = true,
    val blockAdsAndTrackers: Boolean = true,
    val blockPopups: Boolean = true,
    val cosmeticFiltering: Boolean = true,
    val disabledHosts: Set<String> = emptySet()
) {
    fun isEnabledForHost(host: String?): Boolean {
        if (!enabled) return false
        if (host.isNullOrBlank()) return true
        val normalized = host.lowercase().trimStart('.')
        return !disabledHosts.any { disabled ->
            normalized == disabled || normalized.endsWith(".$disabled")
        }
    }
}

data class DomainRuleMeta(
    val thirdPartyOnly: Boolean?,
    val category: BlockCategory,
    val raw: String,
    val documentOrPopup: Boolean = false,
    val allowedDomains: Set<String> = emptySet(),
    val excludedDomains: Set<String> = emptySet()
)

data class UrlPatternRule(
    val raw: String,
    val anchorLower: String,
    val regex: Regex?,
    val thirdPartyOnly: Boolean?,
    val allowedDomains: Set<String>,
    val excludedDomains: Set<String>,
    val scriptOnly: Boolean,
    val isException: Boolean,
    val category: BlockCategory,
    val documentOrPopup: Boolean = false,
    val hostScope: String? = null
)

data class BlockDecision(
    val blocked: Boolean,
    val matchedRule: String? = null,
    val category: BlockCategory = BlockCategory.AD
)

data class BlockedEvent(
    val url: String,
    val host: String,
    val pageHost: String,
    val rule: String,
    val category: BlockCategory,
    val timestampMs: Long
)

data class FilterStats(
    val domainRuleCount: Int,
    val patternRuleCount: Int,
    val exceptionRuleCount: Int,
    val cosmeticSelectorCount: Int,
    val lastUpdatedIso: String?
)

data class FilterSourceConfig(
    val id: String,
    val name: String,
    val category: BlockCategory,
    val url: String,
    val enabled: Boolean,
    val lastSyncedIso: String? = null,
    val cachedRuleCount: Int = 0
)

data class FilterSyncResult(
    val syncedSources: Int,
    val failedSources: Int,
    val totalRules: Int,
    val lastUpdatedIso: String,
    val message: String
)
