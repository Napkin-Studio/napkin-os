# Phase 28 (2026-11-09): the agency's colours theme the whole app (light and dark), not just the logo.
# Surfaces take a faint tint of the agency base; actions and selection use base (light) / accent (dark).
# Documents (brief sheet, research report, source cards) stay paper.
rep("    document.documentElement.style.setProperty('--accent', curBase);", r'''    document.documentElement.style.setProperty('--accent', curBase);
    (function appTheme() {
      const R = document.documentElement.style;
      const lum = h => { const c = AT.rgb(h).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      // in dark mode a very dark base can't be an action colour: use the accent there
      const baseDark = lum(curBase) < .04;
      R.setProperty('--ag-on-base', lum(curBase) > .45 ? '#141413' : '#FFFFFF');
      R.setProperty('--ag-act-l', curBase);
      R.setProperty('--ag-act-l-ink', lum(curBase) > .45 ? '#141413' : '#FFFFFF');
      const actD = baseDark || lum(curBase) < .08 ? curAcc : curBase;
      R.setProperty('--ag-act-d', actD);
      R.setProperty('--ag-act-d-ink', lum(actD) > .3 ? '#141413' : '#FFFFFF');
      R.setProperty('--ag-tint', baseDark ? curAcc : curBase);
    })();''')
rep('\n</style>', r"""
/* ═══ Phase 28: agency theme across the app ═══ */
:root { --ag-act: var(--ag-act-l, #1E22AA); --ag-act-ink: var(--ag-act-l-ink, #fff); }
html:not([data-theme="dark"]) {
  --desk: color-mix(in srgb, var(--ag-tint, #1E22AA) 6%, #F6F1E7);
  --paper: color-mix(in srgb, var(--ag-tint, #1E22AA) 2.5%, #FFFDF8);
  --line: color-mix(in srgb, var(--ag-tint, #1E22AA) 10%, #E2D9C8);
}
html[data-theme="dark"] {
  --ag-act: var(--ag-act-d, #FFB800); --ag-act-ink: var(--ag-act-d-ink, #141413);
  --desk: color-mix(in srgb, var(--ag-tint, #1E22AA) 12%, #121110);
  --paper: color-mix(in srgb, var(--ag-tint, #1E22AA) 9%, #1B1A18);
  --card: color-mix(in srgb, var(--ag-tint, #1E22AA) 7%, #201E1B);
  --line: color-mix(in srgb, var(--ag-tint, #1E22AA) 16%, #34302A);
}
html[data-theme="dark"] .topbar-outer { background: color-mix(in srgb, var(--desk) 92%, transparent) !important; }
html:not([data-theme="dark"]) .topbar-outer { background: color-mix(in srgb, var(--desk) 94%, transparent) !important; }
/* actions and selected states take the agency colour */
.btn-rect.primary, .side-save, .bl-apply, .ra-go, .r-ask-go, .rb-cont, .r-lock, #r-report #r-lock, .r-needs .nb-act button:first-child, #r-start-run,
html[data-theme="dark"] .btn-rect.primary, html[data-theme="dark"] .side-save, html[data-theme="dark"] .bl-apply, html[data-theme="dark"] .ra-go, html[data-theme="dark"] .r-ask-go,
html[data-theme="dark"] #r-report #r-lock, html[data-theme="dark"] .r-needs .nb-act button:first-child, html[data-theme="dark"] #r-start-run {
  background: var(--ag-act) !important; color: var(--ag-act-ink) !important; border-color: var(--ag-act) !important; }
.seg-row button[aria-pressed="true"], html[data-theme="dark"] .seg-row button[aria-pressed="true"] { background: var(--ag-act) !important; color: var(--ag-act-ink) !important; }
.flow-steps button[aria-pressed="true"] i { background: var(--ag-act) !important; border-color: var(--ag-act) !important; color: var(--ag-act-ink) !important; }
.cl-circle[aria-pressed="true"] .cl-disc { box-shadow: 0 0 0 3px var(--ag-act), 0 12px 26px -12px rgba(20,20,19,.5); }
.dial-hub { box-shadow: 0 0 0 4px var(--paper), 0 0 0 6px var(--ag-act) !important; }
.side-part, .rb-viewsw { border-color: color-mix(in srgb, var(--ag-act) 45%, var(--line)) !important; }
.tb-client:hover, .tba-btn:hover { background: color-mix(in srgb, var(--ag-act) 10%, transparent) !important; }
.tba-name svg, .tba-brief svg { color: var(--ag-act) !important; }
.side-link { text-decoration-color: color-mix(in srgb, var(--ag-act) 55%, transparent); }
a.side-link:hover, button.side-link:hover { text-decoration-color: var(--ag-act); }
:focus-visible { outline-color: var(--ag-act) !important; }
.rb-viewsw button[aria-pressed="true"] { background: var(--ag-act) !important; color: var(--ag-act-ink) !important; }
/* documents stay paper */
.brief-page, #research-sheet, .rb-mapview, .src-card { --line: #E2D9C8; }
</style>""", 1)
rep("      R.setProperty('--ag-tint', baseDark ? curAcc : curBase);", "      R.setProperty('--ag-tint', curBase);")
rep("    mountH1Mark();\n    if (stageAgent) stageAgent.setAccent(ag.ring, ag.base);",
    "    mountH1Mark();\n    if (stageAgent) stageAgent.setAccent(ag.ring, ag.base);\n    try { renderBriefPage(); } catch (e) {}\n    try { if (window.renderTrail) window.renderTrail(); } catch (e) {}")
rep('\n</style>', r"""
.b-state b, .r-rep-h b { display: inline-flex; align-items: center; white-space: nowrap; }
.b-state span#b-state-t { text-align: right; }
</style>""", 1)
