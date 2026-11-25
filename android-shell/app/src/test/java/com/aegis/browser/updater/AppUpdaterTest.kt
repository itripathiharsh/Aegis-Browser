package com.aegis.browser.updater

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdaterTest {

    @Test
    fun comparesSemanticVersionsWithPrefixAndDebugSuffix() {
        assertTrue(SemverComparator.isNewerVersion("v1.0.2", "1.0.0-debug"))
        assertTrue(SemverComparator.isNewerVersion("v1.1.0", "1.0.9"))
        assertTrue(SemverComparator.isNewerVersion("2.0.0", "v1.9.9"))
        assertTrue(SemverComparator.isNewerVersion("v1.0.2", "1.0.2-beta.1"))

        assertFalse(SemverComparator.isNewerVersion("v1.0.0", "1.0.0-debug"))
        assertFalse(SemverComparator.isNewerVersion("v1.0.1", "1.0.2"))
        assertFalse(SemverComparator.isNewerVersion("v1.0.2-rc.1", "1.0.2"))
    }

    @Test
    fun prefersSignedReleaseApkOverDebugAsset() {
        val assets = JSONArray().apply {
            put(
                JSONObject()
                    .put("name", "app-debug.apk")
                    .put("browser_download_url", "https://example.com/app-debug.apk")
                    .put("size", 3500000L)
            )
            put(
                JSONObject()
                    .put("name", "AegisBrowser-v1.0.2.apk")
                    .put("browser_download_url", "https://example.com/AegisBrowser-v1.0.2.apk")
                    .put("size", 850000L)
            )
        }

        val picked = SemverComparator.pickBestApkAsset(assets)
        assertNotNull(picked)
        assertEquals("AegisBrowser-v1.0.2.apk", picked?.name)
        assertEquals(850000L, picked?.sizeBytes)
    }
}
