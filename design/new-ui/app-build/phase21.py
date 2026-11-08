# Phase 21 (2026-11-09): the research report in the real tool's shape (campaign-research §17): headline, summary
# (each line cites), sections per lens/market made of claim / pins / finding / contest / gap blocks, confirm list,
# not researched. No "answer formed" card; the provenance graph moves out of the report into an Evidence map view.

# ═══ headline + summary replace the single answer ═══
_a = s.index('<section class="r-answer rb-sec" id="r-answer"')
_b = s.index('</section>', _a) + len('</section>')
SUM = ["Irish 16–24s don't plan treats; they stretch social moments.", "68% of out-of-home treat stops are unplanned and social.",
       "Delivery desserts grew 23.4% in a year in the Republic.", "Indulgence moves home unless the outing gives a reason.", "The two-spoon ritual is promising, but thin."]
s = s[:_a] + '''<section class="r-answer rb-sec rp-top" id="r-answer" aria-label="Headline and summary">
          <div class="rs-h"><span>Headline</span></div>
          <p class="rp-head" data-rb-sel="answer:0">McFlurry’s summer is won outside, in unplanned social moments, and lost to the sofa when nothing gives a reason to go out.<span class="rp-cites" id="rp-head-cites"></span></p>
          <div class="rs-h rp-sum-h"><span>Summary</span></div>
          <ul class="rp-sum" id="rb-ans-t">''' + ''.join(f'<li><span class="rb-claim" data-claim="{k}">{t}</span><span class="rp-cites" data-cites="{k}"></span></li>' for k, t in enumerate(SUM)) + '''</ul>
          <button type="button" id="rb-how" hidden>map</button>
          <div class="rb-trace" id="rb-trace" hidden></div>
        </section>
        <div id="rp-sections"></div>''' + s[_b:]

# ═══ wording: headline and summary, not "the answer" ═══
for a_, b_ in [("'How the answer was formed'", "'How the headline and summary were formed'"), ('>How the answer was formed<', '>How the headline and summary were formed<'),
               ("Sentence by sentence", "Line by line"), ("Answer · sentence ${k + 1} of 5", "Summary · line ${k + 1} of 5"),
               ("answer: () => 'Answer'", "answer: () => 'Summary'"), ("claim: k => 'Sentence ' + (+k + 1)", "claim: k => 'Line ' + (+k + 1)")]:
    s = s.replace(a_, b_)

