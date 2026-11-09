# Phase 23 (2026-11-09): the report uses the OS field pattern (clan-fields): values are inline fields in the prose,
# sentences are fields, status sits on the field; no rows of pins/sources under each claim.

# ═══ section data: prose with inline field tokens ═══
_a = s.index("    const RP = [")
_b = s.index("    const NOTR = [", _a)
s = s[:_a] + r'''    const RP = [
      { t: 'The market', lens: 'Market', mk: 'IE', b: [['claim', 'Summer 2026 had {f_014} more days above 20°C than 2024, but warm days lift every treat stop alike.', 'fact:f_014']] },
      { t: 'The category', lens: 'Category', mk: 'IE', b: [['claim', 'Frozen desserts through delivery apps grew {contest} in a year in the Republic.', 'finding:1'], ['finding', 1]] },
      { t: 'Who it is for', lens: 'Audience', mk: 'IE', b: [['claim', '{f_003} of out-of-home treat stops for 16–24s are unplanned and social, up {f_004} since 2024; CSO puts time out with friends at {f_005}.', 'finding:0'], ['finding', 0]] },
      { t: 'Culture', lens: 'Culture', mk: 'IE', b: [['claim', '#McFlurry has {f_009} views in Ireland, but sharing one with two spoons shows up in only {f_011}.', 'finding:2'], ['finding', 2], ['gap', 'No sample of 50+ sharing posts yet, so the ritual cannot be called a habit.']] },
      { t: 'Competitors', lens: 'Competitors', mk: 'IE', b: [['gap', 'Searched; nothing found on who owns the shared outdoor treat in Ireland.']] }
    ];
''' + s[_b:]

# ═══ render: inline fields, sentence fields, status on the field ═══
_a = s.index("    function renderReport() {")
_b = s.index("    window.rbOpenMap = () => showTrace(true);", _a)
s = s[:_a] + r'''    const SHORT = { 'Bord Bia Consumer Insights': 'Bord Bia', 'Kantar Worldpanel': 'Kantar', 'CSO Ireland': 'CSO', 'TikTok Ireland': 'TikTok', 'TikTok comment sample': 'TikTok', 'Met Éireann': 'Met Éireann', 'Client deck': 'Client deck' };
    const inF = (p, withSrc) => { const x = fx(p); const st = x.st === 'thin' ? ' low' : ''; return `<button type="button" class="clf in${st}" data-rb-sel="fact:${p}" title="${x.fact} · ${x.src} · ${x.asof}">${x.value.replace(/ YoY$/, '')}${withSrc ? `<span class="clf-src">${SHORT[x.src] || x.src}</span>` : ''}</button>`; };
    const inContest = () => `<button type="button" class="clf in s-contest" data-rb-sel="contest:0" title="Contest · resolved for Kantar"><span class="split-v">23.4% <s>31%</s></span><span class="clf-src">contest · resolved</span></button>`;
    const prose = (t, withSrc) => t.replace(/\{(f_\d+|contest)\}/g, (m, k) => k === 'contest' ? inContest() : inF(k, withSrc));
    function renderReport() {
      // headline + summary: plain prose; values are fields
      const hc = $('rp-head-cites'); if (hc) hc.innerHTML = '';
      const SUMT = ["Irish 16–24s don't plan treats; they stretch social moments.", "{f_003} of out-of-home treat stops are unplanned and social.", "Delivery desserts grew {f_007} in a year in the Republic.", "Indulgence moves home unless the outing gives a reason.", "The two-spoon ritual is promising, but thin."];
      document.querySelectorAll('.rp-sum .rb-claim').forEach((el, k) => { el.innerHTML = prose(SUMT[k], false); el.classList.add('clf', 'claim'); if (CL[k].cert === 'med') el.classList.add('conf'); if (CL[k].cert === 'low') el.classList.add('low'); });
      document.querySelectorAll('.rp-cites[data-cites]').forEach(el => { const c = CL[+el.dataset.cites]; el.innerHTML = `<span class="clf-src">${c.f.map(i => 'F' + (i + 1)).join(' ')} · ${c.pins.length} pin${c.pins.length > 1 ? 's' : ''}${c.cert === 'med' ? ' · inference' : c.cert === 'low' ? ' · thin' : ''}</span>`; });
      const blk = ([k, a, b]) => {
        if (k === 'claim') return `<p class="rp-p"><span class="clf claim" data-rb-sel="${b}">${prose(a, true)}</span></p>`;
        if (k === 'finding') { const st = fState(a), cls = st === 'proposed' ? 's-check' : st === 'cut' || st === 'rejected' ? 's-rejected' : 's-verified';
          return `<p class="rp-p rp-fp"><span class="clf claim ${cls}" data-rb-sel="finding:${a}">${FSTMT(a)} <span class="tag">${st === 'proposed' ? 'Needs your call' : st === 'cut' ? 'Cut' : st === 'rejected' ? 'Rejected' : 'Finding ' + (a + 1) + ' · verified'}</span></span></p>`; }
        return `<div class="clan-gap"><span class="gap-k">Gap</span>${a}</div>`;
      };
      $('rp-sections').innerHTML = RP.map((sc, i) => `<section class="rb-sec rp-sec"><div class="rs-h"><span>${String(i + 1).padStart(2, '0')} — ${sc.lens} · ${sc.mk}</span><h3>${sc.t}</h3></div>${sc.b.map(blk).join('')}</section>`).join('')
        + `<section class="rb-sec rp-sec"><div class="rs-h"><span>Before the brief</span><h3>Confirm</h3></div><ul class="rp-confirm"><li><button type="button" data-rb-sel="finding:2">Finding 3 rests on 2 clips</button><span>Keep it as a working hypothesis, or cut it.</span></li><li><button type="button" data-rb-sel="contest:0">Kantar over the client deck</button><span>Resolved by the Review agent; confirm you agree.</span></li><li><button type="button" data-rb-sel="claim:3">Summary line 4 is an inference</button><span>No source says it; read it as the agency’s view.</span></li></ul></section>`
        + `<section class="rb-sec rp-sec"><div class="rs-h"><span>Scope</span><h3>Not researched</h3></div><div class="rp-notr">${NOTR.map(([n, w]) => `<span><span class="cov none"></span><b>${n}</b> ${w}</span>`).join('')}</div></section>`;
    }
''' + s[_b:]
# summary line text for the inspector (vClaim) must ignore the field labels
s = s.replace("const c = CL[k], txt = $q(`.rb-claim[data-claim=\"${k}\"]`).textContent.replace(/[\\d·]+$/, '').replace(/[,:]$/, '');",
              "const c = CL[k], txt = $q(`.rb-claim[data-claim=\"${k}\"]`).textContent.trim().replace(/[,:]$/, '');", 1)

