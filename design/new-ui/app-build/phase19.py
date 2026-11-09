# Phase 19 (2026-11-08): Source is an OS-level panel. Any fact or document, from any app, opens the same full source record.
rep('<div class="toast" id="toast"', '''<div class="os-src-back" id="os-src-back" hidden></div>
<aside class="os-src" id="os-src" hidden aria-label="Source"></aside>
<div class="toast" id="toast"''')
rep("  const BRIEF_PINS = {", r'''  // ── OS-level source records (facts and documents, whatever app they came from) ──
  const SOURCES = {
    f_003: { kind: 'Panel report', title: 'Consumer Insights: Irish 16–24 treat occasions', publisher: 'Bord Bia', url: 'bordbia.ie/insights/consumer/treat-occasions-2026', published: '12 Jun 2026', retrieved: '02 Nov 2026', tier: 'Panel', licence: 'Licensed panel', sample: 'Republic of Ireland, n=1,400', quote: 'Among Irish 16–24s, 68% of out-of-home treat occasions were unplanned and social, up from 61% in 2024.', from: ['research', 'Research · Irish summer treats'], layer: 'Category layer · Ireland, row r_003', pinned: 'Knowledge agent · 03 Nov 2026' },
    f_004: { kind: 'Panel report', title: 'Consumer Insights: Irish 16–24 treat occasions', publisher: 'Bord Bia', url: 'bordbia.ie/insights/consumer/treat-occasions-2026', published: '12 Jun 2026', retrieved: '02 Nov 2026', tier: 'Panel', licence: 'Licensed panel', sample: 'Republic of Ireland, n=1,400', quote: 'Social context of treat occasions rose 7 points against the prior period.', from: ['research', 'Research · Irish summer treats'], layer: 'Category layer · Ireland, row r_004', pinned: 'Knowledge agent · 03 Nov 2026' },
    f_007: { kind: 'Panel tracker', title: 'ROI Out-of-Home & Delivery Tracker, Aug 2026', publisher: 'Kantar Worldpanel', url: 'kantar.com/worldpanel/ie/ooh-delivery-aug-2026', published: '28 Aug 2026', retrieved: '03 Nov 2026', tier: 'Panel', licence: 'Licensed panel', sample: 'ROI households, 12 months', quote: 'Frozen dessert delivery orders in the Republic of Ireland rose 23.4% against the prior 12 months.', from: ['research', 'Research · Irish summer treats'], layer: 'Category layer · ROI, row r_007', pinned: 'Review agent · resolved contest d_045' },
    f_009: { kind: 'Platform data', title: '#McFlurry tag, Ireland', publisher: 'TikTok', url: 'tiktok.com/tag/mcflurry?region=IE', published: '—', retrieved: '04 Nov 2026', tier: 'Social', licence: 'Public', sample: 'Tag views, IE region', quote: '#McFlurry: 11.2M views (Ireland).', from: ['research', 'Research · Irish summer treats'], layer: 'Culture layer · Ireland, row r_009', pinned: 'Research agent · 04 Nov 2026' },
    f_011: { kind: 'Social sample', title: 'Two-spoon sharing clips', publisher: 'TikTok comment sample', url: 'tiktok.com/@…/video/73921… (2 clips)', published: 'Oct 2026', retrieved: '04 Nov 2026', tier: 'Social', licence: 'Public', sample: '2 clips · 4.1k likes', quote: '“the two spoons thing is so real, nobody orders their own mcflurry”', from: ['research', 'Research · Irish summer treats'], layer: 'Culture layer · Ireland, row r_011', pinned: 'Research agent · held as thin' },
    f_014: { kind: 'Open data', title: 'Summer 2026 climate statement', publisher: 'Met Éireann', url: 'met.ie/climate/summer-2026', published: '02 Sep 2026', retrieved: '05 Nov 2026', tier: 'Gov', licence: 'Open data (CC BY 4.0)', sample: 'National stations', quote: 'Days above 20°C were 18% higher than in summer 2024.', from: ['layer', 'Knowledge layer · pinned by Brief directly'], layer: 'Market layer · ROI, row r_014', pinned: 'Brief agent · 06 Nov 2026' },
    'doc:call': { kind: 'Client upload', title: 'client-call-notes.pdf', publisher: "McDonald's Ireland · call with Siobhán Ryan", url: 'Uploaded to Summer McFlurry · 28 Oct 2026', published: '27 Oct 2026', retrieved: '28 Oct 2026', tier: 'Client', licence: 'Confidential · client', sample: '4 pages · p.2 cited', quote: 'Commercial target: +12% unit growth June–August with no price promotion. Must feature both Flake and Oreo.', from: ['upload', 'Client upload · on this brief'], layer: 'Not in a knowledge layer (client material)', pinned: 'Knowledge agent read it · 28 Oct 2026' },
    'doc:recap': { kind: 'Client upload', title: 'last-summer-recap.key', publisher: "McDonald's Ireland · marketing", url: 'Uploaded to Summer McFlurry · 28 Oct 2026', published: 'Sep 2025', retrieved: '28 Oct 2026', tier: 'Client', licence: 'Confidential · client', sample: '24 slides · slide 6 cited', quote: 'McFlurry volume flat across June–August for the second year.', from: ['upload', 'Client upload · on this brief'], layer: 'Not in a knowledge layer (client material)', pinned: 'Knowledge agent read it · 28 Oct 2026' },
    'doc:clan': { kind: 'Brand Clan', title: "McDonald's Ireland · Brand Clan v4", publisher: 'Brand kit, accepted 21 Oct 2026', url: 'Client page → Brand Clan', published: '21 Oct 2026', retrieved: '—', tier: 'Brand', licence: 'Agency + client', sample: 'voice 6 · rules 9 · assets 23', quote: 'Warm, quick, a little cheeky. Never sarcastic. Real Irish places; never a studio pack-shot.', from: ['clan', 'Brand Clan · v4'], layer: 'Brand layer · McDonald’s Ireland', pinned: 'Frozen copy on this brief · v4' }
  };
  const SRC_USED = id => {
    const out = [];
    Object.values(BRIEF_DATA).forEach(d => d.parts.forEach(p => { if ((BRIEF_PINS[p.k] || []).includes(id) && d === BRIEF_DATA.mcflurry) out.push(['brief', p.n]); }));
    if (typeof RS_FACT !== 'undefined' && RS_FACT[id]) RS_FACT[id].used.forEach(i => out.push(['finding', 'Finding ' + (i + 1)]));
    return out;
  };
  window.openSource = function (id) {
    const x = SOURCES[id]; if (!x) return;
    const used = SRC_USED(id);
    const fromIco = { research: TOOL_ICON.research, upload: '<path d="M6 3.5h8.5l3.5 3.5v13.5H6z"/><path d="M12 10v6M9.5 12.5L12 10l2.5 2.5"/>', clan: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', layer: '<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>' }[x.from[0]];
    $('os-src').innerHTML = `<header class="osr-h"><span class="osr-kind">${x.kind}</span><button type="button" class="osr-x" id="osr-x" title="Close">×</button></header>
      <h3 class="osr-title">${esc(x.title)}</h3><p class="osr-pub">${esc(x.publisher)}</p>
      <div class="osr-from"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${fromIco}</svg><span>From <b>${esc(x.from[1])}</b></span></div>
      <blockquote class="osr-quote">${esc(x.quote)}</blockquote>
      <dl class="osr-grid">${[['Link', x.url], ['Published', x.published], ['Retrieved', x.retrieved], ['Tier', x.tier], ['Licence', x.licence], ['Sample', x.sample]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="osr-sec"><span class="osr-k">How it got here</span><ol class="r-chain"><li><span>Source</span>${esc(x.publisher)}</li><li><span>Knowledge</span>${esc(x.layer)}</li><li><span>Pinned</span>${esc(x.pinned)}</li>${id.startsWith('f_') ? `<li><span>Origin</span><code>fact://mcd/ie/${id}@v2</code></li>` : ''}</ol></div>
      <div class="osr-sec"><span class="osr-k">Used in</span>${used.length ? used.map(([k, n]) => `<div class="osr-use"><span class="osr-use-k">${k === 'brief' ? 'Brief part' : 'Research'}</span>${esc(n)}</div>`).join('') : '<p class="osr-none">Not used yet.</p>'}</div>
      <footer class="osr-f">${x.from[0] === 'research' ? `<button type="button" class="sp-btn" data-osr="research" data-id="${id}">Open in Research</button>` : ''}${x.from[0] === 'upload' ? '<button type="button" class="sp-btn" data-osr="file">Open file</button>' : ''}${x.from[0] === 'clan' ? '<button type="button" class="sp-btn" data-osr="clan">Open Brand Clan</button>' : ''}<button type="button" class="side-link" data-osr="copy">Copy citation</button></footer>`;
    $('os-src').hidden = false; $('os-src-back').hidden = false;
    requestAnimationFrame(() => $('os-src').classList.add('open'));
  };
  function closeSource() { $('os-src').classList.remove('open'); $('os-src-back').hidden = true; setTimeout(() => { $('os-src').hidden = true; }, 200); }
  document.addEventListener('click', e => {
    if (e.target.id === 'os-src-back' || e.target.closest('#osr-x')) { closeSource(); return; }
    const b = e.target.closest('[data-osr]'); if (!b) return;
    e.stopPropagation(); const a = b.dataset.osr;
    if (a === 'research') { const id = b.dataset.id; closeSource(); curClient = 'mcd'; activeTool = 'research'; activeStep = 'output'; syncNavigation(); setTimeout(() => { if (window.rsSelectExt) window.rsSelectExt('fact', id); }, 60); }
    else if (a === 'file') showToast('Opens the uploaded file (not in this mock).');
    else if (a === 'clan') { closeSource(); curClient = 'mcd'; activeTool = 'client'; syncNavigation(); }
    else if (a === 'copy') showToast('Citation copied.');
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('os-src').hidden) closeSource(); });

  const BRIEF_PINS = {''')
