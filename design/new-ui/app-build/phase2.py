# Phase 2 (2026-11-08): client chip + client page, calm brief output (click-to-reveal), Brief / Research identity.
# exec'd by build_app_v1.py with s, rep, cut, re in scope.

# ═══ 1. Brief output: the page is the brief + a small side tab ═══
a = s.index('<section id="brief-screen-output" class="section-block" hidden>')
a = s.index('<div class="action-strip">', a)
b = s.index('</aside>', a) + len('</aside>')
s = s[:a] + '''<div class="brief-workspace" id="brief-workspace">
        <div class="bm-wrap"><span class="bm-tab" id="bm-tab">Summer McFlurry</span><article class="brief-page bm-sheet" id="brief-page"></article></div>
        <aside class="look-inspector" id="look-inspector">
          <button type="button" class="btn-rect primary side-save" id="b-print-pdf">Save · PDF</button>
          <button type="button" class="side-link" id="b-redraft-btn">Draft it again</button>
          <div>
            <h4>Format</h4>
            <div class="seg-row" id="b-view-seg">
              <button type="button" data-view="screen" aria-pressed="true">Screen</button>
              <button type="button" data-view="pdf" aria-pressed="false">PDF</button>
              <button type="button" data-view="phone" aria-pressed="false">Phone</button>
            </div>
          </div>
          <div>
            <h4>Cover</h4>
            <div class="seg-row" id="b-cover-seg">
              <button type="button" data-cover="plain" aria-pressed="true">Plain</button>
              <button type="button" data-cover="band" aria-pressed="false">Band</button>
            </div>
          </div>
          <details class="side-more">
            <summary>More</summary>
            <h4>Frame</h4>
            <div class="seg-row" id="b-frame-seg" style="margin-bottom:8px">
              <button type="button" data-frame="open" aria-pressed="true">Open</button>
              <button type="button" data-frame="boxed" aria-pressed="false">Boxed</button>
            </div>
            <h4>Headings</h4>
            <div class="seg-row" id="b-heads-seg">
              <button type="button" data-heads="label" aria-pressed="true">Label</button>
              <button type="button" data-heads="tab" aria-pressed="false">Tab</button>
            </div>
            <button type="button" class="side-link" id="b-reset-layout">Reset look</button>
          </details>
          <p class="side-hint">Click a part to see why it says what it says, and to change it.</p>
        </aside>''' + s[b:]

# bindings for removed controls
cut("  $('b-toggle-arrange').addEventListener('click', function () {", "  $('b-redraft-btn').addEventListener('click', () => {", '')
_a = s.index("  $('b-look-presets').querySelectorAll('button').forEach(b => {")
_b = s.index("  });\n", s.index("  });\n", _a) + 1) + len("  });\n")
s = s[:_a] + s[_b:]

# renderBriefPage: no arrange mode, nothing on hover, everything on click
rep("  let briefEditMode = true;", "  let briefEditMode = false;\n  let selIdx = null;")
rep("  let briefAccent = '#2F6FED';", "  let briefAccent = '#2A2620';")
rep("    briefAccent = '#2F6FED'; briefBg = '#FFFDF8'; briefText = '#2A2620';", "    briefAccent = '#2A2620'; briefBg = '#FFFDF8'; briefText = '#2A2620';")
rep('''          <div class="eyebrow-row"><span>CREATIVE BRIEF · NAPKIN STUDIO</span><span>${data.sub}</span></div>
          <h2>${data.title}</h2>
          <p class="sub">Single-sheet arrangable record · Click "why?" on any block to inspect the decision chain</p>''',
    '''          <div class="eyebrow-row"><span>Creative brief</span><span>${data.sub}</span></div>
          <h2>${data.title}</h2>''')
