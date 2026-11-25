package com.nivrok.browser.adblock

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class ShieldsTelemetry(
    private val onStatsChanged: () -> Unit
) {
    private val totalBlocked = AtomicLong(0L)
    private val adsBlocked = AtomicLong(0L)
    private val trackersBlocked = AtomicLong(0L)
    private val popupsBlocked = AtomicLong(0L)
    private val perTabCounts = ConcurrentHashMap<String, AtomicLong>()
    private val recentLock = Any()
    private val recentEvents = ArrayDeque<BlockedEvent>(MAX_RECENT)

    fun recordBlocked(tabId: String, event: BlockedEvent) {
        totalBlocked.incrementAndGet()
        when (event.category) {
            BlockCategory.AD, BlockCategory.COSMETIC -> adsBlocked.incrementAndGet()
            BlockCategory.TRACKER -> trackersBlocked.incrementAndGet()
            BlockCategory.POPUP -> popupsBlocked.incrementAndGet()
        }
        perTabCounts.computeIfAbsent(tabId) { AtomicLong(0L) }.incrementAndGet()
        synchronized(recentLock) {
            if (recentEvents.size >= MAX_RECENT) {
                recentEvents.removeFirst()
            }
            recentEvents.addLast(event)
        }
        onStatsChanged()
    }

    fun getTabCount(tabId: String): Long = perTabCounts[tabId]?.get() ?: 0L

    fun resetTabCount(tabId: String) {
        perTabCounts[tabId]?.set(0L)
    }

    fun removeTab(tabId: String) {
        perTabCounts.remove(tabId)
    }

    fun getTotalBlocked(): Long = totalBlocked.get()
    fun getAdsBlocked(): Long = adsBlocked.get()
    fun getTrackersBlocked(): Long = trackersBlocked.get()
    fun getPopupsBlocked(): Long = popupsBlocked.get()

    fun getRecentEvents(): List<BlockedEvent> = synchronized(recentLock) {
        recentEvents.toList().asReversed()
    }

    companion object {
        private const val MAX_RECENT = 80
    }
}