# ═══ sections + evidence map (inside the inspector's scope) ═══
rep("    renderFacts(); renderContest(); renderGaps(); renderCov(); renderExcluded(); renderRun(); renderLog(); renderOutline(); renderMix(); decorateCards(); rsStats(); updLock();",
    r'''    // ── report sections (lens × market), the real report's blocks ──
    const RP = [
      { t: 'The market', lens: 'Market', mk: 'IE', b: [['claim', 'Summer 2026 had 18% more days above 20°C than 2024, but warm days lift every treat stop alike.', ['f_014']], ['pins', ['f_014']]] },
      { t: 'The category', lens: 'Category', mk: 'IE', b: [['claim', 'Frozen desserts through delivery apps grew 23.4% in a year in the Republic.', ['f_007']], ['pins', ['f_007']], ['finding', 1], ['contest']] },
      { t: 'Who it is for', lens: 'Audience', mk: 'IE', b: [['claim', 'Most out-of-home treat stops for 16–24s are unplanned and social, and the share is rising.', ['f_003', 'f_004', 'f_005']], ['pins', ['f_003', 'f_004', 'f_005']], ['finding', 0]] },
      { t: 'Culture', lens: 'Culture', mk: 'IE', b: [['claim', '#McFlurry is big on Irish TikTok; sharing one with two spoons shows up, but rarely.', ['f_009', 'f_011']], ['pins', ['f_009', 'f_011']], ['finding', 2], ['gap', 'No sample of 50+ sharing posts yet, so the ritual cannot be called a habit.']] },
      { t: 'Competitors', lens: 'Competitors', mk: 'IE', b: [['gap', 'Searched; nothing found on who owns the shared outdoor treat in Ireland.']] }
    ];
    const NOTR = [['Northern Ireland', 'out of the market in the ask'], ['Channels', 'not in the ask'], ['Brand', 'not in the ask']];
    function renderReport() {
      $('rp-head-cites').innerHTML = ' ' + fChip(0) + fChip(1);
      document.querySelectorAll('.rp-cites[data-cites]').forEach(el => { const c = CL[+el.dataset.cites]; el.innerHTML = c.f.map(fChip).join('') + c.pins.slice(0, 2).map(p => pinChip(p)).join(''); });
      const blk = ([k, a, b]) => k === 'claim' ? `<p class="rp-claim">${a} <span class="rp-cites">${b.map(p => pinChip(p)).join('')}</span></p>`
        : k === 'pins' ? `<div class="rp-pins">${a.map(p => { const x = fx(p); return `<button type="button" class="rp-pin" data-rb-sel="fact:${p}"><span class="pin"></span><span class="rp-pv">${x.value}</span><span class="rp-pf">${x.fact}</span><span class="rp-ps">${x.src}</span></button>`; }).join('')}</div>`
        : k === 'finding' ? (() => { const st = fState(a); return `<button type="button" class="rp-find ${st}" data-rb-sel="finding:${a}"><span class="rb-n${st === 'proposed' ? ' p' : ''}">${a + 1}</span><span class="rp-fs">${FSTMT(a)}</span><span class="rp-fst">${st === 'proposed' ? 'Needs your call' : st === 'cut' ? 'Cut' : 'Verified'}</span></button>`; })()
        : k === 'contest' ? `<button type="button" class="rp-contest" data-rb-sel="contest:0"><span class="rp-k">Contest · resolved</span><span><b>23.4%</b> Kantar chosen over <s>31%</s> client deck</span></button>`
        : `<div class="rp-gap"><span class="cov empty"></span><span class="rp-k">Gap</span><span>${a}</span></div>`;
      $('rp-sections').innerHTML = RP.map((sc, i) => `<section class="rb-sec rp-sec"><div class="rs-h"><span>${String(i + 1).padStart(2, '0')} — ${sc.lens} · ${sc.mk}</span><h3>${sc.t}</h3></div>${sc.b.map(blk).join('')}</section>`).join('')
        + `<section class="rb-sec rp-sec"><div class="rs-h"><span>Before the brief</span><h3>Confirm</h3></div><ul class="rp-confirm"><li><button type="button" data-rb-sel="finding:2">Finding 3 rests on 2 clips</button><span>Keep it as a working hypothesis, or cut it.</span></li><li><button type="button" data-rb-sel="contest:0">Kantar over the client deck</button><span>Resolved by the Review agent; confirm you agree.</span></li><li><button type="button" data-rb-sel="answer:0">Line 4 is an inference</button><span>No source says it; read it as the agency’s view.</span></li></ul></section>`
        + `<section class="rb-sec rp-sec"><div class="rs-h"><span>Scope</span><h3>Not researched</h3></div><div class="rp-notr">${NOTR.map(([n, w]) => `<span><span class="cov none"></span><b>${n}</b> ${w}</span>`).join('')}</div></section>`;
    }
    window.rbOpenMap = () => showTrace(true);
    renderFacts(); renderContest(); renderGaps(); renderCov(); renderExcluded(); renderRun(); renderLog(); renderOutline(); renderMix(); decorateCards(); rsStats(); updLock(); renderReport();
    // the graph lives in its own view, not in the report
    (function mapView() {
      document.body.insertAdjacentHTML('beforeend', `<div class="rb-map" id="rb-map" hidden><div class="rb-map-in"><header><div><b>Evidence map</b><span>How this report was formed · sources → pins → findings → summary</span></div><button type="button" id="rb-map-x" title="Close">×</button></header><div class="rb-map-body" id="rb-map-body"></div></div></div>`);
      $('rb-map-body').append($('rb-trace'));
      const sync = () => { $('rb-map').hidden = $('rb-trace').hidden; };
      new MutationObserver(sync).observe($('rb-trace'), { attributes: true, attributeFilter: ['hidden'] });
      const close = () => { $('rb-trace').hidden = true; sync(); };
      $('rb-map-x').addEventListener('click', close);
      $('rb-map').addEventListener('click', e => { if (e.target.id === 'rb-map') close(); e.stopPropagation(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('rb-map').hidden) close(); });
      $('rb-map-body').addEventListener('click', e => { const s2 = e.target.closest('[data-rb-sel]'); if (s2) { e.stopPropagation(); close(); const i = s2.dataset.rbSel.indexOf(':'); const k = s2.dataset.rbSel.slice(0, i), id = s2.dataset.rbSel.slice(i + 1); rsSelect(k === 'answer' ? 'answer' : k, ['finding', 'claim'].includes(k) ? +id : (k === 'answer' ? 0 : id)); } });
    })();''')
