# Phase 14 (2026-11-08): Research redesign ("highlighter on graph paper", v2), from the planning agent's spec.
# Report = a paper sheet + side bar: header, stats, short answer, findings (meta, needs pill), where sources disagree,
# gaps, pinned facts, lens coverage, folded decision log. Side bar: spin-off, save, your call, selected part, show, source mix.

def H(k, title):
    return f'<div class="rs-h"><span>{k}</span><h3>{title}</h3></div>'

# ═══ markup ═══
rep('<article class="research-sheet" style="margin-top:20px">', '<div class="brief-workspace rs-workspace" id="r-workspace"><article class="research-sheet" id="research-sheet">')
rep('<header class="r-header">', '<header class="r-header" id="r-header">')
rep('''<span class="badge-pill verified" style="font-size:11.5px;padding:6px 12px">2 Verified · 1 Proposed</span>
        </header>''', '''<span class="badge-pill verified" style="font-size:11.5px;padding:6px 12px">2 Verified · 1 Proposed</span>
        </header>
        <div class="r-stats" id="r-stats"></div>
        <section class="r-answer" id="r-answer">''' + H('01 — Answer', 'In short') + '''
          <p class="r-ans-t">Irish 16–24s don't plan treats; they stretch social moments. <mark class="rs-hl">68%</mark> of out-of-home treat stops are unplanned and social, while delivery desserts grew <mark class="rs-hl">23.4%</mark>: indulgence moves home unless the outing gives a reason. The two-spoon ritual is promising, but thin.</p>
          <div class="r-ans-c"><span class="conf" data-c="med"><i></i><i></i><i></i></span> Overall confidence · Medium</div>
        </section>''')
rep('''<div class="sec-num">01 / SYNTHESISED FINDINGS</div>
          <h3 class="sec-title" style="font-size:22px">What the evidence says</h3>''', H('02 — Findings', 'What the evidence says'))
rep('''        <!-- 02 / FACTS ON THE RECORD -->''', '''        <section id="r-contests">''' + H('03 — Where sources disagree', 'One contest, resolved') + '''
          <div class="r-vs">
            <div class="r-side-a won"><small>Kantar Worldpanel · ROI panel</small><b><mark class="rs-hl">23.4%</mark></b><span>Like-for-like ROI, documented method</span></div>
            <div class="r-side-b lost"><small>Client deck · internal</small><b>31%</b><span>No method; likely blends NI with ROI</span></div>
            <div class="r-scale"><i class="tick" style="left:0">0</i><i class="tick" style="left:100%">35%</i><i class="mk won" style="left:66.9%"></i><i class="mk lost" style="left:88.6%"></i></div>
            <p class="r-vs-note">Delivery frozen-dessert growth · resolved for Kantar by the Review agent (d_045)</p>
          </div>
        </section>
        <section id="r-gaps">''' + H('04 — Not found / not researched', 'Gaps') + '''
          <div class="r-gap"><span class="cov none"></span><span class="r-gap-k">Gap</span><span>Northern Ireland not researched: the market was out of scope.</span><button type="button" class="side-link">Research this</button></div>
          <div class="r-gap"><span class="cov empty"></span><span class="r-gap-k">Not found</span><span>No summer-only price data for frozen desserts in ROI.</span><button type="button" class="side-link">Research this</button></div>
        </section>

        <!-- 02 / FACTS ON THE RECORD -->''')
rep('''<div class="sec-num">02 / FACTS ON THE RECORD</div>
          <h3 class="sec-title" style="font-size:22px">Pinned facts table</h3>''', H('05 — Pinned facts', 'Every figure, with its source'))
s, _n = re.subn(r'<table class="facts-table">.*?</table>', '''<table class="facts-table"><thead><tr><th>Pin</th><th>Fact</th><th>Value</th><th>As of</th><th>Confidence</th><th>Source</th><th>Lens</th></tr></thead><tbody id="r-facts-body"></tbody></table>''', s, count=1, flags=re.S)
assert _n == 1
rep('''        <!-- 03 / DECISION LOG -->''', '''        <section id="r-coverage">''' + H('06 — Coverage', 'What we looked at') + '''<div class="r-cov" id="r-cov"></div></section>

        <!-- 03 / DECISION LOG -->''')
