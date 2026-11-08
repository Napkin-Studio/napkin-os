# Phase 26 (2026-11-09): no Draft chip in the OS bar (state lives in the panel's Report box);
# Evidence map opens in the panel, which widens beside the report; the report stays visible.
rep("        $('research-sheet').hidden = map; $('rb-mapview').hidden = !map;",
    "        ws.classList.toggle('ws-map', map); $('rb-mapview').hidden = !map;\n        if (map && $('rb-mapview').parentNode !== $('r-side')) $('rb-viewsw').after($('rb-mapview'));")
rep("        window.scrollTo({ top: 0, behavior: 'instant' });\n      };\n      window.rbOpenMap", "      };\n      window.rbOpenMap")
rep('\n</style>', r"""
.tba-st { display: none !important; }
#r-workspace.rb-ws.ws-map { grid-template-columns: minmax(0, 1fr) min(760px, 52vw) !important; }
#r-side .rb-mapview { min-height: 0; box-shadow: none; border-radius: 8px; margin-bottom: 16px; padding-bottom: 14px; }
#r-side .rb-mv-h { padding: 14px 16px 12px; margin-bottom: 12px; flex-wrap: wrap; }
#r-side .rb-mv-h b { font-size: 18px; }
#r-side .rb-mv-h span { font-size: 12px; }
#r-side #rb-mv-body { padding: 0 14px; }
#r-side .rb-tn b { font-size: 11.5px; } #r-side .rb-tn small { font-size: 10px; }
.ws-map #research-sheet { transition: none; }
</style>""", 1)
rep('\n</style>', r"""
#r-side.rb-side > * { flex-shrink: 0; }
#r-side .rb-ibar { position: sticky; top: 0; z-index: 3; }
</style>""", 1)
s = s.replace("Click any box to trace it; its details open on the right.", "Click any box to trace it; its details open below.", 1)
