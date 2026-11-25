# Nivrok — Design Plan

IDEA: Obsidian Shield Console — a precision dark-mode browser deck engineered for OLED phones and 10-foot TVs, pairing calm slate surfaces with a single live amber-flame privacy shield telemetry counter.

COLOR:
- Ground:      #090C10 (deep OLED obsidian slate)
- Surface 1:   #11161D (top chrome deck, panels)
- Surface 2:   #18202B (inputs, tab pills, cards)
- Surface 3:   #212C3A (elevated active/hover controls)
- Ink Primary: #EDF2F7 (15.8:1 on ground)
- Ink Muted:   #93A3B8 (6.7:1 on ground)
- Accent:      #FF6B2B (Shield Flame; hover #FF824D; TV Focus Halo #FFB067)
- Signals:     #22C55E (Shield Active), #38BDF8 (Hardware Video / HLS), #EF4444 (Blocked Threat), #F59E0B (Warning)

TYPE:
- UI / Display: Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif (zero network latency)
- Data / Rules: JetBrains Mono, ui-monospace, Consolas, monospace with `font-variant-numeric: tabular-nums`
- Scale: 1.15 modular clamp() scale (`0.75rem` floor up to `2.15rem` home headline)
- Weights: 400 body, 500 labels, 600 buttons/headings, 700 counters

LAYOUT:
```
+-----------------------------------------------------------------------+
| [<] [>] [R] | [ Lock  https://site.example / search...        Go ]    |
|             | [Tabs: 2] [Bookmarks] [Shields: 142 Blocked] [TV/Home]  |
+-----------------------------------------------------------------------+
|                                                                       |
|  Content WebView (Native hardware-accelerated viewport)               |
|  OR Expanded Nivrok Start Page / Tabs / Bookmarks / Shields Drawer    |
|                                                                       |
+-----------------------------------------------------------------------+
```
- Mobile (320px-639px): wraps action clusters cleanly across two compact rows (nav+omnibox, then quick tools/shields pill) with 44px targets and zero horizontal overflow.
- TV / Wide (>= 960px): single crisp cockpit bar with generous focus gaps and 48px+ targets.

SHAPE:
- 6px (`--radius-sm`) for rule logs and micro-chips
- 10px (`--radius-md`) for omnibox, nav buttons, and speed-dial cards
- 14px (`--radius-lg`) for modal drawers (Tabs, Bookmarks, Shields)
- 999px (`--radius-pill`) for live Shields blocked counter and tab count badges

MOTION:
- Orchestrated entrance: crisp 220ms fade-lift on Start Page shield deck when opening `nivrok://home`.
- Reactive microinteractions: 110ms press scale (`0.97`), subtle amber pulse ring on the live blocked counter when new requests are blocked; fully disabled under `prefers-reduced-motion: reduce`.

IMAGERY:
- 100% code-drawn inline SVG (geometric Nivrok Crest logo, shield status emblem, crisp vector nav/media icons, subtle radial backdrop mesh — zero external image URLs).

PRINCIPLES:
1. Content viewport comes first: chrome stays lean, zero bloated news feeds or crypto wallets.
2. Focus is unmistakable from 3 meters away: high-contrast 3px `#FFB067` focus ring on every interactive control for TV remotes.
3. No unstyled or clipped controls between 320px phones and 1920px TVs.
