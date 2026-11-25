package com.aegis.browser.adblock

import android.content.Context
import java.io.File
import java.net.URI
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference

/**
 * High-speed, thread-safe Adblock Plus / uBlock / Hosts filter engine.
 *
 * Uses immutable snapshot swapping so WebViewClient.shouldInterceptRequest
 * evaluates thousands of domain and pattern rules with zero lock contention.
 */
class AdBlockEngine {

    private data class CompiledSnapshot(
        val blockedDomains: Map<String, DomainRuleMeta>,
        val exceptionDomains: Set<String>,
        val patternRules: List<UrlPatternRule>,
        val exceptionPatterns: List<UrlPatternRule>,
        val globalCosmeticSelectors: List<String>,
        val domainCosmeticSelectors: Map<String, List<String>>,
        val lastUpdatedIso: String?
    )

    private val snapshotRef = AtomicReference(
        CompiledSnapshot(
            blockedDomains = emptyMap(),
            exceptionDomains = emptySet(),
            patternRules = emptyList(),
            exceptionPatterns = emptyList(),
            globalCosmeticSelectors = emptyList(),
            domainCosmeticSelectors = emptyMap(),
            lastUpdatedIso = null
        )
    )

    private val configRef = AtomicReference(ShieldsConfig())

    fun getConfig(): ShieldsConfig = configRef.get()

    fun updateConfig(config: ShieldsConfig) {
        configRef.set(config)
    }

    fun getStats(): FilterStats {
        val snap = snapshotRef.get()
        val domainCosmeticCount = snap.domainCosmeticSelectors.values.sumOf { it.size }
        return FilterStats(
            domainRuleCount = snap.blockedDomains.size,
            patternRuleCount = snap.patternRules.size,
            exceptionRuleCount = snap.exceptionDomains.size + snap.exceptionPatterns.size,
            cosmeticSelectorCount = snap.globalCosmeticSelectors.size + domainCosmeticCount,
            lastUpdatedIso = snap.lastUpdatedIso
        )
    }

    fun loadFromContext(context: Context, lastUpdatedIso: String? = null) {
        val sources = mutableListOf<Pair<BlockCategory, String>>()

        // 1. Load bundled baseline lists from assets/filters
        val bundledFiles = listOf(
            "filters/easylist-core.txt" to BlockCategory.AD,
            "filters/easyprivacy-core.txt" to BlockCategory.TRACKER,
            "filters/ublock-ads-core.txt" to BlockCategory.POPUP,
            "filters/cosmetic-rules.txt" to BlockCategory.COSMETIC
        )
        for ((assetPath, category) in bundledFiles) {
            runCatching {
                context.assets.open(assetPath).bufferedReader().use { reader ->
                    sources.add(category to reader.readText())
                }
            }
        }

        // 2. Overlay downloaded filter caches stored on internal app storage
        val cacheDir = File(context.filesDir, "filters")
        if (cacheDir.exists()) {
            cacheDir.listFiles { f -> f.isFile && f.extension == "txt" }?.forEach { file ->
                val cat = when {
                    file.name.contains("privacy", ignoreCase = true) ||
                        file.name.contains("track", ignoreCase = true) -> BlockCategory.TRACKER
                    file.name.contains("badware", ignoreCase = true) ||
                        file.name.contains("popup", ignoreCase = true) -> BlockCategory.POPUP
                    else -> BlockCategory.AD
                }
                runCatching {
                    sources.add(cat to file.readText())
                }
            }
        }

        compileRules(sources, lastUpdatedIso)
    }

