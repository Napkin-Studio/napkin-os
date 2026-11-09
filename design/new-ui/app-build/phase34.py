# Phase 34 (2026-11-09): verifier round 2. One needs count everywhere (pill, Decisions, lines),
# the count follows the open client, the lock toast and gate agree, the research ask card updates
# the ask, a locked report says so, the client-answer form shows every part, the mock chip tucks away.

# ── 1. Client's answer form: every part checkbox visible and clickable ─────────────────────
CSS34 = '''
/* phase34 */
.b-cr .cr-parts { max-height: none !important; overflow: visible !important; grid-template-columns: 1fr 1fr; }
.b-cr .cr-parts label { min-width: 0; align-items: flex-start; line-height: 1.35; }
.b-cr .cr-parts label input { flex: none; margin-top: 2px; }
.b-cr .cr-which { display: grid; gap: 4px; min-height: 0; }
.b-cr textarea { position: relative; z-index: 0; display: block; }
/* research: locked report */
.p34-lockwhy { font-size: 12px; color: var(--muted); margin: 6px 0 0; }
.p34-lockwhy[hidden] { display: none; }
#r-report .sp-btn:disabled { opacity: .45; cursor: not-allowed; }
/* Decisions for a client with nothing tracked here */
#p34-dt-other { display: none; }
.dtree-drawer.p34-other #p34-dt-other { display: grid; gap: 14px; }
.dtree-drawer.p34-other .dtree-body > :not(#p34-dt-other) { display: none !important; }
.p34-dlist { list-style: none; display: grid; gap: 8px; margin: 0; padding: 0; }
.p34-dlist li { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; gap: 3px; font-size: 13px; background: var(--card); }
.p34-dlist li small { color: var(--muted); font-size: 12px; line-height: 1.4; }
.p34-dlist li .k { font: 600 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
/* research ask card: the market note, and room above the mock chip */
.p34-mk-note { display: block; font: 500 10.5px var(--font-mono); color: var(--accent); margin-top: 2px; letter-spacing: .02em; }
#p33-askcard:not(:empty) { margin-bottom: 56px; }
.p33-askcard { scroll-margin-bottom: 72px; }
/* mock chip: small, faint, in the corner until hovered */
#mock-panel.collapsed { left: 4px !important; bottom: 4px !important; opacity: .38 !important; border-radius: 8px; box-shadow: none; }
#mock-panel.collapsed:hover, #mock-panel.collapsed:focus-within { opacity: 1 !important; }
#mock-panel.collapsed .mock-head { padding: 4px 7px; font-size: 9px; gap: 5px; }
#mock-panel.collapsed .mock-head small { display: none; }
'''
rep('\n</style>', CSS34 + '\n</style>', 1)

# ── 2/3. One needs count, scoped to the open client ────────────────────────────────────────
rep("""    const tbNeeds = document.createElement('button');""",
    """    // phase34: the count follows the open client; set-aside items leave the count everywhere
    const needScope = () => activeTool === 'desk' || curClient === 'mcd';
    const needHere = () => needScope() ? needItems() : [];
    const needAct = () => needHere().filter(x => !setAside.has(x.id));
    window.__p34needs = { all: needItems, here: needHere, act: needAct, setAside };
    const tbNeeds = document.createElement('button');""")
rep("""    function renderNeedsPill() {
      const all = needItems(), act = all.filter(x => !setAside.has(x.id));""",
    """    function renderNeedsPill() {
      const all = needHere(), act = all.filter(x => !setAside.has(x.id));""")
rep("""      $('tb-decisions-cnt').textContent = String(n); $('tb-decisions-cnt').hidden = !n;""",
    """      const nA = all.filter(x => !setAside.has(x.id)).length, nH = needAct().length;
      $('tb-decisions-cnt').textContent = String(nH); $('tb-decisions-cnt').hidden = !nH;""")
rep("""      CLIENT_X.mcd.line = 'Summer McFlurry live · ' + (n ? n + ' call' + (n === 1 ? '' : 's') + ' need you' : 'nothing needs you');""",
    """      CLIENT_X.mcd.line = 'Summer McFlurry live · ' + (nA ? nA + ' call' + (nA === 1 ? '' : 's') + ' need you' : 'nothing needs you');""")
rep("""if (b) { b.textContent = String(n); b.hidden = !n; } const l = circ.querySelector('.cl-line'); if (l) l.textContent = 'Summer McFlurry · ' + (n ? n + ' need you' : 'all settled'); }""",
    """if (b) { b.textContent = String(nA); b.hidden = !nA; } const l = circ.querySelector('.cl-line'); if (l) l.textContent = 'Summer McFlurry · ' + (nA ? nA + ' need you' : 'all settled'); }""")
rep("""      const all = needItems(), act = all.filter(x => !setAside.has(x.id)), aside = all.filter(x => setAside.has(x.id));""",
    """      const all = needHere(), act = all.filter(x => !setAside.has(x.id)), aside = all.filter(x => setAside.has(x.id));""")
