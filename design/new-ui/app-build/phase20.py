# Phase 20 (2026-11-08): Research hybrid. Builder B's workspace (sentence-level answer, evidence inspector with
# breadcrumb/back, full reasoning, contests/gaps/excluded/how it ran/record) WITHOUT the left panel; the provenance
# graph only on request; slim finding cards; Source becomes part of the app (inspector level in Research, a stacked
# index card in Brief's side bar) instead of a floating overlay.

# ═══ 1. apply Builder B's edits (variant_b.py) to this build ═══
_vb = (pathlib.Path(__file__).with_name('variant_b.py')).read_text(encoding='utf-8')
_vb = _vb.replace("s = SRC.read_text(encoding='utf-8')", "")
_vb = _vb.replace("OUT.write_text(s, encoding='utf-8')", "").replace("print('wrote', OUT, len(s))", "")
_g = {'s': s, 'pathlib': pathlib, '__file__': str(pathlib.Path(__file__).with_name('variant_b.py'))}
exec(_vb, _g)
s = _g['s']

# ═══ 2. no left panel: its useful bits move into the inspector's overview ═══
_a = s.index('        <nav class="rb-rail" id="rb-rail" aria-label="Research outline">')
_b = s.index('        </nav>', _a) + len('        </nav>')
s = s[:_a] + '''        <div hidden id="rb-rail"><ol class="rb-outline" id="rb-outline"></ol><div class="rb-minicov" id="rb-minicov"></div><span class="lens" id="r-side-lens" hidden></span></div>''' + s[_b:]
rep('''            <div class="r-askside"><h4>Ask the research</h4>''', '''            <div><h4>Show findings</h4><div class="seg-row" id="r-side-show"></div></div>
            <div><h4>Sources · 9 read</h4><div class="r-srcmix" id="r-srcmix"></div><p class="r-srcleg" id="r-srcleg"></p></div>
            <div class="r-askside"><h4>Ask the research</h4>''')

# ═══ 3. graph only when asked ("See how this was formed" / "Show in the graph") ═══
rep("      if (kind === 'answer' || kind === 'claim') showTrace(true); else requestAnimationFrame(drawTrace);", "      requestAnimationFrame(drawTrace);")

# ═══ 4. Source joins the app ═══
rep("  renderBriefPage();\n  syncNavigation();\n  const urlBrand", r'''  (function sourceInApp() {
    const osPanel = window.openSource;
    let stackFrom = null;
    function srcCard(id) {
      const x = SOURCES[id]; if (!x) return '';
      const used = SRC_USED(id);
      return `<div class="src-stack" id="src-stack">
        <button type="button" class="src-back" id="src-back">← ${esc(stackFrom || 'Back')}</button>
        <article class="src-card">
          <span class="src-pin"></span>
          <div class="src-kind">${x.kind} · ${esc(x.from[1])}</div>
          <h3>${esc(x.title)}</h3><p class="src-pub">${esc(x.publisher)}</p>
          <blockquote>${esc(x.quote)}</blockquote>
          <dl>${[['Link', x.url], ['Published', x.published], ['Retrieved', x.retrieved], ['Tier', x.tier], ['Licence', x.licence], ['Sample', x.sample]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          <ol class="src-spine"><li><span>Source</span>${esc(x.publisher)}</li><li><span>Knowledge</span>${esc(x.layer)}</li><li><span>Pinned</span>${esc(x.pinned)}</li>${used.map(([k, n]) => `<li class="use"><span>${k === 'brief' ? 'Used in brief' : 'Used in research'}</span>${esc(n)}</li>`).join('')}</ol>
          <div class="src-acts">${x.from[0] === 'research' ? `<button type="button" class="sp-btn" data-osr="research" data-id="${id}">Open in Research</button>` : ''}${x.from[0] === 'upload' ? '<button type="button" class="sp-btn" data-osr="file">Open file</button>' : ''}${x.from[0] === 'clan' ? '<button type="button" class="sp-btn" data-osr="clan">Open Brand Clan</button>' : ''}<button type="button" class="side-link" data-osr="copy">Copy citation</button></div>
        </article></div>`;
    }
    function closeStack() { const st = $('src-stack'); if (st) st.remove(); $('look-inspector').classList.remove('stacked'); }
    window.openSource = function (id) {
      if (activeTool === 'research' && typeof RS_FACT !== 'undefined' && RS_FACT[id]) { rsSelect('fact', id); return; }
      if (activeTool === 'brief') {
        closeStack();
        const sel = selIdx !== null ? BRIEF_DATA[curBriefKey].parts[selIdx] : null; stackFrom = sel ? sel.n : 'Back';
        const li = $('look-inspector'); li.insertAdjacentHTML('afterbegin', srcCard(id)); li.classList.add('stacked'); li.scrollTop = 0;
        $('src-back').addEventListener('click', e => { e.stopPropagation(); closeStack(); });
        return;
      }
      osPanel(id);
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('src-stack')) closeStack(); });
    const _rbp = renderBriefPage;
  })();
  renderBriefPage();
  syncNavigation();
  const urlBrand''')