    fun compileRules(
        sources: List<Pair<BlockCategory, String>>,
        lastUpdatedIso: String? = null
    ) {
        val blockedDomains = HashMap<String, DomainRuleMeta>(4096)
        val exceptionDomains = HashSet<String>(256)
        val patternRules = ArrayList<UrlPatternRule>(512)
        val exceptionPatterns = ArrayList<UrlPatternRule>(64)
        val globalCosmetics = LinkedHashSet<String>(128)
        val domainCosmetics = HashMap<String, MutableList<String>>(64)

        for ((defaultCategory, text) in sources) {
            text.lineSequence().forEach { rawLine ->
                val line = rawLine.trim()
                if (line.isEmpty() || line.startsWith("!") || line.startsWith("[Adblock")) {
                    return@forEach
                }

                // Hosts file lines: 0.0.0.0 ads.example.com or 127.0.0.1 tracker.example.com
                if (line.startsWith("0.0.0.0 ") || line.startsWith("127.0.0.1 ")) {
                    parseHostLine(line, defaultCategory, blockedDomains)
                    return@forEach
                }

                if (line.startsWith("#")) {
                    if (line.startsWith("##")) {
                        val selector = line.substring(2).trim()
                        if (isSafeCosmeticSelector(selector)) {
                            globalCosmetics.add(selector)
                        }
                    }
                    return@forEach
                }

                // Exception cosmetic rules are ignored to prevent breaking global map
                if (line.contains("#@#")) {
                    return@forEach
                }

                // Domain-scoped cosmetic rule: example.com,m.example.com##.ad
                val cosmeticIdx = line.indexOf("##")
                if (cosmeticIdx > 0 && !line.startsWith("||") && !line.startsWith("@@")) {
                    val domainsPart = line.substring(0, cosmeticIdx)
                    val selector = line.substring(cosmeticIdx + 2).trim()
                    if (isSafeCosmeticSelector(selector)) {
                        domainsPart.split(',').forEach { d ->
                            val clean = d.trim().lowercase(Locale.ROOT)
                            if (clean.isNotEmpty() && !clean.startsWith("~")) {
                                domainCosmetics.getOrPut(clean) { mutableListOf() }.add(selector)
                            }
                        }
                    }
                    return@forEach
                }

                // Network rules
                val isException = line.startsWith("@@")
                val bodyAndOptions = if (isException) line.substring(2) else line
                val dollarIdx = bodyAndOptions.lastIndexOf('$')
                val ruleBody: String
                val optionsPart: String?
                if (dollarIdx > 0 && !bodyAndOptions.endsWith("/")) {
                    ruleBody = bodyAndOptions.substring(0, dollarIdx)
                    optionsPart = bodyAndOptions.substring(dollarIdx + 1)
                } else {
                    ruleBody = bodyAndOptions
                    optionsPart = null
                }

                val parsedOpts = parseOptions(optionsPart)
                val category = inferCategory(ruleBody, defaultCategory)

                // Fast-path pure domain rule: ||example.com^ or ||example.com^$third-party
                if (ruleBody.startsWith("||") && isPureDomainBody(ruleBody)) {
                    val domain = ruleBody.removePrefix("||").removeSuffix("^").lowercase(Locale.ROOT)
                    if (domain.isNotEmpty() && !domain.contains('*')) {
                        if (isException) {
                            exceptionDomains.add(domain)
                        } else if (parsedOpts.allowedDomains.isEmpty() &&
                            parsedOpts.excludedDomains.isEmpty() &&
                            !parsedOpts.scriptOnly
                        ) {
                            blockedDomains.putIfAbsent(
                                domain,
                                DomainRuleMeta(
                                    thirdPartyOnly = parsedOpts.thirdPartyOnly,
                                    category = category,
                                    raw = line
                                )
                            )
                            return@forEach
                        } else {
                            // Domain rule with domain=/script options falls through to pattern rules
                        }
                    }
                }

                val patternRule = compilePatternRule(
                    raw = line,
                    body = ruleBody,
                    opts = parsedOpts,
                    isException = isException,
                    category = category
                )
                if (patternRule != null) {
                    if (isException) {
                        exceptionPatterns.add(patternRule)
                    } else {
                        patternRules.add(patternRule)
                    }
                }
            }
        }

        snapshotRef.set(
            CompiledSnapshot(
                blockedDomains = blockedDomains,
                exceptionDomains = exceptionDomains,
                patternRules = patternRules,
                exceptionPatterns = exceptionPatterns,
                globalCosmeticSelectors = globalCosmetics.toList(),
                domainCosmeticSelectors = domainCosmetics,
                lastUpdatedIso = lastUpdatedIso ?: snapshotRef.get().lastUpdatedIso
            )
        )
    }

