# Phase 33 (2026-11-09): parity sweep. Every feature that exists today gets a visible home
# (except the owner's explicit removals), the breakage-sweep bugs are fixed, and the UI is polished.
import re as _re33

# ── 1. Markup homes in the brief side tab ──────────────────────────────────────────────────
rep('<button type="button" class="btn-rect primary side-save" id="b-print-pdf">Save · PDF</button>',
    '<div id="b-upnote"></div>\n          <div class="save-split"><button type="button" class="btn-rect primary side-save" id="b-print-pdf">Save · PDF</button>'
    '<button type="button" class="save-more" data-save-menu="brief" data-p33-anchor aria-label="More ways to save" title="More ways to save">'
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg></button></div>')
rep('<button type="button" class="sp-btn b-lock-side" id="b-lock-side">Lock the brief</button>',
    '<button type="button" class="sp-btn b-lock-side" id="b-lock-side">Lock the brief</button>\n          <div id="b-gate"></div>\n          <div id="b-client-rev"></div>')
rep('<div class="brand-line" id="b-brand-line"></div>', '<div class="brand-line" id="b-brand-line"></div>\n          <div id="b-made"></div>')
rep('<div class="side-part" id="side-part" hidden></div>', '<div class="side-part" id="side-part" hidden></div>\n          <div id="b-review-host"></div>')
rep('''<div><small>Headings</small><div class="seg-row" id="b-heads-seg"><button type="button" data-heads="label" aria-pressed="true">Label</button><button type="button" data-heads="tab" aria-pressed="false">Tab</button></div></div>
            </div>''', '''<div><small>Headings</small><div class="seg-row" id="b-heads-seg"><button type="button" data-heads="label" aria-pressed="true">Label</button><button type="button" data-heads="tab" aria-pressed="false">Tab</button></div></div>
            </div>
            <div class="lay-2 lay-2b"><div><small>Cover</small><div id="b-cover-host"></div></div><div><small>Why notes</small><div class="seg-row" id="b-why-seg"><button type="button" data-why="hide" aria-pressed="true">Hide</button><button type="button" data-why="show" aria-pressed="false">Show all</button></div></div></div>''')

# ── 2. Wording and data fixes ──────────────────────────────────────────────────────────────
rep('<li><b>Knowledge</b> pinned 6 facts · 1 contest</li>', '<li><b>Knowledge</b> pinned 8 facts · 1 contest</li>')
rep("showToast('12 verified facts from Research attached to your new brief.');", "showToast('8 pinned facts from Irish summer treats attached to your new brief.');")
rep("Includes 12 verified facts.</small>", "Includes 8 pinned research facts.</small>")
rep("summer-treats-research.clan — 12 verified facts (f_003, f_007…)", "summer-treats-research.clan — 8 pinned facts (f_003, f_007…)")
rep("Step 1 of 4 · 3 files + 12 research facts", "Step 1 of 4 · 3 files + 8 research facts")
rep('McFlurry Summer 2026 · ', 'Summer McFlurry v1.3 · ', 3)
rep("x.unused ? 'not used'", "x.unused ? 'context only'")
rep("' · not used'", "' · context only'")
rep('pinned · not used', 'pinned · context only, not in a finding')
rep("call with Siobhán Ryan", "call with Orla Brennan")
_BR33 = {'f_003': ['Where we are', 'The barrier', 'Consumer insight', 'Objective · Behavioural', 'Who we are talking to', 'Response · Think', 'Single-minded proposition'],
         'f_004': ['Consumer insight'], 'f_007': ['Where we are', 'The barrier'],
         'f_009': ['Objective · Attitudinal', 'Who we are talking to', 'Response · Do'],
         'f_011': ['Single-minded proposition', 'Reasons to believe', 'Response · Feel', 'Response · Do', 'Open questions & Mandatories']}
for _fid, _names in _BR33.items():
    _pat = _re33.compile(r"(\n      %s: \{ key: [^\n]*?)brief: \[[^\]]*\]" % _fid)
    _js = '[' + ', '.join("'" + n + "'" for n in _names) + ']'
    s, _n = _pat.subn(lambda m: m.group(1) + 'brief: ' + _js, s, count=1)
    if _n != 1:
        sys.exit('phase33: FX brief array not found for ' + _fid)
# Decisions drawer: house wording
rep('DECISION TREE &amp; PROVENANCE RECORD', 'DECISIONS')
rep('LIVE PROVENANCE GRAPH (SOURCES → FACTS → DECISIONS → BRIEF)', 'HOW IT WAS DECIDED · SOURCES → FACTS → DECISIONS → BRIEF')
rep('Approve both &amp; lock brief ✓', 'Approve both and lock the brief')
rep('>Inspect in Research →<', '>Open in Research<')
rep('>Close ✕<', '>Close<')
rep('H1 Mark: Needs You', 'Needs you')
rep('<b>9 Sources Read by Knowledge Agent</b>', '<b>9 sources read by the Knowledge agent</b>')
rep('<b>d_044 · Delivery Growth Disagreement Resolved</b>', '<b>d_044 · Delivery growth: sources disagreed, resolved</b>')
rep('<b>d_042 · Spontaneous Hangout Extension (f_003, f_004)</b>', '<b>d_042 · Treats stretch an unplanned hangout (f_003, f_004)</b>')
rep('<b>d_046 · Review Agent Rewrote Single-Minded Proposition</b>', '<b>d_046 · The Review agent rewrote the proposition</b>')
rep('<b>d_045 · Two-Spoon Sharing Ritual (f_011)</b>', '<b>d_045 · The two-spoon sharing ritual (f_011)</b>')
# Deck: same language as the other tools
rep('>Inspect Decision Tree (2)<', '>Decisions<')
rep('>← Back to Brief Sheet<', '>← Back to the brief<')
rep("doc: 'Q3 Board Pitch'", "doc: 'Q3 board narrative'")
rep('''eyebrow: "MCDONALD'S IRELAND · Q3 BOARD PITCH"''', '''eyebrow: "MCDONALD'S IRELAND · Q3 BOARD NARRATIVE"''')
# New client form validates itself (message, not the browser bubble)
rep('<form class="cl-add-form" id="cl-add-form" hidden>', '<form class="cl-add-form" id="cl-add-form" hidden novalidate>')

# ── 3. CSS ─────────────────────────────────────────────────────────────────────────────────
CSS33 = r"""
/* ═══ Phase 33: parity homes, fixes, polish ═══ */
/* brief workspace never wider than the window */
#brief-screen-output .brief-workspace { grid-template-columns: minmax(0, var(--a4w)) minmax(320px, 440px) !important; }
@media (max-width: 1400px) { #brief-screen-output { --a4w: 780px; --bw: min(calc(var(--a4w) + 24px + 380px), calc(100vw - 48px)) !important; } #brief-screen-output .brief-workspace { grid-template-columns: minmax(0, var(--a4w)) 380px !important; gap: 24px !important; } }
@media (max-width: 1260px) { #brief-screen-output { --a4w: 700px; --bw: min(calc(var(--a4w) + 20px + 350px), calc(100vw - 40px)) !important; } #brief-screen-output .brief-workspace { grid-template-columns: minmax(0, var(--a4w)) 350px !important; gap: 20px !important; } }
@media (max-width: 1100px) { #brief-screen-output .brief-workspace { grid-template-columns: minmax(0, 1fr) 320px !important; } }
html, body { overflow-x: clip; }
/* inspectors sit below the top bar */
#brief-screen-output #look-inspector, #research-screen-output #r-side { top: 78px !important; max-height: calc(100vh - 94px) !important; }
/* moved parts leave no holes */
#brief-screen-output .b-grid { grid-auto-flow: row dense !important; }
/* page breaks: a tick in the margins, never a line through the text */
#brief-screen-output .brief-page:not(.phone) {
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.5) calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.5) calc(var(--a4w) * 1.4142)),
                    repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.5) calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.5) calc(var(--a4w) * 1.4142)) !important;
  background-size: 18px 100%, 18px 100% !important; background-position: left top, right top !important; background-repeat: no-repeat !important;
}
/* split save button */
.save-split { display: grid; grid-template-columns: 1fr 44px; gap: 2px; }
.save-split .side-save { border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; width: 100%; }
.save-more { display: grid; place-items: center; background: var(--ag-act, #1E22AA); color: var(--ag-act-ink, #fff); border-radius: 0 6px 6px 0; min-height: 38px; }
.save-more svg { width: 16px; height: 16px; }
.save-more:hover { filter: brightness(1.08); }
#r-side .save-split { margin-bottom: 4px; }
/* generic popover + modal */
.p33-pop { position: fixed; z-index: 120; min-width: 240px; max-width: 340px; background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 18px 40px -14px rgba(20,20,19,.38); padding: 6px; display: grid; gap: 1px; font: 13.5px/1.4 var(--font-ui); }
.p33-pop[hidden] { display: none; }
.p33-pop > button, .p33-pop .pp-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 10px; text-align: left; padding: 8px 10px; border-radius: 7px; }
.p33-pop > button:hover, .p33-pop .pp-row:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.p33-pop > button small, .p33-pop .pp-sub { grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
.p33-pop > button[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
.p33-pop hr { border: 0; border-top: 1px solid var(--line); margin: 4px 6px; }
.p33-pop .pp-h { font: 600 10.5px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); padding: 8px 10px 4px; }
.p33-pop label.pp-opt { display: flex; gap: 8px; align-items: center; padding: 6px 10px; font-size: 13px; cursor: pointer; }
.p33-pop .pp-me { display: flex; gap: 10px; align-items: center; padding: 10px 10px 8px; }
.p33-pop .pp-av { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--ag-base, #1E22AA); color: #fff; font: 700 12px var(--font-mono); flex: none; }
.p33-pop .pp-me b { display: block; font-size: 14px; } .p33-pop .pp-me small { color: var(--muted); font-size: 12px; }
.p33-pop .pp-form { display: grid; gap: 8px; padding: 8px 10px; }
.p33-pop .pp-form input, .p33-pop .pp-form textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; background: var(--card); font-size: 13px; }
.p33-pop .pp-acts { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.p33-pop .pp-k { font: 600 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.p33-modal { position: fixed; inset: 0; z-index: 130; background: rgba(20,20,19,.38); display: grid; place-items: center; padding: 24px; }
.p33-modal[hidden] { display: none; }
.p33-mcard { position: relative; width: min(720px, 100%); max-height: calc(100vh - 48px); overflow: auto; background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 30px 70px -20px rgba(20,20,19,.5); padding: 26px 28px; }
.p33-mcard h2 { font: 700 22px/1.2 var(--font-ui); letter-spacing: -.01em; margin-bottom: 4px; }
.p33-mcard .m-sub { color: var(--muted); font-size: 13.5px; margin-bottom: 18px; }
.p33-mcard h3 { font: 600 10.5px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 18px 0 8px; }
.p33-mx { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border-radius: 50%; font-size: 20px; line-height: 1; color: var(--muted); }
.p33-mx:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.m-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.m-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--card); display: grid; gap: 4px; align-content: start; }
.m-card b { font-size: 14px; } .m-card small { color: var(--muted); font-size: 12.5px; line-height: 1.4; }
.m-card .m-tag { justify-self: start; font: 600 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 99px; background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
.m-card .m-tag.soon { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--muted); }
.m-card .sp-btn { justify-self: start; margin-top: 6px; }
.m-card.soon { border-style: dashed; background: transparent; }
.m-fig { width: 46px; height: 46px; border-radius: 50%; margin-bottom: 6px; background: radial-gradient(circle at 34% 30%, rgba(255,255,255,.85), transparent 30%), radial-gradient(circle at 50% 55%, var(--c1), var(--c2) 75%); box-shadow: inset 0 -6px 12px rgba(0,0,0,.25), 0 6px 14px -6px rgba(0,0,0,.35); }
.m-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.m-tbl td { padding: 7px 0; border-bottom: 1px solid var(--line); vertical-align: top; } .m-tbl td:first-child { color: var(--muted); width: 38%; font: 500 12px var(--font-mono); }
.m-list { display: grid; gap: 6px; } .m-list .m-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--card); }
.m-row small { display: block; color: var(--muted); font-size: 12px; }
.m-form { display: grid; gap: 10px; max-width: 360px; } .m-form label { display: grid; gap: 4px; font-size: 12.5px; color: var(--muted); }
.m-form input { border: 1px solid var(--line); border-radius: 7px; padding: 9px 11px; background: var(--card); color: var(--ink); font-size: 14px; }
.m-acts { display: flex; gap: 8px; margin-top: 14px; }
/* sign-in screen */
.p33-signin { position: fixed; inset: 0; z-index: 140; background: var(--desk); display: grid; place-items: center; }
.p33-signin[hidden] { display: none; }
.p33-signin .si-card { width: min(380px, calc(100vw - 32px)); background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 30px 28px; box-shadow: var(--shadow-paper); display: grid; gap: 12px; }
.p33-signin .si-mark { width: 54px; height: 54px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #8c92ff, var(--ag-base, #1E22AA) 70%); }
.p33-signin h2 { font: 700 24px/1.15 var(--font-ui); } .p33-signin p { color: var(--muted); font-size: 13.5px; }
.p33-signin label { display: grid; gap: 4px; font-size: 12.5px; color: var(--muted); }
.p33-signin input { border: 1px solid var(--line); border-radius: 7px; padding: 10px 12px; background: var(--card); color: var(--ink); font-size: 14px; }
/* top bar: needs pill, beta chip, doc name */
.tb-needs { flex: none; display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); background: var(--warn-soft); color: var(--warn); font: 600 11px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.tb-needs i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.tb-needs.aside { background: transparent; color: var(--muted); border-color: var(--line); }
.tb-needs[hidden] { display: none; }
body:not([data-step="loading"]) #bar-status[data-st="sleep"], body:not([data-step="loading"]) #bar-status[data-st="awake"] { opacity: .78; }
.tb-beta { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border-radius: 99px; border: 1px dashed var(--line); color: var(--muted); font: 600 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.tb-beta i { width: 6px; height: 6px; border-radius: 50%; background: var(--alert); animation: p33pulse 1.6s ease-in-out infinite; }
.tb-beta.paused i { background: var(--faint); animation: none; }
@keyframes p33pulse { 50% { opacity: .35; } }
.tba-name { cursor: pointer; border-radius: 7px; padding: 2px 6px 2px 4px; margin-left: -4px; flex-shrink: 0; min-width: 0; }
.tba-name:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.tba-name b { font-family: var(--font-serif) !important; font-weight: 600 !important; font-size: 16px !important; letter-spacing: 0 !important; text-transform: none !important; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.tba-n2 { display: grid; line-height: 1.1; min-width: 0; }
.tba-saved { font: 500 10px var(--font-mono); color: var(--muted); letter-spacing: .03em; white-space: nowrap; }
.tba-caret { font-style: normal; color: var(--muted); font-size: 10px; margin-left: 2px; }
.tba-rename { font: 600 15px var(--font-serif); border: 1px solid var(--accent); border-radius: 6px; padding: 3px 7px; width: 220px; background: var(--card); }
.tba-link { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 3 !important; min-width: 40px; }
.tb-app { max-width: none !important; }
.tba-gate { padding: 8px 10px; margin: 2px 2px 4px; border-radius: 7px; background: var(--warn-soft); color: var(--warn); font-size: 12.5px; line-height: 1.4; }
/* side tab blocks */
#b-upnote:empty, #b-gate:empty, #b-client-rev:empty, #b-made:empty, #b-review-host:empty { display: none; }
.b-up { border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius: 9px; background: color-mix(in srgb, var(--accent) 5%, var(--paper)); font-size: 13px; }
.b-up summary { list-style: none; cursor: pointer; padding: 10px 12px; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.b-up summary::-webkit-details-marker { display: none; }
.b-up summary i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.b-up.seen summary i { background: var(--faint); }
.b-up summary small { margin-left: auto; font: 500 11px var(--font-mono); color: var(--muted); }
.b-up ul { list-style: none; display: grid; gap: 8px; padding: 0 12px 4px; }
.b-up li { display: grid; grid-template-columns: 1fr auto; gap: 1px 10px; align-items: baseline; }
.b-up .b-up-k { grid-column: 1 / -1; font: 600 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.b-up li .side-link { font-size: 12px; }
.b-up-acts { display: flex; gap: 10px; align-items: center; padding: 8px 12px 12px; }
.b-gate { border-left: 2px solid var(--warn); padding: 2px 0 2px 12px; font-size: 13px; }
.b-gate-h { font-weight: 600; color: var(--warn); margin-bottom: 4px; }
.b-gate ul { list-style: none; display: grid; gap: 3px; }
.b-gate li button { text-align: left; color: var(--ink-soft); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; font-size: 13px; line-height: 1.4; }
.b-gate li button:hover { text-decoration-color: currentColor; }
.b-gate-ok { font-size: 12.5px; color: var(--ok); }
.b-made { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 13px; color: var(--muted); padding: 0 2px; }
.b-made .side-link { font-size: 13px; }
.b-made small { font: 500 11px var(--font-mono); }
.b-review { border-top: 1px solid var(--line); padding-top: 12px; font-size: 13px; }
.b-review summary { cursor: pointer; font: 600 10.5px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.b-review summary small { text-transform: none; letter-spacing: 0; font-weight: 500; margin-left: 6px; }
.b-review .b-rev-lead { color: var(--muted); font-size: 12.5px; margin: 8px 0; }
.b-review ul { list-style: none; display: grid; gap: 8px; }
.b-review li { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; align-items: baseline; }
.b-review li b { font-size: 13px; } .b-review li span { grid-column: 1; color: var(--ink-soft); font-size: 12.5px; line-height: 1.4; }
.b-review li .rv-tag { font: 600 9.5px var(--font-mono); letter-spacing: .05em; text-transform: uppercase; color: var(--warn); margin-left: 6px; }
.b-review li .rv-tag.ok { color: var(--ok); } .b-review li .rv-tag.bad { color: var(--alert); }
.b-review li .side-link { grid-row: 1; grid-column: 2; font-size: 12px; }
.b-cr { border: 1px solid var(--line); border-radius: 9px; padding: 12px; display: grid; gap: 10px; font-size: 13px; background: var(--card); }
.b-cr h4 { margin: 0 !important; }
.b-cr .cr-verdicts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.b-cr .cr-verdicts label { border: 1px solid var(--line); border-radius: 6px; padding: 7px 6px; text-align: center; cursor: pointer; font-size: 12.5px; }
.b-cr .cr-verdicts input { position: absolute; opacity: 0; pointer-events: none; }
.b-cr .cr-verdicts label:has(input:checked) { border-color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, transparent); font-weight: 600; }
.b-cr .cr-parts { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; max-height: 150px; overflow: auto; font-size: 12.5px; }
.b-cr .cr-parts label { display: flex; gap: 6px; align-items: center; }
.b-cr textarea, .b-cr input[type="text"] { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font-size: 13px; background: var(--paper); }
.b-cr .cr-file { font-size: 12.5px; color: var(--muted); display: flex; gap: 8px; align-items: center; }
.b-cr .cr-file input { font-size: 12px; max-width: 220px; }
.b-cr .cr-acts { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.b-cr-sum { display: grid; gap: 4px; }
.b-cr-sum .cr-v { font-weight: 600; } .b-cr-sum small { color: var(--muted); font-size: 12px; }
.b-client-bar { display: flex; gap: 10px; align-items: center; margin: 0 0 10px; padding: 8px 12px; border-radius: 8px; background: color-mix(in srgb, var(--warn) 10%, var(--paper)); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); font-size: 13px; }
.b-client-bar b { font-weight: 600; } .b-client-bar .side-link { margin-left: auto; font-size: 12.5px; }
.b-client-bar.ok { background: color-mix(in srgb, var(--ok) 9%, var(--paper)); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
.lay-2b { margin-top: 10px; }
/* selected part extras */
.sp-keep svg { width: 13px; height: 13px; vertical-align: -2px; margin-right: 4px; }
.sp-keep.on { background: var(--ink) !important; color: var(--paper) !important; border-color: var(--ink) !important; }
.sp-btn[aria-disabled="true"] { opacity: .45; cursor: not-allowed; }
.sp-note { font-size: 12px; color: var(--muted); margin-top: -4px; }
.sp-client { border-left: 2px solid var(--warn); padding: 4px 0 4px 10px; display: grid; gap: 6px; }
.sp-client blockquote { font-size: 13px; color: var(--ink-soft); font-style: italic; }
.sp-pics { display: grid; gap: 6px; }
.sp-pics .pic-li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.sp-pics .pic-li i { width: 34px; height: 24px; border-radius: 3px; background-size: cover; background-position: center; flex: none; }
.sp-pics .pic-li button { margin-left: auto; }
.nb-why { font-size: 12px !important; color: var(--muted) !important; background: none !important; border: 0 !important; text-decoration: underline; text-underline-offset: 3px; padding: 0 4px !important; }
.nb-why-in { display: flex; gap: 6px; width: 100%; } .nb-why-in input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 5px; padding: 5px 8px; font-size: 12.5px; background: var(--card); }
.ra-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
.ra-chips button[data-ra] { font-size: 12px; border: 1px solid var(--line); border-radius: 99px; padding: 3px 10px; background: var(--card); }
.ra-chips button[data-ra]:hover { border-color: var(--ink); }
.ra-n { display: inline-flex; gap: 5px; align-items: center; font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: 2px 4px 2px 10px; background: var(--card); }
.ra-n input { width: 46px; border: 0; border-bottom: 1px solid var(--line); background: transparent; font-size: 12px; text-align: center; }
.ra-n button { font-size: 11.5px; padding: 1px 8px; border-radius: 99px; background: color-mix(in srgb, var(--ink) 8%, transparent); }
.agent-card .ac-stop { margin-left: auto; align-self: center; font-size: 12px; }
/* brief page extras */
#brief-page .gi.kept .gi-kept { position: absolute; top: 6px; right: 8px; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; background: var(--ink); color: var(--paper); z-index: 3; }
#brief-page .gi .gi-kept svg { width: 10px; height: 10px; }
#brief-page .gi .gi-kept { display: none; } #brief-page .gi.kept .gi-kept { display: grid; }
#brief-page .ans-mark { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 99px; background: color-mix(in srgb, var(--ok) 13%, transparent); color: var(--ok); font: 600 10.5px/1.7 var(--font-ui); vertical-align: 1px; white-space: nowrap; }
#brief-page .gi-whynote { margin-top: 8px; padding: 7px 10px; border-left: 2px solid color-mix(in srgb, var(--b-accent, #2A2620) 45%, transparent); background: rgba(42,38,32,.04); font: 12px/1.45 var(--font-ui); color: #4A443B; }
#brief-page .gi-whynote b { font-weight: 600; margin-right: 4px; color: #2A2620; }
#brief-page .pic-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
#brief-page .pic { aspect-ratio: 4 / 3; border-radius: 3px; background-size: cover; background-position: center; position: relative; overflow: hidden; }
#brief-page .pic span { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 8px 6px; font: 600 10.5px var(--font-ui); color: #fff; background: linear-gradient(transparent, rgba(0,0,0,.55)); }
#brief-page.locked .gi-grip, #brief-page.locked .gi-resize { display: none !important; }
#brief-page .b-cover.band .b-logo, #brief-page .b-cover.band .b-logo-img { box-shadow: 0 0 0 2px rgba(255,253,248,.92); }
#brief-page .b-cover.band .b-ikind { color: rgba(255,253,248,.78) !important; }
/* loading: run bar, live tiles, the agent's question */
body[data-step="loading"] .sphere-stage { height: clamp(420px, calc(100vh - 62px - 92px - 54px - 34px - 96px), 640px) !important; }
.p33-runbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-top: 12px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); font-size: 13px; }
.p33-runbar .sp { flex: 1; }
.p33-runbar .p33-confirm, .p33-runbar .p33-stopped { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.p33-runbar .p33-stopped { color: var(--warn); }
.p33-tiles { flex-basis: 100%; order: 9; }
.p33-tiles summary { cursor: pointer; font-size: 12.5px; color: var(--muted); }
.p33-tiles .tiles { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.p33-tiles .tile { font-size: 12px; padding: 5px 10px; border-radius: 6px; border: 1px dashed var(--line); color: var(--faint); background: transparent; }
.p33-tiles .tile.done { border-style: solid; color: var(--ink-soft); background: var(--card); }
.p33-tiles .tile.done::before { content: "✓ "; color: var(--ok); }
.p33-tiles .tile.now { border-style: solid; border-color: var(--accent); color: var(--accent); }
.p33-askcard { margin-top: 12px; border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line)); border-radius: 12px; background: var(--paper); padding: 14px 16px; display: grid; gap: 10px; font-size: 13.5px; }
.p33-askcard .aq-k { font: 600 10.5px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--accent); }
.p33-askcard .aq-q { font-weight: 600; font-size: 15px; }
.p33-askcard .aq-opts { display: grid; gap: 6px; }
.p33-askcard .aq-opt { display: flex; justify-content: space-between; gap: 12px; text-align: left; border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; background: var(--card); }
.p33-askcard .aq-opt:hover { border-color: var(--ink); }
.p33-askcard .aq-opt small { font: 600 10px var(--font-mono); letter-spacing: .05em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.p33-askcard .aq-own { display: flex; gap: 8px; } .p33-askcard .aq-own input { flex: 1; border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px; background: var(--card); }
.p33-askcard.answered { border-color: var(--line); color: var(--muted); }
/* prompt: examples + labelled lenses */
.p33-examples { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; font-size: 12.5px; color: var(--muted); }
.p33-examples button { border: 1px solid var(--line); border-radius: 99px; padding: 4px 11px; background: var(--card); color: var(--ink-soft); font-size: 12.5px; }
.p33-examples button:hover { border-color: var(--ink); }
#rs-lens.p33-lens { display: flex !important; flex-wrap: wrap; gap: 6px; width: auto !important; height: auto !important; }
#rs-lens.p33-lens button { all: unset; box-sizing: border-box; cursor: pointer; font: 500 12.5px var(--font-ui); padding: 4px 11px 4px 9px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); background: transparent; display: inline-flex; align-items: center; gap: 6px; }
#rs-lens.p33-lens button::before { content: ""; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor; box-sizing: border-box; }
#rs-lens.p33-lens button.filled { color: var(--ink); border-color: var(--ink); background: var(--card); }
#rs-lens.p33-lens button.filled::before { background: currentColor; }
.rs-mk { cursor: pointer; }
/* research report */
.r-ask-grid .r-ask-f:nth-child(7) { grid-column: span 2; }
.p33-gates { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 4px; margin-top: 12px; font-size: 12.5px; }
.p33-gates .g { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--line); font: 600 11px var(--font-mono); letter-spacing: .04em; color: var(--muted); }
.p33-gates .g.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
.p33-gates .g.ok::before { content: "✓"; }
.p33-gates .g.warn { color: #B45309 !important; border-color: rgba(180,83,9,.4); background: #FEF3DC; }
.p33-gates .g.ok { color: #1D8A4E !important; border-color: rgba(29,138,78,.35); }
.p33-gates .g-sep { width: 14px; height: 1px; background: var(--line); }
.p33-gates small { margin-left: 8px; color: var(--muted); }
.p33-fold { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 10px; font-size: 13px; }
.p33-fold > summary { cursor: pointer; font: 600 10.5px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.p33-allf { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px 18px; margin-top: 12px; }
.p33-allf h5 { font: 600 10px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.p33-allf dl { display: grid; gap: 5px; } .p33-allf dl div { display: grid; grid-template-columns: 96px 1fr; gap: 8px; align-items: baseline; }
.p33-allf dt { color: var(--muted); font-size: 12px; } .p33-allf dd { font-size: 13px; }
.p33-allf .pv { font: 600 9.5px var(--font-mono); letter-spacing: .04em; text-transform: uppercase; margin-left: 6px; padding: 0 5px; border-radius: 3px; }
.p33-allf .pv.said { color: var(--ok); background: color-mix(in srgb, var(--ok) 11%, transparent); }
.p33-allf .pv.inf { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.p33-allf .none { color: var(--faint); }
.p33-legend { display: flex; gap: 14px; font-size: 11.5px; color: var(--muted); margin-top: 10px; }
.p33-req { display: grid; gap: 8px; margin-top: 10px; }
.p33-req blockquote { border-left: 2px solid var(--line); padding-left: 10px; color: var(--ink-soft); white-space: pre-line; }
.p33-req .rq-meta { font: 500 11.5px var(--font-mono); color: var(--muted); }
.p33-req .rq-files { display: flex; gap: 6px; flex-wrap: wrap; } .p33-req .rq-files span { font: 500 11.5px var(--font-mono); border: 1px solid var(--line); border-radius: 5px; padding: 2px 7px; }
.p33-req ul { list-style: none; display: grid; gap: 4px; } .p33-req li b { font-weight: 600; }
.p33-cutnote { font-size: 12.5px; color: var(--muted); font-style: italic; margin: 6px 0; }
.prov-pill.kept { color: var(--ok) !important; border-color: color-mix(in srgb, var(--ok) 35%, transparent) !important; background: color-mix(in srgb, var(--ok) 8%, transparent) !important; }
.prov-pill.cut { color: var(--muted) !important; text-decoration: line-through; }
.rp-confirm li.done > button { text-decoration: line-through; color: var(--muted); }
.rp-confirm li.done::after { content: attr(data-done); font: 600 10px var(--font-mono); letter-spacing: .05em; text-transform: uppercase; color: var(--ok); margin-left: 8px; }
.r-conf label.done { color: var(--muted); text-decoration: line-through; }
.p33-used { display: inline-block; margin-left: 8px; font: 600 9.5px var(--font-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--ok); white-space: nowrap; }
/* research inspector */
.p33-thread { display: grid; gap: 10px; margin-top: 10px; }
.at-card { border: 1px solid var(--line); border-radius: 9px; padding: 10px 12px; background: var(--card); display: grid; gap: 6px; font-size: 13px; }
.at-q { font-weight: 600; color: var(--ink); } .at-q::before { content: "You asked · "; font: 600 10px var(--font-mono); letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.at-a { color: var(--ink-soft); line-height: 1.5; }
.at-c { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; } .at-c .fid-chip { cursor: pointer; } .at-c .fid-chip.new { cursor: default; opacity: .75; }
.at-c .side-link { margin-left: auto; font-size: 12px; }
.p33-runagain { border: 1px solid var(--line); border-radius: 8px; padding: 10px; display: grid; gap: 8px; font-size: 12.5px; background: var(--card); margin-top: 8px; }
.p33-runagain .ch { display: flex; flex-wrap: wrap; gap: 5px; } .p33-runagain .ch button { border: 1px solid var(--line); border-radius: 99px; padding: 2px 9px; font-size: 12px; color: var(--muted); }
.p33-runagain .ch button[aria-pressed="true"] { border-color: var(--ink); color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, transparent); }
.p33-runagain .ra-acts { display: flex; gap: 8px; justify-content: flex-end; }
.p33-whoami { font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 10px; margin-top: 4px; }
.p33-whoami input { border: 1px solid var(--line); border-radius: 5px; padding: 3px 7px; font-size: 12px; width: 150px; background: var(--card); }
.p33-stale { border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent); background: var(--warn-soft); border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; font-size: 12.5px; color: var(--ink-soft); }
.p33-usedin { display: grid; gap: 6px; } .p33-usedin .src-uchip { justify-self: start; }
.p33-ran-acts { display: flex; gap: 12px; margin-top: 8px; }
.p33-activity { margin-top: 8px; font-size: 12.5px; } .p33-activity summary { cursor: pointer; color: var(--muted); }
.p33-activity ol { list-style: none; display: grid; gap: 4px; margin-top: 6px; } .p33-activity li { display: grid; grid-template-columns: 52px 1fr; gap: 8px; } .p33-activity li span { font: 500 11px var(--font-mono); color: var(--muted); }
#r-side .rs-top .side-save { width: 100%; }
/* decisions drawer */
.dt-node .dt-main span b { display: inline !important; font-size: inherit !important; margin: 0 !important; }
.p33-dv { margin: 2px 0 4px; flex: none !important; min-height: 34px; }
.p33-dlist { flex: none; }
.p33-dlist { display: grid; gap: 14px; }
.p33-dlist h5 { font: 600 10.5px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.p33-drow { border: 1px solid var(--line); border-radius: 9px; padding: 10px 12px; background: var(--card); display: grid; gap: 4px; font-size: 13px; margin-bottom: 6px; }
.p33-drow .dr-top { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; }
.p33-drow .dr-who { font: 500 11px var(--font-mono); color: var(--muted); }
.p33-drow .dr-acts { display: flex; gap: 12px; align-items: center; }
.p33-drow details summary { cursor: pointer; font-size: 12px; color: var(--muted); }
.p33-drow code { font: 500 11.5px var(--font-mono); color: var(--ink-soft); }
.p33-drow.human { border-left: 3px solid var(--ok); }
.p33-lineage { display: grid; gap: 0; }
.p33-lineage .ln { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.p33-lineage .ln i { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--ink); justify-self: center; }
.p33-lineage .ln.here i { background: var(--ink); }
.p33-lineage .ln small { display: block; color: var(--muted); font-size: 12px; }
/* desk extras */
.p33-desk-tools { display: flex; align-items: center; gap: 12px; margin: 0 0 18px; }
.p33-desk-tools .sp { flex: 1; }
.p33-search { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 99px; padding: 6px 12px; background: var(--paper); min-width: 240px; }
.p33-search svg { width: 15px; height: 15px; color: var(--muted); }
.p33-search input { border: 0; background: transparent; outline: none; font-size: 13.5px; width: 100%; color: var(--ink); }
.p33-more { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line); color: var(--muted); font-size: 16px; line-height: 1; }
.p33-more:hover { color: var(--ink); border-color: var(--ink); }
.p33-desk { display: grid; grid-template-columns: 1.4fr 1fr; gap: 28px; margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--line); }
.p33-desk h3 { display: flex; align-items: center; gap: 10px; font: 600 10.5px var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
.p33-desk h3 .seg-row { margin-left: auto; text-transform: none; letter-spacing: 0; }
.p33-desk h3 .seg-row button { font-size: 11.5px; padding: 3px 9px; min-height: 0; }
.p33-pick-list, .p33-worth-list { display: grid; gap: 6px; }
.p33-pk { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; align-items: center; text-align: left; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--paper); }
.p33-pk:hover { border-color: var(--ink); }
.p33-pk .pk-ico { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line); color: var(--ink-soft); }
.p33-pk .pk-ico svg { width: 15px; height: 15px; }
.p33-pk b { display: block; font-size: 13.5px; } .p33-pk small { color: var(--muted); font-size: 12px; }
.p33-pk .pk-st { font: 600 10px var(--font-mono); letter-spacing: .05em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.p33-pk .pk-st.needs { color: var(--warn); }
.p33-wl { display: grid; gap: 2px; text-align: left; padding: 10px 12px; border-left: 2px solid var(--accent-line); }
.p33-wl:hover { border-left-color: var(--accent); }
.p33-wl b { font-size: 13.5px; font-weight: 600; } .p33-wl small { color: var(--muted); font-size: 12px; }
.p33-err { color: var(--alert); font-size: 12.5px; margin-top: 4px; }
.p33-drop { position: fixed; inset: 0; z-index: 110; display: grid; place-items: center; background: color-mix(in srgb, var(--desk) 80%, transparent); pointer-events: none; }
.p33-drop[hidden] { display: none; }
.p33-drop div { border: 2px dashed var(--ink); border-radius: 16px; padding: 40px 60px; font: 600 18px var(--font-ui); background: var(--paper); }
.cp-head { position: relative; }
.cp-more-btn { position: absolute; top: 4px; right: 0; }
.cl-circle.archived { display: none !important; }
@media (max-width: 900px) { .p33-desk { grid-template-columns: 1fr; } .p33-search { min-width: 0; flex: 1; } }
/* mock panel stays out of the way */
#mock-panel.collapsed { width: auto !important; opacity: .82; }
#mock-panel.collapsed:hover { opacity: 1; }

/* top bar fits: wider bar, fixed trail, compact idle status, short needs label when tight */
.tb-locked { max-width: 1440px !important; }
.tb-trail { flex: none !important; }
#bar-status.p33-idle { width: 28px; height: 28px; min-width: 0; padding: 0 !important; justify-content: center; gap: 0 !important; border-radius: 50% !important; display: inline-flex; align-items: center; margin-left: 0 !important; }
#bar-status.p33-idle #bar-status-text { display: none; }
.tb-needs .s { display: none; }
@media (max-width: 1440px) { .tb-needs .l { display: none; } .tb-needs .s { display: inline; } }
@media (max-width: 1320px) { .tb-beta .bt { display: none; } .tb-beta { padding: 0 8px; } .tba-saved { display: none; } }
.cp-box > .cp-row { padding-left: 18px !important; }
/* dark mode */
html[data-theme="dark"] .slide-card.hero-slide .slide-num, html[data-theme="dark"] .slide-card.hero-slide .slide-foot, html[data-theme="dark"] .slide-card.hero-slide small { color: color-mix(in srgb, var(--paper) 72%, transparent) !important; }
html[data-theme="dark"] .cl-track { stroke: rgba(255,253,248,.32) !important; }
html[data-theme="dark"] .cl-disc { box-shadow: 0 0 0 1px rgba(255,253,248,.22), 0 10px 24px -10px rgba(0,0,0,.6); }
html[data-theme="dark"] .acc-sw button, html[data-theme="dark"] [data-crow] { box-shadow: 0 0 0 1px rgba(255,253,248,.38) !important; }
.rb-tn.dim { opacity: .5 !important; }
html[data-theme="dark"] .rb-tn.dim { opacity: .55 !important; }
html[data-theme="dark"] .p33-mcard, html[data-theme="dark"] .p33-pop { box-shadow: 0 24px 60px -18px rgba(0,0,0,.8); }
html[data-theme="dark"] .tb-needs { background: color-mix(in srgb, var(--warn) 18%, transparent); color: #F2B86A; border-color: color-mix(in srgb, #F2B86A 40%, transparent); }
html[data-theme="dark"] .tba-gate, html[data-theme="dark"] .p33-stale { color: #F2B86A; }
"""
rep('\n</style>', CSS33 + '\n</style>', 1)

# ── 4. JS: everything runs inside the main IIFE, before the first paint ───────────────────
JS33 = r"""
  /* ═══ Phase 33: parity homes, fixes, polish ═══ */
  (function phase33() {
    const $$ = (q, r = document) => [...r.querySelectorAll(q)];
    const ME = { name: 'Siobhán Ryan', role: 'Strategy lead' };
    const agName = () => (AGENCIES[curBrand] || AGENCIES.wk).name;
    const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const svgI = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const LOCK = svgI('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>');
    const toolIco = k => svgI(TOOL_ICON[k] || TOOL_ICON.production);
    const offline = () => document.body.classList.contains('no-mw');
    const OFFLINE_WHY = 'Needs the Napkin server. You are offline; you can still edit by hand.';
    const LOCKED_WHY = 'The brief is locked. Unlock it to change it.';
    const now = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const qsOf = p => p.items.map((t, i) => [t, i]).filter(([t]) => /\?\s*$/.test(String(t).replace(/<[^>]+>/g, '')));
    const plain = t => String(t).replace(/<[^>]+>/g, '');
    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
    let lastEdit = '2 days ago', savedAt = Date.now() - 120000, ver = 'v1.3', resState = 'open', whyAll = false, upSeen = false, CR = null, crOpen = false;
    const HUMAN = [];
    const addHuman = (what, part, partk, tool) => HUMAN.push({ id: 'd_' + (47 + HUMAN.length), t: 'Today ' + now(), who: ME.name, what, part, partk, tool: tool || 'brief', human: true, tech: 'actor=' + ME.name + ' · kind=human · signed' });
    const stampSaved = () => { savedAt = Date.now(); };
    const ago = () => { const m = Math.round((Date.now() - savedAt) / 60000); return m < 1 ? 'just now' : m + 'm ago'; };

    // ── generic popover + modal ──
    const POP = document.createElement('div'); POP.className = 'p33-pop'; POP.hidden = true; document.body.append(POP);
    let popFor = null;
    function openPop(anchor, html, align) {
      if (!POP.hidden && popFor === anchor) { POP.hidden = true; popFor = null; return false; }
      POP.innerHTML = html; POP.hidden = false; popFor = anchor;
      const r = anchor.getBoundingClientRect(), w = POP.offsetWidth;
      POP.style.top = Math.min(r.bottom + 8, innerHeight - POP.offsetHeight - 8) + 'px';
      POP.style.left = Math.max(8, Math.min(align === 'right' ? r.right - w : r.left, innerWidth - w - 8)) + 'px';
      return true;
    }
    const closePop = () => { POP.hidden = true; popFor = null; };
    document.addEventListener('click', e => { if (!POP.hidden && !e.target.closest('.p33-pop, [data-p33-anchor]')) closePop(); }, true);
    addEventListener('scroll', () => { if (!POP.hidden) closePop(); }, { passive: true });
    const MOD = document.createElement('div'); MOD.className = 'p33-modal'; MOD.hidden = true; MOD.innerHTML = '<div class="p33-mcard" role="dialog" aria-modal="true"></div>'; document.body.append(MOD);
    function openModal(html) { closePop(); MOD.querySelector('.p33-mcard').innerHTML = '<button type="button" class="p33-mx" data-p33="mclose" title="Close">×</button>' + html; MOD.hidden = false; }
    const closeModal = () => { MOD.hidden = true; };
    MOD.addEventListener('click', e => { if (e.target === MOD) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!MOD.hidden) closeModal(); if (!POP.hidden) closePop(); } });

    // ── what needs you: one count, from the real state ──
    const resOpen = () => ($('r-needs-banner') && !$('r-needs-banner').hidden) ? 1 : 0;
    const setAside = new Set();
    function needItems() {
      const out = [], d = BRIEF_DATA.mcflurry;
      d.parts.forEach(p => { if (!p.needs) return; qsOf(p).forEach(([t, i]) => { if (!(p.answers || {})[i]) out.push({ id: 'b:' + p.k + ':' + i, kind: 'brief', p, i, title: cap(plain(t).replace(/^Confirm with [^:]+:\s*/, '')), sub: 'Summer McFlurry v1.3 · ' + p.n }); }); });
      if (resOpen()) out.push({ id: 'r:f3', kind: 'research', title: 'Finding 3 · two-spoon sharing rests on 2 clips', sub: 'Irish summer treats · keep it or cut it' });
      return out;
    }
    const tbNeeds = document.createElement('button');
    tbNeeds.type = 'button'; tbNeeds.className = 'tb-needs'; tbNeeds.id = 'tb-needs'; tbNeeds.setAttribute('data-p33-anchor', '');
    $('bar-status').after(tbNeeds);
    const bsObs = () => { const bs = $('bar-status'); bs.classList.toggle('p33-idle', ['sleep', 'awake', 'needs'].includes(bs.dataset.st)); bs.title = 'Agents: ' + $('bar-status-text').textContent; };
    new MutationObserver(bsObs).observe($('bar-status'), { attributes: true, attributeFilter: ['data-st'] }); bsObs();
    function renderNeedsPill() {
      const all = needItems(), act = all.filter(x => !setAside.has(x.id));
      tbNeeds.hidden = !all.length;
      tbNeeds.classList.toggle('aside', !act.length && all.length > 0);
      tbNeeds.innerHTML = act.length ? `<i></i>${act.length}<span class="l"> need${act.length === 1 ? 's' : ''} your call</span><span class="s"> call${act.length === 1 ? '' : 's'}</span>` : `${all.length} set aside`;
      tbNeeds.title = act.length ? act.length + ' need your call' : '';
    }
    syncNeeds = function () {
      const all = needItems(), n = all.length;
      needsOpen = n;
      STATE_LABELS.needs = 'Waiting on you';
      if (curState === 'needs') $('bar-status-text').textContent = STATE_LABELS.needs;
      $('tb-decisions-cnt').textContent = String(n); $('tb-decisions-cnt').hidden = !n;
      if (n === 0 && headerMark && curState === 'needs') headerMark.set({ state: 'done', progress: 1 });
      const bq = all.filter(x => x.kind === 'brief').length;
      const its = DIAL.mcd.areas;
      its[0].items[0].st = bq ? 'needs' : (briefLocked && curBriefKey === 'mcflurry') ? 'done' : 'draft';
      its[1].items[0].st = resOpen() ? 'needs' : 'done';
      CLIENT_X.mcd.line = 'Summer McFlurry live · ' + (n ? n + ' call' + (n === 1 ? '' : 's') + ' need you' : 'nothing needs you');
      const circ = document.querySelector('.cl-circle[data-client="mcd"]');
      if (circ) { const b = circ.querySelector('.cl-badge'); if (b) { b.textContent = String(n); b.hidden = !n; } const l = circ.querySelector('.cl-line'); if (l) l.textContent = 'Summer McFlurry · ' + (n ? n + ' need you' : 'all settled'); }
      renderNeedsPill(); syncCallCard();
    };
    window.napkinResolveNeed = () => syncNeeds();
    function needsPopHtml() {
      const all = needItems(), act = all.filter(x => !setAside.has(x.id)), aside = all.filter(x => setAside.has(x.id));
      const row = x => `<div class="pp-row" style="grid-template-columns:1fr"><button type="button" data-np-open="${x.id}" style="text-align:left"><b style="font-size:13.5px">${esc(x.title)}</b><span class="pp-sub" style="display:block">${esc(x.sub)}</span></button>`
        + `<span class="pp-acts" style="justify-content:flex-start;margin-top:6px"><button type="button" class="sp-btn" data-np-ok="${x.id}">Looks right</button><button type="button" class="side-link" data-np-aside="${x.id}">${setAside.has(x.id) ? 'Bring back' : 'Set aside'}</button><button type="button" class="side-link" data-np-open="${x.id}">Open</button></span></div>`;
      return `<div class="pp-h">Needs your call · ${act.length}</div>` + (act.length ? act.map(row).join('') : '<p class="pp-sub" style="padding:6px 10px">Nothing waits on you right now.</p>')
        + (aside.length ? `<hr><div class="pp-h">Set aside · ${aside.length}</div>` + aside.map(row).join('') : '');
    }
    function resolveItem(x, how) {
      if (x.kind === 'research') { $('r-approve-finding').click(); addHuman('Kept Finding 3 as a working hypothesis (' + how + ')', 'Finding 3', 'F3', 'research'); return; }
      commitAnswer(x.p, x.i, how === 'list' ? 'Looks right (confirmed from the list)' : how);
    }
    function openItem(x) {
      closePop(); curClient = 'mcd';
      if (x.kind === 'brief') {
        curBriefKey = 'mcflurry'; curItem = DIAL.mcd.areas[0].items[0]; activeTool = 'brief'; activeStep = 'output'; syncNavigation();
        selIdx = BRIEF_DATA.mcflurry.parts.indexOf(x.p); renderBriefPage();
        setTimeout(() => { const g = $('brief-page').querySelector('.gi.sel'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      } else { curItem = DIAL.mcd.areas[1].items[0]; activeTool = 'research'; activeStep = 'output'; syncNavigation(); setTimeout(() => rsSelect('finding', 2), 60); }
    }
    document.addEventListener('click', e => {
      if (e.target.closest('#tb-needs, #bar-status')) { e.stopPropagation(); e.preventDefault(); if (!needItems().length) { showToast('Nothing needs you right now.'); return; } openPop(tbNeeds.hidden ? $('bar-status') : tbNeeds, needsPopHtml(), 'right'); return; }
      const o = e.target.closest('[data-np-open]'), ok = e.target.closest('[data-np-ok]'), as = e.target.closest('[data-np-aside]');
      if (!o && !ok && !as) return;
      e.stopPropagation();
      const id = (o || ok || as).dataset.npOpen || (o || ok || as).dataset.npOk || (o || ok || as).dataset.npAside;
      const x = needItems().find(y => y.id === id); if (!x) return;
      if (o) openItem(x);
      else if (ok) { resolveItem(x, 'list'); setAside.delete(id); syncNeeds(); if (needItems().length) POP.innerHTML = needsPopHtml(); else closePop(); }
      else { setAside.has(id) ? setAside.delete(id) : setAside.add(id); renderNeedsPill(); POP.innerHTML = needsPopHtml(); showToast(setAside.has(id) ? 'Set aside. It still needs you; find it under Set aside.' : 'Brought back.'); }
    }, true);

    // ── brief: answers, lock, keep, review ──
    function commitAnswer(p, i, v) {
      p.answers = p.answers || {}; p.answers[i] = v;
      if (qsOf(p).every(([, k]) => p.answers[k])) {
        p.needs = false; p.who = 'You · answered'; showToast('Answered. The brief no longer needs you here.');
        if (selIdx !== null && BRIEF_DATA[curBriefKey].parts[selIdx] === p) selIdx = null;
      } else showToast('Answered. ' + qsOf(p).filter(([, k]) => !p.answers[k]).length + ' more to go in this part.');
      addHuman('Answered “' + plain(p.items[i]).slice(0, 60) + '”: ' + v, p.n, p.k);
      lastEdit = 'just now'; stampSaved(); renderBriefPage(); syncNeeds();
    }
    // the built-in Yes/No/Answer also counts as an edit and is recorded
    $('look-inspector').addEventListener('click', e => { const b = e.target.closest('[data-ans]'); if (b && b.dataset.v !== '?') { lastEdit = 'just now'; stampSaved(); setTimeout(() => { addHuman('Answered a question: ' + b.dataset.v, 'Open questions & Mandatories', 'open_q'); syncNeeds(); refreshSide(); }, 0); } }, true);
    function bumpVer() { const d = BRIEF_DATA.mcflurry, nv = 'v1.' + (+ver.split('.')[1] + 1); d.sub = d.sub.replace(ver, nv); const vp = d.parts.find(p => p.k === 'version'); if (vp) vp.items = vp.items.map(t => t.replace(ver, nv)); ver = nv; }
    function setBriefLock(v) {
      if (briefLocked === v) return;
      briefLocked = v; $('brief-page').classList.toggle('locked', v);
      $('b-lock-side').textContent = v ? 'Unlock' : 'Lock the brief';
      $('b-state-chip').textContent = v ? 'Locked' : 'Draft'; $('b-state-chip').classList.toggle('locked', v); $('b-state').classList.toggle('locked', v);
      if (v) addHuman('Locked the brief (' + ver + ')', 'Whole brief', null);
      stampSaved(); renderBriefPage(); window.renderAppSlot();
    }
    document.addEventListener('click', e => {
      if (!e.target.closest('#b-lock-side')) return;
      const wasLocked = briefLocked;
      setTimeout(() => { if (briefLocked !== wasLocked) { addHuman(briefLocked ? 'Locked the brief (' + ver + ')' : 'Unlocked the brief', 'Whole brief', null); stampSaved(); } renderBriefPage(); window.renderAppSlot(); syncNeeds(); }, 0);
    }, true);
    // a locked brief cannot be changed; a kept part keeps its words
    const partOf = el => { const gi = el && el.closest && el.closest('#brief-page .gi[data-idx]'); return gi ? BRIEF_DATA[curBriefKey].parts[+gi.dataset.idx] : null; };
    document.addEventListener('dblclick', e => {
      const p = partOf(e.target); if (!p) return;
      if (briefLocked) { e.stopPropagation(); showToast(LOCKED_WHY); return; }
      if (p.keep) { e.stopPropagation(); showToast('“' + p.n + '” is kept as it is. Let it change first (Selected part → Kept).'); }
    }, true);
    document.addEventListener('click', e => {
      const b = e.target.closest('#look-inspector [data-sp-act], #brief-page [data-edit], #brief-page [data-redraft], #b-redraft-btn'); if (!b) return;
      const act = b.dataset.spAct || (b.id === 'b-redraft-btn' ? 'redraft-all' : b.dataset.edit !== undefined ? 'edit' : 'redraft');
      const p = selIdx !== null ? BRIEF_DATA[curBriefKey].parts[selIdx] : null;
      if (briefLocked) { e.stopPropagation(); showToast(LOCKED_WHY); return; }
      if (p && p.keep && (act === 'edit' || act === 'redraft')) { e.stopPropagation(); showToast('“' + p.n + '” is kept as it is. Let it change first.'); return; }
      if ((act === 'redraft' || act === 'redraft-all') && offline()) { e.stopPropagation(); showToast(OFFLINE_WHY); }
    }, true);
    document.addEventListener('dragstart', e => { if (briefLocked && e.target.closest && e.target.closest('#brief-page')) { e.preventDefault(); showToast(LOCKED_WHY); } }, true);
    document.addEventListener('pointerdown', e => { if (briefLocked && e.target.closest && e.target.closest('#brief-page .gi-resize')) { e.stopPropagation(); e.preventDefault(); } }, true);
    $('brief-page').addEventListener('focusout', e => { if (e.target.closest && e.target.closest('[data-body]')) { lastEdit = 'just now'; stampSaved(); setTimeout(refreshSide, 0); } });

    // Your pictures: boards from the material you uploaded
    const PICS0 = [{ t: 'Seafront wall, Bray', g: 'linear-gradient(165deg,#F6D27A 0%,#EE9A62 48%,#5B86B0 49%,#3E6A93 100%)' },
                   { t: 'Canal bank, Portobello', g: 'linear-gradient(175deg,#A9CFE0 0%,#EAE2C8 55%,#7C9A63 56%,#58764A 100%)' },
                   { t: 'Two spoons, one cup', g: 'radial-gradient(circle at 50% 62%,#FFFDF5 0 24%,#DA291C 25% 31%,#F3E6C8 32%)' }];
    (function addPictures() {
      const parts = BRIEF_DATA.mcflurry.parts;
      if (parts.some(p => p.k === 'pictures')) return;
      const at = parts.findIndex(p => p.k === 'tone');
      parts.splice(at + 1, 0, { k: 'pictures', n: 'Your pictures', who: 'from your uploads', as: 'prose', span: 12, items: ['Three boards from the material you uploaded.'], pics: PICS0.slice(),
        why: { decided: 'Show the uploaded boards next to the tone.', because: 'You uploaded them with the ask; they set the world better than words.', rejected: 'Stock imagery: never a studio pack-shot (Brand Clan).', certainty: 'Your uploads' } });
    })();
    const picInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    document.body.append(picInput);
    picInput.addEventListener('change', () => {
      const p = BRIEF_DATA[curBriefKey].parts.find(x => x.k === 'pictures'); if (!p) return;
      [...picInput.files].forEach(f => p.pics.push({ t: f.name.replace(/\.[^.]+$/, ''), src: URL.createObjectURL(f) }));
      showToast(picInput.files.length + ' picture' + (picInput.files.length === 1 ? '' : 's') + ' added.'); picInput.value = ''; lastEdit = 'just now'; stampSaved(); renderBriefPage();
    });

    // page decorations after every render
    function decoratePage() {
      const d = BRIEF_DATA[curBriefKey], pg = $('brief-page');
      pg.classList.toggle('locked', briefLocked);
      $$('.gi[data-idx]', pg).forEach(gi => {
        const idx = +gi.dataset.idx, p = d.parts[idx]; if (!p) return;
        gi.classList.toggle('kept', !!p.keep);
        if (!gi.querySelector('.gi-kept')) gi.insertAdjacentHTML('afterbegin', `<span class="gi-kept" title="Kept as it is">${LOCK}</span>`);
        if (briefLocked) { $$('[contenteditable]', gi).forEach(x => x.removeAttribute('contenteditable')); const gr = gi.querySelector('.gi-grip'); if (gr) gr.draggable = false; }
        const body = gi.querySelector('.gi-body'); if (!body) return;
        if (p.pics && editIdx !== idx) body.innerHTML = `<div class="pic-row">${p.pics.map(x => `<div class="pic" style="background-image:${x.src ? `url('${x.src}')` : x.g}"><span>${esc(x.t)}</span></div>`).join('') || '<p>No pictures yet. Select this part to add some.</p>'}</div>`;
        if (p.answers && editIdx !== idx) {
          const els = $$(p.as === 'bullets' ? 'li' : p.as === 'statement' ? '.stmt' : p.as === 'callout' ? '.txt' : 'p', body);
          Object.entries(p.answers).forEach(([i, a]) => { const el = els[+i]; if (el && !el.querySelector('.ans-mark')) el.insertAdjacentHTML('beforeend', `<span class="ans-mark" contenteditable="false" title="${esc(a)}">✓ ${esc(a.length > 28 ? a.slice(0, 28) + '…' : a)}</span>`); });
        }
        if (whyAll && p.why && p.as !== 'cell' && !gi.querySelector('.gi-whynote')) body.insertAdjacentHTML('afterend', `<div class="gi-whynote"><b>Why</b>${p.why.decided} <span>${p.why.because}</span></div>`);
      });
      // client review bar above the page
      let bar = $('b-client-bar');
      if (CR && curBriefKey === 'mcflurry') {
        if (!bar) { $('brief-page').insertAdjacentHTML('beforebegin', '<div class="b-client-bar" id="b-client-bar"></div>'); bar = $('b-client-bar'); }
        const left = d.parts.filter(p => p.clientAsk).length;
        bar.classList.toggle('ok', !left);
        bar.innerHTML = `<span>Client review · <b>${esc(CR.verdictLabel)}</b> · ${esc(CR.who)}</span><span>${left ? left + ' part' + (left === 1 ? '' : 's') + ' to change' : 'nothing left to change'}</span>${left ? '<button type="button" class="side-link" data-p33="cr-next">Show the next one</button>' : ''}`;
      } else if (bar) bar.remove();
    }
    function refreshSide() {
      const d = BRIEF_DATA[curBriefKey], mc = curBriefKey === 'mcflurry';
      const verOf = () => mc ? ver : ((d.parts.find(p => p.k === 'version') || { items: ['v1.0'] }).items[0] || 'v1.0').split(' ')[0];
      $('b-state-t').textContent = briefLocked ? `${verOf()} · locked by ${ME.name}, today` : `${verOf()} · edited ${lastEdit}`;
      // what blocks the lock
      const open = [];
      d.parts.forEach((p, idx) => { if (p.needs) qsOf(p).forEach(([t, i]) => { if (!(p.answers || {})[i]) open.push([idx, plain(t)]); }); });
      $('b-gate').innerHTML = briefLocked ? '' : open.length
        ? `<div class="b-gate"><div class="b-gate-h">${open.length} to settle before it can lock</div><ul>${open.map(([idx, t]) => `<li><button type="button" data-p33-goto="${idx}">${esc(cap(t.replace(/^Confirm with [^:]+:\s*/, '')))}</button></li>`).join('')}</ul></div>`
        : '<p class="b-gate-ok">Nothing blocks the lock.</p>';
      // made from
      $('b-made').innerHTML = curBriefKey === 'ballymaloe' ? '<div class="b-made"><span>Made from</span><button type="button" class="side-link" data-p33="open-research">Under-35 condiments ↗</button><small>research</small></div>'
        : mc ? '<div class="b-made"><span>Made from</span><button type="button" class="side-link" data-p33="open-research">Irish summer treats ↗</button><small>8 pinned facts · research v2</small></div>'
        : '<div class="b-made"><span>Made from your notes</span><button type="button" class="side-link" data-p33="draft-from-research">Draft from the research…</button></div>';
      // the research changed
      if (mc) {
        const ups = [['New there', 'f_014 · warm days +18% vs 2024 (context only)', 'background', 'Where we are'], ['Checked there', 'f_007 · the delivery contest resolved for Kantar, +23.4%', 'background', 'Where we are'], ['Sources disagree', 'Client deck says +31%; Kantar kept (d_044)', 'barrier', 'The barrier']];
        if (resState === 'cut') ups.unshift(['Marked wrong there', 'Finding 3 (two spoons) was cut from the report', 'rtb', 'Reasons to believe']);
        if (resState === 'kept') ups.unshift(['Checked there', 'Finding 3 kept as a working hypothesis', 'rtb', 'Reasons to believe']);
        const wasOpen = $('b-upnote').querySelector('details') && $('b-upnote').querySelector('details').open;
        $('b-upnote').innerHTML = `<details class="b-up ${upSeen ? 'seen' : ''}" ${wasOpen ? 'open' : ''}><summary><i></i>${upSeen ? 'Research updates' : 'The research changed'}<small>${ups.length}${upSeen ? ' · seen' : ''}</small></summary><ul>${ups.map(([k, t, part, pn]) => `<li><span class="b-up-k">${k}</span><span>${esc(t)}</span><button type="button" class="side-link" data-p33-goto-k="${part}">${esc(pn)}</button></li>`).join('')}</ul><div class="b-up-acts"><button type="button" class="sp-btn" data-p33="up-redraft">Draft it again</button>${upSeen ? '' : '<button type="button" class="side-link" data-p33="up-seen">Mark as seen</button>'}</div></details>`;
      } else $('b-upnote').innerHTML = '';
      // review agent's notes
      const notes = [];
      d.parts.forEach((p, idx) => {
        if (p.as === 'cell') return;
        const pins = BRIEF_PINS[p.k] || [];
        if (p.needs) notes.push([idx, p.n, 'Needs a person', '', 'Some of it needs a person: the questions in this part are still open.']);
        else if (mc && pins.includes('f_011')) notes.push([idx, p.n, resState === 'cut' ? 'Rests on something cut' : resState === 'kept' ? 'Kept by you' : 'Thin evidence', resState === 'cut' ? 'bad' : resState === 'kept' ? 'ok' : '', resState === 'cut' ? 'Cites Finding 3 (f_011), which was cut in the research.' : 'Rests on f_011: 2 TikTok clips.']);
        if (p.clientAsk) notes.push([idx, p.n, 'Client asked for a change', 'bad', p.clientAsk]);
      });
      const checked = d.parts.filter(p => p.as !== 'cell').length - new Set(notes.map(n => n[0])).size;
      const wasOpenR = $('b-review-host').querySelector('details') && $('b-review-host').querySelector('details').open;
      $('b-review-host').innerHTML = `<details class="b-review" ${wasOpenR ? 'open' : ''}><summary>Review<small>${notes.length} note${notes.length === 1 ? '' : 's'} · ${checked} parts hold up</small></summary><p class="b-rev-lead">Is this right? The Review agent checked every part against its sources.</p><ul>${notes.map(([idx, n, tag, cls, t]) => `<li><b>${esc(n)}<span class="rv-tag ${cls}">${tag}</span></b><span>${esc(t)}</span><button type="button" class="side-link" data-p33-goto="${idx}">Show</button></li>`).join('')}</ul></details>`;
      // client review
      renderClientRev();
    }
    function renderClientRev() {
      const host = $('b-client-rev'), d = BRIEF_DATA[curBriefKey];
      if (curBriefKey !== 'mcflurry') { host.innerHTML = ''; return; }
      if (crOpen) {
        const parts = d.parts.filter(p => p.as !== 'cell');
        host.innerHTML = `<form class="b-cr" id="b-cr-form"><h4>The client's answer</h4>
          <div class="cr-verdicts"><label><input type="radio" name="crv" value="accepted" ${!CR || CR.verdict === 'accepted' ? 'checked' : ''}>Accepted</label><label><input type="radio" name="crv" value="changes" ${CR && CR.verdict === 'changes' ? 'checked' : ''}>With changes</label><label><input type="radio" name="crv" value="rejected" ${CR && CR.verdict === 'rejected' ? 'checked' : ''}>Rejected</label></div>
          <div class="cr-which"><small style="color:var(--muted);font-size:12px">Which parts</small><div class="cr-parts">${parts.map(p => `<label><input type="checkbox" value="${p.k}" ${CR && CR.parts.includes(p.k) ? 'checked' : ''}>${esc(p.n)}</label>`).join('')}</div></div>
          <textarea rows="3" name="note" placeholder="Paste their email, or note what they said">${CR ? esc(CR.note) : ''}</textarea>
          <label class="cr-file">Or attach it <input type="file" accept=".eml,.msg,.pdf"></label>
          <input type="text" name="who" value="${esc(CR ? CR.who : 'Orla Brennan, McDonald’s Ireland')}" aria-label="Who answered">
          <div class="cr-acts"><button type="button" class="side-link" data-p33="cr-cancel">Cancel</button><button type="submit" class="sp-btn">Save the answer</button></div></form>`;
        return;
      }
      if (CR) { host.innerHTML = `<div class="b-cr b-cr-sum"><span class="pp-k" style="font:600 10px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Client's answer</span><span class="cr-v">${esc(CR.verdictLabel)}</span><small>${esc(CR.who)} · today${CR.file ? ' · ' + esc(CR.file) : ''}</small>${CR.note ? `<small style="font-style:italic">“${esc(CR.note.slice(0, 140))}”</small>` : ''}<button type="button" class="side-link" data-p33="cr-open" style="justify-self:start;font-size:12.5px">Change the answer</button></div>`; return; }
      host.innerHTML = briefLocked ? '<button type="button" class="sp-btn" data-p33="cr-open" style="width:100%">Record the client’s answer</button>' : '';
    }
    document.addEventListener('submit', e => {
      if (e.target.id === 'b-cr-form') {
        e.preventDefault();
        const f = e.target, v = f.querySelector('input[name="crv"]:checked').value, parts = $$('.cr-parts input:checked', f).map(x => x.value);
        const note = f.note.value.trim(), who = f.who.value.trim() || 'The client', file = (f.querySelector('input[type="file"]').files[0] || {}).name || '';
        if (v !== 'accepted' && !parts.length) { showToast('Tick the parts the client wants changed.'); return; }
        CR = { verdict: v, verdictLabel: v === 'accepted' ? 'Accepted' : v === 'changes' ? 'Accepted with changes' : 'Rejected', parts: v === 'accepted' ? [] : parts, note, who, file };
        BRIEF_DATA.mcflurry.parts.forEach(p => { p.clientAsk = CR.parts.includes(p.k) ? (note || 'The client asked for a change here.') : null; });
        crOpen = false; addHuman('Recorded the client’s answer: ' + CR.verdictLabel + (CR.parts.length ? ' (' + CR.parts.length + ' parts)' : ''), 'Whole brief', null);
        showToast('Client’s answer recorded: ' + CR.verdictLabel + '.' + (CR.parts.length ? ' Each part they flagged has "Make the change".' : ''));
        renderBriefPage();
      }
      if (e.target.id === 'cl-add-form') {
        const inp = $('cl-add-name'), err = e.target.querySelector('.p33-err');
        if (!inp.value.trim()) { e.preventDefault(); e.stopImmediatePropagation(); if (!err) inp.insertAdjacentHTML('afterend', '<p class="p33-err">Give the client a name.</p>'); inp.focus(); return; }
        if (err) err.remove();
      }
    }, true);
    const _rbp33 = renderBriefPage;
    renderBriefPage = function () { _rbp33(); try { decoratePage(); refreshSide(); syncNeeds(); } catch (err) { console.error('phase33 brief', err); } };

    // the selected part: keep, why-overrides, shorten, client asks, pictures
    const _rsp33 = renderSidePart;
    renderSidePart = function (data) {
      _rsp33(data);
      try {
        const host = $('side-part'); if (!host || host.hidden || selIdx === null) return;
        const p = data.parts[selIdx]; if (!p) return;
        const acts = host.querySelector('.sp-acts');
        if (acts && p.as !== 'cell') acts.insertAdjacentHTML('beforeend', `<button type="button" class="sp-btn sp-keep ${p.keep ? 'on' : ''}" data-p33-keep aria-pressed="${!!p.keep}" title="${p.keep ? 'Kept as it is. Click to let it change.' : 'Keep this part as it is when the brief is drafted again'}">${LOCK}${p.keep ? 'Kept' : 'Keep as is'}</button>`);
        const why = briefLocked ? LOCKED_WHY : p.keep ? 'Kept as it is. Click "Kept" to let it change.' : '';
        if (acts) {
          $$('[data-sp-act="edit"], [data-sp-act="redraft"]', acts).forEach(b => { if (why) { b.setAttribute('aria-disabled', 'true'); b.title = why; } });
          const rd = acts.querySelector('[data-sp-act="redraft"]'); if (rd && !why && offline()) { rd.setAttribute('aria-disabled', 'true'); rd.title = OFFLINE_WHY; }
          if (briefLocked) { const k = acts.querySelector('[data-p33-keep]'); if (k) { k.setAttribute('aria-disabled', 'true'); k.title = LOCKED_WHY; } }
        }
        if (briefLocked) $$('[data-sp-act="up"], [data-sp-act="down"], select[data-sp-prop]', host).forEach(b => { b.setAttribute('aria-disabled', 'true'); b.disabled = b.tagName === 'SELECT'; b.title = LOCKED_WHY; });
        const lay = host.querySelector('.sp-lay summary'); if (lay) lay.textContent = 'Place on page';
        if (p.lastNote && acts) acts.insertAdjacentHTML('afterend', `<p class="sp-note">Last redraft: “${esc(p.lastNote)}” · ${p.lastWhen || 'earlier'}</p>`);
        if (p.clientAsk) host.querySelector('.sp-name').insertAdjacentHTML('afterend', `<div class="sp-client"><span class="rsp-k">The client asked</span><blockquote>${esc(p.clientAsk)}</blockquote><button type="button" class="sp-btn" data-p33-change style="justify-self:start">Make the change</button></div>`);
        $$('.nb-q:not(.done) .nb-act', host).forEach(a => { const b = a.querySelector('[data-ans]'); if (b) a.insertAdjacentHTML('beforeend', `<button type="button" class="nb-why" data-p33-why="${b.dataset.ans}">Leave it, say why</button>`); });
        if (p.pics) {
          const box = `<div class="sp-pics"><span class="rsp-k">Your pictures · ${p.pics.length}</span>${p.pics.map((x, k) => `<div class="pic-li"><i style="background-image:${x.src ? `url('${x.src}')` : x.g}"></i>${esc(x.t)}<button type="button" class="side-link" data-p33-pic-rm="${k}" ${briefLocked ? 'aria-disabled="true"' : ''}>Remove</button></div>`).join('')}<button type="button" class="sp-btn" data-p33="pic-add" style="justify-self:start" ${briefLocked ? 'aria-disabled="true"' : ''}>+ Add pictures</button></div>`;
          (acts || host.querySelector('.sp-name')).insertAdjacentHTML('afterend', box);
        }
      } catch (err) { console.error('phase33 side', err); }
    };
    // redraft form: presets to shorten; refuse when locked / kept / offline
    const _ask33 = askRedraft;
    askRedraft = function (gi, i, whole) {
      if (briefLocked) { showToast(LOCKED_WHY); return; }
      if (offline()) { showToast(OFFLINE_WHY); return; }
      if (!whole && i !== null && BRIEF_DATA[curBriefKey].parts[i] && BRIEF_DATA[curBriefKey].parts[i].keep) { showToast('Kept as it is. Let it change first.'); return; }
      _ask33(gi, i, whole);
      const box = document.querySelector('.redraft-ask'); if (!box) return;
      const p = !whole && i !== null ? BRIEF_DATA[curBriefKey].parts[i] : null;
      const words = p ? plain(p.items.join(' ')).split(/\s+/).length : 300;
      box.querySelector('label').insertAdjacentHTML('afterend', `<div class="ra-chips"><button type="button" data-ra="third">A third shorter</button><span class="ra-n">At most <input type="number" min="5" step="5" value="${Math.max(5, Math.round(words * .6 / 5) * 5)}" aria-label="Words"> words <button type="button" data-ra="n">Use</button></span></div>`);
      const ta = box.querySelector('textarea');
      box.querySelector('[data-ra="third"]').addEventListener('click', () => { ta.value = 'Rewrite this part about a third shorter.'; ta.focus(); });
      box.querySelector('[data-ra="n"]').addEventListener('click', () => { ta.value = 'Rewrite this part in at most ' + box.querySelector('.ra-n input').value + ' words.'; ta.focus(); });
    };
    function reshape(items, ctx) {
      const m = ctx.match(/at most (\d+) words/i), third = /third shorter|shorter/i.test(ctx);
      if (!m && !third) return items;
      return items.map(t => { if (/<[^>]+>/.test(t)) return t; const w = String(t).split(/\s+/); const n = m ? +m[1] : Math.max(4, Math.round(w.length * 2 / 3)); if (w.length <= n) return t; const sents = String(t).split(/(?<=[.!?])\s+/); let out = '', c = 0; for (const x of sents) { const k = x.split(/\s+/).length; if (c + k > n) break; out += (out ? ' ' : '') + x; c += k; } return out || w.slice(0, n).join(' ').replace(/[,;:—–-]+$/, '') + (/[”"]$/.test(t) ? '…”' : '.'); });
    }
    // the redraft no longer pastes your note into the copy; kept parts stay; it can be stopped
    runRedraft = function (i, ctx) {
      const data = BRIEF_DATA[curBriefKey];
      if (offline()) { showToast(OFFLINE_WHY); return; }
      if (briefLocked) { showToast(LOCKED_WHY); return; }
      if (i !== null && data.parts[i] && data.parts[i].keep) { showToast('Kept as it is. Let it change first.'); return; }
      if (headerMark) headerMark.set({ state: 'working', progress: .5, kind: 'write' });
      const what = i === null ? 'the whole brief' : '“' + data.parts[i].n + '”';
      if (i === null) $('brief-page').classList.add('all-working');
      else { selIdx = null; editIdx = null; renderBriefPage(); const gi = $('brief-page').querySelector('.gi[data-idx="' + i + '"]'); if (gi) gi.classList.add('working'); }
      document.querySelectorAll('.agent-card').forEach(x => x.remove());
      $('look-inspector').insertAdjacentHTML('afterbegin', `<div class="agent-card"><span class="mini-agent"></span><span class="mini-orb"><i></i></span><div class="ac-t"><b>Brief agent</b><span>Redrafting ${esc(what)}</span>${ctx ? `<small>“${esc(ctx)}”</small>` : ''}</div><button type="button" class="side-link ac-stop">Stop</button></div>`);
      $('look-inspector').scrollTop = 0;
      mountMiniAgent();
      const finish = () => { unmountMiniAgent(); document.querySelectorAll('.agent-card').forEach(x => x.remove()); $('brief-page').classList.remove('all-working'); };
      const t = setTimeout(() => {
        finish();
        const kept = data.parts.filter(p => p.keep && p.as !== 'cell');
        const parts = i === null ? data.parts.filter(p => p.as !== 'cell' && !p.keep) : [data.parts[i]];
        parts.forEach(p => { p.who = 'Napkin · redrafted' + (ctx ? ' with your note' : ''); if (ctx) { p.lastNote = ctx; p.lastWhen = 'today ' + now(); p.items = reshape(p.items, ctx); } if (p.clientAsk && /^Client asked/.test(ctx || '')) { p.clientAsk = null; p.clientDone = true; } });
        lastEdit = 'just now'; stampSaved();
        addHuman('Asked for a redraft of ' + what + (ctx ? ': “' + ctx + '”' : ''), i === null ? 'Whole brief' : data.parts[i].n, i === null ? null : data.parts[i].k);
        renderBriefPage();
        if (headerMark) headerMark.set({ state: needItems().length ? 'needs' : 'done', progress: needItems().length ? .85 : 1 });
        showToast(i === null ? 'The brief was redrafted.' + (kept.length ? ' ' + kept.length + ' kept part' + (kept.length === 1 ? '' : 's') + ' stayed as written.' : ' Your layout stayed as it was.') : 'Redrafted "' + data.parts[i].n + '".');
      }, 2600);
      const stop = document.querySelector('.agent-card .ac-stop');
      if (stop) stop.addEventListener('click', e => { e.stopPropagation(); clearTimeout(t); finish(); renderBriefPage(); if (headerMark) headerMark.set({ state: needItems().length ? 'needs' : 'done', progress: .85 }); showToast('Stopped. Nothing changed.'); });
    };
    // side-tab clicks
    $('look-inspector').addEventListener('click', e => {
      const t = e.target;
      const keep = t.closest('[data-p33-keep]');
      if (keep) { e.stopPropagation(); if (briefLocked) { showToast(LOCKED_WHY); return; } const p = BRIEF_DATA[curBriefKey].parts[selIdx]; p.keep = !p.keep; addHuman((p.keep ? 'Kept “' : 'Let “') + p.n + (p.keep ? '” as it is' : '” change again'), p.n, p.k); showToast(p.keep ? '“' + p.n + '” is kept. Drafting again leaves it as it is.' : '“' + p.n + '” can change again.'); renderBriefPage(); return; }
      const why = t.closest('[data-p33-why]');
      if (why) {
        e.stopPropagation(); const act = why.closest('.nb-act'), i = +why.dataset.p33Why, p = BRIEF_DATA[curBriefKey].parts[selIdx];
        act.innerHTML = '<span class="nb-why-in"><input type="text" placeholder="Why it can stay as it is"><button type="button" class="nb-ok">Save</button></span>';
        const inp = act.querySelector('input'); inp.focus();
        const save = () => { const v = inp.value.trim(); if (!v) { showToast('Say why it can stay as it is.'); return; } commitAnswer(p, i, 'Left as it is: ' + v); };
        act.querySelector('.nb-ok').addEventListener('click', ev => { ev.stopPropagation(); save(); });
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') save(); }); inp.addEventListener('click', ev => ev.stopPropagation());
        return;
      }
      const ch = t.closest('[data-p33-change]');
      if (ch) { e.stopPropagation(); const i = selIdx, p = BRIEF_DATA[curBriefKey].parts[i]; if (briefLocked) { setBriefLock(false); bumpVer(); showToast('Unlocked as ' + ver + ' to make the client\u2019s change.'); } runRedraft(i, 'Client asked: ' + p.clientAsk); return; }
      const rm = t.closest('[data-p33-pic-rm]');
      if (rm) { e.stopPropagation(); if (briefLocked) { showToast(LOCKED_WHY); return; } const p = BRIEF_DATA[curBriefKey].parts[selIdx]; const [x] = p.pics.splice(+rm.dataset.p33PicRm, 1); showToast('Removed “' + x.t + '”.'); lastEdit = 'just now'; renderBriefPage(); return; }
      const g = t.closest('[data-p33-goto]');
      if (g) { e.stopPropagation(); selIdx = +g.dataset.p33Goto; editIdx = null; renderBriefPage(); const el = $('brief-page').querySelector('.gi[data-idx="' + selIdx + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      const gk = t.closest('[data-p33-goto-k]');
      if (gk) { e.stopPropagation(); const i = BRIEF_DATA[curBriefKey].parts.findIndex(p => p.k === gk.dataset.p33GotoK); if (i >= 0) { selIdx = i; renderBriefPage(); const el = $('brief-page').querySelector('.gi[data-idx="' + i + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
    });
    // Layout: cover and why notes get a visible home
    $('b-cover-host').append($('b-cover-seg'));
    $$('#b-why-seg button').forEach(b => b.addEventListener('click', () => { whyAll = b.dataset.why === 'show'; window.__whyOpen = whyAll; $$('#b-why-seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderBriefPage(); }));
    // Reset look also brings back removed logos and the colour
    $('b-reset-layout').addEventListener('click', () => {
      delete BT[curBriefKey]; saveBT(); briefCover = 'plain';
      $$('#b-cover-seg button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cover === 'plain')));
      $$('#b-frame-seg button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.frame === 'open')));
      $$('#b-heads-seg button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.heads === 'label')));
      renderBriefPage(); try { syncLogoBoxes(); syncColours(); } catch (err) {}
    });

    // ── exports: one Save with every format ──
    function saveMenu(which) {
      const name = which === 'brief' ? (BRIEF_DATA[curBriefKey].title + ' ' + (curBriefKey === 'mcflurry' ? ver : '')).trim() : 'Irish summer treats';
      return `<div class="pp-h">Save ${esc(name)} as</div>
        <button type="button" data-save="pdf">PDF<small>The page as it prints</small></button>
        <button type="button" data-save="html">HTML<small>A web page with the brand look</small></button>
        <button type="button" data-save="ppdf">Plain PDF<small>No colour, no logos</small></button>
        <button type="button" data-save="phtml">Plain HTML<small>Text and structure only</small></button>
        <button type="button" data-save="clan">.clan copy<small>The full record; opens in Napkin, works offline</small></button>
        <hr><label class="pp-opt"><input type="checkbox" data-save-opt="conf" ${which === 'brief' ? '' : 'checked'}> Mark it Confidential</label>
        <label class="pp-opt"><input type="checkbox" data-save-opt="appx" checked> Include the appendix (sources and questions)</label>`;
    }
    document.addEventListener('click', e => {
      const m = e.target.closest('[data-save-menu]');
      if (m) { e.stopPropagation(); POP.dataset.which = m.dataset.saveMenu; openPop(m, saveMenu(m.dataset.saveMenu), 'right'); return; }
      const s2 = e.target.closest('.p33-pop [data-save]'); if (!s2) return;
      e.stopPropagation();
      const which = POP.dataset.which, k = s2.dataset.save;
      const conf = POP.querySelector('[data-save-opt="conf"]').checked, appx = POP.querySelector('[data-save-opt="appx"]').checked;
      const base = which === 'brief' ? BRIEF_DATA[curBriefKey].title + (curBriefKey === 'mcflurry' ? ' ' + ver : '') : 'Irish summer treats';
      const ext = { pdf: '.pdf', html: '.html', ppdf: ' (plain).pdf', phtml: ' (plain).html', clan: '.clan' }[k];
      const extra = [conf && 'Confidential', appx && k !== 'clan' && 'with appendix'].filter(Boolean).join(' · ');
      closePop();
      if (k === 'pdf' || k === 'ppdf') { document.body.classList.toggle('print-plain', k === 'ppdf'); showToast('Opening the print dialog: ' + base + ext + (extra ? ' (' + extra + ')' : '') + '.'); setTimeout(() => { try { window.print(); } catch (err) {} document.body.classList.remove('print-plain'); }, 300); return; }
      stampSaved(); window.renderAppSlot();
      showToast('Saved ' + base + ext + (extra ? ' · ' + extra : '') + '.');
    }, true);

    // ── top bar: the document's own menu (rename, open, save as, details, edit, offline, lineage) ──
    const NAMES = {};
    const docKey = () => activeTool + ':' + (activeTool === 'brief' ? curBriefKey : curItem ? curItem.t : 'main');
    const OFFLINE = [{ t: 'Summer McFlurry v1.3', k: 'Brief', when: 'saved 2 days ago' }, { t: 'Irish summer treats', k: 'Research', when: 'saved yesterday' }];
    const openInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.clan,.pdf,.html', hidden: true });
    document.body.append(openInput);
    openInput.addEventListener('change', () => { const f = openInput.files[0]; if (f) { OFFLINE.unshift({ t: f.name.replace(/\.[^.]+$/, ''), k: 'Opened file', when: 'just now' }); showToast('Opened ' + f.name + '. It is in Offline copies.'); } openInput.value = ''; });
    function curDocName() { const b = $('tb-app').querySelector('.tba-name b'); return b ? b.textContent : ''; }
    const _ras33 = window.renderAppSlot;
    window.renderAppSlot = function () {
      _ras33();
      try {
        const host = $('tb-app'), nm = host.querySelector('.tba-name'); if (!nm) return;
        const t = activeTool, isDoc = t === 'deck' || activeStep === 'output';
        const b = nm.querySelector('b');
        if (t === 'deck') {
          b.textContent = curItem ? curItem.t : 'Q3 board narrative'; nm.title = 'Deck';
          if (!host.querySelector('.tba-st')) nm.insertAdjacentHTML('afterend', '<span class="tba-st">Draft</span>');
          if (!host.querySelector('[data-tba="d-cont"]')) host.querySelector('.tba-st').insertAdjacentHTML('afterend', '<button type="button" class="tba-btn tba-cont" data-tba="d-cont">Continue in ▾</button>');
        }
        if (NAMES[docKey()]) b.textContent = NAMES[docKey()];
        if (!isDoc) return;
        const locked = t === 'brief' ? briefLocked : t === 'research' && $('research-sheet').classList.contains('locked');
        const wrap = document.createElement('span'); wrap.className = 'tba-n2'; b.replaceWith(wrap); wrap.append(b);
        wrap.insertAdjacentHTML('beforeend', `<small class="tba-saved">saved ${ago()} · ${locked ? 'signed ✓' : 'valid ✓'}</small>`);
        nm.insertAdjacentHTML('beforeend', '<i class="tba-caret">▾</i>');
        nm.setAttribute('data-p33-anchor', ''); nm.setAttribute('role', 'button'); nm.tabIndex = 0; nm.title = 'Document menu · double-click to rename';
      } catch (err) { console.error('phase33 slot', err); }
    };
    function docMenu() {
      const t = activeTool;
      return `<div class="pp-h">${esc(curDocName())}</div>
        <button type="button" data-doc="rename">Rename<small>Or double-click the name</small></button>
        <button type="button" data-doc="open">Open…<small>A .clan, PDF or HTML file</small></button>
        <button type="button" data-doc="saveas">Save as…<small>A copy with a new name</small></button>
        <button type="button" data-doc="details">File details<small>Manifest, signature, what uses it</small></button>
        <button type="button" data-doc="edit">${t === 'brief' ? 'Edit the text' : 'Edit'}<small>${t === 'brief' ? 'Starts with the selected part' : 'What you can change here'}</small></button>
        <button type="button" data-doc="offline">Present offline<small>Keeps a copy that works without a connection</small></button>
        <hr><button type="button" data-doc="lineage">Where it came from<small>Its parent, what it was made from, what it fed</small></button>`;
    }
    function startRename(nm) {
      const b = nm.querySelector('b'); if (!b) return;
      const inp = document.createElement('input'); inp.className = 'tba-rename'; inp.value = b.textContent; b.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const fin = ok => { if (done) return; done = true; const v = inp.value.trim(); if (ok && v && v !== b.textContent) { NAMES[docKey()] = v; if (activeTool === 'brief') { BRIEF_DATA[curBriefKey].title = v; $('bm-tab').textContent = v; renderBriefPage(); } if (curItem && activeTool !== 'brief') curItem.t = v; stampSaved(); addHuman('Renamed the document to “' + v + '”', 'Whole document', null, activeTool); showToast('Renamed to “' + v + '”.'); } window.renderAppSlot(); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
      inp.addEventListener('blur', () => fin(true)); inp.addEventListener('click', e => e.stopPropagation());
    }
    document.addEventListener('dblclick', e => { const nm = e.target.closest('#tb-app .tba-name[data-p33-anchor]'); if (nm) { e.stopPropagation(); closePop(); startRename(nm); } }, true);
    function fileDetails() {
      const t = activeTool, nm = curDocName(), brief = t === 'brief';
      const locked = brief ? briefLocked : $('research-sheet').classList.contains('locked');
      const rows = [['Format', 'clan/1.4 · ' + (brief ? 'creative-brief' : t === 'research' ? 'research-report' : 'deck')], ['Document id', brief ? 'doc://mcd/brief/summer-mcflurry' : t === 'research' ? 'doc://mcd/research/irish-summer-treats' : 'doc://mcd/deck/q3-board'], ['Version', brief ? ver + (locked ? ' · locked' : ' · draft') : locked ? 'v2 · locked' : 'v2 · draft'], ['Saved', ago() + ' by ' + ME.name], ['Signature', locked ? 'Signed by ' + ME.name + ' · ed25519 · valid' : 'Not signed yet (signed when locked)'], ['Validation', '✓ 0 errors · 0 warnings · schema clan/1.4'], ['Parts', brief ? BRIEF_DATA[curBriefKey].parts.length + ' parts · 12 facts attached' : t === 'research' ? '3 findings · 8 pins · 9 sources' : '6 slides'], ['Size', brief ? '41 KB' : t === 'research' ? '118 KB' : '2.3 MB']];
      const used = brief ? [['Deck', 'Q3 board narrative', 'made from v1.3'], ['Research', 'Irish summer treats', 'linked']] : t === 'research' ? [['Brief', 'Summer McFlurry v1.3', '8 pins used'], ['Deck', 'Q3 board narrative', '2 facts']] : [['Brief', 'Summer McFlurry v1.3', 'its source']];
      openModal(`<h2>${esc(nm)}</h2><p class="m-sub">File details</p><h3>Manifest</h3><table class="m-tbl">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>
        <h3>Used by</h3><div class="m-list">${used.map(([k, n, w]) => `<div class="m-row"><span><b>${esc(n)}</b><small>${k} · ${w}</small></span></div>`).join('')}</div>`);
    }
    function lineage() {
      setDecisionTreeOpen(true); setDView('lineage');
    }
    document.addEventListener('click', e => {
      const nm = e.target.closest('#tb-app .tba-name[data-p33-anchor]');
      if (nm && !e.target.closest('input')) { e.stopPropagation(); openPop(nm, docMenu()); return; }
      const d = e.target.closest('.p33-pop [data-doc]'); if (!d) return;
      e.stopPropagation(); const k = d.dataset.doc; closePop();
      if (k === 'rename') { const n2 = $('tb-app').querySelector('.tba-name'); if (n2) startRename(n2); }
      else if (k === 'open') openInput.click();
      else if (k === 'saveas') { const v = curDocName() + ' (copy)'; showToast('Saved a copy: ' + v + '.clan'); OFFLINE.unshift({ t: v, k: activeTool === 'brief' ? 'Brief' : 'Research', when: 'just now' }); }
      else if (k === 'details') fileDetails();
      else if (k === 'edit') { if (activeTool === 'brief') { if (briefLocked) { showToast(LOCKED_WHY); return; } const i = selIdx !== null ? selIdx : BRIEF_DATA[curBriefKey].parts.findIndex(p => p.as !== 'cell'); startEdit(i); showToast('Editing “' + BRIEF_DATA[curBriefKey].parts[i].n + '”. Double-click any part to edit it.'); } else showToast(activeTool === 'research' ? 'Research text is written by the agents. Correct it with Verify, Mark wrong or Ask the research.' : 'Edit the slides in the deck tool.'); }
      else if (k === 'offline') { const v = curDocName(); if (!OFFLINE.some(o => o.t === v)) OFFLINE.unshift({ t: v, k: activeTool === 'brief' ? 'Brief' : activeTool === 'research' ? 'Research' : 'Deck', when: 'just now' }); showToast('Offline copy ready: ' + v + '. Present it from Offline copies, even without a connection.'); }
      else if (k === 'lineage') lineage();
    }, true);
    // Continue in: new brief from inside a brief, the brief-ready gate, and a menu for the deck
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-tba="b-cont"], [data-tba="r-cont"], [data-tba="d-cont"]'); if (!b) return;
      if (b.dataset.tba === 'd-cont') {
        e.stopPropagation(); const menu = $('tba-menu'); if (!menu) return;
        menu.innerHTML = `<div class="tba-mh">Turn it into</div><button type="button" data-p33="d-prod"><span class="tba-mi">${toolIco('production')}</span><span><b>Production</b><small>Films and stills from these slides</small></span></button><button type="button" data-p33="d-res"><span class="tba-mi">${toolIco('research')}</span><span><b>Research</b><small>A question from the deck's open points</small></span></button>`
          + `<div class="tba-mh">Link to an existing one</div><button type="button" data-link="Summer McFlurry v1.3"><span class="tba-mi">↔</span><span><b>Summer McFlurry v1.3</b><small>Brief · McDonald's Ireland</small></span></button><button type="button" data-link="Irish summer treats"><span class="tba-mi">↔</span><span><b>Irish summer treats</b><small>Research · McDonald's Ireland</small></span></button>`;
        menu.style.left = b.offsetLeft + 'px'; menu.hidden = !menu.hidden; return;
      }
      setTimeout(() => {
        const menu = $('tba-menu'); if (!menu || menu.hidden) return;
        if (b.dataset.tba === 'b-cont' && !menu.querySelector('[data-p33="newbrief"]')) menu.insertAdjacentHTML('beforeend', `<div class="tba-mh">Start fresh</div><button type="button" data-p33="newbrief"><span class="tba-mi">+</span><span><b>New brief for this client</b><small>From new notes; this one stays as it is</small></span></button>`);
        if (b.dataset.tba === 'r-cont' && !menu.querySelector('.tba-gate') && (resOpen() || !$('research-sheet').classList.contains('locked'))) menu.insertAdjacentHTML('afterbegin', `<p class="tba-gate">${resOpen() ? 'Not brief-ready yet: 1 call open (Finding 3).' : 'Brief-ready once the report is locked.'} You can still start; the brief flags what is open.</p>`);
      }, 0);
    }, true);
    document.addEventListener('click', e => { const c = e.target.closest('[data-cont="deck"]'); if (c && activeTool === 'brief') setTimeout(() => showToast('Opened Q3 board narrative, the deck made from this brief.'), 30); }, true);

    // ── account menu on the agency pill: who you are, tools, crew, offline, install, password, sign out ──
    $('header-name-pill').setAttribute('data-p33-anchor', ''); $('header-name-pill').style.cursor = 'pointer'; $('header-name-pill').title = 'Your account and studio';
    function acctMenu() {
      return `<div class="pp-me"><span class="pp-av">${initials(ME.name)}</span><span><b>${esc(ME.name)}</b><small>${ME.role} · ${esc(agName())}</small></span></div><hr>
        <button type="button" data-acct="tools">All tools<small>Every tool and template, and what is coming</small></button>
        <button type="button" data-acct="crew">Your crew<small>The agents and what each one does</small></button>
        <button type="button" data-acct="offline">Offline copies<small>${OFFLINE.length} on this device · present without a connection</small></button>
        <button type="button" data-acct="install">Install the app<small>Napkin Studio on this computer</small></button><hr>
        <button type="button" data-acct="password">Change password</button>
        <button type="button" data-acct="signout">Sign out</button>`;
    }
    const AGENTS = [['Strategy', 'Scopes the question and splits it into sub-questions.', '#8C92FF', '#1E22AA'], ['Research', 'Searches the open web and your files; reads every source.', '#F6D27A', '#B45309'], ['Knowledge', 'Pins each fact with its source to the knowledge layers.', '#9AD8B4', '#1D8A4E'], ['Synthesis', 'Finds the points: turns pins into findings.', '#F4B3C2', '#C9462A'], ['Review', 'Checks every claim; holds the thin ones for you.', '#D9D2C2', '#2A2620'], ['Brief', 'Writes and redrafts the brief, part by part.', '#FFD27A', '#DA291C'], ['Deck', 'Builds the board deck from a brief and its facts.', '#B8C8FF', '#2F6FED']];
    const TOOLS = [['brief', 'Brief', 'A one-page creative brief from notes, calls and research.', 1], ['research', 'Research', 'One sharp question; every fact pinned with a source.', 1], ['deck', 'Deck', 'A board deck from a brief and its facts.', 1], ['production', 'Production', 'Films and stills; opens the Production Tool.', 1], ['', 'Media plan', 'Channels, flighting and budget from the brief.', 0], ['', 'Social calendar', 'A month of posts from the brief and the Brand Clan.', 0], ['', 'Client report', 'What ran, what it did, from the agency record.', 0]];
    const TEMPLATES = [['Creative brief', 'The default one-page brief', true], ['Social-first brief', 'Short, platform by platform', false], ['Trade brief', 'For B2B and export buyers', false]];
    function showTools() {
      openModal(`<h2>All tools</h2><p class="m-sub">The four on the dial are live. Add a template to the dial to start from it.</p>
        <h3>Tools</h3><div class="m-grid">${TOOLS.map(([k, n, d, live]) => `<div class="m-card ${live ? '' : 'soon'}"><span class="m-tag ${live ? '' : 'soon'}">${live ? 'On the dial' : 'Coming soon'}</span><b>${n}</b><small>${d}</small>${live ? '' : `<button type="button" class="sp-btn" data-p33-soon="${n}">Tell me when</button>`}</div>`).join('')}</div>
        <h3>Brief templates</h3><div class="m-grid">${TEMPLATES.map(([n, d, on], k) => `<div class="m-card"><b>${n}</b><small>${d}</small><button type="button" class="sp-btn" data-p33-tpl="${k}">${on ? 'On the dial ✓' : 'Add to the dial'}</button></div>`).join('')}</div>`);
    }
    function showCrew() {
      openModal(`<h2>Your crew</h2><p class="m-sub">The agents that work for ${esc(agName())}. Each one signs what it does on the record.</p><div class="m-grid">${AGENTS.map(([n, d, c1, c2]) => `<div class="m-card"><span class="m-fig" style="--c1:${c1};--c2:${c2}"></span><b>${n} agent</b><small>${d}</small></div>`).join('')}</div>`);
    }
    function showOffline() {
      openModal(`<h2>Offline copies</h2><p class="m-sub">Copies kept on this device. They open and present without a connection.</p><div class="m-list">${OFFLINE.map((o, k) => `<div class="m-row"><span><b>${esc(o.t)}</b><small>${esc(o.k)} · ${esc(o.when)}</small></span><span style="display:flex;gap:8px"><button type="button" class="sp-btn" data-p33-present="${k}">Present</button><button type="button" class="side-link" data-p33-offrm="${k}">Remove</button></span></div>`).join('')}</div>
        <h3>On this device</h3><label class="pp-opt" style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" id="p33-devhome" ${window.__devHome ? 'checked' : ''}> Open the desk here without signing in (device home)</label><p class="m-sub" style="margin-top:10px">Drop a .clan file anywhere on the desk to open it.</p>`);
    }
    document.addEventListener('click', e => {
      if (e.target.closest('#header-name-pill')) { e.stopPropagation(); openPop($('header-name-pill'), acctMenu()); return; }
      const a = e.target.closest('[data-acct]'); if (!a) return;
      e.stopPropagation(); closePop(); const k = a.dataset.acct;
      if (k === 'tools') showTools(); else if (k === 'crew') showCrew(); else if (k === 'offline') showOffline();
      else if (k === 'install') openModal(`<h2>Install Napkin Studio</h2><p class="m-sub">Adds Napkin Studio to this computer. It opens in its own window and keeps your offline copies.</p><div class="m-acts"><button type="button" class="btn-rect primary" data-p33="install-go">Install</button><button type="button" class="btn-rect" data-p33="mclose">Not now</button></div>`);
      else if (k === 'password') openModal(`<h2>Change password</h2><p class="m-sub">For ${esc(ME.name)} at ${esc(agName())}.</p><form class="m-form" id="p33-pw"><label>Current password<input type="password" required></label><label>New password<input type="password" minlength="10" required></label><label>New password again<input type="password" required></label><div class="m-acts"><button type="submit" class="btn-rect primary">Change it</button><button type="button" class="btn-rect" data-p33="mclose">Cancel</button></div></form>`);
      else if (k === 'signout') signOut();
    }, true);
    document.addEventListener('submit', e => { if (e.target.id === 'p33-pw') { e.preventDefault(); const v = $$('input', e.target).map(x => x.value); if (v[1].length < 10) { showToast('Use at least 10 characters.'); return; } if (v[1] !== v[2]) { showToast('The new passwords differ.'); return; } closeModal(); showToast('Password changed.'); } if (e.target.id === 'p33-si') { e.preventDefault(); $('p33-signin').hidden = true; showToast('Signed in as ' + ME.name + '.'); } });
    const SI = document.createElement('div'); SI.className = 'p33-signin'; SI.id = 'p33-signin'; SI.hidden = true; document.body.append(SI);
    function signOut() {
      SI.innerHTML = `<form class="si-card" id="p33-si"><span class="si-mark"></span><h2>Signed out.</h2><p>Sign in to ${esc(agName())} on Napkin Studio.</p><label>Email<input type="email" value="siobhan.ryan@${curBrand === 'wk' ? 'wk' : curBrand}.com" required></label><label>Password<input type="password" value="••••••••••" required></label><button type="submit" class="btn-rect primary">Sign in</button><button type="button" class="side-link" data-p33="si-forgot" style="justify-self:start">Forgot your password?</button></form>`;
      SI.hidden = false;
    }

    // ── beta recorder: works / doesn't work ──
    const beta = document.createElement('button'); beta.type = 'button'; beta.className = 'tb-beta'; beta.id = 'tb-beta'; beta.setAttribute('data-p33-anchor', ''); beta.title = 'Beta: this session is recorded to fix what breaks';
    beta.innerHTML = '<i></i><span class="bt">Beta</span>'; $('tb-theme').before(beta);
    let recording = true;
    document.addEventListener('click', e => {
      if (e.target.closest('#tb-beta')) { e.stopPropagation(); openPop(beta, `<div class="pp-h">Beta · ${recording ? 'recording' : 'paused'}</div><p class="pp-sub" style="padding:0 10px 6px">We record this session to fix what breaks. Nothing leaves ${esc(agName())} without your say.</p><div class="pp-form"><div class="pp-acts" style="justify-content:flex-start"><button type="button" class="sp-btn" data-p33-fb="works">It works</button><button type="button" class="sp-btn" data-p33-fb="broken">It doesn't work</button></div><textarea rows="2" placeholder="What happened? (optional)"></textarea><div class="pp-acts"><button type="button" class="side-link" data-p33="rec-toggle">${recording ? 'Pause recording' : 'Resume recording'}</button><button type="button" class="sp-btn" data-p33-fb="send">Send</button></div></div>`, 'right'); return; }
      const fb = e.target.closest('[data-p33-fb]'); if (!fb) return;
      e.stopPropagation();
      if (fb.dataset.p33Fb === 'send' || fb.dataset.p33Fb === 'works' || fb.dataset.p33Fb === 'broken') { const note = POP.querySelector('textarea').value.trim(); closePop(); showToast(fb.dataset.p33Fb === 'works' ? 'Thanks. Marked as working.' : fb.dataset.p33Fb === 'broken' ? 'Thanks. The last 2 minutes are attached to your report.' : 'Sent' + (note ? ': “' + note.slice(0, 40) + '”' : '') + '.'); }
    }, true);

    // ── generic data-p33 actions ──
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-p33]'); if (!a) return;
      const k = a.dataset.p33;
      const handled = () => { e.stopPropagation(); e.preventDefault(); };
      if (a.getAttribute('aria-disabled') === 'true') { handled(); showToast(briefLocked ? LOCKED_WHY : 'Not available right now.'); return; }
      if (k === 'mclose') { handled(); closeModal(); return; }
      if (k === 'install-go') { handled(); closeModal(); showToast('Installed. Napkin Studio is in your apps.'); return; }
      if (k === 'si-forgot') { handled(); showToast('A reset link is on its way to your email.'); return; }
      if (k === 'rec-toggle') { handled(); recording = !recording; beta.classList.toggle('paused', !recording); closePop(); showToast(recording ? 'Recording again.' : 'Recording paused.'); return; }
      if (k === 'newbrief') { handled(); $('tba-menu').hidden = true; activeTool = 'brief'; activeStep = 'prompt'; curItem = null; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); showToast('New brief for ' + ((DIAL[curClient] || DIAL.mcd).full || 'this client') + '. Summer McFlurry stays as it is.'); return; }
      if (k === 'd-prod') { handled(); $('tba-menu').hidden = true; showToast('Production opens in the Production Tool (not in this mock).'); return; }
      if (k === 'd-res') { handled(); $('tba-menu').hidden = true; activeTool = 'research'; activeStep = 'prompt'; curItem = null; syncNavigation(); showToast('New research question from the deck’s open points.'); return; }
      if (k === 'open-research') { handled(); curItem = DIAL[curClient] && DIAL[curClient].areas.find(x => x.tool === 'research') ? DIAL[curClient].areas.find(x => x.tool === 'research').items[0] : null; activeTool = 'research'; activeStep = 'output'; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
      if (k === 'draft-from-research') { handled(); activeTool = 'research'; activeStep = 'output'; syncNavigation(); showToast('Pick the research, then Continue in → Brief.'); return; }
      if (k === 'up-redraft') { handled(); askRedraft(null, null, true); return; }
      if (k === 'up-seen') { handled(); upSeen = true; refreshSide(); return; }
      if (k === 'cr-open') { handled(); crOpen = true; renderClientRev(); return; }
      if (k === 'cr-cancel') { handled(); crOpen = false; renderClientRev(); return; }
      if (k === 'cr-next') { handled(); const i = BRIEF_DATA.mcflurry.parts.findIndex(p => p.clientAsk); if (i >= 0) { selIdx = i; renderBriefPage(); const el = $('brief-page').querySelector('.gi[data-idx="' + i + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
      if (k === 'pic-add') { handled(); picInput.click(); return; }
    }, true);
    document.addEventListener('click', e => {
      const s2 = e.target.closest('[data-p33-soon]'); if (s2) { e.stopPropagation(); s2.textContent = 'We’ll tell you'; s2.disabled = true; showToast(s2.dataset.p33Soon + ': we’ll tell you when it is ready.'); return; }
      const tp = e.target.closest('[data-p33-tpl]'); if (tp) { e.stopPropagation(); const T = TEMPLATES[+tp.dataset.p33Tpl]; T[2] = !T[2]; tp.textContent = T[2] ? 'On the dial ✓' : 'Add to the dial'; showToast(T[2] ? T[0] + ' is on the dial under Brief.' : T[0] + ' taken off the dial.'); return; }
      const pr = e.target.closest('[data-p33-present]'); if (pr) { e.stopPropagation(); const o = OFFLINE[+pr.dataset.p33Present]; closeModal(); showToast('Presenting ' + o.t + ' from the offline copy.'); return; }
      const rm = e.target.closest('[data-p33-offrm]'); if (rm) { e.stopPropagation(); OFFLINE.splice(+rm.dataset.p33Offrm, 1); showOffline(); return; }
      const dh = e.target.closest('#p33-devhome'); if (dh) { window.__devHome = dh.checked; showToast(dh.checked ? 'This device opens the desk without signing in.' : 'This device asks you to sign in.'); }
    }, true);

    // ── mock controls: the Napkin server can be off (shows every disabled-with-a-reason state) ──
    (function mockServer() {
      const row = $('proc-replay-btn') && $('proc-replay-btn').closest('.mock-row'); if (!row) return;
      row.insertAdjacentHTML('afterend', '<div class="mock-lbl">Napkin server</div><div class="mock-row"><button type="button" class="d-chip" data-p33-mw="on" aria-pressed="true">Online</button><button type="button" class="d-chip" data-p33-mw="off" aria-pressed="false">Offline (no middleware)</button></div>');
      $$('[data-p33-mw]').forEach(b => b.addEventListener('click', () => { const off = b.dataset.p33Mw === 'off'; document.body.classList.toggle('no-mw', off); $$('[data-p33-mw]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('b-redraft-btn').title = off ? OFFLINE_WHY : ''; $('b-redraft-btn').setAttribute('aria-disabled', String(off)); renderBriefPage(); showToast(off ? 'Napkin server off: drafting and asks show why they cannot run.' : 'Napkin server back on.'); }));
    })();

    // ── research: ask thread, lock, keep/cut, gates, fields, request, stale pin, used-in, run again ──
    runAsk = function (box, q) {
      if (offline()) { showToast(OFFLINE_WHY); return; }
      let th = box.nextElementSibling;
      if (!th || !th.classList.contains('p33-thread')) { th = document.createElement('div'); th.className = 'p33-thread'; box.after(th); }
      const job = document.createElement('div'); job.className = 'r-job';
      job.innerHTML = `<span class="r-job-dot"></span><span><b>Research agent</b> is looking: “${esc(q)}”</span><button type="button" class="side-link">Stop</button>`;
      th.prepend(job);
      const tm = setTimeout(() => {
        const [, a, cites] = ASK_ANS.find(([re]) => re.test(q));
        const card = document.createElement('div'); card.className = 'at-card';
        card.innerHTML = `<div class="at-q">${esc(q)}</div><p class="at-a">${hl(a)}</p><div class="at-c">${cites.map(c => RS_FACT[c] ? `<button type="button" class="fid-chip" data-rb-sel="fact:${c}">${c}</button>` : `<span class="fid-chip new">${c} · new pin</span>`).join('')}<button type="button" class="side-link at-again">Ask again</button></div>`;
        job.replaceWith(card); addHuman('Asked the research: “' + q + '”', 'Ask the research', null, 'research');
        showToast('Answered with ' + cites.length + ' cited pins. It is under the ask box.');
      }, 2600);
      job.querySelector('button').addEventListener('click', e => { e.stopPropagation(); clearTimeout(tm); job.remove(); showToast('Stopped.'); });
      askBoxIdle(box);
    };
    document.addEventListener('click', e => { const ag = e.target.closest('.at-again'); if (!ag) return; e.stopPropagation(); const th = ag.closest('.p33-thread'); runAsk(th.previousElementSibling, ag.closest('.at-card').querySelector('.at-q').textContent); }, true);
    let lockPass = false;
    document.addEventListener('click', e => {
      if (!e.target.closest('#r-lock') || lockPass) return;
      if ($('research-sheet').classList.contains('locked')) { setTimeout(() => { addHuman('Unlocked the report', 'Report', null, 'research'); syncResearch(); }, 0); return; }
      if (resOpen() || document.querySelector('#research-sheet .rb-rejected')) { showToast(resOpen() ? '1 call is open. Make it before the report can lock.' : 'A rejected finding is still cited. Refresh the report first.'); return; }
      e.stopPropagation();
      setTimeout(() => {
        lockPass = true;
        const t = document.createElement('button'); t.type = 'button'; t.dataset.rbAct = 'lock-go'; t.hidden = true; $('r-side').append(t); t.click(); t.remove();
        lockPass = false;
        $('r-rep-st').textContent = 'locked by ' + ME.name + ' · today'; syncResearch(); window.renderAppSlot();
      }, 0);
    }, true);
    $('r-approve-finding').addEventListener('click', () => { resState = 'kept'; setTimeout(syncResearch, 40); });
    $('r-drop-finding').addEventListener('click', () => { resState = 'cut'; setTimeout(syncResearch, 40); });
    function renumber() {
      let n = 0;
      $$('#research-sheet .rb-sec').forEach(sec => {
        if (sec.hidden || getComputedStyle(sec).display === 'none' || sec.id === 'r-answer') return;
        const sp = sec.querySelector(':scope > .rs-h > span'); if (!sp) return;
        const label = sp.textContent.replace(/^\s*\d+\s*—\s*/, '').trim();
        const txt = String(n++).padStart(2, '0') + ' — ' + label;
        if (sp.textContent !== txt) sp.textContent = txt;
      });
    }
    function decorateReport() {
      renumber();
      const li5 = $$('.rp-sum .rb-claim')[4], row5 = li5 && (li5.closest('li') || li5.parentElement);
      if (row5) { row5.hidden = resState === 'cut'; if (resState === 'cut' && !document.querySelector('.p33-cutnote.sum')) row5.insertAdjacentHTML('afterend', '<p class="p33-cutnote sum">Finding 3 was cut by you; its summary line was taken out.</p>'); }
      const fp = document.querySelector('#rp-sections .rp-fp [data-rb-sel="finding:2"]');
      if (fp && resState === 'cut') { const pp = fp.closest('.rp-fp'); if (!pp.hidden) { pp.hidden = true; pp.insertAdjacentHTML('afterend', '<p class="p33-cutnote">Finding 3 (two-spoon sharing) was cut by you · on the record.</p>'); } }
      const c1 = document.querySelector('.rp-confirm li [data-rb-sel="finding:2"]');
      if (c1 && resState !== 'open') { const li = c1.closest('li'); li.classList.add('done'); li.dataset.done = resState === 'cut' ? 'Cut' : 'Kept'; }
    }
    function gates() {
      const g = $('p33-gates'); if (!g) return;
      const locked = $('research-sheet').classList.contains('locked'), open = resOpen();
      const ready = !open && locked;
      g.innerHTML = `<span class="g ok">01 Created</span><span class="g-sep"></span><span class="g ok">02 Research</span><span class="g-sep"></span><span class="g ${ready ? 'ok' : 'warn'}">03 Brief-ready</span><small>${ready ? 'Locked and ready for a brief.' : 'Still missing: ' + [open && '1 call (Finding 3)', !locked && 'the lock'].filter(Boolean).join(' and ') + '.'}</small>`;
    }
    function syncResearch() {
      $$('#research-screen-output .prov-pill.needs').forEach(p => { if (resState === 'open') return; p.classList.remove('needs'); p.classList.add(resState === 'cut' ? 'cut' : 'kept'); const s0 = p.querySelector('span'); if (s0) s0.textContent = resState === 'cut' ? 'cut by you' : 'kept · working hypothesis'; });
      const cb = document.querySelector('.r-conf input'); if (cb && resState !== 'open' && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); cb.parentElement.classList.add('done'); }
      decorateReport(); gates(); syncNeeds(); if (activeTool === 'brief') refreshSide();
    }
    let reqAns = [['Is Northern Ireland in the market?', 'No, the Republic only', 'You said this · client-email.txt']];
    (function researchHomes() {
      // gates, all 19 fields, your request and its answers
      const src = document.querySelector('#r-ask .r-ask-src');
      const F19 = [['Who and what', [['Client', "McDonald's Ireland", 'said'], ['Brand', 'McFlurry', 'inf'], ['Product', '', ''], ['Market', 'Republic of Ireland', 'said'], ['Audience', '16–24s', 'said']]],
                   ['The job', [['Question', 'What makes 16–24s choose a treat on an Irish summer day?', 'said'], ['Objective', '+12% units, no price promotion', 'said'], ['KPI', '', ''], ['Sub-questions', '', ''], ['Decision it feeds', '', '']]],
                   ['Limits', [['Window', 'Summer 2026 · Jun–Aug', 'said'], ['Mandatories', 'Flake and Oreo; no “limited time”', 'said'], ['Budget', '', ''], ['Exclusions', '', '']]],
                   ['Context', [['Competitors', '', ''], ['Channels', '', ''], ['Prior work', '', ''], ['Sources to use', '', ''], ['Deadline', '', '']]]];
      src.insertAdjacentHTML('afterend', `<div class="p33-gates" id="p33-gates"></div>
        <details class="p33-fold"><summary>All 19 fields · 8 filled</summary><div class="p33-allf">${F19.map(([g, fs]) => `<div><h5>${g}</h5><dl>${fs.map(([k, v, pv]) => `<div><dt>${k}</dt><dd>${v ? esc(v) + `<span class="pv ${pv}">${pv === 'said' ? 'You said' : 'We inferred'}</span>` : '<span class="none">not given</span>'}</dd></div>`).join('')}</dl></div>`).join('')}</div><p class="p33-legend"><span><b style="color:var(--ok)">You said</b> · from your ask or files</span><span><b style="color:var(--accent)">We inferred</b> · check it</span><span>not given · the agents did without</span></p></details>
        <details class="p33-fold"><summary>Your request and answers</summary><div class="p33-req" id="p33-req"></div></details>`);
      renderReq(); gates();
      // report box: run again, find the points; how it ran: replay and activity
      const acts = document.querySelector('#r-report .sp-acts');
      acts.style.flexWrap = 'wrap';
      acts.insertAdjacentHTML('beforeend', '<button type="button" class="sp-btn" data-p33r="again">Run again…</button><button type="button" class="sp-btn" data-p33r="points">Find the points</button>');
      document.querySelector('#r-report .r-ran').insertAdjacentHTML('beforeend', `<div class="p33-ran-acts"><button type="button" class="side-link" data-p33r="replay">Replay run</button></div><details class="p33-activity"><summary>Activity</summary><ol><li><span>10:31</span>${esc(ME.name)} asked the question with 2 files</li><li><span>10:32</span>Strategy agent split it into 3 sub-questions</li><li><span>10:33</span>Strategy agent asked: is Northern Ireland in the market? You said no</li><li><span>10:36</span>Research agent read 9 sources, 41 queries</li><li><span>10:40</span>Knowledge agent pinned 8 facts; 1 contest</li><li><span>10:42</span>Synthesis agent found 3 points</li><li><span>10:44</span>Review agent checked every claim; held Finding 3 for you</li></ol></details>`);
      const run = $('rb-run'); if (run) run.insertAdjacentHTML('afterend', '<p style="margin-top:10px"><button type="button" class="side-link" data-p33r="replay">Replay run</button></p>');
      // who signs the checks
      const hint = document.querySelector('#r-side .rb-over .side-hint');
      if (hint) hint.insertAdjacentHTML('afterend', `<p class="p33-whoami" id="p33-whoami">Checks signed as <b>${esc(ME.name)}</b> · <button type="button" class="side-link" data-p33r="whoami">change</button></p>`);
      // Save: the same primary button as the brief, with every format
      const rp = $('r-print');
      if (rp) { rp.className = 'btn-rect primary side-save'; const wrap = document.createElement('div'); wrap.className = 'save-split'; rp.replaceWith(wrap); wrap.append(rp); wrap.insertAdjacentHTML('beforeend', '<button type="button" class="save-more" data-save-menu="research" data-p33-anchor aria-label="More ways to save" title="More ways to save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg></button>'); }
      // keep the report in step: numbering, cut lines, used-in chips, inspector extras
      if ($('rp-sections')) new MutationObserver(decorateReport).observe($('rp-sections'), { childList: true });
      const decoFacts = () => $$('#r-facts-body tr[data-fact]').forEach(tr => { const id = tr.dataset.fact; const n = Object.values(BRIEF_PINS).filter(a => a.includes(id)).length; const td = tr.children[1]; if (n && td && !td.querySelector('.p33-used')) td.insertAdjacentHTML('beforeend', `<span class="p33-used" title="Used in ${n} part${n === 1 ? '' : 's'} of Summer McFlurry v1.3">in Summer McFlurry v1.3</span>`); });
      if ($('r-facts-body')) { new MutationObserver(decoFacts).observe($('r-facts-body'), { childList: true }); decoFacts(); }
      const PART = $('r-side-part');
      const decoPart = () => {
        if (!rsSel || PART.hidden || PART.querySelector('.p33-deco')) return;
        const FP = { 0: ['f_003', 'f_004'], 1: ['f_007'], 2: ['f_011'] };
        if (rsSel.kind === 'finding') { const pins = FP[+rsSel.id] || []; const parts = new Set(); Object.entries(BRIEF_PINS).forEach(([k, a]) => { if (a.some(x => pins.includes(x))) parts.add(k); }); if (parts.size) PART.insertAdjacentHTML('beforeend', `<div class="p33-usedin p33-deco"><span class="rsp-k">Used in</span><button type="button" class="src-uchip" data-p33="open-brief-mc">Summer McFlurry v1.3 · ${parts.size} part${parts.size === 1 ? '' : 's'}</button></div>`); }
        if (rsSel.kind === 'fact' && rsSel.id === 'f_009' && !window.__p33took) PART.insertAdjacentHTML('beforeend', '<div class="p33-stale p33-deco"><span>It’s newer in the layer: <b>12.0M</b> views (this report pinned 11.2M on 04 Nov).</span><button type="button" class="sp-btn" data-p33r="take" style="justify-self:start">Take the newer value</button></div>');
        if (!PART.querySelector('.p33-deco')) PART.insertAdjacentHTML('beforeend', '<span class="p33-deco" hidden></span>');
      };
      new MutationObserver(decoPart).observe(PART, { childList: true, attributes: true, attributeFilter: ['hidden'] });
      decorateReport();
    })();
    function renderReq() {
      const h = $('p33-req'); if (!h) return;
      h.innerHTML = `<blockquote>${esc($('r-prompt-ta').value)}</blockquote><div class="rq-files"><span>client-email.txt</span><span>client-call-notes.pdf</span></div><span class="rq-meta">Asked by ${esc(ME.name)} · 05 Nov 2026, 10:31</span><ul>${reqAns.map(([q, a, w]) => `<li>${esc(q)} <b>${esc(a)}</b> <span class="rq-meta">· ${esc(w)}</span></li>`).join('')}</ul>`;
    }
    const LENS8 = ['Market', 'Category', 'Audience', 'Culture', 'Competitors', 'Channels', 'Brand', 'Client data'];
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-p33r]'); if (!b) return;
      e.stopPropagation(); const k = b.dataset.p33r;
      if (k === 'again') {
        const ex = document.querySelector('.p33-runagain'); if (ex) { ex.remove(); return; }
        b.closest('.sp-acts').insertAdjacentHTML('afterend', `<div class="p33-runagain"><span>Lenses</span><div class="ch">${LENS8.map((l, i) => `<button type="button" aria-pressed="${i < 5 || i === 7}">${l}</button>`).join('')}</div><span>Markets</span><div class="ch">${['IE', 'GB', 'NI'].map((m, i) => `<button type="button" aria-pressed="${i === 0}">${m}</button>`).join('')}</div><div class="ra-acts"><button type="button" class="side-link" data-p33r="again-x">Cancel</button><button type="button" class="sp-btn" data-p33r="again-go">Run</button></div></div>`);
        return;
      }
      if (k === 'again-x') { b.closest('.p33-runagain').remove(); return; }
      if (k === 'again-go') { if (offline()) { showToast(OFFLINE_WHY); return; } const f = b.closest('.p33-runagain'); const ls = $$('.ch:first-of-type button[aria-pressed="true"]', f).map(x => x.textContent); const ms = $$('.ch', f)[1] ? $$('button[aria-pressed="true"]', $$('.ch', f)[1]).map(x => x.textContent) : ['IE']; f.remove(); addHuman('Ran the research again: ' + ls.length + ' lenses × ' + ms.join(', '), 'Report', null, 'research'); showToast('Research agent queued: ' + ls.length + ' lenses × ' + ms.join(', ') + '. This version stays until you refresh.'); return; }
      if (k === 'points') { if (offline()) { showToast(OFFLINE_WHY); return; } b.disabled = true; b.textContent = 'Finding…'; setTimeout(() => { b.disabled = false; b.textContent = 'Find the points'; showToast('Synthesis agent found the same 3 points. Nothing changed.'); }, 1800); return; }
      if (k === 'replay') { activeTool = 'research'; activeStep = 'loading'; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); showToast('Replaying the run as it happened.'); return; }
      if (k === 'whoami') { const p = $('p33-whoami'); p.innerHTML = `Checks signed as <input type="text" value="${esc(ME.name)}"> <button type="button" class="side-link" data-p33r="whoami-ok">Save</button>`; p.querySelector('input').focus(); return; }
      if (k === 'whoami-ok') { const v = $('p33-whoami').querySelector('input').value.trim(); if (v) ME.name = v; $('p33-whoami').innerHTML = `Checks signed as <b>${esc(ME.name)}</b> · <button type="button" class="side-link" data-p33r="whoami">change</button>`; renderReq(); showToast('Checks are signed as ' + ME.name + '.'); return; }
      if (k === 'take') { window.__p33took = true; $$('#research-sheet .clf[data-rb-sel="fact:f_009"], #r-side .clf[data-rb-sel="fact:f_009"]').forEach(c => { const tn = [...c.childNodes].find(n => n.nodeType === 3 && /11\.2M/.test(n.textContent)); if (tn) tn.textContent = tn.textContent.replace('11.2M', '12.0M'); }); const td = document.querySelector('#r-facts-body tr[data-fact="f_009"]'); if (td) td.innerHTML = td.innerHTML.replace('11.2M', '12.0M'); b.closest('.p33-stale').innerHTML = '<span>Took the newer value: <b>12.0M</b>. The sentence that cites it now says so.</span>'; addHuman('Took the newer value of f_009 (12.0M)', 'f_009', null, 'research'); showToast('f_009 is now 12.0M.'); return; }
    }, true);
    document.addEventListener('click', e => { const b = e.target.closest('[data-p33="open-brief-mc"]'); if (!b) return; e.stopPropagation(); curClient = 'mcd'; curBriefKey = 'mcflurry'; curItem = DIAL.mcd.areas[0].items[0]; activeTool = 'brief'; activeStep = 'output'; syncNavigation(); renderBriefPage(); window.scrollTo({ top: 0, behavior: 'instant' }); }, true);
    // research prompt: labelled lens chips with a real selected state; markets toggle
    (function lensChips() {
      const box = $('rs-lens'); if (!box) return;
      box.classList.add('p33-lens');
      $$('button', box).forEach(b => { b.textContent = b.title; if (b.title === 'Channels' || b.title === 'Brand') { b.classList.remove('filled'); b.classList.add('none'); } b.setAttribute('aria-pressed', String(b.classList.contains('filled'))); });
      box.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTimeout(() => b.setAttribute('aria-pressed', String(b.classList.contains('filled'))), 0); });
      $$('.rs-mk').forEach(m => { m.setAttribute('role', 'button'); m.tabIndex = 0; m.addEventListener('click', () => m.classList.toggle('on')); });
    })();
    // prompts: three examples under the box
    (function examples() {
      const add = (ta, items) => { if (!ta) return; ta.insertAdjacentHTML('afterend', `<div class="p33-examples"><span>Try an example</span>${items.map(([k, n]) => `<button type="button" data-p33-ex="${k}">${n}</button>`).join('')}</div>`); };
      add($('b-prompt-ta'), [['b:mcflurry', 'Summer McFlurry'], ['b:ballymaloe', 'Better With Ballymaloe'], ['b:guinness', 'Guinness 0.0 autumn pubs']]);
      add($('r-prompt-ta'), [['r:treats', 'Irish summer treats'], ['r:relish', 'Under-35 condiments'], ['r:guinness', 'Midweek pints, alcohol-free']]);
      document.addEventListener('click', e => {
        const b = e.target.closest('[data-p33-ex]'); if (!b) return;
        e.stopPropagation(); const [t, k] = b.dataset.p33Ex.split(':');
        if (k === 'guinness') {
          if (t === 'b') { $('b-client-inp').value = 'Diageo · Guinness 0.0'; $('b-proj-inp').value = 'Autumn pub draught'; $('b-scope-inp').value = '€90k · On-trade'; $('b-prompt-ta').value = 'Guinness 0.0 is now on draught in 400 Irish pubs, but drinkers still order it by the can at home. We want autumn pub visits where 0.0 is the first round, not the last resort. €90k for on-trade and social.'; }
          else { $('r-client-inp').value = 'Diageo · Guinness 0.0'; $('r-prompt-ta').value = 'When do Irish drinkers choose an alcohol-free pint midweek, and what makes them order it in the pub rather than at home?'; }
          showToast('Loaded the example: Guinness 0.0.'); return;
        }
        const pb = document.querySelector(t === 'b' ? `[data-bpreset="${k}"]` : `[data-rpreset="${k}"]`); if (pb) pb.click();
      }, true);
    })();

    // ── loading: back, stop (with confirm), live tiles, the agent's question, skip ──
    const load = $('brief-screen-loading');
    load.querySelector('.processing-wrap').insertAdjacentHTML('afterend', `<div class="p33-runbar" id="p33-runbar"><button type="button" class="side-link" data-p33l="back">← Back to the ask</button><span id="p33-runmsg" style="color:var(--muted)"></span><span class="sp"></span><span id="p33-stopbox"></span><button type="button" class="btn-rect primary" data-p33l="open" id="p33-open"></button><details class="p33-tiles"><summary id="p33-tiles-sum">See each part as it is written</summary><div class="tiles" id="p33-tiles"></div></details></div>`);
    $('p33-runbar').insertAdjacentHTML('beforebegin', '<div id="p33-askcard"></div>');
    let stopped = false, tileN = 0, tileT = null, qDone = false, serverRun = false;
    const TILES = () => activeTool === 'research' ? ['Market · IE', 'Category · IE', 'Audience · IE', 'Culture · IE', 'Competitors · IE', 'Headline and summary', 'Gaps and contests'] : BRIEF_DATA.mcflurry.parts.filter(p => p.as !== 'cell').map(p => p.n);
    function renderTiles() { const n = TILES(); $('p33-tiles').innerHTML = n.map((t, k) => `<span class="tile ${k < tileN ? 'done' : k === tileN && !stopped && !serverRun ? 'now' : ''}">${esc(t)}</span>`).join(''); $('p33-tiles-sum').textContent = (activeTool === 'research' ? 'See each section as it is written' : 'See each part as it is written') + ' · ' + Math.min(tileN, n.length) + ' of ' + n.length; }
    function renderStopBox() { $('p33-stopbox').innerHTML = stopped ? '' : '<button type="button" class="sp-btn" data-p33l="stop">Stop</button>'; }
    function renderAskCard() {
      const h = $('p33-askcard');
      if (activeTool !== 'research' || activeStep !== 'loading' || serverRun || (curStageIdx < 1 && !qDone)) { h.innerHTML = ''; return; }
      if (qDone) { h.innerHTML = `<div class="p33-askcard answered"><span class="aq-k">You answered the Strategy agent</span><span>${esc(reqAns[0][0])} <b>${esc(reqAns[0][1])}</b></span></div>`; return; }
      if (h.querySelector('.p33-askcard')) return;
      h.innerHTML = `<div class="p33-askcard"><span class="aq-k">The Strategy agent asks</span><span class="aq-q">Is Northern Ireland in the market?</span><div class="aq-opts"><button type="button" class="aq-opt" data-p33q="No, the Republic only|You said this · client-email.txt">No, the Republic only<small>You said this</small></button><button type="button" class="aq-opt" data-p33q="Yes, the whole island|We inferred this · OMD booking">Yes, the whole island<small>We inferred this</small></button></div><div class="aq-own"><input type="text" placeholder="Or type your answer"><button type="button" class="sp-btn" data-p33q="own">Send</button></div></div>`;
      requestAnimationFrame(() => { const c = h.querySelector('.p33-askcard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    }
    function tick() {
      if (activeStep !== 'loading') { clearInterval(tileT); tileT = null; return; }
      if (!stopped && !serverRun && curStageIdx >= 1 && tileN < TILES().length) tileN++;
      renderTiles(); renderAskCard();
      const done = curStageIdx >= 3 && tileN >= TILES().length;
      $$('.flow-steps button').forEach(b => { if (done && b.dataset.qstep === 'loading') b.classList.add('done'); });
    }
    function enterLoading() {
      stopped = false; tileN = 0; qDone = false;
      serverRun = !!(curItem && curItem.st === 'working');
      const res = activeTool === 'research';
      $('p33-open').textContent = res ? 'Skip to the finished report →' : 'Skip to the finished brief →';
      $('p33-runmsg').textContent = serverRun ? `${curItem.t} is running on the server · started 3h ago · step 2 of 4. You'll get a call when it needs you.` : '';
      if (serverRun) { stopAgentStageRun(); try { renderStageStep(activeTool, 1, false); } catch (err) {} if (headerMark) headerMark.set({ state: 'working', progress: .45 }); setBarStatus('work', 'Working · step 2/4'); tileN = 2; $('p33-open').textContent = 'Open the report →'; }
      renderStopBox(); renderTiles(); renderAskCard();
      clearInterval(tileT); tileT = setInterval(tick, 650);
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-p33l], [data-p33q]'); if (!b) return;
      e.stopPropagation();
      const res = activeTool === 'research', what = res ? 'the research' : 'the draft';
      if (b.dataset.p33q) {
        const card = b.closest('.p33-askcard');
        let a, w;
        if (b.dataset.p33q === 'own') { a = card.querySelector('input').value.trim(); w = 'You typed this'; if (!a) { showToast('Type an answer, or pick one.'); return; } }
        else [a, w] = b.dataset.p33q.split('|');
        reqAns = [['Is Northern Ireland in the market?', a, w]]; qDone = true; renderAskCard(); renderReq(); showToast('Answer sent. The agents carry on.'); return;
      }
      const k = b.dataset.p33l;
      if (k === 'back') { $('proc-back-btn').click(); return; }
      if (k === 'open') { if (serverRun) { showToast(curItem.t + ' has no report yet. It keeps running; you get a call when it needs you.'); return; } $('proc-open-output-btn').click(); return; }
      if (k === 'stop') { $('p33-stopbox').innerHTML = `<span class="p33-confirm">Stop ${what}? What is done is kept. <button type="button" class="sp-btn" data-p33l="stop-yes">Yes, stop it</button><button type="button" class="side-link" data-p33l="stop-no">Keep going</button></span>`; return; }
      if (k === 'stop-no') { renderStopBox(); return; }
      if (k === 'stop-yes') {
        stopped = true; stopAgentStageRun(); if (headerMark) headerMark.set({ state: 'awake', progress: 0 }); setBarStatus('ready', 'Stopped by you');
        $('p33-stopbox').innerHTML = `<span class="p33-stopped">You stopped ${what} at step ${Math.min(curStageIdx + 1, 4)} of 4. ${tileN} ${res ? 'section' : 'part'}${tileN === 1 ? '' : 's'} kept.</span><button type="button" class="sp-btn" data-p33l="stop-open">Open what was written</button><button type="button" class="side-link" data-p33l="stop-again">Start again</button>`;
        $('p33-open').hidden = true; renderTiles(); addHuman('Stopped ' + what, res ? 'Report' : 'Whole brief', null, res ? 'research' : 'brief'); return;
      }
      if (k === 'stop-open') { activeStep = 'output'; syncNavigation(); showToast(res ? 'Opened the report so far. Sections not written yet are marked.' : 'Opened the partial draft. ' + tileN + ' parts written; the rest are marked not written yet.'); return; }
      if (k === 'stop-again') { $('p33-open').hidden = false; activeStep = 'loading'; syncNavigation(); return; }
    }, true);

    // ── desk: greeting, search, archived, adopt, pick up, worth a look, drop a .clan ──
    const archived = new Set();
    (function desk() {
      const wrap = document.querySelector('.cl-row-wrap');
      wrap.insertAdjacentHTML('afterbegin', `<div class="p33-desk-tools"><label class="p33-search">${svgI('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>')}<input type="search" id="p33-csearch" placeholder="Find a client" aria-label="Find a client"></label><span class="sp"></span><button type="button" class="side-link" id="p33-archived" data-p33-anchor>Archived · 0</button><button type="button" class="p33-more" id="p33-desk-more" data-p33-anchor title="More">⋯</button></div>`);
      $('cl-add-form').insertAdjacentHTML('afterend', `<section class="p33-desk" id="p33-desk"><div><h3>Pick up where you left off<span class="seg-row" id="p33-from"><button type="button" data-from="all" aria-pressed="true">Everyone</button><button type="button" data-from="me" aria-pressed="false">Me</button></span></h3><div class="p33-pick-list" id="p33-pick"></div></div><div><h3>Worth a look</h3><div class="p33-worth-list" id="p33-worth"></div></div></section>`);
      document.body.insertAdjacentHTML('beforeend', '<div class="p33-drop" id="p33-drop" hidden><div>Drop the .clan file to open it</div></div>');
      $('p33-csearch').addEventListener('input', () => { const q = $('p33-csearch').value.trim().toLowerCase(); $$('.cl-circle[data-client]').forEach(c => { const d = DIAL[c.dataset.client] || {}; c.style.display = !q || ((d.full || d.name || '') + ' ' + (d.sub || '')).toLowerCase().includes(q) ? '' : 'none'; }); });
      $('p33-from').addEventListener('click', e => { const b = e.target.closest('[data-from]'); if (!b) return; e.stopPropagation(); $$('#p33-from button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderPick(b.dataset.from); });
      const v = $('view-desk');
      let dragN = 0;
      v.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('p33-drop').hidden = false; } });
      v.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
      v.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('p33-drop').hidden = true; } });
      v.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('p33-drop').hidden = true; const f = e.dataTransfer.files[0]; if (!f) return; if (!/\.clan$/i.test(f.name)) { showToast('That is not a .clan file.'); return; } OFFLINE.unshift({ t: f.name.replace(/\.clan$/i, ''), k: 'Opened file', when: 'just now' }); showToast('Opened ' + f.name + ' as an offline copy. Find it under Offline copies.'); });
    })();
    function renderPick(from) {
      const L = [['brief', 'mcd', 0, 0, 'Summer McFlurry v1.3', "McDonald's Ireland · edited by you 2 days ago", 'me'], ['research', 'mcd', 1, 0, 'Irish summer treats', "McDonald's Ireland · finished 4m ago", 'me'], ['brief', 'bal', 0, 0, 'Better With Ballymaloe', 'Ballymaloe Foods · Aoife, 2 hours ago', 'team']].filter(x => from !== 'me' || x[6] === 'me');
      $('p33-pick').innerHTML = L.map(([tool, c, a, j, t, sub]) => { const it = DIAL[c].areas[a].items[j]; const st = it.st === 'needs' ? (c === 'mcd' && tool === 'brief' ? needItems().filter(x => x.kind === 'brief').length : 1) + ' call' + ((c === 'mcd' && tool === 'brief' && needItems().filter(x => x.kind === 'brief').length > 1) ? 's' : '') : it.st === 'done' ? 'Done' : it.st === 'working' ? 'Working' : 'Draft'; return `<button type="button" class="p33-pk" data-p33-pick="${c}:${a}:${j}"><span class="pk-ico">${toolIco(tool)}</span><span><b>${esc(t)}</b><small>${esc(sub)}</small></span><span class="pk-st ${it.st === 'needs' ? 'needs' : ''}">${st}</span></button>`; }).join('');
      $('p33-worth').innerHTML = [['Kantar tracker updated', 'f_007 now runs to Aug 2026 · touches Summer McFlurry', 'brief'], ['A thin finding is waiting', 'Finding 3 rests on 2 TikTok clips · Irish summer treats', 'research'], ['Bord Bia: EU retail buyers is done', 'Ready to brief from · 14 facts', 'bb']].map(([t, s2, k]) => `<button type="button" class="p33-wl" data-p33-worth="${k}"><b>${esc(t)}</b><small>${esc(s2)}</small></button>`).join('');
    }
    document.addEventListener('click', e => {
      const pk = e.target.closest('[data-p33-pick]');
      if (pk) { e.stopPropagation(); const [c, a, j] = pk.dataset.p33Pick.split(':'); const ar = DIAL[c].areas[+a], it = ar.items[+j]; curClient = c; curItem = it; if (it.preset) { const pb = document.querySelector('[data-bpreset="' + it.preset + '"]'); if (pb) pb.click(); } else if (ar.tool === 'brief') curBriefKey = 'mcflurry'; activeTool = ar.tool; activeStep = it.step || 'output'; syncNavigation(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
      const w = e.target.closest('[data-p33-worth]');
      if (w) { e.stopPropagation(); const k = w.dataset.p33Worth; if (k === 'bb') { goClient('bb'); return; } curClient = 'mcd'; if (k === 'brief') { curBriefKey = 'mcflurry'; curItem = DIAL.mcd.areas[0].items[0]; activeTool = 'brief'; activeStep = 'output'; syncNavigation(); } else openItem({ kind: 'research' }); return; }
      if (e.target.closest('#p33-archived')) {
        e.stopPropagation(); const a = $('p33-archived');
        openPop(a, `<div class="pp-h">Archived clients · ${archived.size}</div>` + (archived.size ? [...archived].map(id => `<div class="pp-row"><span><b>${esc(DIAL[id].full || DIAL[id].name)}</b><span class="pp-sub">Archived today</span></span><button type="button" class="sp-btn" data-p33-restore="${id}">Restore</button></div>`).join('') : '<p class="pp-sub" style="padding:4px 10px 8px">Nothing archived. Archive a client from its page (⋯).</p>'), 'right');
        return;
      }
      if (e.target.closest('#p33-desk-more')) { e.stopPropagation(); openPop($('p33-desk-more'), `<button type="button" data-p33-dm="adopt">Adopt clients<small>Clients on the agency roster that no one here works on yet</small></button><button type="button" data-p33-dm="open">Open a .clan file…<small>Or drop one on the desk</small></button><button type="button" data-p33-dm="offline">Offline copies<small>${OFFLINE.length} on this device</small></button>`, 'right'); return; }
      const dm = e.target.closest('[data-p33-dm]');
      if (dm) { e.stopPropagation(); closePop(); const k = dm.dataset.p33Dm; if (k === 'open') openInput.click(); else if (k === 'offline') showOffline(); else showAdopt(); return; }
      const rs = e.target.closest('[data-p33-restore]');
      if (rs) { e.stopPropagation(); const id = rs.dataset.p33Restore; archived.delete(id); const c = document.querySelector('.cl-circle[data-client="' + id + '"]'); if (c) c.classList.remove('archived'); closePop(); syncDesk(); showToast((DIAL[id].full || DIAL[id].name) + ' is back on your desk.'); return; }
      const ad = e.target.closest('[data-p33-adopt]');
      if (ad) { e.stopPropagation(); const [n, sec] = ad.dataset.p33Adopt.split('|'); ad.textContent = 'Adopted ✓'; ad.disabled = true; $('cl-add-btn').click(); $('cl-add-name').value = n; $('cl-add-sector').value = sec; closeModal(); $('cl-add-form').requestSubmit(); return; }
    }, true);
    const ROSTER = [['Kerrygold', 'Ornua · Dairy export'], ['Tayto', 'Snacks · Ireland'], ['Avonmore', 'Glanbia · Dairy']];
    function showAdopt() { openModal(`<h2>Adopt clients</h2><p class="m-sub">On the ${esc(agName())} roster, with no desk here yet. Adopting one starts its desk and its Brand Clan.</p><div class="m-list">${ROSTER.filter(([n]) => !Object.values(DIAL).some(d => d.name === n)).map(([n, s2]) => `<div class="m-row"><span><b>${esc(n)}</b><small>${esc(s2)}</small></span><button type="button" class="sp-btn" data-p33-adopt="${esc(n)}|${esc(s2)}">Adopt</button></div>`).join('') || '<p class="m-sub">Everyone on the roster has a desk.</p>'}</div>`); }
    function syncDesk() {
      if (activeTool !== 'desk') return;
      const n = $$('.cl-circle[data-client]').filter(c => !c.classList.contains('archived')).length;
      $('hero-eyebrow').textContent = 'YOUR DESK · ' + n + ' CLIENT' + (n === 1 ? '' : 'S');
      const h = new Date().getHours(), hi = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      $('hero-sub').textContent = hi + ', ' + ME.name.split(' ')[0] + '. Pick a client to open their work, or add a new one.';
      $('p33-archived').textContent = 'Archived · ' + archived.size;
      renderPick(($$('#p33-from button[aria-pressed="true"]')[0] || { dataset: { from: 'all' } }).dataset.from);
    }
    // a newly added client opens its dial and counts; the dial does not toggle shut on the first click
    document.addEventListener('click', e => {
      const c = e.target.closest('.cl-circle[data-client]'); if (!c || !c.dataset.client.startsWith('new')) return;
      const d = DIAL[c.dataset.client]; if (!d.areas.length) d.areas = APPS.map(([tool, code, name]) => ({ code, name, tool, items: [], isNew: true }));
    }, true);
    $('cl-add-form').addEventListener('submit', () => setTimeout(syncDesk, 30));

    // ── client page: real states and counts, header menu, rows open the right thing, new deck ──
    const GEN_BG = { SP: 'A two-week trial: two spoons on request in 12 Dublin restaurants, to test whether sharing lifts summer McFlurry units before the national campaign.', AP: 'Guinness 0.0 is on draught in 400 pubs, but drinkers still order it by the can at home. Autumn is the moment to make it a first-round order.' };
    const GEN_SMP = { SP: 'Two spoons, one summer.' };
    function briefKeyFor(it, cid) {
      if (it.preset === 'ballymaloe') return 'ballymaloe';
      if (/^Summer McFlurry/.test(it.t)) return 'mcflurry';
      const key = 'g_' + it.c, c = DIAL[cid] || DIAL.mcd, m = BRIEF_META[it.c] || {};
      if (!BRIEF_DATA[key]) BRIEF_DATA[key] = { title: it.t, sub: (c.full || c.name) + ' · ' + (m.version || 'v0.1').split(' ')[0] + ' · draft', foot: (c.full || c.name) + ' · Creative brief', parts: [
        { k: 'client', n: 'Client', who: 'from your notes', as: 'cell', span: 3, items: [c.full || c.name] },
        { k: 'project', n: 'Project', who: 'from your notes', as: 'cell', span: 3, items: [it.t] },
        { k: 'budget', n: 'Budget & Scope', who: 'from your notes', as: 'cell', span: 3, items: [m.budget || 'Not given yet'] },
        { k: 'version', n: 'Version', who: 'Napkin', as: 'cell', span: 3, items: [m.version || 'v0.1'] },
        { k: 'smp', n: 'Single-minded proposition', who: GEN_SMP[it.c] ? 'Napkin · first draft' : 'not written yet', as: 'statement', span: 12, items: [GEN_SMP[it.c] || 'Not written yet. Draft it again, or write it here.'] },
        { k: 'background', n: 'Where we are', who: 'from your notes', as: 'prose', span: 12, items: [GEN_BG[it.c] || 'Your notes are attached. The Brief agent has not drafted this part yet.'] },
        { k: 'open_q', n: 'Open questions & Mandatories', who: 'from your notes', as: 'bullets', span: 12, items: ['Add the mandatories from the client call.'] } ] };
      return key;
    }
    Object.entries(DIAL).forEach(([cid, c]) => (c.areas || []).forEach(a => { if (a.tool === 'brief') a.items.forEach(it => { if (it.st === 'draft' && it.step === 'prompt') it.step = 'output'; it.cid = cid; }); }));
    const _rcp33 = window.renderClientPage;
    window.renderClientPage = function () {
      syncNeeds();
      _rcp33();
      try {
        const v = $('view-client'), c = DIAL[curClient] || DIAL.mcd, head = v.querySelector('.cp-head');
        head.insertAdjacentHTML('beforeend', '<button type="button" class="p33-more cp-more-btn" id="p33-cp-more" data-p33-anchor title="Client options">⋯</button>');
        if (curClient === 'mcd') {
          const bq = needItems().filter(x => x.kind === 'brief').length;
          $$('.cp-row', v).forEach(r => { const ar = c.areas[+r.dataset.a], it = ar && ar.items[+r.dataset.j]; const st = r.querySelector('.cp-st'); if (it && it.st === 'needs' && st) st.textContent = ar.tool === 'brief' ? bq + ' call' + (bq === 1 ? '' : 's') : '1 call'; });
        }
      } catch (err) { console.error('phase33 client', err); }
    };
    document.addEventListener('click', e => {
      const row = e.target.closest('#view-client .cp-row, #brief-home-grid .home-card');
      if (row) return;
      const nd = e.target.closest('#view-client [data-new="deck"]');
      if (nd) { e.stopPropagation(); openPop(nd, '<div class="pp-h">Start a deck from</div><button type="button" data-p33-deck="Summer McFlurry v1.3">Summer McFlurry v1.3<small>Brief · its parts become the storyline</small></button><button type="button" data-p33-deck="Irish summer treats">Irish summer treats<small>Research · findings become the slides</small></button><button type="button" data-p33-deck="">A blank deck<small>Start from nothing</small></button>', 'right'); return; }
      const dk = e.target.closest('[data-p33-deck]');
      if (dk) {
        e.stopPropagation(); closePop(); const c = DIAL[curClient] || DIAL.mcd;
        let ar = c.areas.find(a => a.tool === 'deck'); if (!ar) { ar = { code: 'DK', name: 'Deck', tool: 'deck', items: [] }; c.areas.push(ar); }
        const n = ar.items.filter(x => /^Untitled deck/.test(x.t)).length;
        ar.items.unshift({ c: 'ND', t: 'Untitled deck' + (n ? ' ' + (n + 1) : ''), st: 'draft', step: 'output', from: dk.dataset.p33Deck });
        window.renderClientPage(); showToast('New deck started' + (dk.dataset.p33Deck ? ' from ' + dk.dataset.p33Deck : '') + '. It is at the top of Decks.'); return;
      }
      const rec = e.target.closest('[data-open-dtree-cp]');
      if (rec) { e.stopPropagation(); setDecisionTreeOpen(true); setDView('time'); return; }
      if (e.target.closest('#p33-cp-more')) { e.stopPropagation(); openPop($('p33-cp-more'), '<button type="button" data-p33-cp="rename">Rename<small>How the client shows across the studio</small></button><button type="button" data-p33-cp="archive">Archive<small>Off the desk; restore it any time</small></button>', 'right'); return; }
      const cp = e.target.closest('[data-p33-cp]');
      if (cp) {
        e.stopPropagation(); const id = curClient, c = DIAL[id];
        if (cp.dataset.p33Cp === 'rename') { POP.innerHTML = `<form class="pp-form" id="p33-cp-ren"><span class="pp-k">Rename</span><input type="text" value="${esc(c.full || c.name)}"><div class="pp-acts"><button type="button" class="side-link" data-p33="mclose-pop">Cancel</button><button type="submit" class="sp-btn">Save</button></div></form>`; POP.querySelector('input').select(); return; }
        closePop(); archived.add(id); const circ = document.querySelector('.cl-circle[data-client="' + id + '"]'); if (circ) circ.classList.add('archived');
        showToast((c.full || c.name) + ' archived. Restore it from Archived on the desk.'); activeTool = 'desk'; syncNavigation(); return;
      }
      const cs = e.target.closest('#p33-cswitch');
      if (cs) { e.stopPropagation(); openPop(cs, '<div class="pp-h">Switch client</div>' + Object.entries(DIAL).filter(([id]) => !archived.has(id)).map(([id, d]) => `<button type="button" data-p33-go-client="${id}">${esc(d.full || d.name)}<small>${esc(d.sub || '')}</small></button>`).join('')); return; }
      const gc = e.target.closest('[data-p33-go-client]');
      if (gc) { e.stopPropagation(); closePop(); goClient(gc.dataset.p33GoClient); return; }
      if (e.target.closest('[data-p33="mclose-pop"]')) { e.stopPropagation(); closePop(); }
    }, true);
    document.addEventListener('submit', e => {
      if (e.target.id !== 'p33-cp-ren') return;
      e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (!v) return;
      const c = DIAL[curClient]; c.full = v; c.name = v.split(' · ')[0];
      const circ = document.querySelector('.cl-circle[data-client="' + curClient + '"] .cl-name'); if (circ) circ.textContent = v;
      closePop(); window.renderClientPage(); window.renderTrail(); showToast('Renamed to ' + v + '.');
    });
    // the client chip shows on the client page too; it switches clients
    const _rt33 = window.renderTrail;
    window.renderTrail = function () {
      _rt33();
      if (activeTool !== 'client') return;
      const c = DIAL[curClient] || DIAL.mcd;
      $('tb-trail').innerHTML = `<button type="button" class="tb-client" id="p33-cswitch" data-p33-anchor title="Switch client"><span class="tb-cdot" style="background:${c.col};color:${c.ink}">${esc(c.mono)}</span>${esc(c.full || c.name)} <span style="color:var(--muted);font-size:10px;margin-left:2px">▾</span></button>`;
    };

    // ── decisions drawer: Graph · By part · By time · Lineage; approvals reach the brief ──
    const D0 = [
      { id: 'd_046', t: '28 Oct 16:10', who: 'Review agent', what: 'Rewrote the proposition: cut v1 “Summer tastes better shared” for “The best summers are measured in spoons.”', part: 'Single-minded proposition', partk: 'smp', tool: 'brief', tech: 'agent=review · v1→v3 · reason=generic' },
      { id: 'd_048', t: '28 Oct 16:12', who: 'Brief agent', what: 'Left f_014 (warm days +18%) out of the brief: context only, it lifts every treat alike.', part: 'Where we are', partk: 'background', tool: 'brief', tech: 'agent=brief · excluded=f_014 · reason=non-differentiating' },
      { id: 'd_041', t: '05 Nov 10:38', who: 'Research agent', what: 'Proposed Finding 3 from 2 TikTok clips (f_011).', part: 'Finding 3', partk: 'F3', tool: 'research', tech: 'agent=research · inputs=f_011 · confidence=low' },
      { id: 'd_042', t: '05 Nov 10:41', who: 'Synthesis agent', what: 'Read spontaneity as the insight: 68% of treat stops are unplanned (f_003, f_004).', part: 'Consumer insight', partk: 'insight', tool: 'brief', tech: 'agent=synthesis · inputs=f_003,f_004 · confidence=high' },
      { id: 'd_044', t: '05 Nov 10:42', who: 'Knowledge agent', what: 'Chose Kantar’s +23.4% YoY (f_007) over the client deck’s +31%, which blends NI and ROI with no method.', part: 'Where we are', partk: 'background', tool: 'brief', tech: 'contest=resolved · chosen=f_007 · rejected=f_008' },
      { id: 'd_045', t: '05 Nov 10:44', who: 'Review agent', what: 'Held Finding 3 for your call: it rests on 2 clips.', part: 'Open questions & Mandatories', partk: 'open_q', tool: 'brief', tech: 'agent=review · rule=thin-evidence · held=F3' }
    ];
    const body = document.querySelector('#dtree-drawer .dtree-body'), card = $('dtree-open-calls-box');
    card.insertAdjacentHTML('afterend', '<div class="seg-row p33-dv" id="p33-dv"><button type="button" data-dv="graph" aria-pressed="true">Graph</button><button type="button" data-dv="part" aria-pressed="false">By part</button><button type="button" data-dv="time" aria-pressed="false">By time</button><button type="button" data-dv="lineage" aria-pressed="false">Lineage</button></div><div class="p33-dlist" id="p33-dlist" hidden></div>');
    const graphBlocks = [...body.children].filter(x => x !== card && !/^p33-/.test(x.id || ''));
    let dView = 'graph';
    const drow = x => `<div class="p33-drow ${x.human ? 'human' : ''}"><div class="dr-top"><b>${esc(x.what)}</b></div><span class="dr-who">${esc(x.who)} · ${esc(x.t)} · ${esc(x.id)}</span><div class="dr-acts">${x.partk || x.tool === 'research' ? `<button type="button" class="side-link" data-p33-show="${x.tool}|${x.partk || ''}">Show in document</button>` : ''}<details><summary>Technical details</summary><code>${esc(x.tech)}</code></details></div></div>`;
    function renderDList() {
      const L = $('p33-dlist'), all = D0.concat(HUMAN);
      if (dView === 'part') { const g = {}; all.forEach(x => { (g[x.part] = g[x.part] || []).push(x); }); L.innerHTML = Object.entries(g).map(([p, xs]) => `<div><h5>${esc(p)} · ${xs.length}</h5>${xs.map(drow).join('')}</div>`).join(''); }
      else if (dView === 'time') L.innerHTML = '<div><h5>What happened, newest first</h5>' + all.slice().reverse().map(drow).join('') + '</div>';
      else if (dView === 'lineage') L.innerHTML = `<div><h5>Where it came from</h5><div class="p33-lineage">${[['client-email.txt · client-call-notes.pdf', 'Client uploads · 28 Oct', ''], ['Irish summer treats', 'Research v2 · 8 pins · made from the uploads', 'research'], ['Summer McFlurry v1.2', 'Brief · the parent version', ''], ['Summer McFlurry ' + ver, 'Brief · this document · made from the research', 'brief', true], ['Q3 board narrative', 'Deck · made from v1.3', 'deck']].map(([n, s2, k, here]) => `<div class="ln ${here ? 'here' : ''}"><i></i><span><b>${esc(n)}</b><small>${esc(s2)}</small></span>${k && !here ? `<button type="button" class="side-link" data-p33-show="${k}|">Open</button>` : here ? '<span class="pp-k">You are here</span>' : ''}</div>`).join('')}</div></div>`;
    }
    function setDView(v) { dView = v; graphBlocks.forEach(b => { b.hidden = v !== 'graph'; }); $('p33-dlist').hidden = v === 'graph'; $$('#p33-dv button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dv === v))); if (v !== 'graph') renderDList(); }
    $('p33-dv').addEventListener('click', e => { const b = e.target.closest('[data-dv]'); if (b) setDView(b.dataset.dv); });
    $('p33-dlist').addEventListener('click', e => {
      const b = e.target.closest('[data-p33-show]'); if (!b) return;
      const [tool, k] = b.dataset.p33Show.split('|');
      setDecisionTreeOpen(false); curClient = 'mcd';
      if (tool === 'research') { curItem = DIAL.mcd.areas[1].items[0]; activeTool = 'research'; activeStep = 'output'; syncNavigation(); if (k === 'F3') setTimeout(() => rsSelect('finding', 2), 60); return; }
      if (tool === 'deck') { curItem = DIAL.mcd.areas[2].items[0]; activeTool = 'deck'; syncNavigation(); return; }
      curBriefKey = 'mcflurry'; curItem = DIAL.mcd.areas[0].items[0]; activeTool = 'brief'; activeStep = 'output'; syncNavigation();
      const i = BRIEF_DATA.mcflurry.parts.findIndex(p => p.k === k); selIdx = i >= 0 ? i : null; renderBriefPage();
      if (i >= 0) setTimeout(() => { const el = $('brief-page').querySelector('.gi[data-idx="' + i + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
    });
    function syncCallCard() {
      if (!$('dtree-call-title')) return;
      const all = needItems(), n = all.length;
      card.classList.toggle('resolved', !n);
      $('dtree-call-title').style.color = n ? '' : 'var(--ok)';
      $('dtree-call-title').textContent = n ? n + ' open call' + (n === 1 ? ' needs' : 's need') + ' your sign-off' : 'Nothing waits for your sign-off';
      $('dtree-call-badge').className = 'badge-pill ' + (n ? 'proposed' : 'verified'); $('dtree-call-badge').textContent = n ? 'Needs you' : 'Done';
      $('dtree-call-desc').innerHTML = n ? all.map((x, k) => `${k + 1}. <b>${esc(x.title)}</b> <span style="color:var(--muted)">· ${esc(x.sub)}</span>`).join('<br>') : 'Every call is answered and on the record.';
      $('dtree-call-actions').hidden = !n;
      $('dtree-approve-all').textContent = n > 1 ? 'Approve all and lock the brief' : 'Approve and lock the brief';
    }
    const _sdo33 = setDecisionTreeOpen;
    setDecisionTreeOpen = function (open) { _sdo33(open); if (open) { syncCallCard(); if (dView !== 'graph') renderDList(); } };
    document.addEventListener('click', e => {
      if (!e.target.closest('#dtree-approve-all')) return;
      e.stopPropagation();
      const d = BRIEF_DATA.mcflurry;
      d.parts.forEach(p => { if (!p.needs) return; p.answers = p.answers || {}; qsOf(p).forEach(([, i]) => { if (!p.answers[i]) p.answers[i] = 'Yes, approved in Decisions'; }); p.needs = false; p.who = 'You · approved'; });
      if (resOpen()) { $('r-approve-finding').click(); }
      addHuman('Approved every open call in Decisions', 'Whole brief', null);
      const dn = $('dt-node-f011-badge'); if (dn) { dn.className = 'badge-pill verified'; dn.textContent = 'Approved'; }
      if (curBriefKey === 'mcflurry' && !briefLocked) setBriefLock(true); else renderBriefPage();
      syncNeeds(); if (headerMark) headerMark.set({ state: 'done', progress: 1 });
      showToast('Every call approved and on the record. The brief is locked.');
    }, true);

    // ── navigation: URL follows the app (Back works, links deep-link); per-screen headers ──
    if (params.get('tool') === 'client') activeTool = 'client';
    if (params.get('client') && DIAL[params.get('client')]) curClient = params.get('client');
    let booted = false, popping = false, lastStep = activeStep, lastTool = activeTool;
    const _sync33 = syncNavigation;
    syncNavigation = function () {
      _sync33();
      try {
        const q = new URLSearchParams(location.search);
        q.set('tool', activeTool);
        if (activeTool === 'brief' || activeTool === 'research') q.set('step', activeStep); else q.delete('step');
        if (activeTool !== 'desk') q.set('client', curClient); else q.delete('client');
        q.set('brand', curBrand);
        const u = '?' + q.toString();
        if (u !== location.search) { try { (booted && !popping ? history.pushState : history.replaceState).call(history, null, '', u); } catch (err) {} }
        // which brief is open
        if (activeTool === 'brief' && activeStep === 'output' && curItem && curItem.cid && !curItem.preset) { const k = briefKeyFor(curItem, curItem.cid); if (k !== curBriefKey) { curBriefKey = k; selIdx = null; editIdx = null; renderBriefPage(); } }
        if (activeTool === 'brief' && activeStep === 'output') { $('bm-tab').textContent = BRIEF_DATA[curBriefKey].title; refreshSide(); }
        // headers name what is open
        if ((activeTool === 'brief' || activeTool === 'research') && curItem && activeStep !== 'home') { const c = DIAL[curClient] || DIAL.mcd; $('hero-eyebrow').textContent = ((c.full || c.name) + ' · ' + curItem.t).toUpperCase(); }
        syncDesk();
        if (activeStep === 'loading' && (activeTool === 'brief' || activeTool === 'research')) enterLoading();
        else { clearInterval(tileT); tileT = null; }
        if (activeTool === 'research' && activeStep === 'output') { gates(); decorateReport(); }
        lastStep = activeStep; lastTool = activeTool;
      } catch (err) { console.error('phase33 nav', err); }
    };
    addEventListener('popstate', () => {
      const q = new URLSearchParams(location.search), t = q.get('tool') || 'desk', st = q.get('step') || 'output';
      activeTool = ['desk', 'client', 'brief', 'research', 'deck'].includes(t) ? t : 'desk';
      if (['home', 'prompt', 'loading', 'output'].includes(st)) activeStep = st;
      if (q.get('client') && DIAL[q.get('client')]) curClient = q.get('client');
      popping = true; syncNavigation(); popping = false;
    });
    setTimeout(() => { booted = true; }, 0);
    syncNeeds();
  })();
"""
rep('  renderBriefPage();\n  syncNavigation();\n  const urlBrand', JS33 + '\n  renderBriefPage();\n  syncNavigation();\n  const urlBrand')
