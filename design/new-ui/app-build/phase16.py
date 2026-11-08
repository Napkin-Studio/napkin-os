# Phase 16 (2026-11-08): provenance + the real Research tool's missing features.
# Brief: "Built from" in the side bar (facts and documents behind a part; open one; jump to it in Research).
# Research: The ask; Ask the research (inline "Ask about…" + side bar); Report block (refresh, lock, confirm before the brief, how it ran);
# "Where did this come from?" on facts.

def H(k, title):
    return f'<div class="rs-h"><span>{k}</span><h3>{title}</h3></div>'

ASK_ROWS = [('Client', "McDonald's Ireland"), ('Brand', 'McFlurry'), ('Market', 'Republic of Ireland'), ('Audience', '16–24s'),
            ('Window', 'Summer 2026 · Jun–Aug'), ('Objective', '+12% units, no price promotion'),
            ('Mandatories', 'Flake and Oreo; no “limited time”'), ('Question', 'What makes 16–24s choose a treat on an Irish summer day?')]

# ═══ Research sheet: The ask ═══
rep('        <div class="r-stats" id="r-stats"></div>\n', '        <div class="r-stats" id="r-stats"></div>\n        <section id="r-ask">' + H('00 — The ask', 'What the client asked') +
    '<div class="r-ask-grid">' + ''.join(f'<div class="r-ask-f{" wide" if k == "Question" else ""}"><span>{k}</span><b>{v}</b></div>' for k, v in ASK_ROWS) + '</div>'
    '<p class="r-ask-src"><span class="pin"></span>Read from client-email.txt and client-call-notes.pdf · 8 of 19 fields filled · <button type="button" class="side-link" id="r-ask-again">Read the ask again</button></p></section>\n')
# inline "Ask about…" boxes
rep("          </div>\n        </div>\n\n        <section id=\"r-contests\">",
    "          </div>\n          <div class=\"r-askbox\" data-ask=\"findings\" data-label=\"these findings\"></div>\n        </div>\n\n        <section id=\"r-contests\">")
rep('<div class="r-cov" id="r-cov"></div></section>', '<div class="r-cov" id="r-cov"></div><div class="r-askbox" data-ask="coverage" data-label="a lens we skipped"></div></section>')

# ═══ Research side bar: Report block + Ask the research ═══
rep('        <div class="rs-top" id="r-side-top"></div>\n', '''        <div class="rs-top" id="r-side-top"></div>
        <div class="r-report" id="r-report">
          <div class="r-rep-h"><b>Report</b><span id="r-rep-st">Draft · refreshed 4m ago</span></div>
          <div class="sp-acts"><button type="button" class="sp-btn" id="r-refresh">Refresh</button><button type="button" class="sp-btn r-lock" id="r-lock">Lock the report</button></div>
          <details class="r-conf"><summary>Confirm before the brief · <span id="r-conf-n">2</span></summary>
            <label><input type="checkbox"> Finding 3 rests on 2 clips (thin)</label>
            <label><input type="checkbox"> f_007: Kantar over the client deck (resolved)</label>
          </details>
          <details class="r-ran"><summary>How it ran</summary>
            <ol><li><b>Strategy</b> scoped the question · 3 sub-questions</li><li><b>Research</b> searched 9 sources · 41 queries</li><li><b>Knowledge</b> pinned 6 facts · 1 contest</li><li><b>Review</b> checked every claim · 1 held for you</li></ol>
          </details>
        </div>
        <div class="r-askside"><h4>Ask the research</h4><div class="r-askbox" data-ask="side" data-label="anything" data-open="1"></div></div>
''')