_a = s.index("      const provHtml = p.as === 'cell' ? '' : p.why")
_b = s.index("      return `\n        <div class=\"gi lay-${p.as}", _a)
s = s[:_a] + r'''      const isSel = idx === selIdx;
      const whyHtml = isSel && p.why ? `
        <div class="why-drawer">
          <div class="why-row"><span class="rl">Checked</span><span>${p.who}</span></div>
          <div class="why-row"><span class="rl">Decided</span><span><b>${p.why.decided}</b></span></div>
          <div class="why-row"><span class="rl">Because</span><span>${p.why.because}</span></div>
          <div class="why-row"><span class="rl">Rejected</span><span>${p.why.rejected}</span></div>
          <div class="why-row"><span class="rl">Certainty</span><span>${p.why.certainty}</span></div>
        </div>` : '';
      const chromeHtml = isSel && p.as !== 'cell' ? `
        <div class="chrome-bar">
          <select data-bidx="${idx}" data-prop="as" aria-label="Show as">
            ${['prose','bullets','callout','statement','cell'].map(opt => `<option value="${opt}" ${p.as === opt ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
          <select data-bidx="${idx}" data-prop="span" aria-label="Width">
            ${[4,6,8,12].map(sp => `<option value="${sp}" ${p.span === sp ? 'selected' : ''}>${sp}/12</option>`).join('')}
          </select>
          <select data-bidx="${idx}" data-prop="tone" aria-label="Tone">
            ${['plain','tint','inverse'].map(tn => `<option value="${tn}" ${(p.tone || 'plain') === tn ? 'selected' : ''}>${tn}</option>`).join('')}
          </select>
          <button type="button" data-move="${idx}" data-dir="-1" title="Move up">↑</button>
          <button type="button" data-move="${idx}" data-dir="1" title="Move down">↓</button>
          <button type="button" data-redraft="${idx}">Redraft</button>
        </div>` : '';

''' + s[_b:]
rep('''        <div class="gi lay-${p.as} ${isTab ? 'hastab' : ''} ${toneCls} ${idx < 4 ? 'r1' : ''}" style="grid-column: span ${span}">
          ${chromeHtml}
          <div class="gi-head">
            <h3 class="${isTab ? 'tab' : ''}" ${briefEditMode ? 'contenteditable="true" spellcheck="false"' : ''}>${p.n}</h3>
            ${provHtml}
          </div>''',
    '''        <div class="gi lay-${p.as} ${isTab ? 'hastab' : ''} ${toneCls} ${idx < 4 ? 'r1' : ''} ${isSel ? 'sel' : ''} ${p.needs ? 'needs' : ''}" data-idx="${idx}" style="grid-column: span ${span}">
          ${chromeHtml}
          <div class="gi-head">
            <h3 class="${isTab ? 'tab' : ''}" ${isSel ? 'contenteditable="true" spellcheck="false"' : ''}>${p.n}</h3>
          </div>''')
rep('''      <span>${data.foot}</span>
      <span>12-column paper layout · Export ready</span>''', '''      <span>${data.foot}</span>''')
rep('''        data.parts[i] = data.parts[j];
        data.parts[j] = tmp;
        renderBriefPage();''', '''        data.parts[i] = data.parts[j];
        data.parts[j] = tmp;
        selIdx = j;
        renderBriefPage();''')
rep('''  // Brief toolbar bindings
''', r'''  // Click a part to select it: shows its why and its options. Esc or a click outside clears.
  $('brief-page').addEventListener('click', e => {
    if (e.target.closest('.chrome-bar, [contenteditable="true"], select')) return;
    const rd = e.target.closest('[data-redraft]');
    const gi = e.target.closest('.gi[data-idx]');
    if (!gi) return;
    const i = +gi.dataset.idx;
    selIdx = selIdx === i ? null : i;
    renderBriefPage();
  });
  $('brief-page').addEventListener('click', e => {
    const rd = e.target.closest('[data-redraft]'); if (!rd) return;
    const part = BRIEF_DATA[curBriefKey].parts[+rd.dataset.redraft];
    part.who = 'Napkin · redrafted just now';
    renderBriefPage();
    showToast('Redrafted "' + part.n + '". The rest of the page stayed as it was.');
  });
  document.addEventListener('click', e => { if (selIdx !== null && !e.composedPath().includes($('brief-page'))) { selIdx = null; renderBriefPage(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && selIdx !== null) { selIdx = null; renderBriefPage(); } });

  // Brief toolbar bindings
''')
rep("        data.parts[i] = data.parts[j];", "        data.parts[i] = data.parts[j];", 1)

# ═══ 2. Top bar: just the client, which goes back to the client page ═══
_a = s.index("  window.renderTrail = function () {")
_b = s.index("  window.renderToolHome = function (tool) {", _a)
s = s[:_a] + r'''  window.renderTrail = function () {
    const nav = $('tb-trail'); if (!nav) return;
    if (activeTool === 'desk' || activeTool === 'client') { nav.innerHTML = ''; return; }
    const c = DIAL[curClient] || DIAL.mcd;
    nav.innerHTML = `<button type="button" class="tb-client" title="Back to ${esc(c.full || c.name)}"><span class="tb-cdot" style="background:${c.col};color:${c.ink}">${esc(c.mono)}</span>${esc(c.full || c.name)}</button>`;
    nav.querySelector('.tb-client').addEventListener('click', () => goClient(curClient));
  };
  function goClient(id) {
    curClient = id; closeClient(true); curItem = null;
    activeTool = 'client'; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' });
  }
''' + s[_b:]
rep("    $('dial-hub').addEventListener('click', e => { e.stopPropagation(); closeClient(); });",
    "    $('dial-hub').addEventListener('click', e => { e.stopPropagation(); goClient(id); });")
rep('title="Close"><b>${esc(c.name)}</b>', 'title="Open ${esc(c.full || c.name)}"><b>${esc(c.name)}</b>')
rep(".cl-circle:hover .cl-disc { transform: translateY(-3px); }", "")
# the H1 medallion returns to the desk
rep("  $('header-medallion').addEventListener('click', () => {",
    "  $('header-medallion').addEventListener('click', e => { if (!e.shiftKey) { activeTool = 'desk'; syncNavigation(); return; } {")
