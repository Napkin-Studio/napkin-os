# Phase 4 (2026-11-08): options bar above the sheet; answer what needs you; no stamps;
# Agency / Client looks with their logos; Redraft takes context; an agent orb shows while it works.

# ═══ 1. The sheet no longer clips: the fold is drawn, not cut ═══
rep(".bm-sheet { position: relative; clip-path: polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%); }",
    ".bm-sheet { position: relative; }\n.brief-page.bm-sheet { overflow: visible; }\n.bm-sheet::before { content: \"\"; position: absolute; top: -1px; right: -1px; width: 21px; height: 21px; background: linear-gradient(225deg, var(--desk) 50%, transparent 50%); z-index: 2; }")
rep(".bm-sheet::after { content: \"\"; position: absolute; top: 0; right: 0; width: 20px; height: 20px; background: linear-gradient(225deg, transparent 50%, #EAE1CF 50%); }",
    ".bm-sheet::after { content: \"\"; position: absolute; top: -1px; right: -1px; width: 21px; height: 21px; background: linear-gradient(225deg, transparent 50%, #EAE1CF 50%); z-index: 2; }")
rep(".chrome-bar { position: absolute; top: -17px; left: 6px;", ".gi.sel { z-index: 6; }\n.chrome-bar { white-space: nowrap; position: absolute; top: -17px; left: 6px;")

# ═══ 2. No stamps ═══
rep('''          <span class="bm-stamp ${data.parts.some(x => x.needs) ? '' : 'ok'}">${data.parts.some(x => x.needs) ? 'Needs your call' : 'Approved'}</span>''', '')
rep("<span class=\"bm-cstamp ${it.st}\">${ST[it.st] ? ST[it.st][0] : ''}</span>", "<span class=\"home-st ${ST[it.st] ? ST[it.st][1] : ''}\">${ST[it.st] ? ST[it.st][0] : ''}</span>")

# ═══ 3. What needs you: answer it right on the part; the bar's count opens the list ═══
rep('''          ${whyHtml}
        </div>
      `;''', r'''          ${p.needs ? needsBox(p, idx) : ''}
          ${whyHtml}
        </div>
      `;''')
rep("  function renderBriefPage() {", r'''  // Questions a part asks you. Answer each one: Yes, No, or a written answer.
  function needsBox(p, idx) {
    p.answers = p.answers || {};
    const qs = p.items.map((t, i) => [t, i]).filter(([t]) => /\?\s*$/.test(t.replace(/<[^>]+>/g, '')));
    return `<div class="needs-box" data-needs="${idx}"><div class="nb-h">Your call · ${qs.filter(([, i]) => !p.answers[i]).length} open</div>`
      + qs.map(([t, i]) => {
        const a = p.answers[i];
        return `<div class="nb-q ${a ? 'done' : ''}"><span class="nb-t">${t}</span>`
          + (a ? `<span class="nb-a">${a}</span>`
               : `<span class="nb-act"><button type="button" data-ans="${i}" data-v="Yes">Yes</button><button type="button" data-ans="${i}" data-v="No">No</button><button type="button" data-ans="${i}" data-v="?">Answer…</button></span>`)
          + `</div>`;
      }).join('') + `</div>`;
  }
  let needsOpen = 2;
  function syncNeeds() {
    STATE_LABELS.needs = needsOpen + ' need' + (needsOpen === 1 ? 's' : '') + ' your call';
    $('tb-decisions-cnt').textContent = String(needsOpen);
    if (curState === 'needs') $('bar-status-text').textContent = STATE_LABELS.needs;
    if (needsOpen === 0 && headerMark) headerMark.set({ state: 'done', progress: 1 });
    const it = DIAL.mcd.areas[0].items[0]; if (it && !BRIEF_DATA.mcflurry.parts.some(x => x.needs)) it.st = 'done';
  }
  window.napkinResolveNeed = () => { needsOpen = Math.max(0, needsOpen - 1); syncNeeds(); };

  function renderBriefPage() {''')
