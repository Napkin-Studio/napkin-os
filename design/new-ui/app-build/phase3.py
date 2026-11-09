# Phase 3 (2026-11-08): edit a part's text in place; more personality for Brief (red pencil on manila) and Research (highlighter on graph paper).

# ═══ 1. Edit: an Edit button in the part's bar (or double-click); saves when you leave the text ═══
rep("  let selIdx = null;", "  let selIdx = null;\n  let editIdx = null;")
rep("      const chromeHtml = isSel && p.as !== 'cell' ? `\n        <div class=\"chrome-bar\">\n          <select data-bidx",
    "      const chromeHtml = isSel && p.as === 'cell' ? `<div class=\"chrome-bar\"><button type=\"button\" class=\"cb-edit\" data-edit=\"${idx}\">${editIdx === idx ? 'Done' : 'Edit'}</button></div>` : isSel ? `\n        <div class=\"chrome-bar\">\n          <button type=\"button\" class=\"cb-edit\" data-edit=\"${idx}\">${editIdx === idx ? 'Done' : 'Edit'}</button>\n          <select data-bidx")
rep('''          ${bodyHtml}
          ${whyHtml}''', '''          <div class="gi-body" data-body="${idx}" ${editIdx === idx ? 'contenteditable="true" spellcheck="true"' : ''}>${bodyHtml}</div>
          ${whyHtml}''')
rep('''  // Click a part to select it: shows its why and its options. Esc or a click outside clears.''', r'''  // Edit text in place
  function saveBody(el) {
    const p = BRIEF_DATA[curBriefKey].parts[+el.dataset.body]; if (!p) return;
    const pick = sel => [...el.querySelectorAll(sel)].map(x => x.innerHTML.trim()).filter(Boolean);
    let items = p.as === 'bullets' ? pick('li') : p.as === 'statement' ? pick('.stmt') : p.as === 'callout' ? pick('.txt') : p.as === 'cell' ? [] : pick('p');
    if (p.as === 'cell') { const cv = el.querySelector('.cv'); items = (cv ? cv.innerHTML : el.innerHTML).split(/<br\s*\/?>/i).map(x => x.trim()).filter(Boolean); }
    if (!items.length) items = el.innerText.split(/\n+/).map(x => x.trim()).filter(Boolean);
    p.items = items;
  }
  function startEdit(i) {
    editIdx = i; selIdx = i; renderBriefPage();
    const el = $('brief-page').querySelector('[data-body="' + i + '"]'); if (!el) return;
    el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  $('brief-page').addEventListener('focusout', e => {
    const el = e.target.closest && e.target.closest('[data-body]'); if (el) saveBody(el);
    const h = e.target.closest && e.target.closest('h3[contenteditable="true"]');
    if (h) { const gi = h.closest('.gi'); const p = BRIEF_DATA[curBriefKey].parts[+gi.dataset.idx]; if (p) p.n = h.textContent.trim() || p.n; }
  });
  $('brief-page').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]'); if (!b) return;
    e.stopPropagation();
    const i = +b.dataset.edit;
    if (editIdx === i) { const el = $('brief-page').querySelector('[data-body="' + i + '"]'); if (el) saveBody(el); editIdx = null; renderBriefPage(); }
    else startEdit(i);
  }, true);
  $('brief-page').addEventListener('dblclick', e => {
    if (e.target.closest('.chrome-bar, .gi-grip, .gi-resize')) return;
    const gi = e.target.closest('.gi[data-idx]'); if (gi && editIdx !== +gi.dataset.idx) startEdit(+gi.dataset.idx);
  });

  // Click a part to select it: shows its why and its options. Esc or a click outside clears.''')