# keep the section blocks current when findings change (keep / cut / reject)
rep("    const reRender = () => { renderFacts(); renderOutline(); rsStats();", "    const reRender = () => { renderFacts(); renderOutline(); rsStats(); if (typeof renderReport === 'function') renderReport();")
# "Show in the graph" opens the map (no scroll to the report)
s = s.replace("      if (k === 'trace') { showTrace(true); $('r-answer').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }", "      if (k === 'trace') { showTrace(true); return; }", 1)

# ═══ app slot: Evidence map is an app action in the OS bar ═══
rep("""    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn" data-tba="r-cont">Continue in ▾</button>""",
    """    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn" data-tba="r-map">Evidence map</button><button type="button" class="tba-btn" data-tba="r-cont">Continue in ▾</button>""")
rep("    if (a === 'r-lock') { $('r-lock').click(); renderAppSlot(); return; }", "    if (a === 'r-lock') { $('r-lock').click(); renderAppSlot(); return; }\n    if (a === 'r-map') { if (window.rbOpenMap) window.rbOpenMap(); return; }")

# ═══ CSS ═══
rep('\n</style>', r"""
/* ═══ Phase 21: report shape + evidence map ═══ */
.rb-start { display: none !important; }
#r-findings { display: none !important; }
.rp-top .rs-h span { display: block; }
.rp-head { font: 600 26px/1.3 var(--font-ui); letter-spacing: -.02em; margin: 6px 0 22px; cursor: pointer; border-radius: 6px; padding: 4px 6px; margin-left: -6px; transition: background .12s; }
.rp-head:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.rp-cites { display: inline-flex; flex-wrap: wrap; gap: 4px; vertical-align: 3px; margin-left: 6px; }
.rp-head .rp-cites { vertical-align: 5px; }
.rp-sum-h { margin-top: 4px; }
.rp-sum { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
.rp-sum li { position: relative; padding: 6px 6px 6px 22px; border-radius: 6px; font: 450 16.5px/1.5 var(--font-ui); }
.rp-sum li::before { content: ""; position: absolute; left: 6px; top: 15px; width: 6px; height: 6px; border-radius: 50%; background: var(--ink); }
.rp-sum .rb-claim { cursor: pointer; }
.rp-sum li:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.rp-sec { display: grid; gap: 12px; }
.rp-claim { font: 450 16px/1.55 var(--font-ui); margin: 0; }
.rp-pins { display: grid; gap: 6px; }
.rp-pin { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 12px 92px 1fr auto; gap: 10px; align-items: baseline; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: #fff; font-size: 13px; }
.rp-pin:hover { border-color: var(--ink); }
.rp-pin .pin { margin: 0; }
.rp-pv { font: 700 13px var(--font-mono); background: linear-gradient(transparent 40%, var(--rs-hl) 40%, var(--rs-hl) 90%, transparent 90%); justify-self: start; padding: 0 2px; }
.rp-ps { font: 11px var(--font-mono); color: var(--muted); white-space: nowrap; }
.rp-find { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 26px 1fr auto; gap: 12px; align-items: center; padding: 12px 14px; border-left: 3px solid var(--ink); background: color-mix(in srgb, var(--ink) 3%, transparent); border-radius: 0 6px 6px 0; }
.rp-find:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.rp-find .rb-n { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 700 11px var(--font-mono); }
.rp-find .rb-n.p { background: transparent; color: var(--ink); border: 2px dashed var(--ink); }
.rp-fs { font: 500 15px/1.4 var(--font-ui); }
.rp-fst { font: 700 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ok); white-space: nowrap; }
.rp-find.proposed { border-left-color: var(--warn); background: color-mix(in srgb, var(--warn) 7%, transparent); }
.rp-find.proposed .rp-fst { color: #fff; background: var(--warn); padding: 3px 8px; border-radius: 999px; }
.rp-find.cut { opacity: .5; text-decoration: line-through; }
.rp-contest { all: unset; box-sizing: border-box; cursor: pointer; display: flex; gap: 12px; align-items: baseline; padding: 10px 14px; border: 1px solid var(--line); border-left: 3px solid #C9462A; border-radius: 0 6px 6px 0; font-size: 13.5px; }
.rp-contest b { font-family: var(--font-mono); background: var(--rs-hl); padding: 0 3px; }
.rp-contest s { color: var(--muted); font-family: var(--font-mono); }
.rp-k { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.rp-gap { display: grid; grid-template-columns: 14px auto 1fr; gap: 10px; align-items: center; padding: 10px 14px; border: 1px dashed var(--faint); border-radius: 6px; font-size: 13.5px; }
.rp-gap .cov, .rp-notr .cov { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--ink); box-sizing: border-box; }
.rp-gap .cov.empty { border-color: var(--warn); }
.rp-notr .cov.none { border-style: dashed; }
.rp-confirm { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.rp-confirm li { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; }
.rp-confirm button { all: unset; cursor: pointer; font: 600 14px var(--font-ui); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line); }
.rp-confirm span { font-size: 13px; color: var(--muted); }
.rp-notr { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 13.5px; }
.rp-notr > span { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
.rp-notr b { color: var(--ink); font-weight: 600; }
/* evidence map: its own view */
.rb-map { position: fixed; inset: 0; z-index: 88; background: rgba(20,20,19,.32); display: grid; place-items: center; padding: 70px 24px 24px; }
.rb-map[hidden] { display: none; }
.rb-map-in { width: min(1100px, 100%); max-height: 100%; overflow: auto; background: #FFFDF8; color: #2A2620; border-radius: 14px; box-shadow: 0 40px 90px -30px rgba(0,0,0,.6); }
.rb-map-in header { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 22px; background: #FFFDF8; border-bottom: 1px solid #E2D9C8; z-index: 2; }
.rb-map-in header b { display: block; font: 700 17px var(--font-ui); }
.rb-map-in header span { font: 11.5px var(--font-mono); color: #6D655A; }
#rb-map-x { width: 32px; height: 32px; border-radius: 50%; border: 1px solid #E2D9C8; background: none; font-size: 18px; cursor: pointer; color: #2A2620; }
.rb-map-body { padding: 18px 22px 22px; }
.rb-map-body .rb-trace { margin: 0; border: 0; padding: 0; background: none; }
html[data-theme="dark"] .rp-pin { background: #fff; }
</style>""", 1)
s = s.replace('<h6>Answer · 5 sentences</h6>', '<h6>Summary · 5 lines</h6>', 1)
s = s.replace('<span class="rb-tleg"', '<span class="rb-tleg"', 1)
s = s.replace('<span>Excluded: Checkout, Retail Ireland (see 07)</span>', '<span>Excluded: Checkout, Retail Ireland</span>', 1)
rep('\n</style>', r"""
.rb-map-body .rb-trace-h { display: none !important; }
</style>""", 1)
