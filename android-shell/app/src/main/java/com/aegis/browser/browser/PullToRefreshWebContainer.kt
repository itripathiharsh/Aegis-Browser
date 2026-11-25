package com.aegis.browser.browser

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import kotlin.math.min

/**
 * Lightweight native pull-to-refresh wrapper for WebView without external dependencies.
 * Triggers only when WebView is scrolled to top (scrollY == 0) and user drags downward cleanly.
 */
class PullToRefreshWebContainer(
    context: Context,
    private val webView: WebView,
    private val isDarkTheme: () -> Boolean,
    private val onRefresh: () -> Unit
) : FrameLayout(context) {

    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private val triggerDistancePx = (76 * resources.displayMetrics.density)
    private val maxPullPx = (112 * resources.displayMetrics.density)

    private var startY = 0f
    private var startX = 0f
    private var pulling = false
    private var pullDistance = 0f

    private val pillView = TextView(context).apply {
        textSize = 12f
        setPadding(dp(14), dp(7), dp(14), dp(7))
        gravity = Gravity.CENTER
        visibility = GONE
        elevation = dp(4).toFloat()
    }

    init {
        addView(
            webView,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        )
        val pillLp = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = dp(10)
        }
        addView(pillView, pillLp)
        updateIndicatorColors()
    }

    fun updateIndicatorColors() {
        val dark = isDarkTheme()
        val bgColor = Color.parseColor(if (dark) "#1D222C" else "#FFFFFF")
        val borderColor = Color.parseColor(if (dark) "#30FFFFFF" else "#200F172A")
        val textColor = Color.parseColor(if (dark) "#F3F4F6" else "#111827")
        pillView.setTextColor(textColor)
        pillView.background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(999).toFloat()
            setColor(bgColor)
            setStroke(1, borderColor)
        }
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                startY = ev.y
                startX = ev.x
                pulling = false
                pullDistance = 0f
            }
            MotionEvent.ACTION_MOVE -> {
                if (webView.scrollY == 0) {
                    val dy = ev.y - startY
                    val dx = kotlin.math.abs(ev.x - startX)
                    if (dy > touchSlop * 1.5f && dy > dx * 1.4f) {
                        pulling = true
                        return true
                    }
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                pulling = false
            }
        }
        return super.onInterceptTouchEvent(ev)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!pulling) return super.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> {
                val dy = (event.y - startY).coerceAtLeast(0f)
                pullDistance = min(maxPullPx, dy * 0.55f)
                val ready = pullDistance >= triggerDistancePx
                updateIndicatorColors()
                pillView.visibility = VISIBLE
                pillView.translationY = (pullDistance * 0.45f) - dp(4)
                pillView.alpha = (pullDistance / triggerDistancePx).coerceIn(0.25f, 1f)
                pillView.text = if (ready) "Release to refresh" else "Pull to refresh"
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val triggered = pullDistance >= triggerDistancePx
                pulling = false
                pullDistance = 0f
                pillView.visibility = GONE
                if (triggered) {
                    onRefresh()
                }
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