rep('''  // Edit text in place''', r'''  // Answer what needs you
  $('brief-page').addEventListener('click', e => {
    const b = e.target.closest('[data-ans]'); if (!b) return;
    e.stopPropagation();
    const box = b.closest('[data-needs]'), p = BRIEF_DATA[curBriefKey].parts[+box.dataset.needs], i = +b.dataset.ans;
    const commit = v => {
      p.answers[i] = v;
      const qs = p.items.filter(t => /\?\s*$/.test(t.replace(/<[^>]+>/g, '')));
      if (Object.keys(p.answers).length >= qs.length) { p.needs = false; p.who = 'You · answered'; window.napkinResolveNeed(); showToast('Answered. The brief no longer needs you here.'); }
      renderBriefPage();
    };
    if (b.dataset.v !== '?') { commit(b.dataset.v === 'Yes' ? 'Yes, confirmed' : 'No'); return; }
    const row = b.closest('.nb-q');
    row.querySelector('.nb-act').innerHTML = '<input class="nb-in" type="text" placeholder="Type your answer"><button type="button" class="nb-ok">Save</button>';
    const inp = row.querySelector('.nb-in'); inp.focus();
    const save = () => { if (inp.value.trim()) commit(inp.value.trim()); };
    row.querySelector('.nb-ok').addEventListener('click', ev => { ev.stopPropagation(); save(); });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') save(); });
    inp.addEventListener('click', ev => ev.stopPropagation());
  }, true);

  // Edit text in place''')
# research finding #3 counts too
rep("    $('r-needs-banner').hidden = true;\n    setBarStatus('done', 'Finished just now');\n    if (headerMark) headerMark.set({ state: 'done', progress: 1 });\n    showToast('Finding #3 confirmed and added to verified record.');",
    "    $('r-needs-banner').hidden = true;\n    window.napkinResolveNeed && window.napkinResolveNeed();\n    showToast('Finding #3 kept as a working hypothesis.');")
rep("    $('r-needs-banner').hidden = true;\n    setBarStatus('done', 'Finished just now');\n    if (headerMark) headerMark.set({ state: 'done', progress: 1 });\n    showToast('Finding #3 cut from the report.');",
    "    $('r-needs-banner').hidden = true;\n    window.napkinResolveNeed && window.napkinResolveNeed();\n    showToast('Finding #3 cut from the report.');")
# the bar's "needs your call" opens a short list that takes you to each one
rep('<div class="toast" id="toast"', '''<div class="needs-pop" id="needs-pop" hidden>
  <div class="np-h">Needs you</div>
  <button type="button" class="np-row" data-np="brief"><b>Open questions</b><small>Summer McFlurry brief · 2 questions</small></button>
  <button type="button" class="np-row" data-np="research"><b>Finding 3 · two-spoon sharing</b><small>Irish summer treats · thin evidence</small></button>
</div>
<div class="toast" id="toast"''')
rep('''  // Answer what needs you''', r'''  // The bar's status opens the "Needs you" list
  $('bar-status').style.cursor = 'pointer';
  $('bar-status').addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('needs-pop'), r = $('bar-status').getBoundingClientRect();
    pop.querySelector('[data-np="brief"]').hidden = !BRIEF_DATA.mcflurry.parts.some(x => x.needs);
    pop.querySelector('[data-np="research"]').hidden = $('r-needs-banner').hidden;
    if (pop.querySelectorAll('.np-row:not([hidden])').length === 0) { showToast('Nothing needs you right now.'); return; }
    pop.style.top = (r.bottom + 8) + 'px'; pop.style.right = (innerWidth - r.right) + 'px'; pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', e => { if (!e.target.closest('#needs-pop')) $('needs-pop').hidden = true; });
  $('needs-pop').querySelectorAll('[data-np]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); $('needs-pop').hidden = true; curClient = 'mcd';
    if (b.dataset.np === 'brief') {
      const pb = document.querySelector('[data-bpreset="mcflurry"]'); if (pb) pb.click();
      activeTool = 'brief'; activeStep = 'output'; syncNavigation();
      selIdx = BRIEF_DATA.mcflurry.parts.findIndex(x => x.needs); renderBriefPage();
      setTimeout(() => { const g = $('brief-page').querySelector('.gi.sel'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
    } else {
      activeTool = 'research'; activeStep = 'output'; syncNavigation();
      setTimeout(() => $('finding-3-card').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }));

  // Answer what needs you''')