    fun evaluateRequest(
        requestUrl: String,
        pageUrl: String?,
        acceptHeader: String? = null,
        isMainFrame: Boolean = false
    ): BlockDecision {
        val cfg = configRef.get()
        val pageHost = extractHost(pageUrl)
        if (!cfg.enabled || !cfg.blockAdsAndTrackers || !cfg.isEnabledForHost(pageHost)) {
            return BlockDecision(blocked = false)
        }

        val lowerUrl = requestUrl.lowercase(Locale.ROOT)
        if (!lowerUrl.startsWith("http://") && !lowerUrl.startsWith("https://")) {
            return BlockDecision(blocked = false)
        }

        val requestHost = extractHost(lowerUrl) ?: return BlockDecision(blocked = false)

        // Never block Aegis internal asset server
        if (requestHost == "appassets.androidplatform.net") {
            return BlockDecision(blocked = false)
        }

        val snap = snapshotRef.get()
        val isThirdParty = isThirdParty(requestHost, pageHost)
        val isScript = looksLikeScript(lowerUrl, acceptHeader)

        // Check exception rules first
        if (matchesDomainSet(requestHost, snap.exceptionDomains)) {
            return BlockDecision(blocked = false)
        }
        for (ex in snap.exceptionPatterns) {
            if (matchesPatternRule(ex, lowerUrl, requestHost, pageHost, isThirdParty, isScript)) {
                return BlockDecision(blocked = false)
            }
        }

        // Preserve first-party media segments unless an explicit domain/path ad rule matches
        if (!isThirdParty && isMediaStreamSegment(lowerUrl)) {
            return BlockDecision(blocked = false)
        }

        // Do not aggressively break normal top-level navigation unless it's an ad/popunder host
        if (isMainFrame) {
            val domainHit = findMatchingDomainRule(requestHost, snap.blockedDomains)
            if (domainHit != null && domainHit.thirdPartyOnly != true) {
                return BlockDecision(
                    blocked = true,
                    matchedRule = domainHit.raw,
                    category = domainHit.category
                )
            }
            return BlockDecision(blocked = false)
        }

        // 1. O(depth) domain hash lookup
        val domainMatch = findMatchingDomainRule(requestHost, snap.blockedDomains)
        if (domainMatch != null) {
            val tpReq = domainMatch.thirdPartyOnly
            if (tpReq == null || tpReq == isThirdParty) {
                return BlockDecision(
                    blocked = true,
                    matchedRule = domainMatch.raw,
                    category = domainMatch.category
                )
            }
        }

        // 2. Compiled URL / path pattern rules
        for (rule in snap.patternRules) {
            if (matchesPatternRule(rule, lowerUrl, requestHost, pageHost, isThirdParty, isScript)) {
                return BlockDecision(
                    blocked = true,
                    matchedRule = rule.raw,
                    category = rule.category
                )
            }
        }

        return BlockDecision(blocked = false)
    }