# ═══ CSS: the OS field look (clan-fields), in the app's tokens ═══
rep('\n</style>', r"""
/* ═══ Phase 23: clan fields in the report ═══ */
#research-sheet .clf { all: unset; cursor: pointer; border-radius: 4px; transition: background .15s; color: inherit; }
#research-sheet .clf:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
#research-sheet .clf.claim { display: inline; padding: 1px 2px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
#research-sheet .clf.in { display: inline; padding: 0 2px; font-weight: 650; font-variant-numeric: tabular-nums; border-bottom: 1.5px dotted color-mix(in srgb, var(--ink) 45%, transparent); }
#research-sheet .clf.in:hover { background: color-mix(in srgb, var(--rs-hl) 45%, transparent); border-bottom-style: solid; }
#research-sheet .clf.in.low { background: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--ink) 8%, transparent) 5px 6px); }
.clf-src { font: 400 10.5px var(--font-mono); letter-spacing: .02em; color: var(--muted); white-space: nowrap; margin-left: 4px; }
.clf-src::before { content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: currentColor; margin-right: 4px; vertical-align: 1px; opacity: .7; }
#research-sheet .clf.in .clf-src { font-weight: 400; }
#research-sheet .clf.s-contest { border-bottom: 1.5px dashed #C9462A; }
#research-sheet .clf.s-contest .split-v { display: inline-flex; align-items: baseline; gap: 5px; }
#research-sheet .clf.s-contest s { opacity: .5; font-weight: 400; text-decoration: line-through; }
#research-sheet .clf .tag { display: inline-flex; align-items: center; font: 500 10px var(--font-mono); letter-spacing: .05em; text-transform: uppercase; border-radius: 999px; padding: 1px 8px; vertical-align: 2px; white-space: nowrap; }
#research-sheet .clf.s-verified .tag { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
#research-sheet .clf.s-check { background: color-mix(in srgb, var(--warn) 10%, transparent); border-bottom: 1.5px dashed var(--warn); }
#research-sheet .clf.s-check .tag { background: var(--warn); color: #fff; }
#research-sheet .clf.s-rejected { text-decoration: line-through; text-decoration-color: #C9462A; color: var(--muted); }
#research-sheet .clf.conf { background: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--ink) 6%, transparent) 5px 6px); }
#research-sheet .clf.claim.sel, #research-sheet .rb-claim.sel { background: color-mix(in srgb, var(--rs-hl) 35%, transparent); }
.rp-p { font: 450 16.5px/1.7 var(--font-ui); margin: 0; }
.rp-fp { font-size: 16px; }
.rp-sec { gap: 10px; }
.clan-gap { display: flex; gap: 10px; align-items: baseline; padding: 9px 12px; border: 1px dashed var(--faint); border-radius: 6px; font-size: 14px; color: var(--ink-soft); }
.gap-k { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); }
.rp-sum li { font-size: 17px; }
.rp-sum .rp-cites { margin-left: 4px; }
.rp-head .rp-cites { display: none; }
</style>""", 1)
s = s.replace('>The whole answer</button>', '>The whole summary</button>')
s = s.replace("askSec('sentence ' + (k + 1))", "askSec('line ' + (k + 1))")
rep('\n</style>', r"""
#rp-sections .rp-sec { padding-top: 26px; margin-top: 8px; border-top: 1px solid var(--line); }
#rp-sections .rp-sec:first-child { border-top: 0; padding-top: 6px; }
#rp-sections .rs-h h3 { margin-bottom: 4px; }
</style>""", 1)
