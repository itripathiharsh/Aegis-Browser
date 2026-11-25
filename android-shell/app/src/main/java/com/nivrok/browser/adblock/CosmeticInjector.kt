package com.nivrok.browser.adblock

import org.json.JSONObject

object CosmeticInjector {

    fun buildInjectionScript(
        selectors: List<String>,
        enableAdSkipScriptlet: Boolean
    ): String {
        val safeSelectors = selectors
            .asSequence()
            .filter { it.isNotBlank() && !it.contains('\n') && !it.contains('\r') }
            .distinct()
            .take(280)
            .toList()

        val cssText = if (safeSelectors.isNotEmpty()) {
            safeSelectors.joinToString(",") +
                "{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;pointer-events:none!important;}"
        } else {
            ""
        }

        val escapedCss = JSONObject.quote(cssText)

        // Always verify & re-apply <style> tag if missing (handles early onPageStarted & SPA head resets)
        return """
            (function() {
              try {
                var css = $escapedCss;
                var root = document.head || document.documentElement;
                if (css && root) {
                  var style = document.getElementById('nivrok-cosmetic-style');
                  if (!style) {
                    style = document.createElement('style');
                    style.id = 'nivrok-cosmetic-style';
                    root.appendChild(style);
                  }
                  if (style.textContent !== css) {
                    style.textContent = css;
                  }
                }
                if (window.__nivrokHooksAttached || !document.documentElement) return;
                window.__nivrokHooksAttached = true;
                ${if (enableAdSkipScriptlet) buildRuntimeScriptlet(escapedCss) else ""}
              } catch (e) {}
            })();
        """.trimIndent()
    }

    private fun buildRuntimeScriptlet(escapedCss: String): String = """
        // Track whether last user tap was directly inside a visible <a href> link
        var lastRealAnchorTs = 0;
        document.addEventListener('click', function(ev) {
          try {
            var el = ev.target;
            while (el && el !== document.documentElement) {
              if (el.tagName === 'A' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) {
                var st = window.getComputedStyle(el);
                if (st && parseFloat(st.opacity) > 0.1) {
                  lastRealAnchorTs = Date.now();
                }
                break;
              }
              el = el.parentElement;
            }
          } catch (_) {}
        }, true);

        // Guard navigator.sendBeacon against tracker sinks
        if (typeof navigator.sendBeacon === 'function') {
          var origBeacon = navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon = function(url, data) {
            try {
              var u = String(url || '').toLowerCase();
              if (u.indexOf('doubleclick.net') !== -1 ||
                  u.indexOf('google-analytics.com') !== -1 ||
                  u.indexOf('clarity.ms') !== -1 ||
                  u.indexOf('/ptracking') !== -1 ||
                  u.indexOf('/api/stats/ads') !== -1) {
                return true;
              }
            } catch (_) {}
            return origBeacon(url, data);
          };
        }

        // Guard programmatic pop-under & third-party click-hijack window.open calls
        var origOpen = window.open;
        var badTokens = ['popads', 'propeller', 'adsterra', 'monetag', 'exoclick', 'clickadu', 'juicyads', 'trafficjunky', 'zoneid=', 'click_id=', 'afu.php'];
        window.open = function(url, target, features) {
          try {
            var u = String(url || '').toLowerCase();
            if (!u || u === 'about:blank') {
              return { closed: true, close: function(){}, focus: function(){}, blur: function(){} };
            }
            for (var i = 0; i < badTokens.length; i++) {
              if (u.indexOf(badTokens[i]) !== -1) {
                return { closed: true, close: function(){}, focus: function(){}, blur: function(){} };
              }
            }
            if (u.indexOf('http') === 0) {
              var targetHost = (new URL(u, location.href)).hostname;
              var isExternal = targetHost && targetHost !== location.hostname;
              if (isExternal && (Date.now() - lastRealAnchorTs > 1500)) {
                return { closed: true, close: function(){}, focus: function(){}, blur: function(){} };
              }
            }
          } catch (_) {}
          return origOpen.apply(window, arguments);
        };

        // Neutralize invisible full-screen click-hijack overlays & speed-skip HTML5 video ads
        var cleanOverlaysAndAds = function() {
          try {
            var css = $escapedCss;
            if (css && !document.getElementById('nivrok-cosmetic-style')) {
              var r = document.head || document.documentElement;
              if (r) {
                var st = document.createElement('style');
                st.id = 'nivrok-cosmetic-style';
                st.textContent = css;
                r.appendChild(st);
              }
            }
            var vw = window.innerWidth || 0;
            var vh = window.innerHeight || 0;
            if (vw > 100 && vh > 100) {
              var fixedNodes = document.querySelectorAll('div[style*="fixed"], a[style*="fixed"], div[style*="z-index"], a[style*="z-index"]');
              for (var i = 0; i < fixedNodes.length && i < 60; i++) {
                var node = fixedNodes[i];
                var cs = window.getComputedStyle(node);
                if (!cs || cs.position !== 'fixed') continue;
                var z = parseInt(cs.zIndex, 10) || 0;
                if (z < 999) continue;
                var rect = node.getBoundingClientRect();
                if (rect.width >= vw * 0.65 && rect.height >= vh * 0.55) {
                  var op = parseFloat(cs.opacity || '1');
                  var hasText = (node.innerText || '').trim().length > 0;
                  var hasInteractive = node.querySelector('video, input, form, button[type="submit"]');
                  if (!hasInteractive && (op <= 0.1 || (!hasText && cs.backgroundColor === 'rgba(0, 0, 0, 0)'))) {
                    node.style.setProperty('pointer-events', 'none', 'important');
                    node.style.setProperty('display', 'none', 'important');
                  }
                }
              }
            }
            var skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, [class*="skip-ad"]');
            if (skipBtn && typeof skipBtn.click === 'function') {
              skipBtn.click();
            }
            var player = document.querySelector('.html5-video-player.ad-showing video');
            if (player && isFinite(player.duration) && player.duration > 0 && player.currentTime < player.duration - 0.25) {
              player.muted = true;
              player.currentTime = player.duration - 0.1;
            }
          } catch (_) {}
        };

        cleanOverlaysAndAds();
        if (typeof MutationObserver === 'function') {
          var timer = null;
          var obs = new MutationObserver(function() {
            if (timer) return;
            timer = setTimeout(function() {
              timer = null;
              cleanOverlaysAndAds();
            }, 250);
          });
          obs.observe(document.documentElement, { childList: true, subtree: true });
        }
    """.trimIndent()
}