rep("    else headerMark.set({ state: nxt, progress: nxt === 'done' ? 1 : 0.68 });\n  });",
    "    else headerMark.set({ state: nxt, progress: nxt === 'done' ? 1 : 0.68 });\n  } });")

# ═══ 3. Client page ═══
rep('  <!-- ═══════════════════════════════════════════════════════════════════════\n       TOOL 1: BRIEF MAKER',
    '  <main id="view-client" hidden></main>\n\n  <!-- ═══════════════════════════════════════════════════════════════════════\n       TOOL 1: BRIEF MAKER')
rep("    if (window.renderTrail) window.renderTrail();",
    "    if (window.renderTrail) window.renderTrail();\n"
    "    $('view-client').hidden = activeTool !== 'client';\n"
    "    if (activeTool === 'client' && window.renderClientPage) window.renderClientPage();\n"
    "    document.querySelector('.app-head').hidden = activeTool === 'client' || (stepTool && activeStep === 'output');\n"
    "    if (activeStep === 'prompt') $('hero-cta-circle').hidden = true;")
rep("  window.renderToolHome = function (tool) {", r'''  const CLIENT_X = {
    mcd: { since: 'MAR 2025', line: 'Summer McFlurry live · 2 need you',
      campaigns: [ { name: 'Summer McFlurry', docs: [['brief', 0, 0], ['research', 1, 0], ['deck', 2, 0], ['production', 3, 0]] },
                   { name: 'Spoon trial', docs: [['brief', 0, 1]] }, { name: 'Delivery desserts', docs: [['research', 1, 1]] } ],
      clan: { v: 4, upd: 'Updated 21 Oct from an accepted brief', counts: 'voice 6 · rules 9 · assets 23 · approved work 3', sw: ['#DA291C', '#FFC72C', '#27251F', '#FFFFFF'], voice: 'Warm, quick, a little cheeky. Never sarcastic.' },
      record: '38 brand facts · 112 category facts · 61 decisions' }
  };
  const DATES = ['2d', '4m', '1w', '3h', 'today', '5d'];
  window.renderClientPage = function () {
    const c = DIAL[curClient] || DIAL.mcd, full = c.full || c.name;
    const x = CLIENT_X[curClient] || { since: 'NOV 2026', line: (c.areas.length ? c.areas.length + ' kinds of work' : 'No work yet'),
      campaigns: c.areas.length ? [{ name: c.areas[0].items[0] ? c.areas[0].items[0].t : full, docs: c.areas.flatMap((a, ai) => a.items.map((it, j) => [a.tool, ai, j])) }] : [],
      clan: { v: 1, upd: 'Started from the roster', counts: 'voice 0 · rules 0 · assets 0 · approved work 0', sw: [c.col, c.ink, '#141413', '#FFFDF8'], voice: 'No voice written yet.' }, record: '0 brand facts · 0 decisions' };
    const ST = { needs: ['Needs your call', 'needs'], working: ['Agents working', 'working'], draft: ['Draft', ''], done: ['Done', ''] };
    const ico = t => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (TOOL_ICON[t] || TOOL_ICON.production) + '</svg>';
    const row = (d, k) => {
      const ar = c.areas[d[1]], it = ar && ar.items[d[2]]; if (!it) return '';
      const st = ST[it.st] || ['', ''];
      return `<button type="button" class="cp-row" data-a="${d[1]}" data-j="${d[2]}"><span class="cp-ico k-${ar.tool}">${ico(ar.tool)}</span>`
        + `<span class="cp-t"><b>${esc(it.t)}</b><small>${TOOL_NAME[ar.tool] || 'Production'}</small></span><span class="cp-st ${st[1]}">${st[0]}</span><span class="cp-d">${DATES[(d[1] + d[2] + k) % DATES.length]}</span></button>`;
    };
    const needs = c.areas.flatMap((a, ai) => a.items.map((it, j) => it.st === 'needs' ? [a.tool, ai, j] : null)).filter(Boolean);
    const sw = x.clan.sw.map(h => `<i style="background:${h}"></i>`).join('');
    $('view-client').innerHTML = `
      <header class="cp-head"><span class="cl-disc cp-disc" style="--cl:${c.col};--cl-ink:${c.ink}"><b>${esc(c.mono)}</b></span>
        <div><div class="eyebrow">CLIENT · SINCE ${x.since}</div><h1 class="hero-title">${esc(full)}<span class="period-dot"></span></h1><p class="hero-sub">${esc(x.line)}</p></div></header>
      ${needs.length ? `<section class="cp-sec"><h2 class="cp-h">Needs you</h2><div class="cp-box">${needs.map((d, k) => row(d, k)).join('')}</div></section>` : ''}
      <section class="cp-sec"><div class="cp-hrow"><h2 class="cp-h">Work</h2><div class="cp-new"><button type="button" class="cp-plus" id="cp-plus" aria-expanded="false" title="New">+</button>
        <div class="cp-menu" id="cp-menu" hidden><button type="button" data-new="brief">New brief</button><button type="button" data-new="research">New research question</button></div></div></div>
        <div class="cp-box">${x.campaigns.length ? x.campaigns.map(cm => `<div class="cp-camp">${esc(cm.name)}</div>` + cm.docs.map((d, k) => row(d, k)).join('')).join('') : '<p class="cp-empty">Nothing yet. Start with a brief or a research question.</p>'}</div></section>
      <section class="cp-sec"><h2 class="cp-h">Brand Clan</h2><div class="cp-box cp-clan"><div><b>Brand Clan · v${x.clan.v}</b><p>${esc(x.clan.upd)}</p><p class="mono">${x.clan.counts}</p></div>
        <div><span class="cp-sw">${sw}</span><p>${esc(x.clan.voice)}</p><button type="button" class="side-link" id="cp-kit">Open kit</button></div></div></section>
      <p class="cp-record"><button type="button" class="side-link" data-open-dtree-cp>${x.record}</button></p>`;
    $('view-client').querySelectorAll('.cp-row').forEach(b => b.addEventListener('click', () => {
      const ar = c.areas[+b.dataset.a], it = ar.items[+b.dataset.j]; curItem = it;
      if (ar.tool === 'production') { showToast('Production opens in the Production Tool (not in this mock).'); return; }
      if (it.preset) { const pb = document.querySelector('[data-bpreset="' + it.preset + '"]'); if (pb) pb.click(); }
      activeTool = ar.tool; activeStep = ar.tool === 'deck' ? 'output' : it.step; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' });
    }));
    const menu = $('cp-menu');
    $('cp-plus').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; $('cp-plus').setAttribute('aria-expanded', String(!menu.hidden)); });
    menu.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => { activeTool = b.dataset.new; activeStep = 'prompt'; curItem = null; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); }));
    $('cp-kit').addEventListener('click', () => showToast('Brand Clan kit opens here (not in this mock).'));
    $('view-client').querySelector('[data-open-dtree-cp]').addEventListener('click', () => setDecisionTreeOpen(true));
  };
  window.renderToolHome = function (tool) {''')