# ═══ 4. Look: Napkin / Agency / Client — the brief can wear the agency's or the client's identity ═══
rep('''          <div>
            <h4>Cover</h4>''', '''          <div>
            <h4>Look</h4>
            <div class="seg-row" id="b-ident-seg">
              <button type="button" data-ident="napkin" aria-pressed="true">Napkin</button>
              <button type="button" data-ident="agency" aria-pressed="false">Agency</button>
              <button type="button" data-ident="client" aria-pressed="false">Client</button>
            </div>
          </div>
          <div>
            <h4>Cover</h4>''')
rep("  let briefText = '#2A2620';", "  let briefText = '#2A2620';\n  let briefIdent = 'napkin';")
rep('''          <div class="eyebrow-row"><span>Creative brief</span><span>${data.sub}</span></div>
          <h2>${data.title}</h2>''', r'''          ${identHtml}
          <div class="eyebrow-row"><span>Creative brief</span><span>${data.sub}</span></div>
          <h2>${data.title}</h2>''')
rep("    const coverHtml = briefCover === 'sheet'", r'''    const ag = AGENCIES[curBrand] || AGENCIES.wk, cl = DIAL[curClient] || DIAL.mcd;
    const ident = briefIdent === 'agency' && !ag.isDefault ? { name: ag.name, mono: ag.short, bg: ag.base, fg: ag.acc, kind: 'Agency' }
      : briefIdent === 'client' ? { name: cl.full || cl.name, mono: cl.mono, bg: cl.col, fg: cl.ink, kind: 'Client' } : null;
    pg.style.setProperty('--b-accent', ident ? ident.bg : briefAccent);
    pg.classList.toggle('ident', !!ident);
    const identHtml = ident ? `<div class="b-ident" style="--ib:${ident.bg};--if:${ident.fg}"><span class="b-logo">${esc(ident.mono)}</span><span class="b-iname">${esc(ident.name)}</span><span class="b-ikind">${ident.kind} brief</span></div>` : '';
    const coverHtml = briefCover === 'sheet''' + "'")
rep('''  // Answer what needs you''', r'''  $('b-ident-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    briefIdent = b.dataset.ident;
    $('b-ident-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderBriefPage();
  }));

  // Answer what needs you''')