rep("""if (!needItems().length) { showToast('Nothing needs you right now.'); return; }""",
    """if (!needHere().length) { showToast('Nothing needs you right now.'); return; }""")
rep("""else { setAside.has(id) ? setAside.delete(id) : setAside.add(id); renderNeedsPill(); POP.innerHTML = needsPopHtml();""",
    """else { setAside.has(id) ? setAside.delete(id) : setAside.add(id); syncNeeds(); POP.innerHTML = needsPopHtml();""")
rep("""      if (!$('dtree-call-title')) return;
      const all = needItems(), n = all.length;""",
    """      if (!$('dtree-call-title')) return;
      const all = needAct(), n = all.length;""")

# opening an existing brief is not loading a sample: only a real click on a sample says so
rep("""  document.querySelectorAll('[data-bpreset]').forEach(btn => {
    btn.addEventListener('click', () => {""",
    """  document.querySelectorAll('[data-bpreset]').forEach(btn => {
    btn.addEventListener('click', e => {""")
rep("""      showToast('Loaded sample ask: ' + $('b-proj-inp').value);""",
    """      if (e && e.isTrusted) showToast('Loaded sample ask: ' + $('b-proj-inp').value);""")

# ── 5. Lock toast counts what the gate lists (open questions, not parts) ───────────────────
rep("""    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);""",
    """    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
    window.__p34openQs = () => { let n = 0; BRIEF_DATA[curBriefKey].parts.forEach(p => { if (p.needs) qsOf(p).forEach(([, i]) => { if (!(p.answers || {})[i]) n++; }); }); return n; };""")
rep("""const open = BRIEF_DATA[curBriefKey].parts.filter(p => p.needs).length;""",
    """const open = window.__p34openQs ? window.__p34openQs() : BRIEF_DATA[curBriefKey].parts.filter(p => p.needs).length;""", 2)
rep("""showToast(open + ' part' + (open > 1 ? 's need' : ' needs') + ' your call before the brief can lock.');""",
    """showToast(open + (open > 1 ? ' questions need' : ' question needs') + ' your call before the brief can lock.');""", 2)

# ── 4. Research ask card: the running agent asks; the answer changes the ask ───────────────
rep("""    function renderAskCard() {
      const h = $('p33-askcard');""",
    """    let qBy = 'Strategy';
    const AGN = () => ['Strategy', 'Research', 'Knowledge', 'Review'][Math.max(0, Math.min(curStageIdx, 3))];
    function renderAskCard() {
      const h = $('p33-askcard');""")
rep("""<span class="aq-k">You answered the Strategy agent</span>""", """<span class="aq-k">You answered the ${qBy} agent</span>""")
rep("""      if (h.querySelector('.p33-askcard')) return;
      h.innerHTML = `<div class="p33-askcard"><span class="aq-k">The Strategy agent asks</span>""",
    """      if (h.querySelector('.p33-askcard')) { const k0 = h.querySelector('.aq-k'); if (k0) k0.textContent = 'The ' + AGN() + ' agent asks'; return; }
      h.innerHTML = `<div class="p33-askcard"><span class="aq-k">The ${AGN()} agent asks</span>""")
rep("""        reqAns = [['Is Northern Ireland in the market?', a, w]]; qDone = true;""",
    """        qBy = AGN(); reqAns = [['Is Northern Ireland in the market?', a, w]]; qDone = true; if (window.__p34market) window.__p34market(a, qBy);""")
rep("""    const NOTR = [['Northern Ireland', 'out of the market in the ask'], ['Channels', 'not in the ask'], ['Brand', 'not in the ask']];""",
    """    const NOTR = [['Northern Ireland', 'out of the market in the ask'], ['Channels', 'not in the ask'], ['Brand', 'not in the ask']];
    window.__p34rb = { NOTR, GAPS, reRender: () => { try { reRender(); } catch (err) {} try { renderGaps(); } catch (err) {} } };""")