rep("  const TOOL_ICON = {", "  const TOOL_ICON = {\n    production: '<rect x=\"3.5\" y=\"6\" width=\"17\" height=\"12\" rx=\"1.5\"/><path d=\"M10 9.5l4.5 2.5-4.5 2.5z\"/>',")
# tool icons: Brief = folded sheet, Research = category tree
rep("    brief: '<rect x=\"6\" y=\"3.5\" width=\"12\" height=\"17\" rx=\"1.5\"/><line x1=\"9\" y1=\"8.5\" x2=\"15\" y2=\"8.5\"/><line x1=\"9\" y1=\"12\" x2=\"15\" y2=\"12\"/>',",
    "    brief: '<path d=\"M6 3.5h8.5l3.5 3.5v13.5H6z\"/><path d=\"M14.5 3.5V7H18\" opacity=\".55\"/><line x1=\"8.8\" y1=\"11\" x2=\"15.2\" y2=\"11\"/><line x1=\"8.8\" y1=\"14\" x2=\"15.2\" y2=\"14\"/><line x1=\"8.8\" y1=\"17\" x2=\"12.6\" y2=\"17\"/>',")
rep("    research: '<circle cx=\"11\" cy=\"11\" r=\"6\"/><line x1=\"15.5\" y1=\"15.5\" x2=\"20\" y2=\"20\"/>',",
    "    research: '<circle cx=\"12\" cy=\"5.5\" r=\"2.3\"/><circle cx=\"6.5\" cy=\"18\" r=\"2.3\"/><circle cx=\"17.5\" cy=\"18\" r=\"2.3\"/><path d=\"M12 7.8v4.2M6.5 15.7V12h11v3.7\"/>',")

# ═══ 4. Tool homes: Brief = dog-eared sheets with a manila tab, Research = ink band + lens dots ═══
rep("    grid.innerHTML = ar.items.map((it, j) => `<button type=\"button\" class=\"home-card\" data-j=\"${j}\"><small>${esc(it.c)}</small><b>${esc(it.t)}</b><span class=\"home-st ${ST[it.st] ? ST[it.st][1] : ''}\">${ST[it.st] ? ST[it.st][0] : ''}</span></button>`).join('')",
    "    const lens = '<span class=\"lens\">' + [1,1,1,.5,1,0,1,-1].map(v => '<i class=\"cov ' + (v === 1 ? 'filled' : v === .5 ? 'thin' : v === 0 ? 'empty' : 'none') + '\"></i>').join('') + '</span>';\n"
    "    grid.className = 'home-grid ' + (tool === 'brief' ? 'bm-homes' : 'rs-homes');\n"
    "    grid.innerHTML = ar.items.map((it, j) => tool === 'brief'\n"
    "      ? `<button type=\"button\" class=\"home-card bm-card bm-sheet\" data-j=\"${j}\"><span class=\"bm-tab\">${esc(it.c)}</span><b>${esc(it.t)}</b><span class=\"home-st ${ST[it.st] ? ST[it.st][1] : ''}\">${ST[it.st] ? ST[it.st][0] : ''}</span></button>`\n"
    "      : `<button type=\"button\" class=\"home-card rs-card\" data-j=\"${j}\"><span class=\"rs-band\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\">${TOOL_ICON.research}</svg>${esc(it.c)}</span><b>${esc(it.t)}</b>${lens}<span class=\"home-st ${ST[it.st] ? ST[it.st][1] : ''}\">${ST[it.st] ? ST[it.st][0] : ''} · 18 pins · 5 findings</span></button>`).join('')")

