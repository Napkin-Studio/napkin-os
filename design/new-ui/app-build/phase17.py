# Phase 17 (2026-11-08): the OS bar's app slot. The open app publishes its name, the document, its state, and a few actions.
rep('    <nav class="tb-trail" id="tb-trail" aria-label="Where you are"></nav>\n',
    '    <nav class="tb-trail" id="tb-trail" aria-label="Where you are"></nav>\n    <div class="tb-app" id="tb-app" aria-label="App"></div>\n')
rep("    document.body.dataset.tool = activeTool;", "    document.body.dataset.tool = activeTool;\n    if (window.renderAppSlot) window.renderAppSlot();")
rep("  window.renderClientPage = function () {", r'''  let briefLocked = false;
  window.renderAppSlot = function () {
    const host = $('tb-app'); if (!host) return;
    const t = activeTool, st = activeStep;
    if (t !== 'brief' && t !== 'research' && t !== 'deck') { host.innerHTML = ''; return; }
    const ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (TOOL_ICON[t] || '') + '</svg>';
    const docName = st === 'home' ? (t === 'brief' ? 'Briefs' : 'Research') : st === 'prompt' ? (t === 'brief' ? 'New brief' : 'New question') : (curItem ? curItem.t : (HERO_META[t] || {}).doc);
    const rLocked = t === 'research' && $('research-sheet') && $('research-sheet').classList.contains('locked');
    const locked = t === 'brief' ? briefLocked : rLocked;
    const state = st === 'loading' ? 'Agents working' : st === 'output' ? (locked ? 'Locked' : 'Draft') : '';
    let acts = '';
    if (st === 'output' && t === 'brief') acts = `<button type="button" class="tba-btn" data-tba="b-cont">Continue in ▾</button><button type="button" class="tba-btn tba-lock" data-tba="b-lock">${briefLocked ? 'Unlock' : 'Lock'}</button>`;
    if (st === 'output' && t === 'research') acts = `<button type="button" class="tba-btn" data-tba="r-ask">Ask</button><button type="button" class="tba-btn" data-tba="r-cont">Continue in ▾</button><button type="button" class="tba-btn tba-lock" data-tba="r-lock">${rLocked ? 'Unlock' : 'Lock'}</button>`;
    host.innerHTML = `<span class="tba-name tba-${t}">${ico}<b>${t === 'brief' ? 'Brief' : t === 'research' ? 'Research' : 'Deck'}</b></span><span class="tba-doc">${esc(docName || '')}</span>${state ? `<span class="tba-st ${locked ? 'locked' : ''}">${state}</span>` : ''}<span class="tba-acts">${acts}</span>
      <div class="tba-menu" id="tba-menu" hidden></div>`;
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tba]'); const menu = $('tba-menu');
    if (!b) { if (menu && !e.target.closest('#tba-menu')) menu.hidden = true; return; }
    e.stopPropagation(); const a = b.dataset.tba;
    const go = (tool, step) => { activeTool = tool; activeStep = step; curItem = null; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); };
    if (a === 'b-cont' || a === 'r-cont') {
      const opts = a === 'b-cont' ? [['deck', 'Deck', 'A board deck from this brief'], ['production', 'Production', 'Films and stills from this brief']] : [['brief', 'Brief', 'A brief with these 6 pinned facts']];
      menu.innerHTML = opts.map(([k, n, d]) => `<button type="button" data-cont="${k}"><b>${n}</b><small>${d}</small></button>`).join('');
      menu.style.left = (b.offsetLeft) + 'px'; menu.hidden = !menu.hidden; return;
    }
    if (a === 'b-lock') {
      const open = BRIEF_DATA[curBriefKey].parts.filter(p => p.needs).length;
      if (!briefLocked && open) { showToast(open + ' part' + (open > 1 ? 's need' : ' needs') + ' your call before the brief can lock.'); return; }
      briefLocked = !briefLocked; $('brief-page').classList.toggle('locked', briefLocked); showToast(briefLocked ? 'Brief locked. This is the version the client sees.' : 'Unlocked.'); renderAppSlot(); return;
    }
    if (a === 'r-lock') { $('r-lock').click(); renderAppSlot(); return; }
    if (a === 'r-ask') { const ta = document.querySelector('.r-askside textarea'); if (ta) { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus(); } return; }
  });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-cont]'); if (!c) return;
    e.stopPropagation(); $('tba-menu').hidden = true; const k = c.dataset.cont;
    if (k === 'production') { showToast('Production opens in the Production Tool (not in this mock).'); return; }
    if (k === 'brief') { $('r-spin-brief').click(); return; }
    activeTool = k; activeStep = 'output'; curItem = null; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' });
  });
  window.renderClientPage = function () {''')