# leaving a part (another click, Esc, outside) ends editing after saving
rep("    const i = +gi.dataset.idx;\n    selIdx = selIdx === i ? null : i;\n    renderBriefPage();",
    "    const i = +gi.dataset.idx;\n    if (editIdx === i) return;\n    const ed = $('brief-page').querySelector('[data-body][contenteditable=\"true\"]'); if (ed) saveBody(ed);\n    editIdx = null; selIdx = selIdx === i ? null : i;\n    renderBriefPage();")
rep("  document.addEventListener('click', e => { if (selIdx !== null && !e.composedPath().includes($('brief-page'))) { selIdx = null; renderBriefPage(); } });",
    "  document.addEventListener('click', e => { if (selIdx !== null && !e.composedPath().includes($('brief-page'))) { const ed = $('brief-page').querySelector('[data-body][contenteditable=\"true\"]'); if (ed) saveBody(ed); selIdx = null; editIdx = null; renderBriefPage(); } });")
rep("  document.addEventListener('keydown', e => { if (e.key === 'Escape' && selIdx !== null) { selIdx = null; renderBriefPage(); } });",
    "  document.addEventListener('keydown', e => { if (e.key === 'Escape' && selIdx !== null) { const ed = $('brief-page').querySelector('[data-body][contenteditable=\"true\"]'); if (ed) saveBody(ed); selIdx = null; editIdx = null; renderBriefPage(); } });")
rep("    if (e.target.closest('.chrome-bar, [contenteditable=\"true\"], select, .gi-grip, .gi-resize')) return;",
    "    if (e.target.closest('.chrome-bar, [contenteditable=\"true\"], select, .gi-grip, .gi-resize, [data-edit]')) return;")
rep('<p class="side-hint">Click a part to see why it says what it says. Drag ⋮⋮ to move it, drag its right edge to resize.</p>',
    '<p class="side-hint">Click a part to see why it says what it says. Double-click to edit. Drag ⋮⋮ to move it, its right edge to resize.</p>')

# ═══ 2. Brief: status stamp on the sheet ═══
rep('''          <div class="eyebrow-row"><span>Creative brief</span><span>${data.sub}</span></div>
          <h2>${data.title}</h2>''', '''          <div class="eyebrow-row"><span>Creative brief</span><span>${data.sub}</span></div>
          <h2>${data.title}</h2>
          <span class="bm-stamp ${data.parts.some(x => x.needs) ? '' : 'ok'}">${data.parts.some(x => x.needs) ? 'Needs your call' : 'Approved'}</span>''')
# home cards: folders with stamps
rep("      ? `<button type=\"button\" class=\"home-card bm-card bm-sheet\" data-j=\"${j}\"><span class=\"bm-tab\">${esc(it.c)}</span><b>${esc(it.t)}</b><span class=\"home-st ${ST[it.st] ? ST[it.st][1] : ''}\">${ST[it.st] ? ST[it.st][0] : ''}</span></button>`",
    "      ? `<button type=\"button\" class=\"home-card bm-card\" data-j=\"${j}\"><span class=\"bm-tab\">${esc(it.c)}</span><span class=\"bm-peek\"></span><b>${esc(it.t)}</b><span class=\"bm-cstamp ${it.st}\">${ST[it.st] ? ST[it.st][0] : ''}</span></button>`")

# ═══ 3. Tool theme hook on <body> ═══
rep("    if (window.renderTrail) window.renderTrail();",
    "    if (window.renderTrail) window.renderTrail();\n    document.body.dataset.tool = activeTool;")

