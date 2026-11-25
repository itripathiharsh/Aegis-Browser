package com.aegis.browser.adblock

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
            .take(250)
            .toList()

        val cssText = if (safeSelectors.isNotEmpty()) {
            safeSelectors.joinToString(",") +
                "{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;pointer-events:none!important;}"
        } else {
            ""
        }

        val escapedCss = JSONObject.quote(cssText)

        return """
            (function() {
              try {
                var css = $escapedCss;
                if (css) {
                  var style = document.getElementById('aegis-cosmetic-style');
                  if (!style) {
                    style = document.createElement('style');
                    style.id = 'aegis-cosmetic-style';
                    (document.head || document.documentElement).appendChild(style);
                  }
                  if (style.textContent !== css) {
                    style.textContent = css;
                  }
                }
                if (window.__aegisShieldsActive) return;
                window.__aegisShieldsActive = true;
                ${if (enableAdSkipScriptlet) buildRuntimeScriptlet() else ""}
              } catch (e) {}
            })();
        """.trimIndent()
    }

    private fun buildRuntimeScriptlet(): String = """
        // Guard navigator.sendBeacon against common tracker sinks
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

        // Guard programmatic pop-under window.open calls
        var origOpen = window.open;
        window.open = function(url, target, features) {
          try {
            var u = String(url || '').toLowerCase();
            if (!u || u === 'about:blank' || u.indexOf('popads') !== -1 || u.indexOf('propeller') !== -1) {
              return { closed: true, close: function(){}, focus: function(){}, blur: function(){} };
            }
          } catch (_) {}
          return origOpen.apply(window, arguments);
        };

        // Smooth HTML5 video ad overlay & skip-button helper
        var skipTick = function() {
          try {
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
        if (typeof MutationObserver === 'function') {
          var timer = null;
          var obs = new MutationObserver(function() {
            if (timer) return;
            timer = setTimeout(function() {
              timer = null;
              skipTick();
            }, 250);
          });
          if (document.documentElement) {
            obs.observe(document.documentElement, { childList: true, subtree: true });
          }
        }
    """.trimIndent()
}