# ═══ 5. Brief prompt: one sheet, one action ═══
rep('''    <section id="brief-screen-prompt" class="section-block">
      <div class="sec-num">01 / INTAKE & ASK</div>
      <h2 class="sec-title">Give it everything you have</h2>''', '''    <section id="brief-screen-prompt" class="section-block bm-prompt">
      <h2 class="sec-title">What's the brief?</h2>''')
rep('''              <b>Connected from Research Tool:</b> Irish summer treats · 12 verified facts travel with this brief''',
    '''              From research: Irish summer treats · 12 facts''')
for emo in ('📄 ', '📊 ', '📑 '): rep(emo, '')
rep('''              Write the brief →
            </button>''', '''              Write the brief
            </button>''')
rep('''    <section id="research-screen-prompt" class="section-block">
      <div class="sec-num">01 / QUESTION & SCOPE</div>
      <h2 class="sec-title">Ask a sharp question</h2>''', '''    <section id="research-screen-prompt" class="section-block rs-prompt">
      <h2 class="sec-title">What do you need to find out?</h2>''')
rep('''              Run research →
            </button>''', '''              Start research
            </button>''')
rep('''          <div>
            <div class="prompt-label" style="margin-bottom:8px"><span>Sources to search & cross-check</span></div>''',
    '''          <div class="rs-scope"><span class="rs-scope-l">Lenses</span><span class="lens lens-lg" id="rs-lens">''' + ''.join(f'<button type="button" class="cov filled" title="{n}"></button>' for n in ['Market','Category','Audience','Culture','Competitors','Channels','Brand','Client data']) + '''</span></div>
          <div hidden>
            <div class="prompt-label" style="margin-bottom:8px"><span>Sources to search & cross-check</span></div>''')

# ═══ 6. Research output: one action, why on click, no badges ═══
rep('''          <button type="button" class="btn-rect" onclick="window.print()">Download PDF</button>
          <button type="button" class="btn-rect primary" id="r-spin-brief">Spin off a brief with these facts →</button>''',
    '''          <button type="button" class="btn-rect primary" id="r-spin-brief">Spin off a brief with these facts →</button>''')
s = s.replace('onclick="toggleWhy(this)" aria-expanded="true"', 'onclick="toggleWhy(this)" aria-expanded="false"')
s = re.sub(r'(</button>\n\s*</div>\n\s*)<div class="why-drawer">', r'\1<div class="why-drawer" hidden>', s)
rep('''            <div class="eyebrow">RESEARCH REPORT · MCDONALD'S IRELAND</div>''', '''            <div class="eyebrow">Research · McDonald's Ireland</div>''')
rep('''  // Click a part to select it''', r'''  // Research: click a finding to unfold its evidence and why
  document.querySelectorAll('#r-findings-list .finding-card').forEach(card => card.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const d = card.querySelector('.why-drawer'); if (!d) return;
    d.hidden = !d.hidden; card.classList.toggle('open', !d.hidden);
  }));
  $('rs-lens').querySelectorAll('.cov').forEach(b => b.addEventListener('click', () => { b.classList.toggle('filled'); b.classList.toggle('none'); }));

  // Click a part to select it''')