# Brief "Built from": every row opens the OS source panel (facts and documents alike)
rep('''      if (id.startsWith('doc:')) { const d = BRIEF_DOCS[id.slice(4)]; return `<div class="bf-row bf-doc"><span class="bf-ico">▤</span><span><b>${d[0]}</b><small>${d[1]}</small></span></div>`; }''',
    '''      if (id.startsWith('doc:')) { const d = BRIEF_DOCS[id.slice(4)]; return `<button type="button" class="bf-row bf-doc" data-src="${id}"><span class="bf-ico">▤</span><span><b>${d[0]}</b><small>${d[1]}</small></span><span class="bf-go">Source →</span></button>`; }''')
s, _n = re.subn(r'      return `<details class="bf-row bf-fact"><summary>(.*?)</summary>\n        <div class="bf-more">.*?</div></details>`;',
                lambda m: '      return `<button type="button" class="bf-row bf-fact" data-src="${id}">' + m.group(1) + '</button>`;', s, count=1, flags=re.S)
assert _n == 1, 'built-from fact row'
rep("  // \"Open in Research\" from a brief part's Built from\n", "  $('look-inspector').addEventListener('click', e => { const b = e.target.closest('[data-src]'); if (!b) return; e.stopPropagation(); window.openSource(b.dataset.src); }, true);\n  // \"Open in Research\" from a brief part's Built from\n")
# Research: facts get "Full source"; expose selection for the OS panel
rep('''        <details class="rsp-where"><summary>Where did this come from?</summary>''', '''        <button type="button" class="sp-btn rsp-src" data-src="${id}">Full source →</button>
        <details class="rsp-where"><summary>Where did this come from?</summary>''')