# ═══ 5. Redraft asks what to change, and an agent orb works on the part ═══
rep('''  $('brief-page').addEventListener('click', e => {
    const rd = e.target.closest('[data-redraft]'); if (!rd) return;
    const part = BRIEF_DATA[curBriefKey].parts[+rd.dataset.redraft];
    part.who = 'Napkin · redrafted just now';
    renderBriefPage();
    showToast('Redrafted "' + part.n + '". The rest of the page stayed as it was.');
  });''', r'''  // Redraft: say what should change, then the Brief agent works on that part
  function agentOrb(label) {
    return `<div class="agent-work"><span class="mini-orb"><i></i></span><span class="aw-t"><b>Brief agent</b><small>${esc(label)}</small></span></div>`;
  }
  function askRedraft(gi, i, whole) {
    document.querySelectorAll('.redraft-ask').forEach(x => x.remove());
    const host = whole ? $('look-inspector') : gi;
    host.insertAdjacentHTML(whole ? 'beforeend' : 'beforeend', `<div class="redraft-ask"><label>What should change?</label>
      <textarea rows="2" placeholder="${whole ? 'e.g. Make it shorter and lead with the spoon ritual' : 'e.g. Warmer, and mention the seafront'}"></textarea>
      <div class="ra-row"><button type="button" class="ra-cancel side-link">Cancel</button><button type="button" class="ra-go">Redraft</button></div></div>`);
    const box = host.querySelector('.redraft-ask'), ta = box.querySelector('textarea');
    box.addEventListener('click', ev => ev.stopPropagation());
    ta.focus();
    box.querySelector('.ra-cancel').addEventListener('click', () => box.remove());
    box.querySelector('.ra-go').addEventListener('click', () => {
      const ctx = ta.value.trim(); box.remove();
      runRedraft(whole ? null : i, ctx);
    });
  }
  function runRedraft(i, ctx) {
    const data = BRIEF_DATA[curBriefKey];
    if (headerMark) headerMark.set({ state: 'working', progress: .5, kind: 'write' });
    const label = ctx ? 'Redrafting: “' + (ctx.length > 48 ? ctx.slice(0, 48) + '…' : ctx) + '”' : 'Redrafting…';
    if (i === null) {
      $('brief-page').insertAdjacentHTML('beforeend', `<div class="sheet-work">${agentOrb(label)}</div>`);
    } else {
      selIdx = null; editIdx = null; renderBriefPage();
      const gi = $('brief-page').querySelector('.gi[data-idx="' + i + '"]');
      if (gi) { gi.classList.add('working'); gi.insertAdjacentHTML('beforeend', agentOrb(label)); }
    }
    setTimeout(() => {
      const parts = i === null ? data.parts.filter(p => p.as !== 'cell') : [data.parts[i]];
      parts.forEach(p => { p.who = 'Napkin · redrafted' + (ctx ? ' with your note' : ''); });
      if (i !== null && ctx) { const p = data.parts[i]; p.items = p.items.map((t, k) => k === 0 && p.as !== 'bullets' ? t.replace(/\.\s*$/, '') + ' — ' + ctx.replace(/\.$/, '').toLowerCase() + '.' : t); }
      renderBriefPage();
      if (headerMark) headerMark.set({ state: needsOpen ? 'needs' : 'done', progress: needsOpen ? .85 : 1 });
      showToast(i === null ? 'The brief was redrafted. Your layout stayed as it was.' : 'Redrafted "' + data.parts[i].n + '".');
    }, 2600);
  }
  $('brief-page').addEventListener('click', e => {
    const rd = e.target.closest('[data-redraft]'); if (!rd) return;
    e.stopPropagation();
    const i = +rd.dataset.redraft;
    askRedraft($('brief-page').querySelector('.gi[data-idx="' + i + '"]'), i, false);
  }, true);''')
rep("  $('b-redraft-btn').addEventListener('click', () => {", "  $('b-redraft-btn').addEventListener('click', e => { e.stopPropagation(); askRedraft(null, null, true); });\n  $('b-redraft-btn').addEventListener('dummy', () => {")