# closing the source stack whenever the brief re-renders a different selection
rep("    renderSidePart(data);\n    syncThemeUI();", "    renderSidePart(data);\n    syncThemeUI();\n    if ($('src-stack') && selIdx === null) { $('src-stack').remove(); $('look-inspector').classList.remove('stacked'); }")

# ═══ 5. CSS ═══
rep('\n</style>', r"""
/* ═══ Phase 20: hybrid research workspace ═══ */
#r-workspace.rb-ws { grid-template-columns: minmax(0, 1fr) 432px !important; }
@media (max-width: 1180px) { #r-workspace.rb-ws { grid-template-columns: minmax(0, 1fr) 380px !important; } }
@media (max-width: 900px) { #r-workspace.rb-ws { grid-template-columns: 1fr !important; } }
/* slim finding cards: the quote and reviewer line show on the selected card only */
.rb #r-findings-list .finding-card:not(.sel) .finding-quote,
.rb #r-findings-list .finding-card:not(.sel) .prov-pill { display: none !important; }
.rb #r-findings-list .finding-card.sel .finding-quote { display: block !important; }
/* Source as a stacked index card in Brief's side bar */
.look-inspector.stacked > :not(#src-stack) { display: none !important; }
.src-stack { display: grid; gap: 10px; }
.src-back { justify-self: start; background: none; border: 0; padding: 0; font: 600 12.5px var(--font-ui); color: var(--muted); cursor: pointer; }
.src-back:hover { color: var(--ink); }
.src-card { position: relative; background: #FFFDF8; color: #2A2620; border: 1px solid #E2D9C8; border-radius: 6px; padding: 20px 18px 16px; box-shadow: 0 1px 0 #fff inset, 0 10px 24px -16px rgba(50,38,18,.4); background-image: repeating-linear-gradient(transparent 0 27px, rgba(122,156,198,.14) 27px 28px); background-position: 0 64px; display: grid; gap: 10px; }
.src-pin { position: absolute; top: -6px; left: 50%; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; background: #D8452E; box-shadow: inset -2px -2px 0 rgba(0,0,0,.25), 0 3px 6px -2px rgba(0,0,0,.35); }
.src-kind { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #6D655A; }
.src-card h3 { font: 600 17px/1.3 var(--font-ui); letter-spacing: -.01em; margin: 0; }
.src-pub { font-size: 12.5px; color: #6D655A; margin-top: -6px; }
.src-card blockquote { margin: 2px 0; font: italic 400 16px/1.5 var(--font-serif); border-left: 3px solid #2A2620; padding-left: 12px; }
.src-card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0; background: #FFFDF8; }
.src-card dl div:first-child { grid-column: 1 / -1; }
.src-card dt { font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #8A8276; }
.src-card dd { margin: 1px 0 0; font-size: 12.5px; overflow-wrap: anywhere; }
.src-spine { list-style: none; margin: 4px 0 0; padding: 0 0 0 14px; border-left: 2px solid #2A2620; display: grid; gap: 7px; font-size: 12.5px; background: #FFFDF8; }
.src-spine li { position: relative; }
.src-spine li::before { content: ""; position: absolute; left: -19px; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: #2A2620; }
.src-spine li.use::before { background: #F6E36B; box-shadow: 0 0 0 1.5px #2A2620; }
.src-spine span { display: block; font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #8A8276; }
.src-acts { display: flex; gap: 10px; align-items: center; border-top: 1px solid #E2D9C8; padding-top: 10px; background: #FFFDF8; }
.src-acts .sp-btn { background: #FFFDF8; color: #2A2620; border-color: #E2D9C8; }
.src-acts .side-link { color: #2A2620; }
</style>""", 1)
rep('\n</style>', r"""
/* back inside the app's column (no left panel any more) */
#research-screen-output.rb { width: auto !important; margin-left: 0 !important; }
/* top bar: the app slot gives way before anything overlaps */
.tb-app { flex: 0 1 auto; min-width: 0; overflow: hidden; }
.tba-acts, .tba-st { flex: none; }
.tba-name { min-width: 0; }
.tb-status { flex: none; margin-left: 10px; }
@media (max-width: 1500px) { .tba-name b { max-width: 180px; } }
@media (max-width: 1300px) { .tba-st { display: none; } }
</style>""", 1)
rep("if (e.target.closest('#rb-how')) { e.stopPropagation(); if ($('rb-trace').hidden) rsSelect('answer', 0); else showTrace(false); return; }",
    "if (e.target.closest('#rb-how')) { e.stopPropagation(); if ($('rb-trace').hidden) { rsSelect('answer', 0); showTrace(true); } else showTrace(false); return; }")

