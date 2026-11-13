# Phase 22 (2026-11-09): wider research page; Evidence map is a view of the page (Report / Evidence map switch in
# the right panel), clickable, tracing each fact with details in the panel; Continue in moves to the panel;
# the OS bar keeps the document name, state and Lock.

# ═══ the map: a view in the page, not a modal ═══
s, _n = re.subn(r"    \(function mapView\(\) \{.*?\n    \}\)\(\);", r'''    (function mapView() {
      const ws = $('r-workspace');
      $('research-sheet').insertAdjacentHTML('afterend', `<section class="rb-mapview" id="rb-mapview" hidden><div class="rb-mv-h"><div><b>Evidence map</b><span>How this report was formed. Click any box to trace it; its details open on the right.</span></div><span class="rb-mv-leg"><i></i>feeds <i class="r"></i>considered, not chosen <i class="d"></i>not used</span></div><div id="rb-mv-body"></div></section>`);
      $('rb-mv-body').append($('rb-trace'));
      $('r-side').insertAdjacentHTML('afterbegin', `<div class="seg-row rb-viewsw" id="rb-viewsw"><button type="button" data-rbview="report" aria-pressed="true">Report</button><button type="button" data-rbview="map" aria-pressed="false">Evidence map</button></div>`);
      const setView = v => {
        const map = v === 'map';
        $('research-sheet').hidden = map; $('rb-mapview').hidden = !map;
        $('rb-viewsw').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rbview === v)));
        if (map && $('rb-trace').hidden) showTrace(true);
        if (!map && !$('rb-trace').hidden) $('rb-trace').hidden = true;
        if (map) requestAnimationFrame(drawTrace);
        window.scrollTo({ top: 0, behavior: 'instant' });
      };
      window.rbOpenMap = () => setView('map');
      new MutationObserver(() => { if (!$('rb-trace').hidden && $('rb-mapview').hidden) setView('map'); }).observe($('rb-trace'), { attributes: true, attributeFilter: ['hidden'] });
      $('rb-viewsw').addEventListener('click', e => { const b = e.target.closest('[data-rbview]'); if (!b) return; e.stopPropagation(); setView(b.dataset.rbview); });
      $('rb-mapview').addEventListener('click', e => {
        e.stopPropagation();
        const s2 = e.target.closest('[data-rb-sel]'); if (!s2) return;
        const i = s2.dataset.rbSel.indexOf(':'); const k = s2.dataset.rbSel.slice(0, i), id = s2.dataset.rbSel.slice(i + 1);
        rsSelect(k === 'answer' ? 'answer' : k, ['finding', 'claim'].includes(k) ? +id : (k === 'answer' ? 0 : id));
      });
      addEventListener('resize', () => { if (!$('rb-mapview').hidden) requestAnimationFrame(drawTrace); });
    })();''', s, count=1, flags=re.S)
assert _n == 1, 'mapView'
# opening from a selection (inspector "Show in the graph") switches the page to the map
s = s.replace("      if (k === 'trace') { showTrace(true); return; }", "      if (k === 'trace') { window.rbOpenMap ? window.rbOpenMap() : showTrace(true); return; }", 1)
# clicks elsewhere shouldn't drop the selection while on the map
s = s.replace("if (rsSel && !e.target.closest('#research-sheet, #r-side, #os-src, #os-src-back')) rsSelect(null);", "if (rsSel && !e.target.closest('#research-sheet, #r-side, #os-src, #os-src-back, #rb-mapview')) rsSelect(null);", 1)

# ═══ panel gets Continue in; the OS bar keeps name, state, Lock ═══
rep("""    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn" data-tba="r-map">Evidence map</button><button type="button" class="tba-btn" data-tba="r-cont">Continue in ▾</button>""",
    """    if (st === 'output' && t === 'research') acts = `""")
rep('<div class="rs-top" id="r-side-top"></div>', '<div class="rs-top" id="r-side-top"><button type="button" class="rb-cont" id="rb-cont">Continue in a brief <small>with these 8 pinned facts</small><span>→</span></button></div>')
rep("  (function sourceInApp() {", "  document.addEventListener('click', e => { if (e.target.closest('#rb-cont')) { e.stopPropagation(); $('r-spin-brief').click(); } }, true);\n  (function sourceInApp() {")

# ═══ CSS ═══
rep('\n</style>', r"""
/* ═══ Phase 22 ═══ */
#research-screen-output.rb { --rbw2: min(1440px, calc(100vw - 48px)); width: var(--rbw2) !important; margin-left: calc((100% - var(--rbw2)) / 2) !important; }
#r-workspace.rb-ws { grid-template-columns: minmax(0, 1fr) 440px !important; gap: 24px; }
@media (max-width: 1100px) { #r-workspace.rb-ws { grid-template-columns: minmax(0, 1fr) 380px !important; } }
@media (max-width: 900px) { #research-screen-output.rb { width: auto !important; margin-left: 0 !important; } #r-workspace.rb-ws { grid-template-columns: 1fr !important; } }
.rb-viewsw { margin-bottom: 14px; }
.rb-viewsw button { flex: 1; }
.rb-mapview { background: #FFFDF8; color: #2A2620; border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow-paper); padding: 0 0 24px; min-height: 70vh; }
.rb-mv-h { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding: 24px 28px 18px; border-bottom: 1px solid #E2D9C8; margin-bottom: 18px; background-image: var(--rs-grid); border-radius: 8px 8px 0 0; }
.rb-mv-h b { display: block; font: 600 26px var(--font-ui); letter-spacing: -.02em; }
.rb-mv-h span { font-size: 13px; color: #6D655A; }
.rb-mv-leg { display: flex; align-items: center; gap: 8px; font: 11px var(--font-mono) !important; white-space: nowrap; }
.rb-mv-leg i { display: inline-block; width: 18px; height: 0; border-top: 1.5px solid #2A2620; }
.rb-mv-leg i.r { border-top: 1.5px dashed #C9462A; }
.rb-mv-leg i.d { width: 12px; height: 10px; border: 1px dashed #9A9082; }
#rb-mv-body { padding: 0 28px; }
#rb-mv-body .rb-trace { margin: 0; border: 0; padding: 0; background: none; box-shadow: none; }
#rb-mv-body .rb-trace-h, #rb-mv-body .rb-tleg { display: none !important; }
#rb-mv-body .rb-tn { cursor: pointer; }
.rb-cont { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 10px; padding: 12px 14px; border-radius: 10px; background: var(--ink); color: var(--paper); font: 600 14px var(--font-ui); }
.rb-cont small { grid-column: 1; font: 500 12px var(--font-ui); opacity: .7; }
.rb-cont span { grid-row: 1 / span 2; grid-column: 2; font-size: 18px; }
html[data-theme="dark"] .rb-cont { background: var(--ink); color: #151412; }
</style>""", 1)
rep('\n</style>', r"""
#r-side #rb-viewsw { display: flex !important; }
</style>""", 1)