# ═══ 6. CSS ═══
rep(".chrome-bar { white-space: nowrap;", r""".needs-box { margin-top: 12px; border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent); background: color-mix(in srgb, var(--warn) 6%, #fff); border-radius: 6px; padding: 10px 12px; display: grid; gap: 8px; cursor: default; }
.nb-h { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); }
.nb-q { display: grid; gap: 6px; padding-top: 8px; border-top: 1px solid color-mix(in srgb, var(--warn) 18%, transparent); }
.nb-q:first-of-type { border-top: 0; padding-top: 0; }
.nb-t { font-size: 13.5px; line-height: 1.4; }
.nb-act { display: flex; gap: 6px; flex-wrap: wrap; }
.nb-act button { height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line-strong); background: #fff; font: 600 12px var(--font-ui); cursor: pointer; }
.nb-act button:hover { background: var(--ink); color: var(--paper); }
.nb-in { flex: 1; min-width: 160px; height: 28px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 0 8px; font: 13px var(--font-ui); }
.nb-q.done .nb-t { color: var(--muted); }
.nb-a { font: 600 12.5px var(--font-ui); color: #2F6B3A; }
.nb-a::before { content: "✓ "; }
.needs-pop { position: fixed; z-index: 80; width: 300px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 16px 36px -14px rgba(20,20,19,.35); padding: 8px; }
.np-h { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); padding: 6px 8px; }
.np-row { width: 100%; display: grid; text-align: left; gap: 2px; padding: 9px 10px; border: 0; border-radius: 7px; background: none; cursor: pointer; }
.np-row:hover { background: #FBF7EF; }
.np-row b { font: 600 13.5px var(--font-ui); } .np-row small { font-size: 12px; color: var(--muted); }
.b-ident { display: flex; align-items: center; gap: 12px; margin: -6px 0 18px; padding-bottom: 14px; border-bottom: 3px solid var(--ib); }
.b-logo { width: 40px; height: 40px; border-radius: 9px; display: grid; place-items: center; background: var(--ib); color: var(--if); font: 800 15px var(--font-ui); letter-spacing: -.03em; }
.b-iname { font: 700 16px var(--font-ui); letter-spacing: -.01em; }
.b-ikind { margin-left: auto; font: 600 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--b-muted); }
.brief-page.ident { background-image: none; }
.brief-page.ident .b-cover h2 { color: var(--b-text); }
.brief-page.ident .lay-statement .stmt { text-decoration-color: var(--b-accent); }
.redraft-ask { position: relative; z-index: 7; margin-top: 12px; display: grid; gap: 8px; padding: 12px; background: #fff; border: 1px solid var(--line-strong); border-radius: 8px; box-shadow: 0 12px 26px -14px rgba(20,20,19,.4); cursor: default; }
.redraft-ask label { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.redraft-ask textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px; font: 14px/1.4 var(--font-ui); resize: vertical; }
.ra-row { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.ra-go { height: 30px; padding: 0 14px; border-radius: 999px; border: 0; background: var(--ink); color: var(--paper); font: 600 12.5px var(--font-ui); cursor: pointer; }
.gi.working > *:not(.agent-work):not(.gi-grip):not(.gi-resize) { opacity: .35; filter: blur(.4px); transition: opacity .3s; }
.agent-work { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 12px; z-index: 4; pointer-events: none; }
.sheet-work { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; background: color-mix(in srgb, var(--b-bg) 70%, transparent); border-radius: inherit; }
.sheet-work .agent-work { position: static; }
.aw-t { display: grid; background: var(--paper); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; box-shadow: 0 8px 20px -12px rgba(20,20,19,.35); }
.aw-t b { font: 700 12.5px var(--font-ui); } .aw-t small { font-size: 12px; color: var(--muted); max-width: 280px; }
.mini-orb { position: relative; width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; }
.mini-orb::before { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--ink) 12%, transparent); border-top-color: var(--ag-acc); animation: orb-spin 1.1s linear infinite; }
.mini-orb i { width: 40px; height: 40px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #6A6560 0%, #2A2724 45%, #121110 100%); box-shadow: inset -4px -6px 10px rgba(0,0,0,.45), 0 8px 16px -8px rgba(0,0,0,.5); animation: orb-breathe 1.6s ease-in-out infinite; }
@keyframes orb-spin { to { transform: rotate(360deg); } }
@keyframes orb-breathe { 50% { transform: scale(1.05); } }
@media (prefers-reduced-motion: reduce) { .mini-orb::before, .mini-orb i { animation: none; } }
.chrome-bar { white-space: nowrap;""")

# ═══ 7. The agents screen fits one viewport: compact header, stage sized to the window ═══
rep("    document.body.dataset.tool = activeTool;", "    document.body.dataset.tool = activeTool;\n    document.body.dataset.step = (activeTool === 'brief' || activeTool === 'research') ? activeStep : '';")
rep(".chrome-bar { white-space: nowrap;", r"""body[data-step="loading"] { padding-bottom: 0; }
body[data-step="loading"] .app-head { padding: 14px 0 12px; align-items: center; }
body[data-step="loading"] .app-head .hero-title { font-size: 30px; margin-bottom: 0; }
body[data-step="loading"] .app-head .hero-sub { display: none; }
body[data-step="loading"] .app-head .eyebrow { margin-bottom: 4px; }
body[data-step="loading"] #brief-screen-loading { padding-top: 14px; padding-bottom: 0; margin: 0; }
body[data-step="loading"] #brief-screen-loading > .sec-num, body[data-step="loading"] #brief-screen-loading > .sec-title { display: none; }
body[data-step="loading"] .proc-topbar { padding: 10px 16px; }
body[data-step="loading"] .sphere-stage { min-height: 0; height: max(380px, calc(100vh - 62px - 92px - 54px - 34px)); padding: 12px 16px; }
body[data-step="loading"] .rail { max-height: 100%; }
body[data-step="loading"] .agent-gl-box { width: min(360px, 44vh); height: min(340px, 40vh); }
body[data-step="loading"] .sphere-caption { margin-top: 0; }
.chrome-bar { white-space: nowrap;""")