# ═══ 7. CSS ═══
rep('''/* Arrange chrome on brief blocks */
.chrome-bar {
  display: none;
  align-items: center;
  gap: 5px;
  margin-bottom: 6px;
}
.brief-page.edit .gi:hover .chrome-bar,
.brief-page.edit .gi.sel .chrome-bar {
  display: flex;
}
.brief-page.edit .gi:hover,
.brief-page.edit .gi.sel {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--b-accent) 65%, transparent);
}''', '''/* Parts: a faint tint on hover, nothing moves; a click selects and shows why + options */
.gi { position: relative; cursor: pointer; transition: background-color .12s; }
.gi:hover { background-color: color-mix(in srgb, var(--b-text) 3.5%, transparent); }
.gi.sel { background-color: color-mix(in srgb, var(--b-accent) 4%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b-accent) 30%, transparent); cursor: default; }
.gi.needs::after { content: ""; position: absolute; top: 20px; right: 10px; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
.chrome-bar { position: absolute; top: -36px; right: 0; display: flex; align-items: center; gap: 4px; padding: 3px; background: var(--paper); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 16px -8px rgba(20,20,19,.25); z-index: 3; }''')
rep("[id$='-home-eyebrow'] { display: none; }", r"""[id$='-home-eyebrow'] { display: none; }
/* top bar client chip */
.tb-client { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px 0 4px; border-radius: 999px; border: 1px solid var(--line); background: var(--paper); font: 600 13px var(--font-ui); color: var(--ink); cursor: pointer; }
.tb-client:hover { background: #FBF7EF; }
.tb-cdot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 800 10px var(--font-ui); }
/* side tab */
.look-inspector { gap: 16px; }
.side-save { width: 100%; justify-content: center; }
.side-link { background: none; border: 0; padding: 0; font: 600 13px var(--font-ui); color: var(--ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line); cursor: pointer; text-align: left; }
.side-link:hover { text-decoration-color: var(--ink); }
.side-more summary { cursor: pointer; font: 600 11px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.side-more[open] summary { margin-bottom: 10px; }
.side-more h4 { margin-top: 6px; }
.side-hint { font-size: 12px; color: var(--muted); line-height: 1.45; border-top: 1px solid var(--line); padding-top: 12px; }
/* Brief Maker identity: the dog-eared sheet with a manila tab */
.bm-wrap { position: relative; padding-top: 16px; }
.bm-sheet { position: relative; clip-path: polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%); }
.bm-sheet::after { content: ""; position: absolute; top: 0; right: 0; width: 20px; height: 20px; background: linear-gradient(225deg, transparent 50%, #EAE1CF 50%); }
.bm-tab { position: absolute; top: 0; left: 24px; height: 17px; padding: 0 10px; display: inline-flex; align-items: center; background: #E7D5AC; border: 1px solid #C4AA75; border-bottom: 0; border-radius: 4px 4px 0 0; font: 600 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #5A4A2A; z-index: 2; }
.bm-card { position: relative; margin-top: 17px; overflow: visible; }
.bm-card .bm-tab { top: -17px; left: 18px; }
.bm-card b { font: 600 20px/1.2 var(--font-serif); letter-spacing: -.01em; margin-top: 4px; }
.brief-page .b-cover h2 { font-family: var(--font-serif); font-weight: 600; }
.bm-prompt .sec-title, .bm-homes + * { font-family: var(--font-serif); }
.bm-prompt .sec-title { font-weight: 600; letter-spacing: -.01em; }
.bm-prompt .meta-fields, .bm-prompt .side-card, .bm-prompt #view-research-btn, .bm-prompt .composer-footer span { display: none; }
.bm-prompt .intake-grid { grid-template-columns: minmax(0, 760px); }
.bm-prompt .paper-composer { clip-path: polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%); }
.bm-prompt .prompt-ta { font-family: var(--font-serif); font-size: 17px; }
.bm-prompt .upstream-banner { background: none; border: 0; padding: 0; font-size: 13px; color: var(--muted); }
.bm-prompt .upstream-banner .dot-ok { display: none; }
.bm-prompt .file-slip { font-family: var(--font-mono); font-size: 11.5px; }
.bm-prompt .file-slip button { opacity: 0; transition: opacity .12s; }
.bm-prompt .file-slip:hover button { opacity: 1; }
#b-start-run { background: #C9462A; border-color: #C9462A; color: #fff; }
.proc-footer { display: none; }
/* Research identity: ink band, sans, lens dots */
.lens { display: inline-flex; gap: 5px; align-items: center; }
.cov { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--ink); background: transparent; padding: 0; }
.cov.filled { background: var(--ink); }
.cov.thin { background: linear-gradient(90deg, var(--ink) 50%, transparent 50%); }
.cov.empty { border-color: var(--warn); }
.cov.none { border-style: dashed; }
.lens-lg .cov { width: 16px; height: 16px; cursor: pointer; }
.rs-card { padding: 0; overflow: hidden; gap: 10px; }
.rs-card > *:not(.rs-band) { margin: 0 18px; }
.rs-card > .home-st { margin-bottom: 16px; font-family: var(--font-mono); font-size: 11.5px; }
.rs-band { display: flex; align-items: center; gap: 8px; background: var(--ink); color: var(--paper); padding: 9px 14px; font: 700 11px var(--font-mono); letter-spacing: .1em; }
.rs-band svg { width: 16px; height: 16px; }
.rs-prompt .meta-fields, .rs-prompt .side-card, .rs-prompt .prompt-label { display: none; }
.rs-prompt .intake-grid { grid-template-columns: minmax(0, 760px); }
.rs-prompt .paper-composer { background: transparent; border: 0; box-shadow: none; padding: 0; }
.rs-prompt .prompt-ta { border: 2px solid var(--ink); border-radius: 28px; padding: 20px 26px; font: 500 17px/1.5 var(--font-ui); background: var(--paper); }
.rs-scope { display: flex; align-items: center; gap: 12px; }
.rs-scope-l { font: 600 11px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
#r-start-run { background: var(--ink); border-color: var(--ink); border-radius: 999px; }
.research-sheet { box-shadow: none; }
.r-header { background: var(--ink); color: var(--paper); margin: -1px -1px 0; padding: 26px 30px; border-radius: var(--r-md) var(--r-md) 0 0; }
.r-header .eyebrow, .r-header p { color: rgba(255,253,248,.7) !important; }
.r-header .badge-pill { display: none; }
.r-question, .finding-stmt { font-family: var(--font-ui) !important; letter-spacing: -.02em; }
.r-question { font-weight: 600; color: var(--paper); }
.finding-stmt { font-weight: 500; font-size: 18px; line-height: 1.4; }
.finding-quote { font-family: var(--font-ui) !important; font-style: normal !important; font-size: 14px; border-left: 2px solid var(--ink) !important; }
.finding-card { cursor: pointer; }
.finding-card .prov-pill, .finding-card .badge-pill.verified { display: none; }
.finding-card.proposed { border: 1px dashed var(--faint) !important; }
#research-screen-output .action-left { display: none; }
/* client page */
#view-client { max-width: 1080px; margin: 0 auto; padding: 34px 0 40px; }
.cp-head { display: flex; align-items: center; gap: 22px; padding-bottom: 26px; border-bottom: 1px solid var(--line); }
.cp-disc { width: 84px; height: 84px; }
.cp-disc b { width: 84px; height: 84px; font-size: 26px; }
.cp-head .hero-title { font-size: clamp(32px, 4vw, 46px); margin-bottom: 4px; }
.cp-sec { margin-top: 30px; }
.cp-hrow { display: flex; align-items: center; justify-content: space-between; }
.cp-h { font: 700 18px var(--font-ui); letter-spacing: -.01em; margin-bottom: 12px; }
.cp-box { background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; }
.cp-camp { padding: 12px 18px 6px; font: 600 11px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border-top: 1px solid var(--line); }
.cp-camp:first-child { border-top: 0; }
.cp-row { width: 100%; display: grid; grid-template-columns: 28px 1fr auto 56px; align-items: center; gap: 14px; padding: 12px 18px 12px 30px; border: 0; background: none; text-align: left; cursor: pointer; }
.cp-box > .cp-row:first-child { padding-left: 18px; }
.cp-row + .cp-row { border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
.cp-row:hover { background: #FBF7EF; }
.cp-ico { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line); color: var(--ink); }
.cp-ico svg { width: 15px; height: 15px; }
.cp-ico.k-research { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.cp-ico.k-brief { background: #F1E6CB; border-color: #C4AA75; }
.cp-t { display: grid; }
.cp-t b { font: 600 14.5px var(--font-ui); color: var(--ink); }
.cp-t small { font-size: 12px; color: var(--muted); }
.cp-st { font-size: 12.5px; color: var(--muted); }
.cp-st.needs { color: var(--warn); font-weight: 600; }
.cp-st.working { color: var(--ink-soft); }
.cp-d { font: 11.5px var(--font-mono); color: var(--faint); text-align: right; }
.cp-new { position: relative; }
.cp-plus { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line-strong); background: var(--paper); font-size: 22px; line-height: 1; cursor: pointer; margin-bottom: 12px; }
.cp-menu { position: absolute; right: 0; top: 46px; z-index: 5; display: grid; min-width: 210px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: 0 10px 26px -12px rgba(20,20,19,.3); overflow: hidden; }
.cp-menu button { text-align: left; padding: 11px 14px; border: 0; background: none; font: 500 13.5px var(--font-ui); cursor: pointer; }
.cp-menu button:hover { background: #FBF7EF; }
.cp-empty { padding: 18px; color: var(--muted); font-size: 13.5px; }
.cp-clan { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 18px; }
.cp-clan b { font: 700 15px var(--font-ui); }
.cp-clan p { font-size: 13px; color: var(--muted); margin-top: 4px; }
.cp-clan .mono { font: 12px var(--font-mono); color: var(--ink-soft); }
.cp-sw { display: flex; gap: 6px; margin-bottom: 6px; }
.cp-sw i { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,.1); }
.cp-record { margin-top: 22px; }
.cp-record .side-link { font: 12px var(--font-mono); color: var(--muted); }
@media (max-width: 720px) { .cp-clan { grid-template-columns: 1fr; } .cp-row { grid-template-columns: 28px 1fr auto; } .cp-d { display: none; } }""")

