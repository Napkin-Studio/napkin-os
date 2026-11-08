#!/usr/bin/env python3
"""
napkin-app-v1.html: the app version of the Napkin Studio mock.

Source: studio-tools-v1.frozen-1812.html (Antigravity's 18:12 build, frozen; never written to).
Output: napkin-app-v1.html. Safe to re-run.

What it changes, on top of the 18:12 build:
  - Opens on the OS level (the client desk), one screen at a time, like the app would.
  - The big "mock page" hero and the workspace/screen switcher ribbon are gone. Each view has a
    compact app header: client crumb, tool title, and a three-circle flow (Ask, Agents, Brief/Report).
  - A finished run moves on to the output by itself.
  - Brand skin, mark state and run simulation live in one floating, collapsible "Mock controls"
    panel, outside the app chrome.
  - The bottom dock no longer repeats the top-bar tabs. It holds context actions as labelled
    circles (Art Director reference) beside the "Ask Napkin" bar.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "studio-tools-v1.frozen-1812.html"
OUT = ROOT / "napkin-app-v1.html"
s = SRC.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f"expected {count} match(es), found {n}: {old[:90]!r}")
    s = s.replace(old, new)


def cut(start, end, new):
    """Replace from the start marker up to (not including) the end marker."""
    global s
    a = s.index(start)
    b = s.index(end, a)
    s = s[:a] + new + s[b:]


# ── 1. Title ───────────────────────────────────────────────────────────────
import re
s = re.sub(r"<title>.*?</title>", "<title>Napkin Studio</title>", s, count=1, flags=re.S)

# ── 2. Mock controls: move the demo strip out of the top bar ───────────────
a = s.index('  <!-- ═══ SLIM INTERACTIVE BAR TO TEST AGENCIES')
b = s.index('</div>\n\n<div class="studio-shell">', a)
strip = s[a:b]
s = s[:a] + s[b:]
brand_chips = strip[strip.index('<span class="demo-lbl">Brand Skin:</span>') + len('<span class="demo-lbl">Brand Skin:</span>'):strip.index('</div>')]
brand_chips = brand_chips.replace('Napkin Default (Single Centered Title)', 'Napkin (own workspace)')
st_start = strip.index('<span class="demo-lbl">H1 Mark State:</span>') + len('<span class="demo-lbl">H1 Mark State:</span>')
state_chips = strip[st_start:strip.index('</div>', st_start)]

MOCK_PANEL = f'''
<!-- ═══ MOCK CONTROLS: not part of the app; for trying skins and states ═══ -->
<aside class="mock-panel" id="mock-panel" aria-label="Mock controls">
  <button type="button" class="mock-head" id="mock-toggle" aria-expanded="true">
    <span>Mock controls</span><small>not part of the app</small><b class="mock-caret">▾</b>
  </button>
  <div class="mock-body">
    <div class="mock-lbl">Agency (base + accent)</div>
    <div class="mock-row">{brand_chips}</div>
    <div class="mock-lbl">Mark state</div>
    <div class="mock-row">{state_chips}</div>
    <div class="mock-lbl">Agent run</div>
    <div class="mock-row">
      <button type="button" class="d-chip" id="proc-handoff-btn">Handoff now</button>
      <button type="button" class="d-chip" id="proc-needs-btn">Needs you</button>
      <button type="button" class="d-chip" id="proc-replay-btn">↻ Replay run</button>
    </div>
  </div>
</aside>
'''

# ── 3. Hero + switcher ribbon → compact app header with a three-circle flow ──
_hs = s.index('  <!-- ═══ HERO SECTION'); _he = s.rindex('  <!-- ', 0, s.index('VIEW 00: OS CLIENT DESK', _hs))
s = s[:_hs] + '''  <!-- ═══ APP HEADER: where you are, the tool, and the flow (circles choose) ═══ -->
  <section class="app-head">
    <div class="app-head-text">
      <div class="eyebrow" id="hero-eyebrow"></div>
      <h1 class="hero-title" id="hero-title"></h1>
      <p class="hero-sub" id="hero-sub"></p>
    </div>
    <div class="app-head-right">
      <ol class="flow-steps" id="step-switcher-group" aria-label="Steps">
        <li><button type="button" data-qstep="prompt" aria-pressed="true"><i>1</i><span>Ask</span></button></li>
        <li><button type="button" data-qstep="loading" aria-pressed="false"><i>2</i><span>Agents</span></button></li>
        <li><button type="button" data-qstep="output" aria-pressed="false"><i>3</i><span id="flow-out-label">Brief</span></button></li>
      </ol>
      <button type="button" class="hero-circle-btn" id="hero-cta-circle" title="Next step">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="7" y1="7" x2="17" y2="17"></line>
          <polyline points="17 7 17 17 7 17"></polyline>
        </svg>
      </button>
    </div>
  </section>

''' + s[_he:]

# ── 4. Run simulation buttons leave the agent stage (they are in Mock controls now) ──
cut('          <div style="display:flex;gap:8px;align-items:center">\n            <button type="button" class="btn-rect" id="proc-handoff-btn"',
    '        </div>\n\n        <div class="sphere-stage"', '')

# ── 5. Bottom dock: context actions as labelled circles + the Ask bar ──────
def circ(act, label, svg, extra=''):
    return (f'    <button type="button" class="dock-act" data-act="{act}" {extra}>'
            f'<span class="dock-ring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round">{svg}</svg></span><span class="dock-lbl">{label}</span></button>\n')

DOCK = ('<div class="cmd-dock-wrap" aria-label="Actions">\n  <div class="dock-acts" role="group" aria-label="Actions for this screen">\n'
        + circ('newbrief', 'New brief', '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')
        + circ('newresearch', 'Ask research', '<circle cx="11" cy="11" r="6"/><line x1="16" y1="16" x2="20" y2="20"/>')
        + circ('attach', 'Attach', '<path d="M20 12l-7.5 7.5a5 5 0 01-7-7L13 5a3.3 3.3 0 014.7 4.7L10.2 17a1.7 1.7 0 01-2.4-2.4L14.5 8"/>')
        + circ('why', 'Why?', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5"/><line x1="12" y1="17" x2="12" y2="17.2"/>')
        + circ('arrange', 'Arrange', '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>')
        + circ('tobrief', 'To brief', '<path d="M5 12h12"/><polyline points="12 6 18 12 12 18"/>')
        + circ('export', 'Export', '<path d="M12 4v11"/><polyline points="7 10 12 15 17 10"/><path d="M5 19h14"/>')
        + circ('tree', 'Decisions', '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 8.2v7.6M8 6.8c5 0 4 5.2 7.9 5.2"/>', 'id="dock-tree-btn" aria-pressed="false"')
        + '  </div>\n')
cut('<div class="cmd-dock-wrap"', '  <form class="cmd-bar" id="cmd-form">', DOCK)
rep('placeholder="Ask Napkin to sharpen the proposition, test a claim, or switch agency skin…"',
    'placeholder="Ask Napkin…"')
rep('<div class="toast" id="toast"', MOCK_PANEL + '\n<div class="toast" id="toast"')

# ── 6. CSS ─────────────────────────────────────────────────────────────────
CSS = '''
/* ═══ APP VERSION (napkin-app-v1): compact header, flow circles, dock actions, mock panel ═══ */
body { padding-bottom: 132px; }
.app-head {
  display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: 24px;
  padding: 30px 0 22px; border-bottom: 1px solid var(--line);
}
.app-head .hero-title { font-size: clamp(34px, 4.2vw, 50px); margin-bottom: 8px; }
.app-head .hero-sub { font-size: 14.5px; max-width: 62ch; }
.app-head-right { display: flex; align-items: center; gap: 22px; }
.app-head .hero-circle-btn { width: 64px; height: 64px; }
.app-head .hero-circle-btn svg { width: 24px; height: 24px; }
.flow-steps { list-style: none; display: flex; align-items: center; gap: 0; margin: 0; padding: 0; }
.flow-steps li { display: flex; align-items: center; }
.flow-steps li + li::before { content: ""; width: 28px; height: 1px; background: var(--line-strong); margin: 0 4px 18px; }
.flow-steps button { display: grid; justify-items: center; gap: 6px; background: none; border: 0; cursor: pointer; color: var(--muted); font: 600 11px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
.flow-steps i { font-style: normal; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line-strong); background: var(--paper); color: var(--ink-soft); font: 700 12px var(--font-mono); transition: background .15s, color .15s, border-color .15s; }
.flow-steps button.done i { background: var(--ink); border-color: var(--ink); color: var(--paper); }
.flow-steps button[aria-pressed="true"] { color: var(--ink); }
.flow-steps button[aria-pressed="true"] i { background: var(--ag-acc); border-color: var(--ag-acc); color: var(--ag-acc-ink); }
@media (max-width: 760px) { .app-head { grid-template-columns: 1fr; } .app-head-right { justify-content: space-between; } }

/* Bottom dock: labelled circles (Art Director reference) + Ask bar */
.cmd-dock-wrap { align-items: flex-end; gap: 14px; }
.dock-acts { display: inline-flex; align-items: flex-start; gap: 10px; }
.dock-act { display: grid; justify-items: center; gap: 5px; background: none; border: 0; cursor: pointer; padding: 0; }
.dock-act[hidden] { display: none; }
.dock-ring { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--paper); border: 1px solid var(--line-strong); color: var(--ink); box-shadow: 0 6px 18px -8px rgba(20,20,19,.3); transition: transform .15s, background .15s; }
.dock-ring svg { width: 19px; height: 19px; }
.dock-act:hover .dock-ring { transform: translateY(-2px); }
.dock-act[aria-pressed="true"] .dock-ring { background: var(--ag-acc); border-color: var(--ag-acc); color: var(--ag-acc-ink); }
.dock-lbl { font: 600 11px var(--font-ui); color: var(--ink-soft); background: rgba(255,253,248,.9); padding: 1px 6px; border-radius: 6px; white-space: nowrap; }
.cmd-bar { margin-bottom: 21px; }
@media (max-width: 760px) { .dock-lbl { display: none; } .cmd-bar { margin-bottom: 0; } }

/* Mock controls: deliberately outside the app's look (dashed, mono) */
.mock-panel { position: fixed; left: 16px; bottom: 16px; z-index: 60; width: 300px; max-width: calc(100vw - 32px); background: rgba(255,255,255,.97); border: 1px dashed #9A9A94; border-radius: 12px; box-shadow: 0 10px 30px -12px rgba(0,0,0,.3); font-family: var(--font-mono); }
.mock-head { width: 100%; display: flex; align-items: baseline; gap: 8px; padding: 9px 12px; background: none; border: 0; cursor: pointer; font: 700 11px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: #3A3A36; }
.mock-head small { font: 500 10px var(--font-mono); letter-spacing: .02em; text-transform: none; color: #8A8A84; }
.mock-caret { margin-left: auto; transition: transform .2s; }
.mock-panel.collapsed .mock-caret { transform: rotate(180deg); }
.mock-panel.collapsed .mock-body { display: none; }
.mock-body { padding: 0 12px 12px; display: grid; gap: 6px; }
.mock-lbl { font: 600 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: #8A8A84; margin-top: 4px; }
.mock-row { display: flex; flex-wrap: wrap; gap: 5px; }
.mock-row .d-chip { font-size: 11px; padding: 4px 8px; }
'''
rep('\n</style>', CSS + '\n</style>')

# ── 7. JS: open on the desk, one screen at a time, finished runs move on ────
rep("let activeTool = params.get('tool') || 'brief';\n  if (!['desk', 'brief', 'research', 'deck'].includes(activeTool)) activeTool = 'brief';\n  let activeStep = params.get('step') || 'all';",
    "let activeTool = params.get('tool') || 'desk';\n  if (!['desk', 'brief', 'research', 'deck'].includes(activeTool)) activeTool = 'desk';\n  let activeStep = params.get('step') || 'prompt';\n  if (!['prompt', 'loading', 'output'].includes(activeStep)) activeStep = 'prompt';")

rep("eyebrow: 'NAPKIN STUDIO OS · CLIENT WORKSPACE',\n      title: 'Client Desk<span class=\"period-dot\"></span>',",
    "eyebrow: 'YOUR DESK · 4 CLIENTS',\n      title: 'Client Desk<span class=\"period-dot\"></span>',")
rep("eyebrow: 'STUDIO TOOL / 01 · CAMPAIGN STUDIO',", "eyebrow: \"MCDONALD'S IRELAND · SUMMER MCFLURRY\",")
rep("eyebrow: 'STUDIO TOOL / 02 · EVIDENCE & STRATEGY',", "eyebrow: \"MCDONALD'S IRELAND · IRISH SUMMER TREATS\",")
rep("eyebrow: 'STUDIO TOOL / 03 · NARRATIVE STORYBOARD',", "eyebrow: \"MCDONALD'S IRELAND · Q3 BOARD PITCH\",")
rep("sub: 'Four active client accounts, 38 pinned research facts, and live brief sheets — with every agent call and human decision on the record.',",
    "sub: 'Four client accounts, their briefs, research and decks. Two calls are waiting for you.',")
rep("title: 'Research Tool<span class=\"period-dot\"></span>',", "title: 'Research<span class=\"period-dot\"></span>',")

rep("    $('tb-crumb-doc').textContent = hm.doc;\n",
    "    $('tb-crumb-doc').textContent = hm.doc;\n    syncAppChrome();\n")

APP_JS = r'''
  /* ═══ APP VERSION: flow circles, context dock, mock panel ═══ */
  const DOCK_SHOW = {
    'desk':            ['newbrief', 'newresearch', 'tree'],
    'brief:prompt':    ['attach', 'tree'],
    'brief:loading':   ['tree'],
    'brief:output':    ['why', 'arrange', 'export', 'tree'],
    'research:prompt': ['attach', 'tree'],
    'research:loading':['tree'],
    'research:output': ['tobrief', 'export', 'tree'],
    'deck':            ['export', 'tree']
  };
  function syncAppChrome() {
    const stepTool = activeTool === 'brief' || activeTool === 'research';
    const key = stepTool ? activeTool + ':' + activeStep : activeTool;
    const show = DOCK_SHOW[key] || ['tree'];
    document.querySelectorAll('.dock-act').forEach(b => { b.hidden = !show.includes(b.dataset.act); });
    const order = ['prompt', 'loading', 'output'];
    document.querySelectorAll('.flow-steps button').forEach(b => {
      b.classList.toggle('done', order.indexOf(b.dataset.qstep) < order.indexOf(activeStep));
    });
    const lbl = $('flow-out-label'); if (lbl) lbl.textContent = activeTool === 'research' ? 'Report' : 'Brief';
    $('hero-cta-circle').hidden = !stepTool || activeStep === 'output';
    $('hero-cta-circle').title = activeStep === 'prompt' ? 'Start the agents' : 'Open the result';
    const crumb = $('tb-crumb');
    if (activeTool === 'desk') crumb.innerHTML = '<b id="tb-crumb-doc">All clients</b>';
    else crumb.innerHTML = "McDonald's Ireland <span>/</span> <b id=\"tb-crumb-doc\">" + (HERO_META[activeTool] || HERO_META.brief).doc + '</b>';
  }
  document.querySelectorAll('.dock-act').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.act;
    const go = (tool, step) => { activeTool = tool; activeStep = step; syncNavigation(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    if (act === 'newbrief') go('brief', 'prompt');
    else if (act === 'newresearch') go('research', 'prompt');
    else if (act === 'tobrief') $('r-spin-brief').click();
    else if (act === 'why') { $('b-expand-all-why').click(); b.setAttribute('aria-pressed', $('b-expand-all-why').getAttribute('aria-pressed')); }
    else if (act === 'arrange') { $('b-toggle-arrange').click(); b.setAttribute('aria-pressed', $('b-toggle-arrange').getAttribute('aria-pressed')); }
    else if (act === 'export') showToast('Export: saved on this device (mock).');
    else if (act === 'attach') showToast('Attach: drop decks, PDFs, brand books or voice notes (mock).');
  }));
  document.querySelectorAll('[data-qstep]').forEach(b => b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' })));
  (function mockPanel() {
    const p = $('mock-panel'), t = $('mock-toggle');
    let collapsed = false;
    try { collapsed = localStorage.getItem('napkin-app-mock-collapsed') === '1'; } catch (e) {}
    const apply = () => { p.classList.toggle('collapsed', collapsed); t.setAttribute('aria-expanded', String(!collapsed)); };
    apply();
    t.addEventListener('click', () => { collapsed = !collapsed; apply(); try { localStorage.setItem('napkin-app-mock-collapsed', collapsed ? '1' : '0'); } catch (e) {} });
  })();
'''
rep("  // Desk card deep links\n", APP_JS + "\n  // Desk card deep links\n")

# A finished run moves on to its output, as the app would.
rep("        $('cap-l1').textContent = tool === 'brief' ? 'Brief drafted and checked' : 'Research report assembled';\n        return;",
    "        $('cap-l1').textContent = tool === 'brief' ? 'Brief drafted and checked' : 'Research report assembled';\n"
    "        procTimer = setTimeout(() => {\n"
    "          if (activeStep === 'loading' && activeTool === tool) { activeStep = 'output'; syncNavigation(); window.scrollTo({ top: 0, behavior: 'smooth' }); }\n"
    "        }, 1800);\n        return;")

# The CTA: prompt → agents → result (no wrap back to the prompt).
rep("      activeStep = activeStep === 'prompt' ? 'loading' : activeStep === 'loading' ? 'output' : 'prompt';",
    "      activeStep = activeStep === 'prompt' ? 'loading' : 'output';")

# The bar names the real step and the real next agent.
rep("    working: 'Working · Step 3/4',\n    handoff: 'Handing over → Strategy',",
    "    working: 'Agents working',\n    handoff: 'Handing over',")
rep("    if (isHandoff && nextStep) {\n      headerMark.set({ handoff:",
    "    STATE_LABELS.working = 'Working · Step ' + (idx + 1) + '/' + plan.length;\n"
    "    if (nextStep) STATE_LABELS.handoff = 'Handing over → ' + nextStep.agent.charAt(0).toUpperCase() + nextStep.agent.slice(1);\n"
    "    if (isHandoff && nextStep) {\n      headerMark.set({ handoff:")

# The mock panel starts collapsed so it never covers the app; the dock gets a paper backing.
rep("    let collapsed = false;\n    try { collapsed = localStorage.getItem('napkin-app-mock-collapsed') === '1'; }",
    "    let collapsed = true;\n    try { collapsed = localStorage.getItem('napkin-app-mock-collapsed') !== '0'; }")
rep(".dock-acts { display: inline-flex; align-items: flex-start; gap: 10px; }",
    ".dock-acts { display: inline-flex; align-items: flex-start; gap: 12px; padding: 8px 12px 6px; background: rgba(255,253,248,.94); backdrop-filter: blur(12px); border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 10px 28px -10px rgba(20,20,19,.25); }")
rep(".dock-lbl { font: 600 11px var(--font-ui); color: var(--ink-soft); background: rgba(255,253,248,.9); padding: 1px 6px; border-radius: 6px; white-space: nowrap; }",
    ".dock-lbl { font: 600 11px var(--font-ui); color: var(--ink-soft); white-space: nowrap; }")
rep(".dock-ring { width: 44px; height: 44px;", ".dock-ring { width: 40px; height: 40px;")
rep(".cmd-bar { margin-bottom: 21px; }", ".cmd-bar { margin-bottom: 14px; }")

# No "Ask Napkin" bar: the dock is only the action circles.
s = re.sub(r'  <form class="cmd-bar" id="cmd-form">.*?</form>\n', '', s, count=1, flags=re.S)
cut("  $('cmd-form').addEventListener('submit'", "  renderBriefPage();", '')

# ── Client desk: circles choose (clients + add), rectangles hold the work ──
CLIENTS = [
  dict(id='mcd', mono='Mc', name="McDonald's Ireland", eyebrow='QSR & RETAIL · REPUBLIC OF IRELAND', col='#DA291C', ink='#FFC72C', calls=2, arc=.72,
       line='Summer McFlurry · 2 need you', note='Updated 4m ago · 6 decisions on record',
       work=[('brief','output','BRIEF','Summer McFlurry v1.3','Needs your call'),('research','output','RESEARCH','Irish summer treats','12 facts'),('deck','output','DECK','Q3 board narrative','Draft')]),
  dict(id='bal', mono='Bm', name='Ballymaloe Foods', eyebrow='FMCG & PANTRY · CORK', col='#7A1E1E', ink='#F3D9A4', calls=0, arc=1,
       line='Better With Ballymaloe · done', note='Updated 2h ago · €150k TV & social',
       work=[('ballymaloe-brief','output','BRIEF','Better With Ballymaloe','Verified'),('ballymaloe-research','output','RESEARCH','Under-35 condiments','9 facts')]),
  dict(id='gui', mono='G0', name='Diageo · Guinness 0.0', eyebrow='BEVERAGE · DUBLIN', col='#111111', ink='#C9A86A', calls=0, arc=.4,
       line='Midweek pint · agents working', note='9 on-trade sources indexed',
       work=[('brief','prompt','BRIEF','Autumn pub draught','Intake'),('research','loading','RESEARCH','On-trade draught','Agents working')]),
  dict(id='bb', mono='BB', name='Bord Bia · Origin Green', eyebrow='PUBLIC & EXPORT · IRISH FOOD BOARD', col='#1F6B3A', ink='#CDE8B5', calls=0, arc=.9,
       line='EU export proof · 14 facts', note='All claims checked against CSO & Eurostat',
       work=[('research','output','RESEARCH','EU retail buyers','14 facts'),('brief','output','BRIEF','DACH trade brief','Verified')]),
]
C = 2 * 3.14159 * 52
def ring(c):
    stroke = 'var(--warn)' if c['calls'] else 'var(--ag-acc)'
    badge = f'<span class="cl-badge">{c["calls"]}</span>' if c['calls'] else ''
    return (f'<button type="button" class="cl-circle" data-client="{c["id"]}" aria-pressed="false">'
            f'<span class="cl-disc" style="--cl:{c["col"]};--cl-ink:{c["ink"]}">'
            f'<svg viewBox="0 0 116 116" aria-hidden="true"><circle cx="58" cy="58" r="52" class="cl-track"/>'
            f'<circle cx="58" cy="58" r="52" class="cl-arc" style="stroke:{stroke}" stroke-dasharray="{C*c["arc"]:.1f} {C:.1f}"/></svg>'
            f'<b>{c["mono"]}</b>{badge}</span>'
            f'<span class="cl-name">{c["name"]}</span><span class="cl-line">{c["line"]}</span></button>')
ICONS = {
  'BRIEF':    '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="11.5" x2="15" y2="11.5"/><line x1="9" y1="15" x2="13" y2="15"/>',
  'RESEARCH': '<circle cx="11" cy="11" r="6"/><line x1="15.5" y1="15.5" x2="20" y2="20"/>',
  'DECK':     '<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><line x1="12" y1="16" x2="12" y2="20"/><line x1="8.5" y1="20" x2="15.5" y2="20"/>',
  'NEW':      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
}
CW = 2 * 3.14159 * 44
def wk_circle(attr, kind, title, st, new=False):
    low = st.lower()
    if new: frac, stroke = 0, None
    elif 'need' in low: frac, stroke = .72, 'var(--warn)'
    elif 'working' in low: frac, stroke = .45, 'var(--ag-acc)'
    elif low in ('draft', 'intake'): frac, stroke = .2, 'var(--ag-acc)'
    else: frac, stroke = 1, 'var(--ag-acc)'
    arc = (f'<circle cx="50" cy="50" r="44" class="cl-arc" style="stroke:{stroke}" stroke-dasharray="{CW*frac:.1f} {CW:.1f}"/>' if frac else '')
    return (f'<button type="button" class="wk-circle{" wk-new" if new else ""}" {attr}>'
            f'<span class="wk-disc"><svg class="wk-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="cl-track"/>{arc}</svg>'
            f'<svg class="wk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{ICONS[kind]}</svg></span>'
            f'<small>{kind}</small><b>{title}</b><span>{st}</span></button>')

def work(c):
    cards = ''
    for tool, step, kind, title, st in c['work']:
        if tool.startswith('ballymaloe-'):
            attr = f'data-load-ballymaloe="{tool.split("-")[1]}"'
        else:
            attr = f'data-goto-tool="{tool}" data-goto-step="{step}"'
        cards += wk_circle(attr, kind, title, st)
    cards += wk_circle('data-goto-tool="brief" data-goto-step="prompt"', 'NEW', 'Start a brief', 'or ask research first', True)
    calls = (f'<button type="button" class="btn-rect" data-open-dtree style="min-height:34px;font-size:12.5px">{c["calls"]} calls need you →</button>' if c['calls'] else '')
    return (f'<section class="wk-panel" data-client-panel="{c["id"]}" hidden>'
            f'<header class="wk-head"><div><div class="sec-num">{c["eyebrow"]}</div><h2 class="sec-title">{c["name"]}</h2>'
            f'<p class="wk-note">{c["note"]}</p></div>{calls}</header>'
            f'<div class="wk-grid">{cards}</div></section>')

DESK = ('<main id="view-desk" hidden>\n'
        '    <section class="cl-row-wrap" aria-label="Clients">\n      <div class="cl-row" id="cl-row">\n'
        + '\n'.join('        ' + ring(c) for c in CLIENTS) +
        '\n        <button type="button" class="cl-circle cl-add" id="cl-add-btn"><span class="cl-disc"><b>+</b></span>'
        '<span class="cl-name">New client</span><span class="cl-line">Start a client desk</span></button>\n'
        '      </div>\n'
        '      <form class="cl-add-form" id="cl-add-form" hidden>\n'
        '        <label>Client name<input id="cl-add-name" type="text" placeholder="e.g. Kerrygold" required></label>\n'
        '        <label>Sector<input id="cl-add-sector" type="text" placeholder="e.g. Dairy · Export"></label>\n'
        '        <button type="submit" class="btn-rect primary">Add client</button>\n'
        '        <button type="button" class="btn-rect" id="cl-add-cancel">Cancel</button>\n'
        '      </form>\n    </section>\n'
        '  </main>')
_a = s.index('<main id="view-desk" hidden>'); _b = s.index('</main>', _a) + len('</main>')
s = s[:_a] + DESK + s[_b:]

rep("sub: 'Four client accounts, their briefs, research and decks. Two calls are waiting for you.',",
    "sub: 'Pick a client to open their work, or add a new one.',")
rep("title: 'Client Desk<span class=\"period-dot\"></span>',", "title: 'Clients<span class=\"period-dot\"></span>',")

rep('\n</style>', r"""
/* Client desk: circles choose */
.cl-row-wrap { padding: 30px 0 8px; }
.cl-row { display: flex; flex-wrap: wrap; gap: 26px 30px; }
.cl-circle { display: grid; justify-items: center; gap: 4px; width: 132px; background: none; border: 0; cursor: pointer; padding: 0; text-align: center; }
.cl-disc { position: relative; width: 116px; height: 116px; border-radius: 50%; display: grid; place-items: center; background: var(--paper); box-shadow: 0 10px 24px -14px rgba(20,20,19,.45); transition: transform .2s cubic-bezier(.34,1.56,.64,1); }
.cl-disc svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.cl-track { fill: none; stroke: var(--line); stroke-width: 3; }
.cl-arc { fill: none; stroke-width: 3; stroke-linecap: round; }
.cl-disc b { width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; background: var(--cl, var(--ink)); color: var(--cl-ink, var(--paper)); font: 800 26px var(--font-ui); letter-spacing: -.03em; }
.cl-badge { position: absolute; top: 4px; right: 4px; min-width: 24px; height: 24px; border-radius: 12px; display: grid; place-items: center; background: var(--warn); color: #fff; font: 700 12px var(--font-mono); box-shadow: 0 0 0 3px var(--bg, #F6F1E7); }
.cl-circle:hover .cl-disc { transform: translateY(-3px); }
.cl-circle[aria-pressed="true"] .cl-disc { box-shadow: 0 0 0 3px var(--ag-acc), 0 12px 26px -12px rgba(20,20,19,.5); }
.cl-name { margin-top: 8px; font: 700 14px var(--font-ui); color: var(--ink); letter-spacing: -.01em; }
.cl-line { font-size: 12px; color: var(--muted); line-height: 1.3; }
.cl-add .cl-disc { background: transparent; border: 1.5px dashed var(--line-strong); box-shadow: none; }
.cl-add .cl-disc b { background: transparent; color: var(--ink-soft); font-weight: 400; font-size: 38px; }
.cl-add-form { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin-top: 22px; padding: 16px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-md); }
.cl-add-form[hidden] { display: none; }
.cl-add-form label { display: grid; gap: 5px; font: 600 11px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.cl-add-form input { height: 38px; min-width: 220px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: #fff; font: 14px var(--font-ui); color: var(--ink); text-transform: none; letter-spacing: 0; }
/* the client opens up: a dial (hub = client, outer ring = work areas, inner ring = documents) */
.cl-row { align-items: center; }
.dial { position: relative; flex: none; width: min(400px, 86vw); aspect-ratio: 1; transform-origin: 50% 50%; margin: 6px 4px; }
.dial-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.dz { cursor: pointer; transform-box: view-box; transform-origin: 320px 320px; animation: dz-in .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0ms); }
@keyframes dz-in { from { opacity: 0; transform: scale(.82) rotate(-8deg); } to { opacity: 1; transform: none; } }
.dz path { stroke: #DDD5C5; stroke-width: 2; transition: fill .15s; }
.dz-out path { fill: #FFFDF8; }
.dz-out:hover path { fill: #F1ECE2; }
.dz-out.dz-needs path { fill: #ECE6DA; }
.dz-new path { fill: #FFFDF8; }
.dz-new .dz-outline { fill: none; stroke: var(--line-strong); stroke-width: 1; stroke-dasharray: 4 4; opacity: .5; }
.dz-in path { fill: #F4EEE2; }
.dz-in:hover path { fill: #E3DBCB; }
.dz-in.needs path { fill: #E0D7C6; }
.dz-in.empty path { fill: #F8F3E8; cursor: default; }
.dz text { pointer-events: none; text-anchor: middle; }
.dz-code { font: 600 15px var(--font-mono); letter-spacing: .08em; fill: var(--muted); }
.dz-name { font: 700 22px var(--font-ui); letter-spacing: -.01em; fill: var(--ink); }
.dz-sub { font: 500 15px var(--font-ui); fill: var(--muted); }
.dz-icode { font: 700 17px var(--font-mono); letter-spacing: .04em; fill: var(--ink-soft); }
.dz-tagbg { fill: var(--ink); }
.dz-tag { font: 700 12.5px var(--font-mono); letter-spacing: .1em; fill: var(--paper); }
.dz-rim { fill: none; stroke-width: 3.5; stroke-linecap: round; animation: dz-in .6s both; animation-delay: .35s; }
.dz-rim.needs { stroke: var(--warn); } .dz-rim.working { stroke: var(--ag-acc); } .dz-rim.done { stroke: var(--ag-acc); opacity: .55; }
.dz-line { stroke: var(--line); stroke-width: 1.2; animation: dz-in .5s both; animation-delay: .45s; }
.dial-hub { position: absolute; left: 50%; top: 50%; width: 28.75%; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%; border: 0; cursor: pointer;
  background: var(--cl, var(--ink)); color: var(--cl-ink, var(--paper)); display: grid; place-content: center; text-align: center; gap: 2px;
  box-shadow: 0 0 0 4px #FFFDF8, 0 0 0 6px var(--ag-acc); }
.dial-hub b { font: 800 19px var(--font-ui); letter-spacing: -.03em; line-height: 1.05; padding: 0 10px; }
.dial-hub small { font: 600 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; opacity: .75; }
.dz-thumb { position: absolute; transform: translate(-50%, -50%); display: grid; justify-items: center; gap: 4px; width: 92px; background: none; border: 0; padding: 0; cursor: pointer; animation: th-in .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0ms); }
@keyframes th-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.6); } to { opacity: 1; transform: translate(-50%, -50%); } }
.th-paper { width: 72px; height: 50px; border-radius: 4px; background: var(--paper); border: 1px solid var(--line); box-shadow: var(--shadow-card); position: relative; overflow: hidden; transition: transform .15s; }
.dz-thumb:hover .th-paper { transform: translateY(-2px); border-color: var(--ink); }
.th-paper::before { content: ""; position: absolute; inset: 8px 9px; }
.k-brief .th-paper::before { background: linear-gradient(var(--ink) 0 0) 0 0/60% 4px no-repeat, linear-gradient(var(--line) 0 0) 0 10px/100% 2px no-repeat, linear-gradient(var(--line) 0 0) 0 16px/90% 2px no-repeat, linear-gradient(var(--line) 0 0) 0 22px/95% 2px no-repeat, linear-gradient(var(--ag-acc) 0 0) 0 30px/40% 2px no-repeat; }
.k-research .th-paper::before { background: linear-gradient(var(--line) 0 0) 0 100%/14% 40% no-repeat, linear-gradient(var(--line) 0 0) 25% 100%/14% 70% no-repeat, linear-gradient(var(--ag-acc) 0 0) 50% 100%/14% 100% no-repeat, linear-gradient(var(--line) 0 0) 75% 100%/14% 55% no-repeat; }
.k-deck .th-paper::before { inset: 9px 12px; border: 1.5px solid var(--ink); border-radius: 2px; background: linear-gradient(var(--ag-acc) 0 0) 6px 6px/30% 3px no-repeat; }
.k-production .th-paper { background: #1C1B19; }
.k-production .th-paper::before { inset: 0; background: repeating-linear-gradient(90deg, transparent 0 8px, rgba(255,255,255,.18) 8px 11px) 0 3px/100% 4px no-repeat, repeating-linear-gradient(90deg, transparent 0 8px, rgba(255,255,255,.18) 8px 11px) 0 calc(100% - 3px)/100% 4px no-repeat, radial-gradient(circle at 50% 52%, var(--ag-acc) 0 5px, transparent 6px); }
.th-cap { font: 600 10.5px/1.25 var(--font-ui); color: var(--ink-soft); text-align: center; }
@media (prefers-reduced-motion: reduce) { .dz, .dz-thumb, .dz-rim, .dz-line { animation: none; } }
/* the circle opens up into the tool */
.portal-open { animation: portal-open .7s cubic-bezier(.65,0,.35,1) both; }
body.portal-anim { background: #E4DFD3; transition: background .7s; }
@keyframes portal-open { from { clip-path: circle(48px at var(--px) var(--py)); } to { clip-path: circle(150% at var(--px) var(--py)); } }
@media (prefers-reduced-motion: reduce) { .portal-open { animation: none; } }
</style>""", 1)

rep("  // Desk card deep links\n", r"""  /* ═══ CLIENT DESK: each client circle opens up into its dial ═══ */
  const DIAL = {
    mcd: { name: "McDonald's", sub: 'Ireland', mono: 'Mc', col: '#DA291C', ink: '#FFC72C', areas: [
      { code: 'BR', name: 'Brief', tool: 'brief', items: [
        { c: 'SM', t: 'Summer McFlurry v1.3', st: 'needs', step: 'output' }, { c: 'SP', t: 'Spoon trial', st: 'draft', step: 'prompt' } ] },
      { code: 'RS', name: 'Research', tool: 'research', items: [
        { c: 'IT', t: 'Irish summer treats', st: 'done', step: 'output' }, { c: 'DD', t: 'Delivery desserts', st: 'working', step: 'loading' } ] },
      { code: 'DK', name: 'Deck', tool: 'deck', items: [ { c: 'Q3', t: 'Q3 board narrative', st: 'draft', step: 'output' } ] },
      { code: 'PR', name: 'Production', tool: 'production', items: [ { c: 'SF', t: 'Spoon film · 6s', st: 'working' } ] } ] },
    bal: { name: 'Ballymaloe', sub: 'Foods', mono: 'Bm', col: '#7A1E1E', ink: '#F3D9A4', areas: [
      { code: 'BR', name: 'Brief', tool: 'brief', items: [ { c: 'BW', t: 'Better With Ballymaloe', st: 'done', step: 'output', preset: 'ballymaloe' } ] },
      { code: 'RS', name: 'Research', tool: 'research', items: [ { c: 'U3', t: 'Under-35 condiments', st: 'done', step: 'output', preset: 'ballymaloe' } ] },
      { code: 'DK', name: 'Deck', tool: 'deck', items: [] } ] },
    gui: { name: 'Guinness 0.0', sub: 'Diageo', mono: 'G0', col: '#111111', ink: '#C9A86A', areas: [
      { code: 'BR', name: 'Brief', tool: 'brief', items: [ { c: 'AP', t: 'Autumn pub draught', st: 'draft', step: 'prompt' } ] },
      { code: 'RS', name: 'Research', tool: 'research', items: [ { c: 'OT', t: 'On-trade draught', st: 'working', step: 'loading' } ] },
      { code: 'DK', name: 'Deck', tool: 'deck', items: [ { c: 'SI', t: 'Pub trade sell-in', st: 'draft', step: 'output' } ] } ] },
    bb: { name: 'Bord Bia', sub: 'Origin Green', mono: 'BB', col: '#1F6B3A', ink: '#CDE8B5', areas: [
      { code: 'RS', name: 'Research', tool: 'research', items: [ { c: 'EU', t: 'EU retail buyers', st: 'done', step: 'output' } ] },
      { code: 'BR', name: 'Brief', tool: 'brief', items: [ { c: 'DA', t: 'DACH trade brief', st: 'done', step: 'output' } ] } ] }
  };
  const R = { hub: 92, i0: 100, i1: 172, o0: 172, o1: 300, rim: 308 };
  const pol = (r, a) => [320 + r * Math.cos(a), 320 + r * Math.sin(a)];
  const f1 = n => n.toFixed(1);
  function sector(r0, r1, a0, a1) {
    const L = (a1 - a0) > Math.PI ? 1 : 0;
    const [x0, y0] = pol(r1, a0), [x1, y1] = pol(r1, a1), [x2, y2] = pol(r0, a1), [x3, y3] = pol(r0, a0);
    if (a1 - a0 >= 2 * Math.PI - 1e-3) {   // a single full ring
      return `M${320 + r1} 320A${r1} ${r1} 0 1 1 ${320 - r1} 320A${r1} ${r1} 0 1 1 ${320 + r1} 320ZM${320 + r0} 320A${r0} ${r0} 0 1 0 ${320 - r0} 320A${r0} ${r0} 0 1 0 ${320 + r0} 320Z`;
    }
    return `M${f1(x0)} ${f1(y0)}A${r1} ${r1} 0 ${L} 1 ${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}A${r0} ${r0} 0 ${L} 0 ${f1(x3)} ${f1(y3)}Z`;
  }
  function arcD(r, a0, a1) {
    const [x0, y0] = pol(r, a0), [x1, y1] = pol(r, a1);
    return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${(a1 - a0) > Math.PI ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`;
  }
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function areasFor(c) {
    if (!c.areas.length) return [
      { code: '+', name: 'Start a brief', tool: 'brief', items: [], step: 'prompt', isNew: true },
      { code: '+', name: 'Ask research', tool: 'research', items: [], step: 'prompt', isNew: true } ];
    return c.areas.concat([{ code: '+', name: 'New', tool: 'brief', items: [], step: 'prompt', isNew: true }]);
  }
  function areaState(ar) {
    if (ar.items.some(x => x.st === 'needs')) return 'needs';
    if (ar.items.some(x => x.st === 'working')) return 'working';
    if (ar.items.length && ar.items.every(x => x.st === 'done')) return 'done';
    return '';
  }
  function buildDial(id) {
    const c = DIAL[id], areas = areasFor(c), n = areas.length, span = 2 * Math.PI / n, start = -Math.PI / 2 - span / 2;
    let svg = '<svg class="dial-svg" viewBox="0 0 640 640" aria-hidden="false">', thumbs = '';
    areas.forEach((ar, i) => {
      const a0 = start + i * span, a1 = a0 + span, am = (a0 + a1) / 2, st = areaState(ar);
      const [lx, ly] = pol((R.o0 + R.o1) / 2, am);
      const sub = ar.isNew ? '' : (st === 'needs' ? '' : ar.items.length ? ar.items.length + (ar.items.length > 1 ? ' open' : ' open') : 'nothing yet');
      svg += `<g class="dz dz-out${ar.isNew ? ' dz-new' : ''}${st === 'needs' ? ' dz-needs' : ''}" data-i="${i}" style="--d:${i * 55}ms" role="button" tabindex="0"><title>${esc(ar.name)}</title>`
        + `<path d="${sector(R.o0, R.o1, a0, a1)}"/>` + (ar.isNew ? `<path class="dz-outline" d="${sector(R.o0 + 6, R.o1 - 6, a0 + .03, a1 - .03)}"/>` : '')
        + `<text x="${f1(lx)}" y="${f1(ly - 12)}" class="dz-code">${ar.code}</text><text x="${f1(lx)}" y="${f1(ly + 12)}" class="dz-name">${esc(ar.name)}</text>`
        + (sub ? `<text x="${f1(lx)}" y="${f1(ly + 33)}" class="dz-sub">${sub}</text>` : '')
        + (st === 'needs' ? `<rect class="dz-tagbg" x="${f1(lx - 46)}" y="${f1(ly + 21)}" width="92" height="19" rx="2"/><text x="${f1(lx)}" y="${f1(ly + 35)}" class="dz-tag">YOUR CALL</text>` : '')
        + '</g>';
      if (st) { const fr = st === 'done' ? 1 : st === 'needs' ? .8 : .45; svg += `<path class="dz-rim ${st}" d="${arcD(R.rim, a0 + .03, a0 + .03 + (span - .06) * fr)}"/>`; }
      const m = ar.items.length;
      if (!m) { svg += `<g class="dz dz-in empty" style="--d:${180 + i * 55}ms"><path d="${sector(R.i0, R.i1, a0, a1)}"/></g>`; return; }
      const s2 = span / m;
      ar.items.forEach((it, j) => {
        const b0 = a0 + j * s2, b1 = b0 + s2, bm = (b0 + b1) / 2, d = 180 + i * 55 + j * 30;
        const [ix, iy] = pol((R.i0 + R.i1) / 2, bm);
        svg += `<g class="dz dz-in ${it.st}" data-i="${i}" data-j="${j}" style="--d:${d}ms" role="button" tabindex="0"><title>${esc(it.t)}</title><path d="${sector(R.i0, R.i1, b0, b1)}"/><text x="${f1(ix)}" y="${f1(iy + 4)}" class="dz-icode">${it.c}</text></g>`;
      });
    });
    svg += '</svg>';
    return `<div class="dial" id="dial">${svg}<button type="button" class="dial-hub" id="dial-hub" style="--cl:${c.col};--cl-ink:${c.ink}" title="Close"><b>${esc(c.name)}</b><small>${esc(c.sub || '')}</small></button>${thumbs}</div>`;
  }

  function portalFrom(cx, cy) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const shell = document.querySelector('.studio-shell'), sr = shell.getBoundingClientRect();
    shell.style.setProperty('--px', (cx - sr.left) + 'px');
    shell.style.setProperty('--py', (cy - sr.top) + 'px');
    shell.classList.remove('portal-open'); void shell.offsetWidth; shell.classList.add('portal-open'); document.body.classList.add('portal-anim');
    shell.addEventListener('animationend', () => { shell.classList.remove('portal-open'); document.body.classList.remove('portal-anim'); }, { once: true });
  }
  function openWork(ar, it, cx, cy) {
    if (ar.tool === 'production') { showToast('Production opens in the Production Tool (not in this mock).'); return; }
    if (it && it.preset) { const pb = document.querySelector('[data-bpreset="' + it.preset + '"]'); if (pb) pb.click(); }
    activeTool = ar.tool;
    activeStep = ar.tool === 'deck' ? 'output' : (it ? it.step : (ar.step || (ar.items[0] ? ar.items[0].step : 'prompt')));
    syncNavigation();
    portalFrom(cx, cy);
  }

  let openId = null;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const circleOf = id => document.querySelector('.cl-circle[data-client="' + id + '"]');
  function pressRow(id) { document.querySelectorAll('.cl-circle[data-client]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.client === id))); }
  function openClient(id) {
    if (openId) closeClient(true);
    const circle = circleOf(id), from = circle.querySelector('.cl-disc').getBoundingClientRect();
    openId = id; pressRow(id);
    circle.insertAdjacentHTML('beforebegin', buildDial(id));
    circle.hidden = true;
    const dial = $('dial'), to = dial.getBoundingClientRect();
    dial.animate([{ transform: `translate(${(from.left + from.width / 2) - (to.left + to.width / 2)}px, ${(from.top + from.height / 2) - (to.top + to.height / 2)}px) scale(${from.width / to.width})` }, { transform: 'none' }],
      { duration: reduce() ? 0 : 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const areas = areasFor(DIAL[id]);
    const fire = (el, e) => {
      const ar = areas[+el.dataset.i]; if (!ar) return;
      const it = el.dataset.j != null ? ar.items[+el.dataset.j] : null;
      const r = el.getBoundingClientRect();
      openWork(ar, it, e && e.clientX ? e.clientX : r.left + r.width / 2, e && e.clientY ? e.clientY : r.top + r.height / 2);
    };
    dial.querySelectorAll('.dz[data-i]').forEach(el => {
      el.addEventListener('click', e => fire(el, e));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(el); } });
    });
    $('dial-hub').addEventListener('click', () => closeClient());
  }
  function closeClient(now) {
    const dial = $('dial'); if (!dial) return;
    const circle = circleOf(openId);
    const done = () => { dial.remove(); if (circle) circle.hidden = false; pressRow(null); openId = null; };
    if (now || reduce()) { done(); return; }
    dial.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.3)', opacity: 0 }], { duration: 280, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = done;
  }
  const bindCircle = b => b.addEventListener('click', () => {
    if (openId === b.dataset.client) { closeClient(); return; }
    openClient(b.dataset.client);
  });
  document.querySelectorAll('.cl-circle[data-client]').forEach(bindCircle);

  (function addClient() {
    const form = $('cl-add-form');
    $('cl-add-btn').addEventListener('click', () => { form.hidden = false; $('cl-add-name').focus(); });
    $('cl-add-cancel').addEventListener('click', () => { form.hidden = true; });
    let k = 0;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = $('cl-add-name').value.trim(); if (!name) return;
      const sector = $('cl-add-sector').value.trim();
      const mono = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const id = 'new' + (++k);
      DIAL[id] = { name, sub: sector || 'New client', mono, col: '#141413', ink: '#FFFDF8', areas: [] };
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cl-circle'; b.dataset.client = id; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<span class="cl-disc" style="--cl:var(--ink);--cl-ink:var(--paper)"><svg viewBox="0 0 116 116" aria-hidden="true"><circle cx="58" cy="58" r="52" class="cl-track"/></svg><b></b></span><span class="cl-name"></span><span class="cl-line">No work yet</span>';
      b.querySelector('b').textContent = mono; b.querySelector('.cl-name').textContent = name;
      $('cl-add-btn').before(b); bindCircle(b);
      form.hidden = true; form.reset();
      showToast(name + ' added to your clients.');
      requestAnimationFrame(() => openClient(id));
    });
  })();

  // Desk card deep links
""", 1)

# ── Simplify: no bottom dock; the dial floats over its circle, nothing else moves ──
s = re.sub(r'<div class="cmd-dock-wrap".*?</div>\n</div>\n', '', s, count=1, flags=re.S)
rep("    $('dock-tree-btn').setAttribute('aria-pressed', String(open));\n", "")
rep("  $('dock-tree-btn').addEventListener('click', () => {\n    const open = $('dtree-drawer').hidden;\n    setDecisionTreeOpen(open);\n  });\n", "")
rep("body { padding-bottom: 132px; }", "body { padding-bottom: 48px; }")
rep(".cl-row { align-items: center; }", ".cl-row { align-items: flex-start; position: relative; }\n.cl-circle.is-open { visibility: hidden; }")
rep(".dial { position: relative; flex: none; width: min(400px, 86vw); aspect-ratio: 1; transform-origin: 50% 50%; margin: 6px 4px; }",
    ".dial { position: absolute; z-index: 6; width: 360px; aspect-ratio: 1; filter: drop-shadow(0 18px 30px rgba(20,20,19,.12)); }")
rep(".dz { cursor: pointer; transform-box: view-box; transform-origin: 320px 320px; animation: dz-in .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0ms); }",
    ".dz { cursor: pointer; }")
rep(".dz-rim { fill: none; stroke-width: 3.5; stroke-linecap: round; animation: dz-in .6s both; animation-delay: .35s; }",
    ".dz-rim { fill: none; stroke-width: 4; stroke-linecap: round; }\n.dz-rim.working, .dz-rim.done { display: none; }\n.dz-sub { display: none; }\n.cl-arc { display: none; }")

_a = s.index("  function openClient(id) {"); _b = s.index("  const bindCircle = b =>", _a)
s = s[:_a] + r"""  function openClient(id) {
    if (openId) closeClient(true);
    const circle = circleOf(id), row = $('cl-row');
    openId = id; pressRow(id);
    row.insertAdjacentHTML('beforeend', buildDial(id));
    const dial = $('dial'), W = dial.offsetWidth;
    const rr = row.getBoundingClientRect(), dr = circle.querySelector('.cl-disc').getBoundingClientRect();
    const cx = dr.left + dr.width / 2 - rr.left;
    const left = Math.max(-8, Math.min(cx - W / 2, rr.width - W + 8));
    const top = dr.top - rr.top - 12;
    dial.style.left = left + 'px'; dial.style.top = top + 'px';
    dial.style.transformOrigin = (cx - left) + 'px ' + (dr.height / 2 + 12) + 'px';
    circle.classList.add('is-open');
    dial.animate([{ transform: 'scale(' + (dr.width / W) + ')', opacity: .5 }, { transform: 'none', opacity: 1 }], { duration: reduce() ? 0 : 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const areas = areasFor(DIAL[id]);
    const fire = (el, e) => {
      const ar = areas[+el.dataset.i]; if (!ar) return;
      const it = el.dataset.j != null ? ar.items[+el.dataset.j] : null;
      const r = el.getBoundingClientRect();
      openWork(ar, it, e && e.clientX ? e.clientX : r.left + r.width / 2, e && e.clientY ? e.clientY : r.top + r.height / 2);
    };
    dial.querySelectorAll('.dz[data-i]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); fire(el, e); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(el); } });
    });
    $('dial-hub').addEventListener('click', e => { e.stopPropagation(); closeClient(); });
    dial.addEventListener('click', e => e.stopPropagation());
  }
  function closeClient(now) {
    const dial = $('dial'); if (!dial) return;
    const circle = circleOf(openId);
    const done = () => { dial.remove(); if (circle) circle.classList.remove('is-open'); pressRow(null); openId = null; };
    if (now || reduce()) { done(); return; }
    dial.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.35)', opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).onfinish = done;
  }
  document.addEventListener('click', e => { if (openId && !e.target.closest('.cl-circle')) closeClient(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openId) closeClient(); });
""" + s[_b:]
s = s.replace("    if (openId === b.dataset.client) { closeClient(); return; }", "    if (openId === b.dataset.client) { closeClient(); return; }", 1)

# ── Tool home: Brief / Research open on "pick an existing one, or make a new one" ──
for tool, label, noun in (('brief', 'BRIEFS', 'brief'), ('research', 'RESEARCH', 'research question')):
    rep(f'    <section id="{tool}-screen-prompt" class="section-block">',
        f'    <section id="{tool}-screen-home" class="section-block" hidden>\n'
        f'      <div class="sec-num" id="{tool}-home-eyebrow">{label}</div>\n'
        f'      <h2 class="sec-title">Pick one to open, or start a new {noun}</h2>\n'
        f'      <div class="home-grid" id="{tool}-home-grid"></div>\n'
        f'    </section>\n\n'
        f'    <section id="{tool}-screen-prompt" class="section-block">')
rep("if (!['prompt', 'loading', 'output'].includes(activeStep)) activeStep = 'prompt';",
    "if (!['home', 'prompt', 'loading', 'output'].includes(activeStep)) activeStep = 'prompt';")
# top tabs open a tool on its home
rep("  document.querySelectorAll('.tool-tab').forEach(btn => {\n    btn.addEventListener('click', () => {\n      activeTool = btn.dataset.tool;\n",
    "  document.querySelectorAll('.tool-tab').forEach(btn => {\n    btn.addEventListener('click', () => {\n      activeTool = btn.dataset.tool;\n      if (activeTool === 'brief' || activeTool === 'research') activeStep = 'home';\n")
# chrome: show/fill the home screen, hide the flow + arrow there
rep("    $('hero-cta-circle').hidden = !stepTool || activeStep === 'output';",
    "    $('hero-cta-circle').hidden = !stepTool || activeStep === 'output' || activeStep === 'home';\n"
    "    $('step-switcher-group').style.visibility = activeStep === 'home' ? 'hidden' : '';\n"
    "    ['brief', 'research'].forEach(t => { const h = $(t + '-screen-home'); if (h) h.hidden = !(activeTool === t && activeStep === 'home'); });\n"
    "    if (stepTool && activeStep === 'home' && window.renderToolHome) window.renderToolHome(activeTool);")
# area click → home; document click → that document
rep("    activeStep = ar.tool === 'deck' ? 'output' : (it ? it.step : (ar.step || (ar.items[0] ? ar.items[0].step : 'prompt')));",
    "    curClient = openId || curClient;\n"
    "    activeStep = ar.tool === 'deck' ? 'output' : (it ? it.step : (ar.isNew ? 'prompt' : 'home'));")
rep("  let openId = null;\n", r"""  let openId = null;
  let curClient = 'mcd';
  window.renderToolHome = function (tool) {
    const c = DIAL[curClient] || DIAL.mcd, full = c.full || c.name;
    const ar = (c.areas || []).find(a => a.tool === tool) || { items: [] };
    $(tool + '-home-eyebrow').textContent = full.toUpperCase() + ' · ' + (tool === 'brief' ? 'BRIEFS' : 'RESEARCH');
    $('hero-eyebrow').textContent = full.toUpperCase() + ' · ' + (tool === 'brief' ? 'BRIEFS' : 'RESEARCH');
    const crumb = $('tb-crumb'); crumb.innerHTML = esc(full) + ' <span>/</span> <b id="tb-crumb-doc">' + (tool === 'brief' ? 'Briefs' : 'Research') + '</b>';
    const ST = { needs: ['Needs your call', 'needs'], working: ['Agents working', 'working'], draft: ['Draft', 'draft'], done: ['Done', 'done'] };
    const grid = $(tool + '-home-grid');
    grid.innerHTML = ar.items.map((it, j) => `<button type="button" class="home-card" data-j="${j}"><small>${esc(it.c)}</small><b>${esc(it.t)}</b><span class="home-st ${ST[it.st] ? ST[it.st][1] : ''}">${ST[it.st] ? ST[it.st][0] : ''}</span></button>`).join('')
      + `<button type="button" class="home-card home-new" data-new="1"><small>NEW</small><b>+ ${tool === 'brief' ? 'New brief' : 'New research question'}</b><span>${tool === 'brief' ? 'From notes, calls and decks' : 'Sources pinned to every fact'}</span></button>`;
    grid.querySelectorAll('.home-card').forEach(b => b.addEventListener('click', () => {
      const it = b.dataset.new ? null : ar.items[+b.dataset.j];
      if (it && it.preset) { const pb = document.querySelector('[data-bpreset="' + it.preset + '"]'); if (pb) pb.click(); }
      activeStep = it ? it.step : 'prompt';
      syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' });
    }));
  };
""")
rep("    mcd: { name: \"McDonald's\", sub: 'Ireland',", "    mcd: { name: \"McDonald's\", full: \"McDonald's Ireland\", sub: 'Ireland',")
rep("    bal: { name: 'Ballymaloe', sub: 'Foods',", "    bal: { name: 'Ballymaloe', full: 'Ballymaloe Foods', sub: 'Foods',")
rep("    gui: { name: 'Guinness 0.0', sub: 'Diageo',", "    gui: { name: 'Guinness 0.0', full: 'Diageo · Guinness 0.0', sub: 'Diageo',")
rep("    bb: { name: 'Bord Bia', sub: 'Origin Green',", "    bb: { name: 'Bord Bia', full: 'Bord Bia · Origin Green', sub: 'Origin Green',")
rep("      DIAL[id] = { name, sub: sector || 'New client',", "      DIAL[id] = { name, full: name, sub: sector || 'New client',")

# dial legibility + quieter neighbours
rep(".dz-code { font: 600 15px var(--font-mono);", ".dz-code { font: 600 19px var(--font-mono);")
rep(".dz-name { font: 700 22px var(--font-ui);", ".dz-name { font: 700 30px var(--font-ui);")
rep(".dz-icode { font: 700 17px var(--font-mono);", ".dz-icode { font: 700 22px var(--font-mono);")
rep(".dz-tag { font: 700 12.5px var(--font-mono);", ".dz-tag { font: 700 16px var(--font-mono);")
rep("`<text x=\"${f1(lx)}\" y=\"${f1(ly - 12)}\" class=\"dz-code\">${ar.code}</text><text x=\"${f1(lx)}\" y=\"${f1(ly + 12)}\" class=\"dz-name\">${esc(ar.name)}</text>`",
    "`<text x=\"${f1(lx)}\" y=\"${f1(ly - 16)}\" class=\"dz-code\">${ar.code}</text><text x=\"${f1(lx)}\" y=\"${f1(ly + 16)}\" class=\"dz-name\">${esc(ar.name)}</text>`")
rep("`<rect class=\"dz-tagbg\" x=\"${f1(lx - 46)}\" y=\"${f1(ly + 21)}\" width=\"92\" height=\"19\" rx=\"2\"/><text x=\"${f1(lx)}\" y=\"${f1(ly + 35)}\" class=\"dz-tag\">YOUR CALL</text>`",
    "`<rect class=\"dz-tagbg\" x=\"${f1(lx - 58)}\" y=\"${f1(ly + 28)}\" width=\"116\" height=\"24\" rx=\"3\"/><text x=\"${f1(lx)}\" y=\"${f1(ly + 46)}\" class=\"dz-tag\">YOUR CALL</text>`")
rep(".cl-circle.is-open { visibility: hidden; }",
    ".cl-circle.is-open { visibility: hidden; }\n.cl-row .cl-circle { transition: opacity .2s; }\n.cl-row:has(.dial) .cl-circle:not(.is-open) { opacity: .3; }\n"
    ".home-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-top: 18px; }\n"
    ".home-card { display: grid; gap: 6px; align-content: start; min-height: 132px; padding: 18px; text-align: left; background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-md); cursor: pointer; transition: border-color .15s; }\n"
    ".home-card:hover { border-color: var(--ink); }\n"
    ".home-card small { font: 700 10.5px var(--font-mono); letter-spacing: .1em; color: var(--muted); }\n"
    ".home-card b { font: 700 17px var(--font-ui); letter-spacing: -.02em; color: var(--ink); }\n"
    ".home-card > span { margin-top: auto; font-size: 12.5px; color: var(--muted); }\n"
    ".home-st.needs { color: var(--warn); font-weight: 600; } .home-st.working { color: var(--ink-soft); }\n"
    ".home-new { background: transparent; border-style: dashed; border-color: var(--line-strong); }")

rep("    else crumb.innerHTML = \"McDonald's Ireland <span>/</span> <b id=\\\"tb-crumb-doc\\\">\" + (HERO_META[activeTool] || HERO_META.brief).doc + '</b>';",
    "    else if (activeStep !== 'home' || !stepTool) crumb.innerHTML = \"McDonald's Ireland <span>/</span> <b id=\\\"tb-crumb-doc\\\">\" + (HERO_META[activeTool] || HERO_META.brief).doc + '</b>';")

rep(".dial-hub b { font: 800 19px var(--font-ui);", ".dial-hub b { font: 800 14.5px var(--font-ui);")
rep(".dz-name { font: 700 30px var(--font-ui);", ".dz-name { font: 700 26px var(--font-ui);")
rep(".home-grid { display: grid;", "[id$='-home-eyebrow'] { display: none; }\n.home-grid { display: grid;")

# One ring of tools only: no document codes in the dial.
rep("const R = { hub: 92, i0: 100, i1: 172, o0: 172, o1: 300, rim: 308 };", "const R = { hub: 92, o0: 100, o1: 300, rim: 308 };")
_a = s.index("      const m = ar.items.length;\n      if (!m) {"); _b = s.index("    svg += '</svg>';", _a)
s = s[:_a] + "    });\n" + s[_b:]
rep("const [lx, ly] = pol((R.o0 + R.o1) / 2, am);", "const [lx, ly] = pol(212, am);")

# ── Top bar: the tabs give way to a circle trail (where you are; each circle goes back a level) ──
s = re.sub(r'    <nav class="tb-nav-pills".*?</nav>\n', '    <nav class="tb-trail" id="tb-trail" aria-label="Where you are"></nav>\n', s, count=1, flags=re.S)
rep(".home-grid { display: grid;", """.tb-crumb, .tb-crumb + .tb-vsep { display: none !important; }
.tb-trail { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tr-step { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px 0 4px; border: 0; border-radius: 999px; background: none; cursor: pointer; font: 600 13.5px var(--font-ui); color: var(--ink-soft); white-space: nowrap; }
.tr-step:hover { background: rgba(20,20,19,.05); }
.tr-dot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--paper); border: 1px solid var(--line); color: var(--ink); font: 800 10.5px var(--font-ui); letter-spacing: -.02em; }
.tr-dot svg { width: 14px; height: 14px; }
.tr-sep { width: 14px; height: 1px; background: var(--line-strong); opacity: .35; flex: none; }
.tr-here { font: 700 13.5px var(--font-ui); color: var(--ink); padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
.tr-step.is-here { color: var(--ink); font-weight: 700; cursor: default; }
.tr-step.is-here:hover { background: none; }
.home-grid { display: grid;""")
rep("    if (stepTool && activeStep === 'home' && window.renderToolHome) window.renderToolHome(activeTool);",
    "    if (stepTool && activeStep === 'home' && window.renderToolHome) window.renderToolHome(activeTool);\n    if (window.renderTrail) window.renderTrail();")
rep("  window.renderToolHome = function (tool) {", r"""  let curItem = null;
  const TOOL_ICON = {
    brief: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><line x1="9" y1="8.5" x2="15" y2="8.5"/><line x1="9" y1="12" x2="15" y2="12"/>',
    research: '<circle cx="11" cy="11" r="6"/><line x1="15.5" y1="15.5" x2="20" y2="20"/>',
    deck: '<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><line x1="12" y1="16" x2="12" y2="20"/>'
  };
  const TOOL_NAME = { brief: 'Brief', research: 'Research', deck: 'Deck' };
  window.renderTrail = function () {
    const nav = $('tb-trail'); if (!nav) return;
    const ico = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    const atDesk = activeTool === 'desk';
    let h = `<button type="button" class="tr-step${atDesk ? ' is-here' : ''}" data-tr="desk"><span class="tr-dot">${ico('<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><circle cx="8" cy="16" r="2.6"/><circle cx="16" cy="16" r="2.6"/>')}</span>Clients</button>`;
    if (!atDesk) {
      const c = DIAL[curClient] || DIAL.mcd;
      h += `<span class="tr-sep"></span><button type="button" class="tr-step" data-tr="client"><span class="tr-dot" style="background:${c.col};color:${c.ink};border-color:${c.col}">${esc(c.mono)}</span>${esc(c.full || c.name)}</button>`;
      const atHome = activeStep === 'home' || activeTool === 'deck';
      h += `<span class="tr-sep"></span><button type="button" class="tr-step${atHome ? ' is-here' : ''}" data-tr="tool"><span class="tr-dot">${ico(TOOL_ICON[activeTool] || '')}</span>${TOOL_NAME[activeTool] || ''}</button>`;
      if (!atHome) {
        const ar = (c.areas || []).find(a => a.tool === activeTool);
        const doc = curItem ? curItem.t : (activeStep === 'prompt' ? 'New ' + (activeTool === 'brief' ? 'brief' : 'question') : (ar && ar.items[0] ? ar.items[0].t : (HERO_META[activeTool] || {}).doc));
        h += `<span class="tr-sep"></span><span class="tr-here">${esc(doc || '')}</span>`;
      }
    }
    nav.innerHTML = h;
    nav.querySelectorAll('[data-tr]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.tr;
      if (k === 'desk') { activeTool = 'desk'; syncNavigation(); }
      else if (k === 'client') { const id = curClient; activeTool = 'desk'; syncNavigation(); requestAnimationFrame(() => openClient(id)); }
      else if (k === 'tool') { if (activeTool !== 'deck') { activeStep = 'home'; curItem = null; syncNavigation(); } }
      window.scrollTo({ top: 0, behavior: 'instant' });
    }));
  };
  window.renderToolHome = function (tool) {""")
rep("    activeStep = ar.tool === 'deck' ? 'output' : (it ? it.step : (ar.isNew ? 'prompt' : 'home'));",
    "    activeStep = ar.tool === 'deck' ? 'output' : (it ? it.step : (ar.isNew ? 'prompt' : 'home'));\n    curItem = it || null;")
rep("      activeStep = it ? it.step : 'prompt';\n      syncNavigation();",
    "      activeStep = it ? it.step : 'prompt';\n      curItem = it;\n      syncNavigation();")

rep("    curClient = openId || curClient;\n", "    curClient = openId || curClient;\n    closeClient(true);\n")

exec(open(pathlib.Path(__file__).with_name('phase2.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase3.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase4.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase5.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase6.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase7.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase8.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase9.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase10.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase11.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase12.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase13.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase14.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase15.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase16.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase17.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase18.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase19.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase20.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase21.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase22.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase23.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase24.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase25.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase26.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase27.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase28.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase29.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase30.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase31.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase32.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase33.py')).read())

exec(open(pathlib.Path(__file__).with_name('phase34.py')).read())

OUT.write_text(s, encoding="utf-8")
print("wrote", OUT, len(s), "bytes")