    fun evaluateNavigation(
        targetUrl: String,
        currentPageUrl: String?,
        hasUserGesture: Boolean
    ): BlockDecision {
        val cfg = configRef.get()
        val pageHost = extractHost(currentPageUrl)
        if (!cfg.enabled || !cfg.isEnabledForHost(pageHost)) {
            return BlockDecision(blocked = false)
        }

        val lowerUrl = targetUrl.lowercase(Locale.ROOT)
        if (cfg.blockPopups && (lowerUrl.startsWith("intent://") || lowerUrl.startsWith("market://"))) {
            if (!hasUserGesture) {
                return BlockDecision(
                    blocked = true,
                    matchedRule = "scheme:${lowerUrl.substringBefore(':')}",
                    category = BlockCategory.POPUP
                )
            }
        }

        if (!lowerUrl.startsWith("http://") && !lowerUrl.startsWith("https://")) {
            return BlockDecision(blocked = false)
        }

        val targetHost = extractHost(lowerUrl) ?: return BlockDecision(blocked = false)
        val snap = snapshotRef.get()

        if (matchesDomainSet(targetHost, snap.exceptionDomains)) {
            return BlockDecision(blocked = false)
        }

        val domainMatch = findMatchingDomainRule(targetHost, snap.blockedDomains)
        if (domainMatch != null) {
            return BlockDecision(
                blocked = true,
                matchedRule = domainMatch.raw,
                category = BlockCategory.POPUP
            )
        }

        val isThirdParty = isThirdParty(targetHost, pageHost)
        if (cfg.blockPopups && !hasUserGesture && isThirdParty) {
            for (rule in snap.patternRules) {
                if (matchesPatternRule(rule, lowerUrl, targetHost, pageHost, isThirdParty = true, isScript = false)) {
                    return BlockDecision(
                        blocked = true,
                        matchedRule = rule.raw,
                        category = BlockCategory.POPUP
                    )
                }
            }
        }

        return BlockDecision(blocked = false)
    }

    fun getCosmeticSelectorsForHost(pageHost: String?): List<String> {
        val cfg = configRef.get()
        if (!cfg.enabled || !cfg.cosmeticFiltering || !cfg.isEnabledForHost(pageHost)) {
            return emptyList()
        }
        val snap = snapshotRef.get()
        val result = ArrayList<String>(snap.globalCosmeticSelectors.size + 16)
        result.addAll(snap.globalCosmeticSelectors)

        if (!pageHost.isNullOrBlank()) {
            var current: String? = pageHost.lowercase(Locale.ROOT)
            while (!current.isNullOrEmpty()) {
                snap.domainCosmeticSelectors[current]?.let { result.addAll(it) }
                val dot = current.indexOf('.')
                current = if (dot >= 0 && dot + 1 < current.length) current.substring(dot + 1) else null
            }
        }
        return result
    }

    private data class ParsedOptions(
        val thirdPartyOnly: Boolean? = null,
        val scriptOnly: Boolean = false,
        val allowedDomains: Set<String> = emptySet(),
        val excludedDomains: Set<String> = emptySet()
    )

    private fun parseHostLine(
        line: String,
        defaultCategory: BlockCategory,
        out: MutableMap<String, DomainRuleMeta>
    ) {
        val clean = line.substringBefore('#').trim()
        val parts = clean.split(Regex("\\s+"))
        if (parts.size >= 2) {
            val domain = parts[1].lowercase(Locale.ROOT)
            if (domain != "localhost" &&
                domain != "localhost.localdomain" &&
                domain != "0.0.0.0" &&
                domain != "255.255.255.255" &&
                domain.contains('.')
            ) {
                out.putIfAbsent(
                    domain,
                    DomainRuleMeta(
                        thirdPartyOnly = null,
                        category = defaultCategory,
                        raw = line
                    )
                )
            }
        }
    }

    private fun parseOptions(optionsPart: String?): ParsedOptions {
        if (optionsPart.isNullOrBlank()) return ParsedOptions()
        var thirdParty: Boolean? = null
        var scriptOnly = false
        val allowed = HashSet<String>()
        val excluded = HashSet<String>()

        optionsPart.split(',').forEach { rawOpt ->
            val opt = rawOpt.trim().lowercase(Locale.ROOT)
            when {
                opt == "third-party" || opt == "3p" -> thirdParty = true
                opt == "~third-party" || opt == "1p" || opt == "first-party" -> thirdParty = false
                opt == "script" -> scriptOnly = true
                opt.startsWith("domain=") -> {
                    opt.removePrefix("domain=").split('|').forEach { dom ->
                        val d = dom.trim()
                        if (d.startsWith("~") && d.length > 1) {
                            excluded.add(d.substring(1))
                        } else if (d.isNotEmpty()) {
                            allowed.add(d)
                        }
                    }
                }
            }
        }
        return ParsedOptions(thirdParty, scriptOnly, allowed, excluded)
    }