# one action on the prompt screens: the composer's own button
rep("    document.querySelector('.app-head').hidden = activeTool === 'client' || (stepTool && activeStep === 'output');",
    "    document.querySelector('.app-head').hidden = activeTool === 'client' || (stepTool && activeStep === 'output');\n    if (activeStep === 'prompt') $('hero-cta-circle').hidden = true;")
rep("#research-screen-output .action-left { display: none; }", "#research-screen-output .action-left { display: none; }\n#research-screen-output .action-strip { justify-content: flex-end; border: 0; }")

# ═══ 8. Move and resize parts: grip to drag, right edge to resize (both fade in on hover, take no space) ═══
rep('''          ${chromeHtml}
          <div class="gi-head">
            <h3 class="${isTab ? 'tab' : ''}" ${isSel ? 'contenteditable="true" spellcheck="false"' : ''}>${p.n}</h3>''',
    '''          ${chromeHtml}
          ${briefView === 'phone' ? '' : `<span class="gi-grip" draggable="true" data-grip="${idx}" title="Drag to move">⋮⋮</span><span class="gi-resize" data-rs="${idx}" title="Drag to resize"></span>`}
          <div class="gi-head">
            <h3 class="${isTab ? 'tab' : ''}" ${isSel ? 'contenteditable="true" spellcheck="false"' : ''}>${p.n}</h3>''')