# Sentence view: each pin shows what its source actually said, and the pin and the source both open
rep("""      const chain = c.pins.map(p => { const x = fx(p), sx = SRC[x.s]; return `<li class="hl"><span class="k">${p} · ${x.value} · ${lvl(x.conf)}</span>${x.fact}<br><span style="font:11px var(--font-mono);color:var(--muted)">← ${sx.name} · ${sx.date} · ${sx.loc}</span></li>`; }).join('');""",
    """      const chain = c.pins.map(p => { const x = fx(p), sx = SRC[x.s]; return `<li class="hl"><button type="button" class="rbq-pin" data-rb-sel="fact:${p}"><span class="k">${p} · ${x.value} · ${lvl(x.conf)}</span>${x.fact}</button><blockquote class="rbq-quote" data-rb-sel="source:${x.s}">${x.quote}</blockquote><span class="rbq-src">${sChip(x.s)} · ${sx.date} · ${sx.loc} <button type="button" class="rbq-open" data-rb-sel="source:${x.s}">Source →</button></span></li>`; }).join('');""")
rep("""${(c.rej || []).map(p => `<li><span class="k">${p} · ${fx(p).value} · not chosen</span>${fx(p).fact} · lost the contest in ${dChip('d_044')}</li>`).join('')}""",
    """${(c.rej || []).map(p => { const x = fx(p), sx = SRC[x.s]; return `<li><button type="button" class="rbq-pin" data-rb-sel="fact:${p}"><span class="k">${p} · ${x.value} · not chosen</span>${x.fact}</button><blockquote class="rbq-quote rej" data-rb-sel="source:${x.s}">${x.quote}</blockquote><span class="rbq-src">${sChip(x.s)} · ${sx.date} · lost the contest in ${dChip('d_044')} <button type="button" class="rbq-open" data-rb-sel="source:${x.s}">Source →</button></span></li>`; }).join('')}""")
rep('\n</style>', r"""
.rbq-pin { all: unset; cursor: pointer; display: block; font-size: 13px; line-height: 1.4; }
.rbq-pin .k { display: block; font: 600 10.5px var(--font-mono); letter-spacing: .04em; color: var(--muted); }
.rbq-pin:hover { text-decoration: underline; text-underline-offset: 3px; }
.rbq-quote { margin: 6px 0 4px; padding: 6px 10px; border-left: 2px solid var(--ink); font-size: 13px; line-height: 1.45; font-style: italic; background: color-mix(in srgb, var(--rs-hl) 9%, transparent); border-radius: 0 4px 4px 0; cursor: pointer; }
.rbq-quote:hover { background: color-mix(in srgb, var(--rs-hl) 18%, transparent); }
.rbq-quote.rej { text-decoration: line-through; text-decoration-color: color-mix(in srgb, #C9462A 60%, transparent); color: var(--muted); background: none; }
.rbq-src { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font: 11px var(--font-mono); color: var(--muted); }
.rbq-open { all: unset; cursor: pointer; margin-left: auto; font: 600 11.5px var(--font-ui); color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
</style>""", 1)
rep('\n</style>', r"""
.rbi-pins td small { display: block; margin-top: 4px; font: italic 13px/1.45 var(--font-ui) !important; color: var(--ink-soft) !important; border-left: 2px solid var(--ink); padding-left: 8px; }
</style>""", 1)