# ═══ 4. Research: findings as numbered nodes on an evidence line; numbers in highlighter ═══
rep('''  // Research: click a finding to unfold its evidence and why''', r'''  // Research personality: number nodes on an evidence line, figures in highlighter
  document.querySelectorAll('#r-findings-list .finding-card').forEach((card, i) => {
    const st = card.querySelector('.finding-stmt');
    if (st && !card.querySelector('.rs-node')) {
      st.innerHTML = st.innerHTML.replace(/^\s*\d+\.\s*/, '');
      card.insertAdjacentHTML('afterbegin', '<span class="rs-node">' + (i + 1) + '</span>');
    }
  });
  document.querySelectorAll('#research-screen-output .finding-stmt, #research-screen-output .finding-quote').forEach(el => {
    el.childNodes.forEach(n => { if (n.nodeType === 3 && /\d/.test(n.textContent)) {
      const span = document.createElement('span');
      span.innerHTML = n.textContent.replace(/(\+?\d[\d.,]*\s?%?(?:\s?(?:YoY|pts|clips|likes|M|k))?)/g, '<mark class="rs-hl">$1</mark>');
      n.replaceWith(...span.childNodes);
    } });
  });

  // Research: click a finding to unfold its evidence and why''')

# ═══ 5. CSS ═══
rep(".chrome-bar { position: absolute; top: -36px;", r"""/* ── Brief Maker: red pencil on manila ── */
:root { --bm-manila: #E7D5AC; --bm-manila-2: #F3E8CC; --bm-manila-line: #C4AA75; --bm-red: #C9462A; }
body[data-tool="brief"] .app-head .hero-title { font-family: var(--font-serif); font-weight: 600; letter-spacing: -.02em; }
body[data-tool="brief"] .app-head .hero-title .period-dot { background: var(--bm-red); }
body[data-tool="brief"] .app-head .eyebrow::before { content: ""; display: inline-block; width: 18px; height: 2px; background: var(--bm-red); vertical-align: middle; margin-right: 8px; }
body[data-tool="brief"] .flow-steps button[aria-pressed="true"] i { background: var(--bm-red); border-color: var(--bm-red); color: #fff; }
.cb-edit { font-weight: 700 !important; color: var(--bm-red) !important; border-color: color-mix(in srgb, var(--bm-red) 40%, transparent) !important; }
.gi-body[contenteditable="true"] { outline: none; background: #fff; box-shadow: 0 0 0 1px color-mix(in srgb, var(--bm-red) 45%, transparent), 0 0 0 4px color-mix(in srgb, var(--bm-red) 10%, transparent); border-radius: 4px; padding: 2px 6px; margin: -2px -6px; cursor: text; }
.brief-page { background-image: linear-gradient(90deg, transparent 27px, color-mix(in srgb, var(--bm-red) 28%, transparent) 27px, color-mix(in srgb, var(--bm-red) 28%, transparent) 28px, transparent 28px); }
.brief-page .b-cover { position: relative; }
.bm-stamp { position: absolute; right: 44px; top: 58px; transform: rotate(-6deg); border: 2px solid var(--bm-red); color: var(--bm-red); border-radius: 6px; padding: 4px 10px; font: 800 11px var(--font-mono); letter-spacing: .14em; text-transform: uppercase; opacity: .85; mix-blend-mode: multiply; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bm-red) 30%, transparent); }
.bm-stamp.ok { border-color: #2F6B3A; color: #2F6B3A; }
.lay-statement .stmt { text-decoration: underline; text-decoration-color: var(--bm-red); text-decoration-thickness: 2px; text-underline-offset: 7px; text-decoration-skip-ink: auto; }
.bm-prompt .prompt-ta { background: #FFFDF8 repeating-linear-gradient(transparent 0 26px, color-mix(in srgb, #7A9CC6 22%, transparent) 26px 27px); background-position: 0 14px; line-height: 27px; padding-left: 44px; border-color: var(--line); box-shadow: inset 30px 0 0 -29px var(--bm-red); }
.bm-prompt .paper-composer { background: var(--paper); }
.bm-prompt .file-slip { background: var(--bm-manila-2); border-color: var(--bm-manila-line); color: #5A4A2A; }
/* folders on the briefs home */
.bm-card { background: var(--bm-manila-2) !important; border: 1px solid var(--bm-manila-line) !important; border-radius: 2px 8px 8px 8px !important; padding: 26px 18px 18px !important; min-height: 150px; box-shadow: 0 1px 0 #fff inset, 0 8px 18px -12px rgba(90,74,42,.5); transition: transform .15s; }
.bm-card:hover { transform: translateY(-2px); border-color: #A88E5A !important; }
.bm-card .bm-tab { left: -1px; top: -17px; background: var(--bm-manila-2); border-color: var(--bm-manila-line); }
.bm-peek { position: absolute; left: 12px; right: 12px; top: -7px; height: 14px; background: #FFFDF8; border: 1px solid var(--line); border-bottom: 0; border-radius: 2px 2px 0 0; z-index: -1; }
.bm-card b { color: #2A2620; }
.bm-cstamp { align-self: start; justify-self: start; margin-top: auto; transform: rotate(-4deg); border: 1.5px solid currentColor; border-radius: 4px; padding: 2px 7px; font: 800 10px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: #7A6A48; }
.bm-cstamp.needs { color: var(--bm-red); }
.bm-cstamp.done { color: #2F6B3A; }
.bm-homes .home-new { min-height: 150px; margin-top: 17px; border-radius: 2px 8px 8px 8px; }
.cp-ico.k-brief { background: var(--bm-manila-2); border-color: var(--bm-manila-line); color: #5A4A2A; }

/* ── Research: highlighter on graph paper ── */
:root { --rs-hl: #F6E36B; --rs-grid: radial-gradient(circle, color-mix(in srgb, var(--ink) 16%, transparent) 1px, transparent 1.4px) 0 0 / 14px 14px; }
body[data-tool="research"] .app-head .hero-title { font-family: var(--font-mono); font-weight: 700; letter-spacing: -.05em; }
body[data-tool="research"] .app-head .hero-title .period-dot { background: var(--rs-hl); box-shadow: 0 0 0 1.5px var(--ink); }
body[data-tool="research"] .app-head .eyebrow::before { content: ""; display: inline-block; width: 18px; height: 8px; background: var(--rs-hl); vertical-align: middle; margin-right: 8px; }
body[data-tool="research"] .flow-steps button[aria-pressed="true"] i { background: var(--rs-hl); border-color: var(--ink); color: var(--ink); }
.rs-prompt .prompt-ta { background: var(--paper); background-image: var(--rs-grid); }
.rs-prompt .sec-title { font-family: var(--font-mono); letter-spacing: -.04em; }
.rs-card { background: var(--paper) !important; background-image: var(--rs-grid) !important; }
.rs-card .rs-band { box-shadow: inset -60px 0 0 -54px var(--rs-hl); }
.research-sheet { background-color: var(--paper); background-image: var(--rs-grid); }
.r-header { box-shadow: inset 0 -6px 0 var(--rs-hl); padding-bottom: 32px; }
mark.rs-hl { background: linear-gradient(transparent 38%, var(--rs-hl) 38%, var(--rs-hl) 88%, transparent 88%); color: inherit; padding: 0 2px; border-radius: 2px; }
#r-findings-list { position: relative; padding-left: 44px; }
#r-findings-list::before { content: ""; position: absolute; left: 15px; top: 24px; bottom: 24px; border-left: 2px solid var(--ink); }
.finding-card { position: relative; background: #fff !important; }
.rs-node { position: absolute; left: -44px; top: 18px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 700 13px var(--font-mono); box-shadow: 0 0 0 4px var(--paper); }
.finding-card.proposed .rs-node { background: var(--paper); color: var(--ink); border: 2px dashed var(--ink); }
.finding-card.open .rs-node { background: var(--rs-hl); color: var(--ink); }
.fid-chip { background: #fff !important; border: 1px solid var(--ink) !important; border-radius: 3px !important; padding: 1px 8px 1px 18px !important; position: relative; }
.fid-chip::before { content: ""; position: absolute; left: 6px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%; background: #D8452E; box-shadow: inset -1px -1px 0 rgba(0,0,0,.25); }
.cp-ico.k-research { background: var(--ink); box-shadow: inset 0 -5px 0 -2px var(--rs-hl); }
.chrome-bar { position: absolute; top: -36px;""")

