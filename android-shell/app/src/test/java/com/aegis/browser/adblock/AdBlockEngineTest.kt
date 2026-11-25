package com.aegis.browser.adblock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdBlockEngineTest {

    private fun sampleEngine(): AdBlockEngine {
        val engine = AdBlockEngine()
        engine.compileRules(
            listOf(
                BlockCategory.AD to """
                    ! EasyList sample
                    ||doubleclick.net^
                    ||googlesyndication.com^
                    ||taboola.com^${'$'}third-party
                    /pagead/js/adsbygoogle.js${'$'}script
                    @@||cdn.jsdelivr.net^
                    ||youtube.com/pagead/
                    ##.adsbygoogle
                    youtube.com###player-ads
                """.trimIndent(),
                BlockCategory.TRACKER to """
                    ||google-analytics.com^
                    0.0.0.0 clarity.ms
                """.trimIndent(),
                BlockCategory.POPUP to """
                    ||popads.net^
                    ||propellerads.com^
                """.trimIndent()
            )
        )
        return engine
    }

    @Test
    fun blocksAdNetworkDomainsAndSubdomains() {
        val engine = sampleEngine()
        val decision = engine.evaluateRequest(
            requestUrl = "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
            pageUrl = "https://news.example.com/article",
            acceptHeader = "application/javascript"
        )
        assertTrue(decision.blocked)
        assertEquals(BlockCategory.AD, decision.category)
    }

    @Test
    fun enforcesThirdPartyRulesWithoutBreakingFirstParty() {
        val engine = sampleEngine()
        val firstParty = engine.evaluateRequest(
            requestUrl = "https://cdn.taboola.com/libtrc/impl.js",
            pageUrl = "https://www.taboola.com/dashboard",
            acceptHeader = "application/javascript"
        )
        assertFalse("First-party request should pass third-party rule", firstParty.blocked)

        val thirdParty = engine.evaluateRequest(
            requestUrl = "https://cdn.taboola.com/libtrc/impl.js",
            pageUrl = "https://blog.example.co.uk/post",
            acceptHeader = "application/javascript"
        )
        assertTrue("Third-party request should be blocked", thirdParty.blocked)
    }

    @Test
    fun parsesHostsFormatAndScriptPatternRules() {
        val engine = sampleEngine()
        val clarity = engine.evaluateRequest(
            requestUrl = "https://www.clarity.ms/tag/abc123",
            pageUrl = "https://shop.example.com/"
        )
        assertTrue(clarity.blocked)
        assertEquals(BlockCategory.TRACKER, clarity.category)

        val adsbygoogle = engine.evaluateRequest(
            requestUrl = "https://example.com/pagead/js/adsbygoogle.js",
            pageUrl = "https://example.com/",
            acceptHeader = "text/javascript"
        )
        assertTrue(adsbygoogle.blocked)
    }

    @Test
    fun honorsExceptionRulesAndPreservesHlsVideoSegments() {
        val engine = sampleEngine()
        val cdnAllowed = engine.evaluateRequest(
            requestUrl = "https://cdn.jsdelivr.net/npm/hls.js@latest",
            pageUrl = "https://player.example.com/"
        )
        assertFalse(cdnAllowed.blocked)

        val firstPartyHls = engine.evaluateRequest(
            requestUrl = "https://cdn.stream.example.com/live/segment_042.ts",
            pageUrl = "https://stream.example.com/watch"
        )
        assertFalse(firstPartyHls.blocked)

        val ytAdPath = engine.evaluateRequest(
            requestUrl = "https://www.youtube.com/pagead/viewthroughconversion",
            pageUrl = "https://www.youtube.com/watch?v=123"
        )
        assertTrue(ytAdPath.blocked)
    }

    @Test
    fun blocksPopunderNavigationAndRespectsPerSiteToggle() {
        val engine = sampleEngine()
        val popupDecision = engine.evaluateNavigation(
            targetUrl = "https://serve.popads.net/pop.php?id=99",
            currentPageUrl = "https://movies.example.com/",
            hasUserGesture = false
        )
        assertTrue(popupDecision.blocked)
        assertEquals(BlockCategory.POPUP, popupDecision.category)

        engine.updateConfig(ShieldsConfig(disabledHosts = setOf("movies.example.com")))
        val disabledSiteDecision = engine.evaluateRequest(
            requestUrl = "https://doubleclick.net/ad.js",
            pageUrl = "https://movies.example.com/watch"
        )
        assertFalse("Disabled host must bypass shields", disabledSiteDecision.blocked)
    }

    @Test
    fun returnsGlobalAndDomainCosmeticSelectors() {
        val engine = sampleEngine()
        val ytSelectors = engine.getCosmeticSelectorsForHost("m.youtube.com")
        assertTrue(ytSelectors.contains(".adsbygoogle"))
        assertTrue(ytSelectors.contains("#player-ads"))
    }
}