    private fun isPureDomainBody(body: String): Boolean {
        val stripped = body.removePrefix("||").removeSuffix("^")
        return stripped.isNotEmpty() &&
            !stripped.contains('/') &&
            !stripped.contains('*') &&
            !stripped.contains('?') &&
            !stripped.contains('^') &&
            stripped.contains('.')
    }

    private fun compilePatternRule(
        raw: String,
        body: String,
        opts: ParsedOptions,
        isException: Boolean,
        category: BlockCategory
    ): UrlPatternRule? {
        if (body.isBlank() || body == "*" || body.startsWith("/") && body.endsWith("/") && body.length > 2) {
            // Skip complex raw regex /.../ rules for guaranteed linear safety
            return null
        }

        val cleanBody = body.lowercase(Locale.ROOT)
        // Extract longest static alphanumeric/path token as fast pre-filter anchor
        val anchor = cleanBody
            .removePrefix("||")
            .removePrefix("|")
            .split('*', '^')
            .maxByOrNull { it.length }
            ?.takeIf { it.length >= 3 }
            ?: return null

        val regex = if (cleanBody.contains('*') || cleanBody.contains('^') || cleanBody.startsWith("||")) {
            runCatching { abpToRegex(cleanBody) }.getOrNull()
        } else {
            null
        }

        return UrlPatternRule(
            raw = raw,
            anchorLower = anchor,
            regex = regex,
            thirdPartyOnly = opts.thirdPartyOnly,
            allowedDomains = opts.allowedDomains,
            excludedDomains = opts.excludedDomains,
            scriptOnly = opts.scriptOnly,
            isException = isException,
            category = category
        )
    }

    private fun abpToRegex(pattern: String): Regex {
        val sb = StringBuilder()
        var p = pattern
        if (p.startsWith("||")) {
            sb.append("^https?://([^/]+\\.)?")
            p = p.substring(2)
        } else if (p.startsWith("|")) {
            sb.append("^")
            p = p.substring(1)
        }

        val endsWithPipe = p.endsWith("|")
        if (endsWithPipe) {
            p = p.substring(0, p.length - 1)
        }

        for (ch in p) {
            when (ch) {
                '*' -> sb.append(".*")
                '^' -> sb.append("([^a-zA-Z0-9_.%-]|$)")
                '.', '?', '+', '(', ')', '[', ']', '{', '}', '\\', '$', '|' -> {
                    sb.append('\\').append(ch)
                }
                else -> sb.append(ch)
            }
        }
        if (endsWithPipe) {
            sb.append("$")
        }
        return Regex(sb.toString())
    }

    private fun matchesPatternRule(
        rule: UrlPatternRule,
        lowerUrl: String,
        requestHost: String,
        pageHost: String?,
        isThirdParty: Boolean,
        isScript: Boolean
    ): Boolean {
        if (!lowerUrl.contains(rule.anchorLower)) return false
        if (rule.thirdPartyOnly != null && rule.thirdPartyOnly != isThirdParty) return false
        if (rule.scriptOnly && !isScript) return false

        if (rule.allowedDomains.isNotEmpty()) {
            if (pageHost == null || !matchesDomainSet(pageHost, rule.allowedDomains)) return false
        }
        if (rule.excludedDomains.isNotEmpty() && pageHost != null) {
            if (matchesDomainSet(pageHost, rule.excludedDomains)) return false
        }

        return rule.regex?.containsMatchIn(lowerUrl) ?: lowerUrl.contains(rule.anchorLower)
    }