rep("  let rsSel = null;", "  let rsSel = null;\n  window.rsSelectExt = (k, id) => { rsSelect(k, id); const row = document.querySelector('#r-facts-body tr[data-fact=\"' + id + '\"]'); if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' }); };")
rep("    const gf = e.target.closest('[data-goto-fact]'); if (gf) { rsSelect('fact', gf.dataset.gotoFact); return; }",
    "    const sr = e.target.closest('[data-src]'); if (sr) { window.openSource(sr.dataset.src); return; }\n    const gf = e.target.closest('[data-goto-fact]'); if (gf) { rsSelect('fact', gf.dataset.gotoFact); return; }")
# CSS
rep('\n</style>', r"""
/* ═══ OS source panel ═══ */
.os-src-back { position: fixed; inset: 0; z-index: 85; background: rgba(20,20,19,.18); }
.os-src { position: fixed; top: 70px; right: 16px; bottom: 16px; width: 440px; max-width: calc(100vw - 32px); z-index: 90; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 30px 70px -24px rgba(20,20,19,.45); padding: 18px 20px; overflow-y: auto; display: grid; gap: 14px; align-content: start; transform: translateX(24px); opacity: 0; transition: transform .2s ease, opacity .2s ease; }
.os-src.open { transform: none; opacity: 1; }
.osr-h { display: flex; justify-content: space-between; align-items: center; }
.osr-kind { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 3px 8px; border: 1px solid var(--line); border-radius: 999px; }
.osr-x { width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--line); background: none; font-size: 18px; cursor: pointer; color: var(--ink); }
.osr-title { font: 600 20px/1.25 var(--font-ui); letter-spacing: -.015em; }
.osr-pub { font-size: 13px; color: var(--muted); margin-top: -8px; }
.osr-from { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--ink) 4%, transparent); }
.osr-from svg { width: 16px; height: 16px; flex: none; }
.osr-quote { margin: 0; font-size: 15px; line-height: 1.5; border-left: 3px solid var(--ink); padding-left: 12px; }
.osr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin: 0; }
.osr-grid div:first-child { grid-column: 1 / -1; }
.osr-grid dt { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.osr-grid dd { margin: 2px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.osr-sec { display: grid; gap: 6px; border-top: 1px solid var(--line); padding-top: 12px; }
.osr-k { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.osr-use { display: flex; gap: 8px; align-items: baseline; font-size: 13px; }
.osr-use-k { font: 600 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--faint); min-width: 74px; }
.osr-none { font-size: 13px; color: var(--muted); }
.osr-f { display: flex; gap: 10px; align-items: center; border-top: 1px solid var(--line); padding-top: 12px; }
button.bf-row { width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; display: grid; grid-template-columns: 14px 1fr auto; gap: 8px; align-items: center; padding: 7px 9px; }
button.bf-row:hover { border-color: var(--ink); }
.bf-go { font: 600 11px var(--font-ui); color: var(--muted); }
.rsp-src { justify-self: start; }
</style>""", 1)
rep("!e.composedPath().some(n => n === $('brief-page') || n === $('look-inspector'))", "!e.composedPath().some(n => n === $('brief-page') || n === $('look-inspector') || n === $('os-src') || n === $('os-src-back'))")
rep("  document.addEventListener('click', e => { if (rsSel && !e.target.closest('#research-sheet, #r-side')) rsSelect(null); });", "  document.addEventListener('click', e => { if (rsSel && !e.target.closest('#research-sheet, #r-side, #os-src, #os-src-back')) rsSelect(null); });")
rep('\n</style>', r"""
html[data-theme="dark"] .bf-val { color: #151412; background: #F6E36B; border-radius: 3px; padding: 1px 5px; }
html[data-theme="dark"] .look-inspector mark.rs-hl, html[data-theme="dark"] .rs-side mark.rs-hl, html[data-theme="dark"] .os-src mark.rs-hl { color: #151412; background: #F6E36B; }
html[data-theme="dark"] .bf-row b { color: var(--ink); }
html[data-theme="dark"] .bf-row small, html[data-theme="dark"] .bf-go { color: var(--muted); }
</style>""", 1)
rep('\n</style>', r"""
html[data-theme="dark"] .rs-side .r-ask-form textarea { background-color: var(--card); color: var(--ink); border-color: var(--line-strong); }
html[data-theme="dark"] .rs-side .r-ask-form textarea::placeholder { color: var(--faint); }
</style>""", 1)