# ═══ Links go straight to the source ═══
RB_URLS = """    const RB_URL = { 'Bord Bia Consumer Insights': 'https://www.bordbia.ie/insights/consumer/treat-occasions-2026', 'CSO Ireland': 'https://www.cso.ie/en/statistics/timeuse/', 'Kantar Worldpanel': 'https://www.kantar.com/worldpanel/ie/ooh-delivery-aug-2026',
      'TikTok Ireland': 'https://www.tiktok.com/tag/mcflurry', 'TikTok comment sample': 'https://www.tiktok.com/tag/mcflurry', 'Met Éireann': 'https://www.met.ie/climate/summer-2026', 'Checkout Ireland': 'https://www.checkout.ie/', 'Retail Ireland': 'https://www.retailireland.ie/' };
    const srcLink = (o, cls) => RB_URL[o.name] ? `<a class="${cls || 'rb-extlink'}" href="${RB_URL[o.name]}" target="_blank" rel="noopener">Open it ↗</a>` : `<span class="rb-nolink">Client file · no web link</span>`;
    function vFact(id) {"""
rep("    function vFact(id) {", RB_URLS)
s = s.replace('${x0.mat} · <button type="button" data-rb-act="open-src">Open it ↗</button>', '${x0.mat} · ${srcLink(x0)}', 1)
s = s.replace(' : ` · <button type="button" data-rb-act="open-src">Open it ↗</button>', ' : ` · ${srcLink(sx)}', 1)
rep('<div class="rbi-acts"><button type="button" class="rb-btn" data-rb-act="open-src">Open it ↗</button>', '<div class="rbi-acts">${srcLink(s, \'rb-btn\')}')
# Brief index card + fallback panel: the Link row is a real link (uploads and the Brand Clan stay text)
LINKJS = r"""const lk = v => /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(v) ? `<a class="src-link" href="https://${v.replace(/\s.*$/, '').replace(/…$/, '')}" target="_blank" rel="noopener">${esc(v)} ↗</a>` : esc(v);"""
rep("      const used = SRC_USED(id);\n      return `<div class=\"src-stack\" id=\"src-stack\">", "      const used = SRC_USED(id);\n      " + LINKJS + "\n      return `<div class=\"src-stack\" id=\"src-stack\">")
rep("<dl>${[['Link', x.url], ['Published', x.published], ['Retrieved', x.retrieved], ['Tier', x.tier], ['Licence', x.licence], ['Sample', x.sample]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>",
    "<dl>${[['Link', x.url], ['Published', x.published], ['Retrieved', x.retrieved], ['Tier', x.tier], ['Licence', x.licence], ['Sample', x.sample]].map(([k, v]) => `<div><dt>${k}</dt><dd>${k === 'Link' ? lk(v) : esc(v)}</dd></div>`).join('')}</dl>")
rep("    $('os-src').innerHTML = `<header class=\"osr-h\">", "    " + LINKJS + "\n    $('os-src').innerHTML = `<header class=\"osr-h\">")
rep("['Sample', x.sample]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>\n      <div class=\"osr-sec\">", "['Sample', x.sample]].map(([k, v]) => `<div><dt>${k}</dt><dd>${k === 'Link' ? lk(v) : esc(v)}</dd></div>`).join('')}</dl>\n      <div class=\"osr-sec\">")
rep('\n</style>', r"""
.src-link, .rb-extlink { color: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
.src-link:hover, .rb-extlink:hover { text-decoration-color: currentColor; }
a.rb-btn { text-decoration: none; display: inline-flex; align-items: center; }
.rb-nolink { color: var(--muted); }
</style>""", 1)
s = s.replace('<button type="button" class="side-link" data-rb-act="open-src" style="font-size:11.5px">Open the source ↗</button>', '${srcLink(SRC[x.s], \'side-link\')}', 1)

# ═══ one home per action: Continue in / Lock live in the OS bar; the side bar keeps Save, Refresh, Your call, Ask ═══
rep("""    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn" data-tba="r-ask">Ask</button><button type="button" class="tba-btn" data-tba="r-cont">Continue in ▾</button><button type="button" class="tba-btn tba-lock" data-tba="r-lock">${rLocked ? 'Unlock' : 'Lock'}</button>`;""",
    """    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn" data-tba="r-cont">Continue in ▾</button><button type="button" class="tba-btn tba-lock" data-tba="r-lock">${rLocked ? 'Unlock' : (($('r-lock') && $('r-lock').textContent) || 'Lock').replace('Lock and accept', 'Lock')}</button>`;""")
rep('\n</style>', r"""
#r-side #r-spin-brief, #r-side #r-lock { display: none !important; }
</style>""", 1)
rep('\n</style>', r"""
#research-sheet .r-askbox { display: none !important; }
</style>""", 1)