    private fun findMatchingDomainRule(
        host: String,
        map: Map<String, DomainRuleMeta>
    ): DomainRuleMeta? {
        var current: String? = host
        while (!current.isNullOrEmpty()) {
            map[current]?.let { return it }
            val dot = current.indexOf('.')
            current = if (dot >= 0 && dot + 1 < current.length) current.substring(dot + 1) else null
        }
        return null
    }

    private fun matchesDomainSet(host: String, set: Set<String>): Boolean {
        if (set.isEmpty()) return false
        var current: String? = host
        while (!current.isNullOrEmpty()) {
            if (set.contains(current)) return true
            val dot = current.indexOf('.')
            current = if (dot >= 0 && dot + 1 < current.length) current.substring(dot + 1) else null
        }
        return false
    }

    private fun inferCategory(ruleBody: String, defaultCategory: BlockCategory): BlockCategory {
        val l = ruleBody.lowercase(Locale.ROOT)
        return when {
            l.contains("popad") || l.contains("popcash") || l.contains("popunder") ||
                l.contains("clickadu") || l.contains("onclick") || l.contains("redirect") -> BlockCategory.POPUP
            l.contains("analytics") || l.contains("track") || l.contains("pixel") ||
                l.contains("beacon") || l.contains("metric") || l.contains("telemetry") -> BlockCategory.TRACKER
            else -> defaultCategory
        }
    }

    private fun isSafeCosmeticSelector(selector: String): Boolean {
        if (selector.isBlank() || selector.length > 180) return false
        if (selector.contains(":has(") || selector.contains(":xpath(") || selector.contains("+js(")) {
            return false
        }
        return !selector.contains('{') && !selector.contains('}')
    }

    companion object {
        private val MULTI_PART_SUFFIXES = setOf(
            "co.uk", "org.uk", "ac.uk", "co.in", "net.in", "org.in",
            "com.au", "net.au", "co.jp", "co.kr", "com.br", "com.mx", "co.za"
        )

        fun extractHost(url: String?): String? {
            if (url.isNullOrBlank()) return null
            return try {
                val parsed = URI(url.trim())
                parsed.host?.lowercase(Locale.ROOT)?.trimEnd('.')
            } catch (_: Exception) {
                val afterScheme = url.substringAfter("://", url)
                afterScheme.substringBefore('/').substringBefore('?').substringBefore(':')
                    .lowercase(Locale.ROOT).takeIf { it.contains('.') }
            }
        }

        fun registrableDomain(host: String): String {
            val parts = host.split('.')
            if (parts.size <= 2) return host
            val lastTwo = "${parts[parts.size - 2]}.${parts[parts.size - 1]}"
            return if (lastTwo in MULTI_PART_SUFFIXES && parts.size >= 3) {
                "${parts[parts.size - 3]}.$lastTwo"
            } else {
                lastTwo
            }
        }

        fun isThirdParty(requestHost: String, pageHost: String?): Boolean {
            if (pageHost.isNullOrBlank()) return false
            return registrableDomain(requestHost) != registrableDomain(pageHost)
        }

        private fun looksLikeScript(lowerUrl: String, acceptHeader: String?): Boolean {
            if (acceptHeader?.contains("javascript", ignoreCase = true) == true) return true
            val pathOnly = lowerUrl.substringBefore('?').substringBefore('#')
            return pathOnly.endsWith(".js") || pathOnly.endsWith(".mjs")
        }

        private fun isMediaStreamSegment(lowerUrl: String): Boolean {
            val pathOnly = lowerUrl.substringBefore('?').substringBefore('#')
            return pathOnly.endsWith(".m3u8") ||
                pathOnly.endsWith(".mpd") ||
                pathOnly.endsWith(".ts") ||
                pathOnly.endsWith(".m4s") ||
                pathOnly.endsWith(".mp4") ||
                pathOnly.endsWith(".webm")
        }
    }
}