# ── main-scope wiring (after phase33's block, before the first paint) ──────────────────────
JS34 = r'''
  /* ═══ phase34: market answer, locked report, Decisions per client ═══ */
  (function phase34() {
    // the ask card's answer changes the ask's Market
    window.__p34market = function (a, by) {
      const whole = /whole island|northern|\bNI\b|^\s*yes/i.test(a) && !/republic only|^\s*no\b/i.test(a);
      const val = whole ? 'Island of Ireland (Republic + Northern Ireland)' : 'Republic of Ireland';
      const rb = window.__p34rb;
      if (rb) {
        rb.NOTR[0][1] = whole ? 'added by your answer · research will rerun for NI' : 'out of the market in the ask';
        const g = rb.GAPS.find(x => x.mk === 'NI');
        if (g) { if (!g._t) { g._t = g.t; g._note = g.note; g._k = g.k; } g.k = whole ? 'Rerun queued' : g._k; g.t = whole ? 'Northern Ireland added by your answer; research will rerun for NI.' : g._t; g.note = whole ? 'In scope since your answer during the run. A rerun for NI is queued.' : g._note; }
        rb.reRender();
      }
      const f = [...document.querySelectorAll('#r-ask .r-ask-f')].find(x => /^market$/i.test((x.querySelector('span') || {}).textContent || ''));
      if (f) { const b = f.querySelector('b'); if (b) b.innerHTML = esc(val) + (whole ? '<span class="p34-mk-note">changed by your answer · NI rerun queued</span>' : ''); }
      const dt = [...document.querySelectorAll('.p33-allf dt')].find(x => x.textContent.trim() === 'Market');
      if (dt && dt.nextElementSibling) dt.nextElementSibling.innerHTML = esc(val) + '<span class="pv said">You said</span>';
      const li = [...document.querySelectorAll('.p33-activity li')].find(x => /Northern Ireland in the market/i.test(x.textContent));
      if (li) { const t0 = li.querySelector('span'); li.innerHTML = (t0 ? t0.outerHTML : '') + esc((by || 'Strategy') + ' agent asked: is Northern Ireland in the market? You said: ' + a); }
    };

    // a locked report: confirmations done, Refresh and Run again off, with the reason
    const sheet = $('research-sheet'), acts = document.querySelector('#r-report .sp-acts');
    if (acts) acts.insertAdjacentHTML('afterend', '<p class="p34-lockwhy" id="p34-lockwhy" hidden>Locked — unlock to change. Refresh and Run again are off.</p>');
    function syncResLock() {
      const locked = sheet.classList.contains('locked');
      const ref = $('r-refresh'), again = document.querySelector('#r-report [data-p33r="again"]');
      [ref, again].forEach(b => { if (!b) return; b.disabled = locked; b.title = locked ? 'Locked — unlock to change' : ''; });
      $('p34-lockwhy').hidden = !locked;
      if (locked) {
        document.querySelectorAll('.r-conf input').forEach(cb => { if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); } cb.parentElement.classList.add('done'); });
        $('r-conf-n').textContent = 'done ✓';
      }
    }
    new MutationObserver(syncResLock).observe(sheet, { attributes: true, attributeFilter: ['class'] });
    syncResLock();

    // Decisions follow the open client and document
    const drawer = $('dtree-drawer'), dtBody = drawer.querySelector('.dtree-body'), dtH3 = drawer.querySelector('.dtree-head h3'), dtH3Orig = dtH3.textContent;
    dtBody.insertAdjacentHTML('afterbegin', '<div id="p34-dt-other"></div>');
    function dtreeScope() {
      const other = activeTool !== 'desk' && curClient !== 'mcd';
      drawer.classList.toggle('p34-other', other);
      if (!other) { dtH3.textContent = dtH3Orig; return; }
      const c = DIAL[curClient] || {}, d = curBriefKey !== 'mcflurry' ? BRIEF_DATA[curBriefKey] : null;
      const docT = (curItem && curItem.t) || (d && d.title) || '';
      dtH3.textContent = (c.full || c.name || '') + (docT ? ' · ' + docT : '');
      const rows = d ? d.parts.filter(p => p.why && p.why.decided) : [];
      $('p34-dt-other').innerHTML = `<div class="dtree-call-card resolved"><b style="color:var(--ok);font-size:13.5px">Nothing waits for your sign-off</b><p style="font-size:12.5px;color:var(--ink-soft);line-height:1.45">Nothing in ${esc(docT || c.full || 'this client')} needs your call.</p></div>`
        + (rows.length ? `<div><div class="sec-num">HOW IT WAS DECIDED</div><ul class="p34-dlist">${rows.map(p => `<li><span class="k">${esc(p.n)}</span><b>${esc(String(p.why.decided).replace(/<[^>]+>/g, ''))}</b>${p.why.because ? `<small>${esc(String(p.why.because).replace(/<[^>]+>/g, ''))}</small>` : ''}</li>`).join('')}</ul></div>`
          : '<p class="pp-sub" style="font-size:12.5px;color:var(--muted)">No decisions recorded here yet. Open a document from this client to see how it was decided.</p>');
    }
    const _sdo34 = setDecisionTreeOpen;
    setDecisionTreeOpen = function (open) { if (open) dtreeScope(); _sdo34(open); };
    // the count and Decisions re-scope whenever the open client or tool changes
    const _sync34 = syncNavigation;
    syncNavigation = function () { _sync34(); try { if (window.napkinResolveNeed) window.napkinResolveNeed(); if (!drawer.hidden) dtreeScope(); } catch (err) { console.error('phase34 nav', err); } };
  })();

  renderBriefPage();
  syncNavigation();
  const urlBrand = params.get('brand');'''
rep('''
  renderBriefPage();
  syncNavigation();
  const urlBrand = params.get('brand');''', JS34)
