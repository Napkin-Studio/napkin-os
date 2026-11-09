# Phase 36 (2026-11-09): the OS bar uses its width: Share (from the real Toolbar), lineage chips beside the document,
# the crew in the document; groups spaced left / centre / right.
rep("  renderBriefPage();\n  syncNavigation();\n  const urlBrand", r'''  (function barMore() {
    const _ras = window.renderAppSlot;
    window.renderAppSlot = function () {
      _ras && _ras();
      const host = $('tb-app'); if (!host || !host.innerHTML.trim()) { const c = $('tb-crew'); if (c) c.hidden = true; return; }
      const t = activeTool, st = activeStep, out = st === 'output';
      // lineage beside the name
      const name = host.querySelector('.tba-name');
      if (name && out && !host.querySelector('.tba-line')) {
        const html = t === 'brief' ? `<button type="button" class="tba-line" data-p36-go="research" title="Made from this research">from <b>Irish summer treats</b></button>`
          : t === 'research' ? `<button type="button" class="tba-line" data-p36-go="brief" title="Briefs made from this research">→ <b>1 brief</b></button>` : '';
        const doc = name.closest('.tba-doc-wrap') || name; doc.insertAdjacentHTML('afterend', html);
      }
      // Share, next to Continue in
      const acts = host.querySelector('.tba-acts');
      if (acts && out && !acts.querySelector('[data-p36-share]')) acts.insertAdjacentHTML('beforeend', `<button type="button" class="tba-btn tba-share" data-p36-share>Share</button>`);
      // the crew in this document
      let crew = $('tb-crew');
      if (!crew) { $('tb-decisions-btn').insertAdjacentHTML('beforebegin', `<span class="tb-crew" id="tb-crew"></span>`); crew = $('tb-crew'); }
      const working = typeof curState !== 'undefined' && (curState === 'working' || curState === 'handoff');
      crew.hidden = !out && st !== 'loading';
      crew.innerHTML = `<i class="cw" style="--c:#C9462A" title="Siobhán Ryan (you)">SR</i><i class="cw" style="--c:#2F6B3A" title="Cian Byrne · viewing">CB</i>${working ? `<i class="cw ag" title="${t === 'research' ? 'Research' : 'Brief'} agent working"></i>` : ''}`;
      crew.title = 'In this document: Siobhán (you), Cian' + (working ? ' · an agent is working' : '');
    };
    const shareMenu = () => {
      const conf = (BRIEF_DATA[curBriefKey] || { parts: [] }).parts.filter(p => p.conf).length;
      return `<div class="pp-h">Share</div>
        <button type="button" class="p36-mi" data-p36="link"><b>Copy link</b><small>People in your agency open it in Napkin Studio</small></button>
        <button type="button" class="p36-mi" data-p36="client"><b>Send the client copy</b><small>${activeTool === 'brief' ? (conf ? conf + ' confidential part' + (conf > 1 ? 's' : '') + ' left out' : 'Nothing marked confidential') : 'Confidential pins left out'}${activeTool === 'brief' && !briefLocked ? ' · lock it first' : ''}</small></button>
        <button type="button" class="p36-mi" data-p36="crew"><b>Invite to the crew</b><small>They can edit and answer calls</small></button>`;
    };
    document.addEventListener('click', e => {
      const sh = e.target.closest('[data-p36-share]');
      if (sh) { e.stopPropagation(); const m = $('tba-menu'); m.innerHTML = shareMenu(); m.style.left = sh.offsetLeft + 'px'; m.hidden = !m.hidden; return; }
      const mi = e.target.closest('[data-p36]');
      if (mi) { e.stopPropagation(); $('tba-menu').hidden = true; const a = mi.dataset.p36;
        if (a === 'link') showToast('Link copied.');
        else if (a === 'client') showToast(activeTool === 'brief' && !briefLocked ? 'Lock the brief first: the client sees the version you lock.' : 'Client copy ready to send (mock).');
        else showToast('Invite sent (mock).'); return; }
      const go = e.target.closest('[data-p36-go]');
      if (go) { e.stopPropagation(); curClient = 'mcd'; activeTool = go.dataset.p36Go; activeStep = 'output'; curItem = null; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); }
    }, true);
    window.renderAppSlot();
  })();
  renderBriefPage();
  syncNavigation();
  const urlBrand''')
rep('\n</style>', r"""
/* ═══ Phase 36: OS bar layout ═══ */
.tb-locked { gap: 14px !important; }
.tb-app { flex: 1 1 auto !important; justify-content: flex-start; gap: 14px !important; }
.tb-app .tba-acts { margin-left: 6px; gap: 6px; }
.tba-line { all: unset; cursor: pointer; font: 500 12.5px var(--font-ui); color: var(--muted); padding: 4px 10px; border-radius: 999px; border: 1px dashed var(--line-strong); white-space: nowrap; }
.tba-line b { color: var(--ink); font-weight: 600; }
.tba-line:hover { border-style: solid; color: var(--ink); }
.tba-share { border: 1px solid var(--line); }
.p36-mi { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 2px; width: 100%; padding: 9px 10px; border-radius: 7px; }
.p36-mi:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.p36-mi b { font: 600 13.5px var(--font-ui); } .p36-mi small { font-size: 12px; color: var(--muted); }
.tb-crew { display: inline-flex; align-items: center; padding-right: 4px; }
.tb-crew[hidden] { display: none; }
.tb-crew .cw { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; margin-left: -8px; background: var(--c); color: #fff; font: 700 10.5px var(--font-ui); font-style: normal; box-shadow: 0 0 0 2px var(--desk); }
.tb-crew .cw:first-child { margin-left: 0; }
.tb-crew .cw.ag { background: radial-gradient(circle at 35% 30%, #F2F0EA, #9A968E 70%); position: relative; }
.tb-crew .cw.ag::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--ag-act); animation: orb-spin 1.1s linear infinite; }
@media (max-width: 1300px) { .tba-line { display: none; } }
</style>""", 1)
rep('\n</style>', r"""
.tba-menu .p36-mi { display: grid !important; grid-template-columns: 1fr !important; min-width: 280px; }
.tba-menu .pp-h { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 8px 10px 4px; }
</style>""", 1)