rep("  $('r-lock').addEventListener('click', e => {", "  $('r-lock').addEventListener('click', () => setTimeout(() => window.renderAppSlot && window.renderAppSlot(), 0));\n  $('r-lock').addEventListener('click', e => {")
rep('\n</style>', r"""
/* ═══ Phase 17: the OS bar's app slot ═══ */
.tb-app { position: relative; display: flex; align-items: center; gap: 12px; margin-left: 14px; padding-left: 14px; border-left: 1px solid var(--line); min-width: 0; }
.tb-app:empty { display: none; }
.tba-name { display: inline-flex; align-items: center; gap: 7px; }
.tba-name svg { width: 17px; height: 17px; }
.tba-name b { font: 700 14px var(--font-ui); letter-spacing: -.01em; }
.tba-brief b { font-family: var(--font-serif); font-weight: 600; font-size: 15px; }
.tba-brief svg { color: #C9462A; }
.tba-research b { font-family: var(--font-mono); letter-spacing: -.03em; }
.tba-doc { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.tba-st { font: 600 10.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding: 3px 8px; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
.tba-st.locked { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.tba-acts { display: flex; gap: 4px; }
.tba-btn { height: 30px; padding: 0 11px; border-radius: 8px; border: 1px solid transparent; background: none; font: 600 12.5px var(--font-ui); color: var(--ink-soft); cursor: pointer; white-space: nowrap; }
.tba-btn:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.tba-lock { border-color: var(--line); }
.tba-menu { position: absolute; top: 40px; z-index: 70; min-width: 240px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 16px 36px -14px rgba(20,20,19,.35); padding: 6px; display: grid; }
.tba-menu button { display: grid; text-align: left; gap: 2px; padding: 9px 10px; border: 0; border-radius: 7px; background: none; cursor: pointer; }
.tba-menu button:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.tba-menu b { font: 600 13.5px var(--font-ui); } .tba-menu small { font-size: 12px; color: var(--muted); }
.brief-page.locked .gi-grip, .brief-page.locked .gi-resize { display: none; }
@media (max-width: 1180px) { .tba-doc { display: none; } }
</style>""", 1)

# ═══ Redraft: the agent works in the side bar, not on the paper ═══
rep('''    if (i === null) {
      $('brief-page').insertAdjacentHTML('beforeend', `<div class="sheet-work">${agentOrb(label)}</div>`);
    } else {
      selIdx = null; editIdx = null; renderBriefPage();
      const gi = $('brief-page').querySelector('.gi[data-idx="' + i + '"]');
      if (gi) { gi.classList.add('working'); gi.insertAdjacentHTML('beforeend', agentOrb(label)); }
    }
    mountMiniAgent();''', '''    const what = i === null ? 'the whole brief' : '“' + data.parts[i].n + '”';
    if (i === null) { $('brief-page').classList.add('all-working'); }
    else {
      selIdx = null; editIdx = null; renderBriefPage();
      const gi = $('brief-page').querySelector('.gi[data-idx="' + i + '"]');
      if (gi) gi.classList.add('working');
    }
    document.querySelectorAll('.agent-card').forEach(x => x.remove());
    $('look-inspector').insertAdjacentHTML('afterbegin', `<div class="agent-card"><span class="mini-agent"></span><span class="mini-orb"><i></i></span><div class="ac-t"><b>Brief agent</b><span>Redrafting ${esc(what)}</span>${ctx ? `<small>“${esc(ctx)}”</small>` : ''}</div></div>`);
    $('look-inspector').scrollTop = 0;
    mountMiniAgent();''')
rep("    setTimeout(() => {\n      unmountMiniAgent();\n", "    setTimeout(() => {\n      unmountMiniAgent();\n      document.querySelectorAll('.agent-card').forEach(x => x.remove());\n      $('brief-page').classList.remove('all-working');\n")
rep("    const el = document.querySelector('#brief-page .agent-work .mini-agent'); if (!el || !S || !A) return;",
    "    const el = document.querySelector('.agent-card .mini-agent'); if (!el || !S || !A) return;")
rep("rFrac: [0.4, 0.36], cyFrac: 0.5 });", "rFrac: [0.27, 0.24], cyFrac: 0.5 });")
rep("      el.closest('.agent-work').classList.add('live');", "      el.closest('.agent-card').classList.add('live');")
rep('\n</style>', r"""
.agent-card { display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 4px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); animation: ac-in .3s ease-out; }
@keyframes ac-in { from { opacity: 0; transform: translateY(-6px); } }
.agent-card .mini-agent { display: none; width: 104px; height: 104px; margin: -6px -8px; flex: none; }
.agent-card.live .mini-agent { display: block; }
.agent-card .mini-orb { width: 40px; height: 40px; margin-left: 10px; }
.agent-card .mini-orb i { width: 30px; height: 30px; }
.agent-card.live .mini-orb { display: none; }
.ac-t { display: grid; gap: 2px; min-width: 0; }
.ac-t b { font: 700 13.5px var(--font-ui); }
.ac-t span { font-size: 12.5px; color: var(--ink-soft); }
.ac-t small { font-size: 12px; color: var(--muted); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.brief-page.all-working .gi { background-image: linear-gradient(100deg, transparent 30%, rgba(201,70,42,.06) 50%, transparent 70%); background-size: 200% 100%; animation: aw-sheen 1.4s linear infinite; }
.brief-page.all-working .gi > * { opacity: .55; transition: opacity .3s; }
</style>""", 1)
rep(".tba-name { display: inline-flex;", ".tb-client { white-space: nowrap; flex: none; }\n.tba-name { display: inline-flex;")
# app slot: just the document's name (with the app's icon), no app word
rep("    host.innerHTML = `<span class=\"tba-name tba-${t}\">${ico}<b>${t === 'brief' ? 'Brief' : t === 'research' ? 'Research' : 'Deck'}</b></span><span class=\"tba-doc\">${esc(docName || '')}</span>",
    "    host.innerHTML = `<span class=\"tba-name tba-${t}\" title=\"${t === 'brief' ? 'Brief' : t === 'research' ? 'Research' : 'Deck'}\">${ico}<b>${esc(docName || '')}</b></span>")
rep(".tba-doc { font-size: 13px;", ".tba-name b { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.tba-doc { font-size: 13px;")