rep('''<div class="sec-num">03 / AUDIT TRAIL</div>
          <h3 class="sec-title" style="font-size:22px">Every decision, on the record</h3>
          <ol class="decision-tl">''', '''<details class="r-log"><summary><span>07 — On the record</span> 5 decisions</summary>
          <ol class="decision-tl">''')
rep('''          </ol>
        </div>
      </article>
    </section>''', '''          </ol></details>
        </div>
      </article>
      <aside class="look-inspector rs-side" id="r-side">
        <div class="rs-top" id="r-side-top"></div>
        <div id="r-side-needs"></div>
        <div class="side-part" id="r-side-part" hidden></div>
        <div><h4>Show</h4><div class="seg-row" id="r-side-show"></div></div>
        <div><h4>Source mix</h4><div class="r-srcmix" id="r-srcmix"></div><p class="r-srcleg" id="r-srcleg"></p></div>
        <div><h4>Coverage</h4><span class="lens" id="r-side-lens"></span></div>
        <p class="side-hint">Click a finding or a fact to see its evidence here.</p>
      </aside>
      </div>
    </section>''')
# prompt: markets + window rows
rep('''          <div hidden>
            <div class="prompt-label" style="margin-bottom:8px"><span>Sources to search & cross-check</span></div>''',
    '''          <div class="rs-scope"><span class="rs-scope-l">Markets</span><span class="rs-mk on">IE</span><span class="rs-mk">GB</span><span class="rs-mk">NI</span></div>
          <div class="rs-scope"><span class="rs-scope-l">Window</span><span class="rs-win">2024 – 2026</span></div>
          <div hidden>
            <div class="prompt-label" style="margin-bottom:8px"><span>Sources to search & cross-check</span></div>''')

