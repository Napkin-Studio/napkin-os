# Phase 25 (2026-11-09): Continue in (spin-off, any doc ↔ any doc, or link) lives in the OS bar for every app;
# Lock lives in the panel beside what blocks it.

# ═══ OS bar: Continue in ▾ for every document; no Lock ═══
rep("""    if (st === 'output' && t === 'brief') acts = `<button type="button" class="tba-btn" data-tba="b-cont">Continue in ▾</button><button type="button" class="tba-btn tba-lock" data-tba="b-lock">${briefLocked ? 'Unlock' : 'Lock'}</button>`;""",
    """    if (st === 'output' && t === 'brief') acts = `<button type="button" class="tba-btn tba-cont" data-tba="b-cont">Continue in ▾</button>`;""")
rep("""    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn tba-lock" data-tba="r-lock">${rLocked ? 'Unlock' : (($('r-lock') && $('r-lock').textContent) || 'Lock').replace('Lock and accept', 'Lock')}</button>`;""",
    """    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn tba-cont" data-tba="r-cont">Continue in ▾</button>`;""")
# links shown beside the document name
rep("""<span class="tba-acts">${acts}</span>""", """${(window.__links && window.__links[t] || []).map(l => `<span class="tba-link" title="Linked">↔ ${esc(l)}</span>`).join('')}<span class="tba-acts">${acts}</span>""")
# the menu: every app that takes this document, plus link to an existing one
rep("""      const opts = a === 'b-cont' ? [['deck', 'Deck', 'A board deck from this brief'], ['production', 'Production', 'Films and stills from this brief']] : [['brief', 'Brief', 'A brief with these 6 pinned facts']];
      menu.innerHTML = opts.map(([k, n, d]) => `<button type="button" data-cont="${k}"><b>${n}</b><small>${d}</small></button>`).join('');""",
    """      const opts = a === 'b-cont'
        ? [['deck', 'Deck', 'A board deck from this brief'], ['production', 'Production', 'Films and stills from this brief'], ['research', 'Research', 'A follow-up question from its open questions']]
        : [['brief', 'Brief', 'A brief with these 8 pinned facts'], ['deck', 'Deck', 'A board deck from this report'], ['production', 'Production', 'A film treatment from the findings']];
      const linkTo = a === 'b-cont' ? [['research', 'Irish summer treats', 'Research']] : [['brief', 'Summer McFlurry v1.3', 'Brief'], ['brief', 'Spoon trial', 'Brief']];
      menu.innerHTML = `<div class="tba-mh">Turn it into</div>` + opts.map(([k, n, d]) => `<button type="button" data-cont="${k}"><span class="tba-mi">${TOOL_ICON[k] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${TOOL_ICON[k]}</svg>` : ''}</span><span><b>${n}</b><small>${d}</small></span></button>`).join('')
        + `<div class="tba-mh">Link to an existing one</div>` + linkTo.map(([k, n, kind]) => `<button type="button" data-link="${esc(n)}"><span class="tba-mi">↔</span><span><b>${esc(n)}</b><small>${kind} · McDonald's Ireland</small></span></button>`).join('');""")
rep("""    if (k === 'brief') { $('r-spin-brief').click(); return; }""",
    """    if (k === 'brief' && activeTool === 'research') { $('r-spin-brief').click(); return; }
    if (k === 'research') { activeTool = 'research'; activeStep = 'prompt'; curItem = null; syncNavigation(); showToast('New research question, seeded from the brief’s open questions.'); return; }""")
rep("  document.addEventListener('click', e => {\n    const c = e.target.closest('[data-cont]'); if (!c) return;",
    """  document.addEventListener('click', e => {
    const l = e.target.closest('[data-link]'); if (!l) return;
    e.stopPropagation(); $('tba-menu').hidden = true;
    window.__links = window.__links || {}; const t = activeTool; window.__links[t] = window.__links[t] || [];
    if (!window.__links[t].includes(l.dataset.link)) window.__links[t].push(l.dataset.link);
    renderAppSlot(); showToast('Linked to ' + l.dataset.link + '. Each keeps its own version; changes show as updates.');
  });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-cont]'); if (!c) return;""")

# ═══ panel: Lock beside Your call; the panel's Continue button goes (it's in the bar) ═══
rep('''#r-side #r-spin-brief, #r-side #r-lock { display: none !important; }''', '''#r-side #r-spin-brief, #rb-cont { display: none !important; }''')
# Brief side tab gets its Lock
rep('''          <button type="button" class="side-link" id="b-redraft-btn">Draft it again</button>''',
    '''          <button type="button" class="side-link" id="b-redraft-btn">Draft it again</button>
          <button type="button" class="sp-btn b-lock-side" id="b-lock-side">Lock the brief</button>''')
rep("  document.addEventListener('click', e => {\n    const b = e.target.closest('[data-tba]');",
    """  document.addEventListener('click', e => {
    if (!e.target.closest('#b-lock-side')) return;
    e.stopPropagation();
    const open = BRIEF_DATA[curBriefKey].parts.filter(p => p.needs).length;
    if (!briefLocked && open) { showToast(open + ' part' + (open > 1 ? 's need' : ' needs') + ' your call before the brief can lock.'); selIdx = BRIEF_DATA[curBriefKey].parts.findIndex(p => p.needs); renderBriefPage(); return; }
    briefLocked = !briefLocked; $('brief-page').classList.toggle('locked', briefLocked);
    $('b-lock-side').textContent = briefLocked ? 'Unlock' : 'Lock the brief'; renderAppSlot();
    showToast(briefLocked ? 'Brief locked. This is the version the client sees.' : 'Unlocked.');
  }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tba]');""")

# ═══ CSS ═══
rep('\n</style>', r"""
/* ═══ Phase 25 ═══ */
.tba-cont { border: 1px solid var(--line); }
.tba-link { font: 600 11px var(--font-mono); color: var(--muted); padding: 3px 8px; border: 1px dashed var(--line-strong); border-radius: 999px; white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.tba-menu { min-width: 300px; }
.tba-mh { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 8px 10px 4px; }
.tba-menu button { grid-template-columns: 26px 1fr; display: grid; align-items: center; gap: 0 10px; }
.tba-mi { width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; font-size: 13px; color: var(--ink-soft); }
.tba-mi svg { width: 14px; height: 14px; }
.b-lock-side { width: 100%; justify-content: center; }
#r-report #r-lock { display: inline-flex !important; background: var(--ink); color: var(--paper); border-color: var(--ink); }
html[data-theme="dark"] #r-report #r-lock { color: #151412; }
/* the Report / Evidence map switch reads in dark mode */
html[data-theme="dark"] #rb-viewsw button { color: var(--ink-soft); background: transparent; }
html[data-theme="dark"] #rb-viewsw button[aria-pressed="true"] { background: var(--ink); color: #151412; }
</style>""", 1)
rep('\n</style>', r"""
.tb-app { overflow: visible !important; }
#r-report #r-lock { align-items: center; justify-content: center; height: 32px; padding: 0 12px; line-height: 1; }
</style>""", 1)
rep('\n</style>', r"""
.tba-menu button > span:last-child { display: grid; gap: 1px; }
.tba-menu button > span:last-child small { line-height: 1.35; }
</style>""", 1)