# ═══ 6. Client page: work organised by tool; each section's + opens that tool's new screen ═══
_a = s.index('      <section class="cp-sec"><div class="cp-hrow"><h2 class="cp-h">Work</h2>')
_b = s.index('</section>', _a) + len('</section>')
s = s[:_a] + r'''      ${(() => {
        const GROUPS = [['brief', 'Briefs'], ['research', 'Research'], ['deck', 'Decks'], ['production', 'Production']];
        return GROUPS.map(([tool, label]) => {
          const ai = c.areas.findIndex(a => a.tool === tool), ar = c.areas[ai];
          if (!ar && (tool === 'deck' || tool === 'production')) return '';
          const rows = ar ? ar.items.map((it, j) => row([tool, ai, j], j)).join('') : '';
          return `<section class="cp-sec cp-group k-${tool}"><div class="cp-hrow"><h2 class="cp-h"><span class="cp-ico k-${tool}">${ico(tool)}</span>${label}<small>${ar ? ar.items.length : 0}</small></h2>`
            + `<button type="button" class="cp-plus" data-new="${tool}" title="New ${label.toLowerCase()}">+</button></div>`
            + `<div class="cp-box">${rows || `<p class="cp-empty">Nothing here yet.</p>`}</div></section>`;
        }).join('');
      })()}''' + s[_b:]