# ═══ JS ═══
cut("  // Research: click a finding to unfold its evidence and why\n", "  $('rs-lens').querySelectorAll('.cov')", "")
rep("  $('r-approve-finding').addEventListener('click', () => {", r'''  /* ═══ Research report v2 ═══ */
  const RS_LENS = ['Market', 'Category', 'Audience', 'Culture', 'Competitors', 'Channels', 'Brand', 'Client data'];
  const RS_FIND = [ { conf: 'high', lens: 'Audience', mk: ['IE'] }, { conf: 'high', lens: 'Category', mk: ['IE'] }, { conf: 'low', lens: 'Culture', mk: ['IE'] } ];
  const RS_FACT = {
    f_003: { fact: 'Unplanned treat occasions (16–24s)', value: '68%', asof: 'Jun 2026', conf: 'high', src: 'Bord Bia Consumer Insights', tier: 'Panel', lens: 'Audience', ret: '02 Nov 2026', lic: 'Licensed panel', st: 'active', used: [0] },
    f_004: { fact: 'Social context vs prior period', value: '+7 pts', asof: 'Jun 2026', conf: 'high', src: 'Bord Bia Consumer Insights', tier: 'Panel', lens: 'Audience', ret: '02 Nov 2026', lic: 'Licensed panel', st: 'active', used: [0] },
    f_007: { fact: 'Delivery frozen-dessert growth, ROI', value: '+23.4% YoY', asof: 'Aug 2026', conf: 'high', src: 'Kantar Worldpanel', tier: 'Panel', lens: 'Category', ret: '03 Nov 2026', lic: 'Licensed panel', st: 'resolved contest', used: [1] },
    f_009: { fact: '#McFlurry tag views in Ireland', value: '11.2M', asof: 'Oct 2026', conf: 'med', src: 'TikTok Ireland', tier: 'Social', lens: 'Culture', ret: '04 Nov 2026', lic: 'Public', st: 'active', used: [2] },
    f_011: { fact: 'Two-spoon sharing UGC clips', value: '2 clips', asof: 'Oct 2026', conf: 'low', src: 'TikTok comment sample', tier: 'Social', lens: 'Culture', ret: '04 Nov 2026', lic: 'Public', st: 'thin', used: [2] },
    f_014: { fact: 'Warm spell days vs 2024 summer', value: '+18%', asof: 'Sep 2026', conf: 'high', src: 'Met Éireann', tier: 'Gov', lens: 'Market', ret: '05 Nov 2026', lic: 'Open data', st: 'active', used: [] }
  };
  const conf = c => `<span class="conf" data-c="${c}" title="Confidence: ${c === 'med' ? 'medium' : c}"><i></i><i></i><i></i></span>`;
  const hl = v => v.replace(/(\+?\d[\d.,]*\s?(?:%|M| pts)?)/, '<mark class="rs-hl">$1</mark>');
  function rsNeedsOpen() { return !$('r-needs-banner').hidden ? 1 : 0; }
  function rsStats() {
    const n = rsNeedsOpen();
    $('r-stats').innerHTML = `<span>9 sources</span><span>6 pins</span><span>3 findings</span><span>1 contest</span><span>2 gaps</span>${n ? '<button type="button" class="r-stat-need" id="r-stat-need">1 needs your call</button>' : '<span class="r-stat-ok">Nothing needs you</span>'}`;
    const b = $('r-stat-need'); if (b) b.addEventListener('click', e => { e.stopPropagation(); rsSelect('finding', 2); });
  }
  (function rsBuild() {
    // side bar: move the existing controls (their handlers come with them)
    const top = $('r-side-top');
    top.append($('r-spin-brief'));
    top.insertAdjacentHTML('beforeend', '<button type="button" class="side-link" id="r-print">Save · PDF</button>');
    $('r-print').addEventListener('click', () => window.print());
    const nb = $('r-needs-banner'), keepB = $('r-approve-finding'), cutB = $('r-drop-finding');
    nb.className = 'needs-box r-needs'; nb.removeAttribute('style');
    nb.innerHTML = `<div class="nb-h">Your call · 1 open</div><p class="nb-t r-nb-t">Finding 3 rests on 2 TikTok clips. Keep it as a working hypothesis?</p><span class="nb-act"></span>`;
    nb.querySelector('.nb-act').append(keepB, cutB);
    $('r-approve-finding').textContent = 'Keep'; $('r-drop-finding').textContent = 'Cut';
    $('r-approve-finding').className = ''; $('r-drop-finding').className = '';
    $('r-approve-finding').removeAttribute('style'); $('r-drop-finding').removeAttribute('style');
    $('r-side-needs').append(nb);
    nb.querySelector('.r-nb-t').addEventListener('click', e => { e.stopPropagation(); rsSelect('finding', 2); });
    document.querySelectorAll('[data-rfilter]').forEach(b => { b.className = ''; b.textContent = b.dataset.rfilter === 'all' ? 'All' : b.dataset.rfilter === 'verified' ? 'Verified' : 'Needs you'; $('r-side-show').append(b); });
    // findings: meta on the right, needs pill on 3
    document.querySelectorAll('#r-findings-list .finding-card').forEach((card, i) => {
      const f = RS_FIND[i]; if (!f) return;
      card.dataset.fi = i;
      card.querySelector('.finding-top').insertAdjacentHTML('beforeend', `<span class="f-meta">${conf(f.conf)}<span class="f-lens"><span class="cov filled"></span>${f.lens}</span>${f.mk.map(m => `<span class="f-mk">${m}</span>`).join('')}${card.classList.contains('proposed') ? '<span class="f-prop">Proposed</span>' : ''}</span>`);
    });
    $('finding-3-card').classList.add('needs');
    // facts table
    $('r-facts-body').innerHTML = Object.entries(RS_FACT).map(([id, x]) => `<tr data-fact="${id}" class="${x.st === 'thin' ? 'thin' : ''} ${x.st.includes('contest') ? 'contested' : ''}"><td class="r-pin"><span class="pin"></span>${id}</td><td><b>${x.fact}</b></td><td class="r-val">${hl(x.value)}</td><td class="r-mono">${x.asof}</td><td>${conf(x.conf)}</td><td><span class="tier t-${x.tier.toLowerCase()}"></span>${x.src}</td><td><span class="cov filled" title="${x.lens}"></span></td></tr>`).join('');
    // coverage
    const COV = { Market: ['v'], Category: ['u'], Audience: ['u', 'u'], Culture: ['u', 'u'], Competitors: ['x'], Channels: [], Brand: [], 'Client data': ['c'] };
    $('r-cov').innerHTML = RS_LENS.map(l => { const c = COV[l] || []; const state = c.length === 0 ? 'none' : c.every(x => x === 'x') ? 'empty' : c.length > 1 ? 'filled' : 'thin';
      return `<div class="r-cov-row"><span class="r-cov-l">${l}</span><span class="cov ${state}"></span><span class="r-cells">${c.map(x => `<i class="c-${x}"></i>`).join('') || '<em>not researched</em>'}</span><span class="r-cov-n">${c.filter(x => x !== 'x').length}</span></div>`; }).join('')
      + '<p class="r-cov-key"><i class="c-v"></i> verified pin <i class="c-u"></i> used in a finding <i class="c-x"></i> searched, nothing found <i class="c-c"></i> contested</p>';
    $('r-side-lens').innerHTML = RS_LENS.map(l => { const c = COV[l] || []; return `<i class="cov ${c.length === 0 ? 'none' : c.every(x => x === 'x') ? 'empty' : c.length > 1 ? 'filled' : 'thin'}" title="${l}"></i>`; }).join('');
    // source mix
    const MIX = [['Panel', 3, 'm1'], ['Trade', 2, 'm2'], ['Social', 2, 'm3'], ['Gov', 1, 'm4'], ['Client', 1, 'm5']];
    $('r-srcmix').innerHTML = MIX.map(([n, k, c]) => `<i class="${c}" style="flex:${k}" title="${n} · ${k}"></i>`).join('');
    $('r-srcleg').innerHTML = MIX.map(([n, k, c]) => `<span><i class="${c}"></i>${n} ${k}</span>`).join('');
    rsStats();
  })();
  let rsSel = null;
  function rsSelect(kind, id) {
    document.querySelectorAll('#research-sheet .sel').forEach(x => x.classList.remove('sel'));
    rsSel = kind ? { kind, id } : null;
    const host = $('r-side-part');
    if (!kind) { host.hidden = true; host.innerHTML = ''; return; }
    if (kind === 'finding') {
      const card = document.querySelector(`#r-findings-list .finding-card[data-fi="${id}"]`); if (!card || card.hidden) return;
      card.classList.add('sel');
      const f = RS_FIND[id], q = card.querySelector('.finding-quote'), w = card.querySelector('.why-drawer');
      const pins = [...card.querySelectorAll('.fid-chip')].map(c => c.textContent.trim().split(' ')[0]).filter(p => RS_FACT[p]);
      host.innerHTML = `<h4>Finding ${id + 1}</h4><b class="sp-name">${card.querySelector('.finding-stmt').textContent}</b>
        <div class="rsp-sec"><span class="rsp-k">Evidence</span><blockquote class="rsp-q">${q ? q.innerHTML : ''}</blockquote></div>
        ${w ? `<details class="sp-why" ${window.__whyOpen ? 'open' : ''}><summary>Why it says this</summary>${w.innerHTML}</details>` : ''}
        <div class="rsp-sec"><span class="rsp-k">Rests on</span>${pins.map(p => `<button type="button" class="rsp-pin" data-goto-fact="${p}"><span class="pin"></span><span class="r-mono">${p}</span><span>${hl(RS_FACT[p].value)}</span>${conf(RS_FACT[p].conf)}</button>`).join('')}</div>
        <div class="rsp-sec"><span class="rsp-k">Confidence</span><p>${f.conf === 'low' ? 'Low: it rests on one thin pin (2 clips).' : 'High: every pin is a verified panel figure.'}</p></div>
        <div class="rsp-sec"><span class="rsp-k">Lens · market</span><p>${f.lens} · ${f.mk.join(', ')}</p></div>`;
    } else {
      const x = RS_FACT[id]; const row = document.querySelector(`#r-facts-body tr[data-fact="${id}"]`); if (row) row.classList.add('sel');
      host.innerHTML = `<h4>Fact · ${id}</h4><b class="sp-name">${x.fact}</b><div class="rsp-big">${hl(x.value)}</div>
        <div class="rsp-sec"><span class="rsp-k">As of</span><p>${x.asof} · retrieved ${x.ret}</p></div>
        <div class="rsp-sec"><span class="rsp-k">Source</span><p><span class="tier t-${x.tier.toLowerCase()}"></span>${x.src} · ${x.tier} · ${x.lic}</p></div>
        <div class="rsp-sec"><span class="rsp-k">Status</span><p>${conf(x.conf)} ${x.st}</p></div>
        <div class="rsp-sec"><span class="rsp-k">Origin</span><p class="r-mono">fact://mcd/ie/${id}@v2</p></div>
        <div class="rsp-sec"><span class="rsp-k">Used by</span>${x.used.length ? x.used.map(i => `<button type="button" class="side-link" data-goto-find="${i}">Finding ${i + 1}</button>`).join(' ') : '<p>Not used in a finding yet.</p>'}</div>`;
    }
    host.hidden = false;
  }
  document.querySelectorAll('#r-findings-list .finding-card').forEach(card => card.addEventListener('click', e => { e.stopPropagation(); const i = +card.dataset.fi; rsSelect(rsSel && rsSel.kind === 'finding' && rsSel.id === i ? null : 'finding', i); }));
  $('r-facts-body').addEventListener('click', e => { const tr = e.target.closest('tr[data-fact]'); if (!tr) return; e.stopPropagation(); rsSelect('fact', tr.dataset.fact); });
  $('r-side').addEventListener('click', e => {
    e.stopPropagation();
    const gf = e.target.closest('[data-goto-fact]'); if (gf) { rsSelect('fact', gf.dataset.gotoFact); return; }
    const gi = e.target.closest('[data-goto-find]'); if (gi) { rsSelect('finding', +gi.dataset.gotoFind); }
  });
  $('r-side').addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('sp-why')) window.__whyOpen = e.target.open; }, true);
  document.addEventListener('click', e => { if (rsSel && !e.target.closest('#research-sheet, #r-side')) rsSelect(null); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && rsSel) rsSelect(null); });
  const rsAfterCall = () => { $('finding-3-card').classList.remove('needs'); $('r-needs-banner').hidden = true; rsStats(); if (rsSel && rsSel.kind === 'finding' && rsSel.id === 2) rsSelect($('finding-3-card').hidden ? null : 'finding', 2); };

  $('r-approve-finding').addEventListener('click', () => {''')