# ═══ JS ═══
rep("  const rsAfterCall = () =>", r'''  // ── Ask the research: a question runs as a job and comes back with a cited answer ──
  const ASK_ANS = [
    [/deliver|home|app/i, 'Delivery grows fastest on weekday evenings (Thu–Sat, 7–10pm); treat stops outside peak on sunny weekend afternoons.', ['f_007', 'f_021']],
    [/tiktok|share|spoon|social/i, 'Beyond the 2 clips, a wider search found 9 more sharing posts (31k likes). Still small; stronger as a creative hook than a norm.', ['f_011', 'f_022']],
    [/price|cost|promo/i, 'No summer-only frozen-dessert price data exists for ROI; the nearest is annual CSO food inflation (4.1%).', ['f_023']],
    [/competitor|fanta|magnum|ben/i, 'Fanta Frozen spends on outdoor in June; Magnum leads take-home. Nobody owns the shared treat outside.', ['f_024']],
    [/./, 'Found two relevant signals and pinned them. The finding stays as written; confidence unchanged.', ['f_003', 'f_025']]
  ];
  function askBoxIdle(box) {
    box.innerHTML = box.dataset.open ? '' : `<button type="button" class="side-link r-ask-open">Ask about ${box.dataset.label}…</button>`;
    if (box.dataset.open) askBoxOpen(box);
  }
  function askBoxOpen(box) {
    box.insertAdjacentHTML('beforeend', `<div class="r-ask-form"><textarea rows="2" placeholder="e.g. How fast is delivery growing in the evenings?"></textarea><button type="button" class="r-ask-go">Ask</button></div>`);
    const f = box.querySelector('.r-ask-form'), ta = f.querySelector('textarea');
    f.querySelector('.r-ask-go').addEventListener('click', e => { e.stopPropagation(); const q = ta.value.trim(); if (q) runAsk(box, q); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const q = ta.value.trim(); if (q) runAsk(box, q); } });
    ta.addEventListener('click', e => e.stopPropagation());
    if (!box.dataset.open) ta.focus();
  }
  function runAsk(box, q) {
    const host = box.dataset.ask === 'side' ? document.querySelector('#r-askbox-findings-out') || box : box;
    const job = document.createElement('div');
    job.className = 'r-job';
    job.innerHTML = `<span class="r-job-dot"></span><span><b>Research agent</b> is looking: “${esc(q)}”</span><button type="button" class="side-link">Stop</button>`;
    const target = box.dataset.ask === 'side' ? document.querySelector('[data-ask="findings"]') : box;
    target.before(job);
    job.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => {
      const [, a, cites] = ASK_ANS.find(([re]) => re.test(q));
      const card = document.createElement('div');
      card.className = 'r-ans';
      card.innerHTML = `<div class="r-ans-q">${esc(q)}</div><p>${hl(a)}</p><div class="r-ans-c">${cites.map(c => `<span class="fid-chip">${c}${RS_FACT[c] ? '' : ' · new pin'}</span>`).join('')}<button type="button" class="side-link r-ans-again">Ask again</button></div>`;
      job.replaceWith(card);
      showToast('Answered with ' + cites.length + ' cited pins.');
    }, 2600);
    job.querySelector('button').addEventListener('click', e => { e.stopPropagation(); clearTimeout(t); job.remove(); showToast('Stopped.'); });
    askBoxIdle(box);
  }
  document.querySelectorAll('.r-askbox').forEach(box => {
    askBoxIdle(box);
    box.addEventListener('click', e => { if (e.target.closest('.r-ask-open')) { e.stopPropagation(); box.innerHTML = ''; askBoxOpen(box); } });
  });
  document.getElementById('research-sheet').addEventListener('click', e => { const ag = e.target.closest('.r-ans-again'); if (ag) { e.stopPropagation(); const q = ag.closest('.r-ans').querySelector('.r-ans-q').textContent; runAsk(ag.closest('.r-ans').nextElementSibling && ag.closest('.r-ans').nextElementSibling.classList.contains('r-askbox') ? ag.closest('.r-ans').nextElementSibling : document.querySelector('[data-ask="findings"]'), q); } });
  // ── The ask ──
  $('r-ask-again').addEventListener('click', e => {
    e.stopPropagation(); const g = document.querySelector('.r-ask-grid'); g.classList.add('reading');
    setTimeout(() => { g.classList.remove('reading'); showToast('Read the ask again. Nothing changed.'); }, 1600);
  });
  // ── Report: refresh, lock, confirm before the brief ──
  $('r-refresh').addEventListener('click', e => {
    e.stopPropagation(); if ($('research-sheet').classList.contains('locked')) { showToast('The report is locked. Unlock it to refresh.'); return; }
    $('r-rep-st').textContent = 'Refreshing…'; $('r-refresh').disabled = true;
    setTimeout(() => { $('r-rep-st').textContent = 'Draft · refreshed just now'; $('r-refresh').disabled = false; showToast('Report refreshed from the latest pins.'); }, 1800);
  });
  $('r-lock').addEventListener('click', e => {
    e.stopPropagation(); const sh = $('research-sheet'), locked = !sh.classList.contains('locked');
    sh.classList.toggle('locked', locked);
    $('r-lock').textContent = locked ? 'Unlock' : 'Lock the report';
    $('r-rep-st').textContent = locked ? 'Locked by Siobhán Ryan · today' : 'Draft · unlocked';
    showToast(locked ? 'Report locked. It is the version a brief will use.' : 'Unlocked.');
  });
  document.querySelectorAll('.r-conf input').forEach(cb => cb.addEventListener('change', () => { const n = [...document.querySelectorAll('.r-conf input')].filter(x => !x.checked).length; $('r-conf-n').textContent = n || 'done ✓'; }));
  document.querySelectorAll('#r-report details').forEach(d => d.addEventListener('click', e => e.stopPropagation()));

  const rsAfterCall = () =>''')