rep("    const menu = $('cp-menu');\n", "")
rep("    $('cp-plus').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; $('cp-plus').setAttribute('aria-expanded', String(!menu.hidden)); });\n", "")
rep("    menu.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => { activeTool = b.dataset.new; activeStep = 'prompt'; curItem = null; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); }));",
    "    $('view-client').querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => {\n"
    "      const t = b.dataset.new;\n"
    "      if (t === 'production') { showToast('Production opens in the Production Tool (not in this mock).'); return; }\n"
    "      activeTool = t; activeStep = t === 'deck' ? 'output' : 'prompt'; curItem = null; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' });\n"
    "    }));")
rep(".cp-camp { padding:", ".cp-h { display: flex; align-items: center; gap: 10px; }\n.cp-h small { font: 600 11.5px var(--font-mono); color: var(--faint); }\n.cp-group .cp-row { padding-left: 18px; }\n.cp-group .cp-row .cp-ico { display: none; }\n.cp-group .cp-row { grid-template-columns: 1fr auto 56px; }\n.cp-plus { width: 34px; height: 34px; font-size: 19px; margin-bottom: 12px; }\n.cp-camp { padding:")

# ═══ 7. Fixes: option bar sits on the part's top edge (left-anchored); highlight only figures ═══
rep(".chrome-bar { position: absolute; top: -36px; right: 0;", ".chrome-bar { position: absolute; top: -17px; left: 6px;")
rep(r"""span.innerHTML = n.textContent.replace(/(\+?\d[\d.,]*\s?%?(?:\s?(?:YoY|pts|clips|likes|M|k))?)/g, '<mark class="rs-hl">$1</mark>');""",
    r"""span.innerHTML = n.textContent.replace(/(\+?\d[\d,]*(?:\.\d+)?\s?%(?:\s?YoY)?|\+?\d+\s?pts)/g, '<mark class="rs-hl">$1</mark>');""")
rep("    el.childNodes.forEach(n => { if (n.nodeType === 3 && /\\d/.test(n.textContent)) {",
    "    el.childNodes.forEach(n => { if (n.nodeType === 3 && /%|pts/.test(n.textContent)) {")
rep(".rs-card { padding: 0; overflow: hidden; gap: 10px; }", ".rs-card { padding: 0 !important; overflow: hidden; gap: 10px; }\n.rs-band { color: var(--paper) !important; }")