rep("  $('r-drop-finding').addEventListener('click', () => {", "  $('r-approve-finding').addEventListener('click', () => setTimeout(rsAfterCall, 0));\n  $('r-drop-finding').addEventListener('click', () => setTimeout(rsAfterCall, 0));\n  $('r-drop-finding').addEventListener('click', () => {")
# loading: lens dots fill as the run goes
rep("    $('cap-l2').textContent = step.sub;", r'''    $('cap-l2').textContent = step.sub;
    let ll = $('rs-load-lens');
    if (!ll) { $('proc-agent-pills').insertAdjacentHTML('afterend', '<span class="rs-load-lens" id="rs-load-lens"><small>Lenses</small>' + ['Market', 'Category', 'Audience', 'Culture', 'Competitors', 'Channels', 'Brand', 'Client data'].map(l => `<i class="cov" title="${l}"></i>`).join('') + '</span>'); ll = $('rs-load-lens'); }
    ll.hidden = tool !== 'research';
    const nFill = Math.round((idx + 1) / plan.length * 8);
    ll.querySelectorAll('.cov').forEach((c, k) => c.classList.toggle('filled', k < nFill));''')

# ═══ CSS ═══
rep('\n</style>', r"""
/* ═══ Research v2 ═══ */
#research-screen-output > .action-strip { display: none !important; }
.rs-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; margin-top: 4px; align-items: start; }
@media (max-width: 1100px) { .rs-workspace { grid-template-columns: 1fr; } }
#research-sheet { background: #FFFDF8 !important; background-image: none !important; max-width: none; padding: 0 44px 44px; display: flex; flex-direction: column; gap: 34px; box-shadow: var(--shadow-paper); border-radius: 8px; border: 1px solid var(--line); }
#r-header { margin: 0 -44px; border-radius: 8px 8px 0 0; padding: 24px 44px 30px; box-shadow: inset 0 -6px 0 var(--rs-hl); }
#r-header .r-question { font-size: 34px; line-height: 1.12; letter-spacing: -.025em; max-width: 28ch; }
.rs-h span { display: block; font: 700 10.5px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.rs-h h3 { font: 600 20px/1.25 var(--font-ui); letter-spacing: -.015em; margin: 4px 0 14px; }
#research-sheet > div > .sec-num, #research-sheet .sec-title { display: none; }
.r-stats { display: flex; flex-wrap: wrap; gap: 0; margin-top: -18px; padding-bottom: 14px; border-bottom: 1px solid var(--line); font: 12px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink-soft); }
.r-stats > * { padding: 0 12px; border-left: 1px solid var(--line); }
.r-stats > :first-child { padding-left: 0; border-left: 0; }
.r-stat-need { background: none; border: 0; border-left: 1px solid var(--line); font: 700 12px var(--font-mono); color: var(--warn); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.r-stat-ok { color: var(--ok); }
.r-ans-t { font: 450 19px/1.5 var(--font-ui); border-left: 3px solid var(--ink); padding-left: 18px; max-width: 62ch; }
.r-ans-c { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-left: 21px; font: 11.5px var(--font-mono); color: var(--muted); }
.conf { display: inline-grid; grid-template-columns: repeat(3, 10px); gap: 2px; vertical-align: middle; }
.conf i { height: 4px; border-radius: 1px; background: var(--line); }
.conf[data-c="high"] i, .conf[data-c="med"] i:nth-child(-n+2) { background: var(--ink); }
.conf[data-c="low"] i:first-child { background: var(--warn); }
/* findings: no boxes, rows on the evidence line */
#r-findings-list { gap: 0 !important; }
#r-findings-list::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 32px; background: var(--rs-grid); opacity: .7; z-index: -1; }
#r-findings-list .finding-card { background: transparent !important; border: 0 !important; border-bottom: 1px solid var(--line) !important; border-radius: 0 !important; padding: 18px 0 20px !important; gap: 10px; cursor: pointer; transition: background .12s; }
#r-findings-list .finding-card:hover { background: color-mix(in srgb, var(--ink) 3%, transparent) !important; }
#r-findings-list .finding-card.sel { background: color-mix(in srgb, var(--rs-hl) 14%, transparent) !important; margin: 0 -12px; padding-left: 12px !important; padding-right: 12px !important; }
#r-findings-list .finding-card.sel .rs-node { background: var(--rs-hl); color: var(--ink); left: -32px; }
.finding-card .finding-quote, .finding-card .why-drawer, .finding-card .prov-pill, .finding-card .badge-pill { display: none !important; }
.finding-top { display: grid !important; grid-template-columns: 1fr auto; align-items: start; gap: 16px; }
.f-meta { display: flex; align-items: center; gap: 10px; padding-top: 4px; font: 11px var(--font-mono); color: var(--muted); white-space: nowrap; }
.f-lens { display: inline-flex; align-items: center; gap: 5px; }
.f-lens .cov { width: 9px; height: 9px; }
.f-mk { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--ink); display: grid; place-items: center; font: 600 9.5px var(--font-mono); color: var(--ink); }
.f-prop { color: var(--warn); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; }
.finding-card:not(.proposed) .rs-node::after { content: "✓"; position: absolute; right: -3px; bottom: -3px; width: 14px; height: 14px; border-radius: 50%; background: var(--ok); color: #fff; font: 700 9px/14px var(--font-ui); text-align: center; }
.finding-card.needs .rs-node { box-shadow: 0 0 0 4px #FFFDF8, 0 0 0 6px var(--warn); }
.finding-card.needs::before { content: "Needs your call"; position: absolute; top: -10px; right: 0; padding: 2px 8px; border-radius: 999px; background: var(--warn); color: #fff; font: 700 9.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
/* contests */
.r-vs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; }
.r-vs > div:not(.r-scale) { display: grid; gap: 2px; }
.r-vs small, .r-vs span { font: 11px var(--font-mono); color: var(--muted); }
.r-vs b { font: 600 22px var(--font-mono); font-variant-numeric: tabular-nums; }
.r-vs .lost b { text-decoration: line-through; color: var(--muted); font-weight: 500; }
.r-scale { grid-column: 1 / -1; position: relative; height: 26px; background: var(--rs-grid); border-bottom: 1px solid var(--ink); margin-top: 6px; }
.r-scale .tick { position: absolute; bottom: -18px; transform: translateX(-50%); font: 10px var(--font-mono); font-style: normal; color: var(--muted); }
.r-scale .tick:first-child { transform: none; } .r-scale .tick:nth-child(2) { transform: translateX(-100%); }
.r-scale .mk { position: absolute; bottom: -6px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; border: 2px solid var(--ink); background: #FFFDF8; }
.r-scale .mk.won { background: var(--ink); box-shadow: 0 0 0 3px var(--rs-hl); }
.r-vs-note { grid-column: 1 / -1; margin-top: 18px; font-size: 12.5px; color: var(--muted); }
/* gaps */
#r-gaps { display: grid; gap: 8px; }
#r-gaps .rs-h h3 { margin-bottom: 6px; }
.r-gap { display: grid; grid-template-columns: 14px auto 1fr auto; align-items: center; gap: 10px; border: 1px dashed var(--faint); border-radius: 6px; padding: 10px 14px; font-size: 13.5px; }
.r-gap-k { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
/* facts table */
.facts-table th { background: var(--desk); font: 600 10.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.facts-table tbody tr { cursor: pointer; transition: background .12s; }
.facts-table tbody tr:hover { background: color-mix(in srgb, var(--ink) 3%, transparent); }
.facts-table tbody tr.sel { background: color-mix(in srgb, var(--rs-hl) 16%, transparent); }
.facts-table tr.contested td:first-child { box-shadow: inset 3px 0 0 #C9462A; }
.facts-table tr.thin td { color: var(--muted); }
.r-pin, .r-mono { font: 12px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink-soft); white-space: nowrap; }
.r-val { font: 600 13px var(--font-mono); white-space: nowrap; }
.pin { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #D8452E; box-shadow: inset -1px -1px 0 rgba(0,0,0,.25); margin-right: 6px; vertical-align: 1px; }
.tier { display: inline-block; width: 8px; height: 8px; margin-right: 6px; background: var(--ink); vertical-align: 0; }
.tier.t-social { background: color-mix(in srgb, var(--ink) 40%, transparent); } .tier.t-gov { background: color-mix(in srgb, var(--ink) 22%, transparent); }
/* coverage */
.r-cov { display: grid; gap: 6px; }
.r-cov-row { display: grid; grid-template-columns: 120px 16px 1fr 30px; align-items: center; gap: 10px; font-size: 13px; }
.r-cov-l { font-weight: 500; }
.r-cells { display: flex; gap: 3px; min-height: 14px; align-items: center; }
.r-cells i, .r-cov-key i { width: 14px; height: 14px; border-radius: 2px; display: inline-block; vertical-align: -2px; }
.c-v { background: var(--ink); } .c-u { background: var(--rs-hl); box-shadow: inset 0 0 0 1px var(--ink); } .c-x { border: 1.5px dashed var(--faint); } .c-c { background: #fff; box-shadow: inset 3px 0 0 #C9462A, inset 0 0 0 1px var(--ink); }
.r-cells em { font: 11px var(--font-mono); font-style: normal; color: var(--faint); }
.r-cov-n { font: 12px var(--font-mono); color: var(--muted); text-align: right; }
.r-cov-key { margin-top: 8px; font: 11px var(--font-mono); color: var(--muted); display: flex; gap: 6px 10px; flex-wrap: wrap; align-items: center; }
.r-cov-key i { width: 11px; height: 11px; margin-right: 2px; }
/* decision log */
.r-log summary { cursor: pointer; font: 600 14px var(--font-ui); list-style: none; }
.r-log summary span { font: 700 10.5px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-right: 8px; }
.r-log[open] summary { margin-bottom: 14px; }
.decision-tl li.contest::before { background: #C9462A; }
/* side bar */
.rs-side { gap: 18px; }
.rs-top { display: grid; gap: 10px; }
.rs-top #r-spin-brief { width: 100%; justify-content: center; background: var(--ink); color: var(--paper); border-color: var(--ink); }
.r-needs { margin: 0; }
.r-nb-t { font-size: 13px; line-height: 1.45; cursor: pointer; margin: 4px 0 8px; }
.r-needs .nb-act button { height: 28px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-strong); background: #fff; font: 600 12px var(--font-ui); cursor: pointer; }
.r-needs .nb-act button:first-child { background: var(--ink); color: var(--paper); border-color: var(--ink); }
#r-side-show button { flex: 1; }
.r-srcmix { display: flex; gap: 1px; height: 10px; border-radius: 2px; overflow: hidden; }
.r-srcmix i, .r-srcleg i { display: block; }
.m1 { background: var(--ink); } .m2 { background: color-mix(in srgb, var(--ink) 65%, transparent); } .m3 { background: color-mix(in srgb, var(--ink) 40%, transparent); } .m4 { background: color-mix(in srgb, var(--ink) 22%, transparent); }
.m5 { background: repeating-linear-gradient(45deg, var(--ink) 0 1px, transparent 1px 4px); }
.r-srcleg { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; font: 11px var(--font-mono); color: var(--muted); }
.r-srcleg span { display: inline-flex; align-items: center; gap: 4px; }
.r-srcleg i { width: 9px; height: 9px; border-radius: 1px; }
#r-side-lens .cov { width: 13px; height: 13px; }
.rsp-sec { display: grid; gap: 4px; border-top: 1px solid var(--line); padding-top: 9px; }
.rsp-k { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rsp-sec p { font-size: 12.5px; line-height: 1.45; }
.rsp-q { font-size: 13.5px; line-height: 1.45; border-left: 2px solid var(--ink); padding-left: 10px; margin: 0; }
.rsp-pin { display: grid; grid-template-columns: auto auto 1fr auto; align-items: center; gap: 8px; padding: 6px 0; border: 0; background: none; text-align: left; font: 13px var(--font-ui); cursor: pointer; }
.rsp-pin .pin { margin: 0; }
.rsp-big { font: 600 26px var(--font-mono); font-variant-numeric: tabular-nums; }
/* prompt */
.rs-mk { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid var(--ink); display: inline-grid; place-items: center; font: 600 11px var(--font-mono); cursor: pointer; }
.rs-mk.on { background: var(--ink); color: var(--paper); }
.rs-win { font: 600 13px var(--font-mono); }
.rs-scope + .rs-scope { margin-top: -4px; }
/* loading: lens dots fill as the run goes */
.rs-load-lens { display: inline-flex; align-items: center; gap: 6px; }
.rs-load-lens small { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-right: 4px; }
.rs-load-lens .cov { width: 13px; height: 13px; transition: background .4s; }
.rs-load-lens[hidden] { display: none; }
body[data-tool="research"][data-step="loading"] .sphere-stage { background-color: var(--desk); background-image: var(--rs-grid); }
/* dark: the report stays light paper */
html[data-theme="dark"] #research-sheet { color-scheme: light; --ink: #141413; --ink-soft: #2A2620; --muted: #6D655A; --faint: #9A9082; --line: #E2D9C8; --paper: #FFFDF8; --card: #FFFDF8; --warn: #B45309; --ok: #1D8A4E; background: #FFFDF8 !important; color: #2A2620; box-shadow: 0 24px 60px -24px rgba(0,0,0,.7); border-color: transparent; }
html[data-theme="dark"] #research-sheet .finding-card { background-color: transparent !important; }
html[data-theme="dark"] #research-sheet .rs-node { background: #141413; color: #FFFDF8; box-shadow: 0 0 0 4px #FFFDF8; }
html[data-theme="dark"] #research-sheet .fid-chip { background: #fff !important; border-color: #141413 !important; color: #141413; }
html[data-theme="dark"] #research-sheet #r-findings-list::before, html[data-theme="dark"] #research-sheet .finding-quote { border-color: #141413 !important; }
html[data-theme="dark"] .r-needs .nb-act button { background: var(--card); color: var(--ink); }
html[data-theme="dark"] .r-needs .nb-act button:first-child, html[data-theme="dark"] .rs-top #r-spin-brief { background: var(--ink); color: #151412; }
</style>""", 1)
rep("const hl = v => v.replace(/(\\+?\\d[\\d.,]*\\s?(?:%|M| pts)?)/, '<mark class=\"rs-hl\">$1</mark>');",
    "const hl = v => v.replace(/(\\+?\\d[\\d.,]*(?:%|M)?(?:\\s?pts)?)/, '<mark class=\"rs-hl\">$1</mark>');")
rep(".pin { display: inline-block;", ".facts-table .cov, .f-lens .cov, .r-gap .cov, .r-cov-row .cov { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--ink); box-sizing: border-box; }\n.facts-table .cov.filled { background: var(--ink); }\n.pin { display: inline-block;")