# fact side: where did this come from
rep('''        <div class="rsp-sec"><span class="rsp-k">Origin</span><p class="r-mono">fact://mcd/ie/${id}@v2</p></div>''',
    '''        <details class="rsp-where"><summary>Where did this come from?</summary><ol class="r-chain"><li><span>Source</span>${x.src} · ${x.tier}</li><li><span>Knowledge layer</span>${x.lens === 'Audience' || x.lens === 'Culture' ? 'Category layer · Ireland' : 'Category layer · ROI'}, row r_${id.slice(2)}</li><li><span>Pinned</span>a frozen copy, ${x.ret}. A pin never follows a newer row; you choose when to take one.</li><li><span>Origin</span><code>fact://mcd/ie/${id}@v2</code></li></ol></details>''')

# ═══ Brief: Built from ═══
rep("  function renderSidePart(data) {", r'''  const BRIEF_PINS = {
    background: ['f_007', 'f_003', 'doc:recap'], barrier: ['f_007', 'f_003'], insight: ['f_003', 'f_004'], obj_comm: ['doc:call'], obj_beh: ['f_003'],
    obj_att: ['doc:recap', 'f_009'], audience: ['f_003', 'f_009'], rtb: ['f_011', 'doc:call'], resp_think: ['f_003'], resp_feel: ['f_011'],
    resp_do: ['f_011', 'f_009'], tone: ['doc:clan'], open_q: ['f_011', 'doc:call'], smp: ['f_011', 'f_003'], client: ['doc:call']
  };
  const BRIEF_DOCS = { call: ['Client call notes', 'client-call-notes.pdf · p.2'], recap: ['Last summer recap', 'last-summer-recap.key · slide 6'], clan: ['Brand Clan · v4', 'voice and rules'] };
  function builtFrom(p) {
    const ids = BRIEF_PINS[p.k] || (p.why && /f_\d+/.test(p.why.because + p.why.certainty) ? (p.why.because + ' ' + p.why.certainty).match(/f_\d+/g) : []);
    if (!ids || !ids.length) return '';
    const F = typeof RS_FACT !== 'undefined' ? RS_FACT : {};
    return `<div class="sp-built"><span class="rsp-k">Built from</span>` + [...new Set(ids)].map(id => {
      if (id.startsWith('doc:')) { const d = BRIEF_DOCS[id.slice(4)]; return `<div class="bf-row bf-doc"><span class="bf-ico">▤</span><span><b>${d[0]}</b><small>${d[1]}</small></span></div>`; }
      const x = F[id]; if (!x) return '';
      return `<details class="bf-row bf-fact"><summary><span class="pin"></span><span><b>${x.fact}</b><small>${id} · ${x.src}</small></span><span class="bf-val">${x.value}</span></summary>
        <div class="bf-more"><p>${x.asof} · ${x.tier} · confidence ${x.conf === 'med' ? 'medium' : x.conf}${x.st === 'thin' ? ' · thin' : ''}</p><button type="button" class="side-link" data-open-fact="${id}">Open in Research →</button></div></details>`;
    }).join('') + `</div>`;
  }
  function renderSidePart(data) {''')
rep("      ${p.needs ? needsBox(p, selIdx) : ''}\n", "      ${p.needs ? needsBox(p, selIdx) : ''}\n      ${builtFrom(p)}\n")
rep("  // Side tab actions for the selected part\n", r'''  // "Open in Research" from a brief part's Built from
  $('look-inspector').addEventListener('click', e => {
    const b = e.target.closest('[data-open-fact]'); if (!b) return;
    e.stopPropagation(); const id = b.dataset.openFact;
    curClient = 'mcd'; activeTool = 'research'; activeStep = 'output'; syncNavigation();
    setTimeout(() => { rsSelect('fact', id); const row = document.querySelector('#r-facts-body tr[data-fact="' + id + '"]'); if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  }, true);
  // Side tab actions for the selected part
''')