rep('''    // Bind block arrangement controls
''', r'''    // Drag a part by its grip to move it
    let dragFrom = null;
    const clearDrop = () => pg.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    pg.querySelectorAll('.gi-grip').forEach(g => {
      g.addEventListener('dragstart', e => {
        dragFrom = +g.dataset.grip; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom));
        const gi = g.closest('.gi'); e.dataTransfer.setDragImage(gi, 20, 20); requestAnimationFrame(() => gi.classList.add('dragging'));
      });
      g.addEventListener('dragend', () => { dragFrom = null; clearDrop(); pg.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); });
    });
    const beforeOf = (gi, e) => { const r = gi.getBoundingClientRect(); return (parseInt(gi.style.gridColumn.replace(/\D+/g, '')) || 12) < 12 ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2; };
    pg.querySelectorAll('.gi[data-idx]').forEach(gi => {
      gi.addEventListener('dragover', e => {
        if (dragFrom === null) return; e.preventDefault();
        clearDrop(); if (+gi.dataset.idx !== dragFrom) gi.classList.add(beforeOf(gi, e) ? 'drop-before' : 'drop-after');
      });
      gi.addEventListener('drop', e => {
        if (dragFrom === null) return; e.preventDefault();
        const to0 = +gi.dataset.idx; if (to0 === dragFrom) return;
        let to = beforeOf(gi, e) ? to0 : to0 + 1;
        const [m] = data.parts.splice(dragFrom, 1); if (dragFrom < to) to--;
        data.parts.splice(to, 0, m); selIdx = null; dragFrom = null; renderBriefPage();
      });
    });
    // Drag a part's right edge to resize it across the 12 columns
    pg.querySelectorAll('.gi-resize').forEach(h => h.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const i = +h.dataset.rs, gi = h.closest('.gi'), grid = pg.querySelector('.b-grid');
      const gs = getComputedStyle(grid), inner = grid.clientWidth - parseFloat(gs.paddingLeft) - parseFloat(gs.paddingRight);
      const gap = parseFloat(gs.columnGap) || 0, col = (inner - gap * 11) / 12, left = gi.getBoundingClientRect().left;
      let span = data.parts[i].span || 12;
      gi.classList.add('resizing'); h.setPointerCapture(e.pointerId);
      const move = ev => {
        span = Math.max(3, Math.min(12, Math.round((ev.clientX - left + gap) / (col + gap))));
        gi.style.gridColumn = 'span ' + span; gi.dataset.span = span + '/12';
      };
      const up = () => { h.removeEventListener('pointermove', move); data.parts[i].span = span; renderBriefPage(); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up, { once: true });
    }));

    // Bind block arrangement controls
''')
rep("    if (e.target.closest('.chrome-bar, [contenteditable=\"true\"], select')) return;",
    "    if (e.target.closest('.chrome-bar, [contenteditable=\"true\"], select, .gi-grip, .gi-resize')) return;")
rep('<p class="side-hint">Click a part to see why it says what it says, and to change it.</p>',
    '<p class="side-hint">Click a part to see why it says what it says. Drag ⋮⋮ to move it, drag its right edge to resize.</p>')
rep(".chrome-bar { position: absolute; top: -36px;", r""".gi-grip { position: absolute; top: 14px; left: -16px; width: 14px; height: 22px; display: grid; place-items: center; font: 700 11px/1 var(--font-mono); letter-spacing: -2px; color: var(--b-muted, #6D655A); cursor: grab; opacity: 0; transition: opacity .12s; user-select: none; }
.gi-resize { position: absolute; top: 8px; bottom: 8px; right: -12px; width: 10px; cursor: col-resize; opacity: 0; transition: opacity .12s; }
.gi-resize::after { content: ""; position: absolute; left: 4px; top: 0; bottom: 0; width: 2px; border-radius: 2px; background: color-mix(in srgb, var(--b-text) 30%, transparent); }
.gi:hover .gi-grip, .gi:hover .gi-resize, .gi.sel .gi-grip, .gi.sel .gi-resize, .gi.resizing .gi-resize { opacity: 1; }
.gi-resize:hover::after, .gi.resizing .gi-resize::after { background: var(--b-accent); }
.gi.resizing { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b-accent) 40%, transparent); }
.gi.resizing::before { content: attr(data-span); position: absolute; top: 6px; right: 10px; font: 600 10.5px var(--font-mono); color: var(--b-accent); }
.gi.dragging { opacity: .35; }
.gi.drop-before { box-shadow: inset 3px 0 0 var(--b-accent); }
.gi.drop-after { box-shadow: inset -3px 0 0 var(--b-accent); }
.chrome-bar { position: absolute; top: -36px;""")