# ═══ CSS ═══
rep('\n</style>', r"""
/* ═══ Phase 16: provenance, the ask, ask the research, report controls ═══ */
.r-ask-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; transition: opacity .3s; }
.r-ask-grid.reading { opacity: .4; }
.r-ask-f { padding: 10px 12px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); display: grid; gap: 3px; }
.r-ask-f:nth-child(4n) { border-right: 0; }
.r-ask-f.wide { grid-column: 1 / -1; border-right: 0; border-bottom: 0; background: color-mix(in srgb, var(--rs-hl) 10%, transparent); }
.r-ask-f span { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.r-ask-f b { font: 500 13.5px var(--font-ui); }
.r-ask-f.wide b { font-size: 15px; }
.r-ask-src { margin-top: 8px; font: 11.5px var(--font-mono); color: var(--muted); }
.r-ask-src .side-link { font: 600 11.5px var(--font-mono); }
.r-askbox { margin-top: 10px; }
.r-askbox .side-link { font-size: 13px; }
.r-ask-form { display: flex; gap: 8px; align-items: flex-end; }
.r-ask-form textarea { flex: 1; border: 1.5px solid var(--ink); border-radius: 14px; padding: 9px 12px; font: 13.5px/1.4 var(--font-ui); background: #fff; color: var(--ink); resize: vertical; background-image: var(--rs-grid); }
.r-ask-go { height: 34px; padding: 0 16px; border-radius: 999px; border: 0; background: var(--ink); color: var(--paper); font: 600 12.5px var(--font-ui); cursor: pointer; }
.r-job { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 10px 14px; border: 1px dashed var(--ink); border-radius: 8px; font-size: 13px; }
.r-job span:nth-child(2) { flex: 1; }
.r-job-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--ink) 20%, transparent); border-top-color: var(--ink); animation: orb-spin .9s linear infinite; }
.r-ans { margin-top: 12px; padding: 12px 14px; border-left: 3px solid var(--rs-hl); background: color-mix(in srgb, var(--rs-hl) 8%, transparent); border-radius: 0 6px 6px 0; display: grid; gap: 6px; }
.r-ans-q { font: 700 10.5px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.r-ans p { font-size: 14px; line-height: 1.5; }
.r-ans-c { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.r-ans-c .side-link { margin-left: auto; font-size: 12px; }
.r-report { border: 1px solid var(--line-strong); border-radius: 8px; padding: 12px; display: grid; gap: 10px; background: #fff; }
.r-rep-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.r-rep-h b { font: 700 14px var(--font-ui); }
.r-rep-h span { font: 11px var(--font-mono); color: var(--muted); }
.r-report summary { cursor: pointer; font: 700 10.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.r-conf label { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; margin-top: 7px; line-height: 1.4; }
.r-ran ol { margin: 8px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 12.5px; }
.r-lock { background: var(--ink) !important; color: var(--paper) !important; border-color: var(--ink) !important; }
#research-sheet.locked #r-header::after { content: "Locked"; position: absolute; top: 18px; right: 44px; padding: 3px 10px; border: 1.5px solid var(--rs-hl); border-radius: 999px; font: 700 10px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--rs-hl); }
#r-header { position: relative; }
#research-sheet.locked .r-askbox { display: none; }
.r-askside h4 { margin-bottom: 8px; }
.rsp-where summary { cursor: pointer; font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); border-top: 1px solid var(--line); padding-top: 9px; }
.r-chain { margin: 8px 0 0; padding: 0 0 0 14px; border-left: 2px solid var(--ink); list-style: none; display: grid; gap: 8px; font-size: 12.5px; line-height: 1.4; }
.r-chain li { position: relative; }
.r-chain li::before { content: ""; position: absolute; left: -19px; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--ink); }
.r-chain li span { display: block; font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.r-chain code { font: 11px var(--font-mono); }
/* brief: built from */
.sp-built { display: grid; gap: 6px; border-top: 1px solid var(--line); padding-top: 9px; }
.bf-row { border: 1px solid var(--line); border-radius: 6px; background: var(--paper); }
.bf-row summary, .bf-doc { display: grid; grid-template-columns: 14px 1fr auto; gap: 8px; align-items: center; padding: 7px 9px; cursor: pointer; list-style: none; }
.bf-doc { cursor: default; }
.bf-row b { display: block; font: 600 12.5px/1.3 var(--font-ui); }
.bf-row small { display: block; font: 10.5px var(--font-mono); color: var(--muted); }
.bf-val { font: 700 12px var(--font-mono); background: linear-gradient(transparent 40%, #F6E36B 40%, #F6E36B 90%, transparent 90%); padding: 0 2px; white-space: nowrap; }
.bf-ico { font-size: 12px; color: var(--muted); }
.bf-row .pin { margin: 0; }
.bf-more { padding: 0 9px 9px 31px; display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
.bf-more .side-link { font-size: 12px; justify-self: start; }
html[data-theme="dark"] .r-report, html[data-theme="dark"] .bf-row { background: var(--card); }
html[data-theme="dark"] #research-sheet .r-ask-form textarea { background-color: #fff; color: #141413; }
</style>""", 1)
