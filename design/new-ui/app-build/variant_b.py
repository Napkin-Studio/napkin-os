# Variant B (2026-11-08): a research workspace of its own, closer to the earlier research UIs.
# Three panes: outline / coverage / sources on the left, the report in the centre (the answer is
# selectable sentence by sentence, with a live provenance graph under it), and a wide evidence
# inspector on the right that drills answer -> finding -> pin -> source -> decision.
# Reads napkin-app-v1.html (generated; never edited) and writes napkin-app-research-b.html.
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent / 'napkin-app-v1.html'
OUT = HERE.parent / 'napkin-app-research-b.html'
s = SRC.read_text(encoding='utf-8')


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor matched {n}x, wanted {count}: {old[:80]!r}'
    s = s.replace(old, new)


# ── 1. Markup: replace the whole research output section ─────────────────────
START = '    <section id="research-screen-output" class="section-block" hidden>'
assert s.count(START) == 1, 'section start'
a = s.index(START)
END = '    </section>\n  </main>'
b = s.index(END, a) + len('    </section>')
old_sec = s[a:b]
for must in ('id="r-findings-list"', 'id="finding-3-card"', 'id="r-needs-banner"', 'id="r-side"', 'id="r-facts-body"'):
    assert must in old_sec, must
# keep the original findings block (cards + ids), only drop the inline toggleWhy and relabel the pills
fa = old_sec.index('        <div class="needs-review-banner" id="r-needs-banner">')
fb = old_sec.index('        <section id="r-contests">')
findings_block = old_sec[fa:fb]
findings_block = findings_block.replace(' onclick="toggleWhy(this)"', '')
findings_block = findings_block.replace('<span>Napkin · verified ✓</span>', '<span>Review agent · verified</span>')
findings_block = findings_block.replace('<span>Napkin · resolved conflict ✓</span>', '<span>Review agent · resolved conflict</span>')
findings_block = findings_block.replace('<span>Needs you</span> <span class="q">why?</span>', '<span>Review agent · needs you</span> <span class="q">why?</span>')
for pin in ('f_003', 'f_004', 'f_007', 'f_011', 'f_009'):
    assert findings_block.count(f'<span class="fid-chip">{pin} ') == 1, pin
    findings_block = findings_block.replace(f'<span class="fid-chip">{pin} ', f'<span class="fid-chip" data-rb-sel="fact:{pin}">{pin} ')
findings_block = findings_block.replace('<span class="fid-chip" data-rb-sel="fact:f_004">f_004 · social context +7 pts</span>',
                                        '<span class="fid-chip" data-rb-sel="fact:f_004">f_004 · social context +7 pts</span>\n                  <span class="fid-chip" data-rb-sel="fact:f_005">f_005 · CSO with friends 65%</span>')
assert 'f_005' in findings_block
findings_block = findings_block.replace('<div class="rs-h"><span>02 — Findings</span><h3>What the evidence says</h3></div>',
                                        '<div class="rs-h"><span>02 — Findings</span><h3>What the evidence says</h3></div>', 1)
findings_block = findings_block.replace('        <!-- 01 / FINDINGS -->\n        <div>', '        <!-- 02 / FINDINGS -->\n        <div class="rb-sec" id="r-findings">')
assert 'id="r-findings"' in findings_block

ask_a = old_sec.index('        <section id="r-ask">')
ask_b = old_sec.index('</section>', ask_a) + len('</section>')
ask_block = old_sec[ask_a:ask_b].replace('<section id="r-ask">', '<section id="r-ask" class="rb-sec">')

rep_a = old_sec.index('        <div class="r-report" id="r-report">')
rep_b = old_sec.index('        </div>\n        <div class="r-askside">', rep_a) + len('        </div>')
report_block = old_sec[rep_a:rep_b]
assert 'id="r-lock"' in report_block and 'id="r-refresh"' in report_block and 'class="r-conf"' in report_block

NEW_SEC = '''    <section id="research-screen-output" class="section-block rb" hidden>
      <div class="action-strip">
        <div class="action-left">
          <button type="button" class="btn-rect" data-rfilter="all" aria-pressed="true">All findings (3)</button>
          <button type="button" class="btn-rect" data-rfilter="verified" aria-pressed="false">Verified only (2)</button>
          <button type="button" class="btn-rect" data-rfilter="proposed" aria-pressed="false">Needs review (1)</button>
        </div>
        <div class="action-right">
          <button type="button" class="btn-rect primary" id="r-spin-brief">Spin off a brief with these facts →</button>
        </div>
      </div>

      <div class="brief-workspace rs-workspace rb-ws" id="r-workspace">
        <nav class="rb-rail" id="rb-rail" aria-label="Research outline">
          <div class="rb-rail-sec"><h4>Report</h4><ol class="rb-outline" id="rb-outline"></ol></div>
          <div class="rb-rail-sec"><h4>Show findings</h4><div class="seg-row" id="r-side-show"></div></div>
          <div class="rb-rail-sec"><h4>Lens × market</h4><div class="rb-minicov" id="rb-minicov"></div><span class="lens" id="r-side-lens" hidden></span></div>
          <div class="rb-rail-sec"><h4>Sources · 9 read</h4><div class="r-srcmix" id="r-srcmix"></div><p class="r-srcleg" id="r-srcleg"></p></div>
        </nav>

        <article class="research-sheet" id="research-sheet">
        <header class="r-header" id="r-header">
          <div>
            <div class="eyebrow">Research · McDonald's Ireland</div>
            <h2 class="r-question">What makes 16–24s choose a treat on an Irish summer day?</h2>
            <p style="font-size:13.5px;color:var(--muted)">Finished 05 Nov, 10:44 · 9 sources read · 8 facts pinned · 6 decisions on the record</p>
          </div>
          <span class="badge-pill verified" style="font-size:11.5px;padding:6px 12px">2 Verified · 1 Proposed</span>
        </header>
        <div class="r-stats" id="r-stats"></div>
''' + ask_block + '''
        <section class="r-answer rb-sec" id="r-answer" tabindex="0" aria-label="Answer. Select to see how it was formed">
          <div class="rs-h"><span>01 — Answer</span><h3>In short</h3></div>
          <p class="r-ans-t" id="rb-ans-t"><span class="rb-claim" data-claim="0">Irish 16–24s don't plan treats; they stretch social moments.<sup class="rb-cite">1</sup></span> <span class="rb-claim" data-claim="1"><mark class="rs-hl">68%</mark> of out-of-home treat stops are unplanned and social,<sup class="rb-cite">1</sup></span> <span class="rb-claim" data-claim="2">while delivery desserts grew <mark class="rs-hl">23.4%</mark>:<sup class="rb-cite">2</sup></span> <span class="rb-claim rb-inf" data-claim="3">indulgence moves home unless the outing gives a reason.<sup class="rb-cite">1·2</sup></span> <span class="rb-claim rb-thin" data-claim="4">The two-spoon ritual is promising, but thin.<sup class="rb-cite">3</sup></span></p>
          <div class="r-ans-c"><span class="conf" data-c="med"><i></i><i></i><i></i></span> Overall confidence · Medium <span class="rb-ans-sep">·</span> 5 sentences · 3 findings · 7 pins <span class="rb-ans-sep">·</span> <button type="button" class="side-link rb-howlink" id="rb-how">See how this was formed</button></div>
          <div class="rb-trace" id="rb-trace" hidden></div>
        </section>

''' + findings_block + '''        <section id="r-contests" class="rb-sec"><div class="rs-h"><span>03 — Where sources disagree</span><h3>One contest, resolved</h3></div><div id="rb-contest"></div></section>
        <section id="r-gaps" class="rb-sec"><div class="rs-h"><span>04 — Not found / not researched</span><h3>Gaps</h3></div><div class="rb-gaps" id="rb-gaps"></div></section>
        <section id="r-pins" class="rb-sec"><div class="rs-h"><span>05 — Pinned facts</span><h3>Every figure, with its source</h3></div>
          <div class="facts-table-wrap"><table class="facts-table rb-facts"><thead><tr><th>Pin</th><th>Fact · source · as of</th><th>Value</th><th>Conf.</th><th>Status</th></tr></thead><tbody id="r-facts-body"></tbody></table></div>
        </section>
        <section id="r-coverage" class="rb-sec"><div class="rs-h"><span>06 — Coverage</span><h3>Lens × market</h3></div><div class="r-cov" id="r-cov"></div><div class="r-askbox" data-ask="coverage" data-label="a lens we skipped"></div></section>
        <section id="r-excluded" class="rb-sec"><div class="rs-h"><span>07 — Excluded</span><h3>Read, not pinned</h3></div><div class="rb-excl" id="rb-excl"></div></section>
        <section id="r-howran" class="rb-sec"><div class="rs-h"><span>08 — How it ran</span><h3>Five agents, 41 queries, 9 sources</h3></div><div id="rb-run"></div></section>
        <section id="r-record" class="rb-sec"><div class="rs-h"><span>09 — On the record</span><h3 id="rb-log-h">6 decisions</h3></div><div id="rb-log"></div></section>
        <footer class="rb-foot">Composed by report.compose · from knowledge v2 · facts sha 9f3a·c21e · 05 Nov 2026, 10:44</footer>
        </article>

        <aside class="look-inspector rs-side rb-side" id="r-side" aria-label="Evidence inspector">
          <div class="rb-ibar" id="rb-ibar" hidden></div>
          <div class="side-part rb-part" id="r-side-part" hidden></div>
          <div class="rb-over" id="rb-over">
            <div class="rs-top" id="r-side-top"></div>
            <button type="button" class="rb-start" data-rb-sel="answer:0"><span class="rb-start-k">Start here</span><b>How the answer was formed</b><small>5 sentences → 3 findings → 7 pins → 6 sources</small></button>
            <div id="r-side-needs"></div>
''' + report_block + '''
            <div class="r-askside"><h4>Ask the research</h4><div class="r-askbox" data-ask="side" data-label="anything" data-open="1"></div></div>
            <p class="side-hint">Click the answer or any sentence in it, a finding, a pin, a source or a decision. It opens here with everything behind it.</p>
          </div>
        </aside>
      </div>
    </section>'''
s = s[:a] + NEW_SEC + s[b:]

# ── 2. CSS ───────────────────────────────────────────────────────────────────
CSS = r'''
/* ═══ Variant B: research workspace (three panes) ═══ */
#research-screen-output.rb { --rbw: min(1404px, calc(100vw - 36px)); width: var(--rbw); margin-left: calc((100% - var(--rbw)) / 2); }
#r-workspace.rb-ws { grid-template-columns: 212px minmax(0, 1fr) 432px; gap: 18px; margin-top: 4px; }
#r-workspace.rb-ws > * { min-width: 0; }
#research-sheet .facts-table-wrap { overflow-x: auto; }
#research-sheet .rb-facts td, #research-sheet .rb-facts th { padding-left: 8px; padding-right: 8px; }
.rb-rail { position: sticky; top: 76px; max-height: calc(100vh - 92px); overflow-y: auto; display: flex; flex-direction: column; gap: 20px; padding: 4px 2px 20px 0; }
.rb-rail h4 { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.rb-outline { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; border-left: 1px solid var(--line); }
.rb-outline button { width: 100%; display: flex; align-items: center; gap: 8px; text-align: left; background: none; border: 0; padding: 5px 10px; margin-left: -1px; border-left: 2px solid transparent; font: 500 13px var(--font-ui); color: var(--ink-soft); cursor: pointer; border-radius: 0 4px 4px 0; }
.rb-outline button:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.rb-outline button.on { border-left-color: var(--ink); color: var(--ink); font-weight: 650; background: color-mix(in srgb, var(--rs-hl) 22%, transparent); }
.rb-outline .rb-o-n { font: 600 10px var(--font-mono); color: var(--muted); width: 18px; flex: none; }
.rb-outline .rb-o-sub button { padding-left: 34px; font-size: 12.5px; }
.rb-outline .rb-o-c { margin-left: auto; font: 11px var(--font-mono); color: var(--muted); }
.rb-o-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
.rb-o-dot.p { background: transparent; border: 1.5px dashed var(--warn); }
.rb-o-dot.x { background: var(--faint); }
.rb-minicov { display: grid; grid-template-columns: 1fr repeat(3, 18px); gap: 3px 4px; align-items: center; font: 11px var(--font-mono); color: var(--ink-soft); }
.rb-minicov .h { color: var(--muted); font-size: 9.5px; text-align: center; letter-spacing: .04em; }
.rb-minicov i { width: 14px; height: 14px; border-radius: 2px; display: block; margin: 0 auto; }
.rb-minicov i.n { border: 1px dashed var(--line-strong); opacity: .45; }
.rb-minicov button { all: unset; cursor: pointer; }
#r-side-show button { font-size: 11.5px; }
/* inspector column */
#r-side.rb-side { position: sticky; top: 76px; max-height: calc(100vh - 92px); overflow-y: auto; padding: 0; gap: 0; scroll-behavior: smooth; }
.rb-over { display: flex; flex-direction: column; gap: 16px; padding: 18px; }
.rb-side.has-sel .rb-over { display: none; }
.rb-start { display: grid; gap: 2px; text-align: left; padding: 12px 14px; border: 1.5px solid var(--ink); border-radius: 8px; background: color-mix(in srgb, var(--rs-hl) 30%, var(--paper)); cursor: pointer; font: inherit; color: var(--ink); box-shadow: 3px 3px 0 var(--ink); transition: transform .12s, box-shadow .12s; }
.rb-start:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink); }
.rb-start-k { font: 700 10px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
.rb-start b { font: 650 15px var(--font-ui); }
.rb-start small { font: 11.5px var(--font-mono); color: var(--ink-soft); }
html[data-theme="dark"] .rb-start { background: color-mix(in srgb, var(--rs-hl) 14%, var(--card)); }
.rb-ibar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--paper); }
.rb-ibar[hidden] { display: none; }
.rb-ibtn { width: 28px; height: 28px; flex: none; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; font: 600 14px var(--font-ui); display: grid; place-items: center; }
.rb-ibtn:hover { border-color: var(--ink); }
.rb-ibtn:disabled { opacity: .35; cursor: default; }
.rb-crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; overflow: hidden; white-space: nowrap; font: 11.5px var(--font-mono); color: var(--muted); }
.rb-crumbs button { all: unset; cursor: pointer; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
.rb-crumbs button:hover { color: var(--ink); text-decoration: underline; }
.rb-crumbs b { color: var(--ink); font-weight: 650; overflow: hidden; text-overflow: ellipsis; }
#r-side-part.rb-part { border: 0; border-radius: 0; padding: 16px 18px 28px; gap: 0; background: transparent; display: block; }
#r-side-part.rb-part[hidden] { display: none; }
.rbi-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.rbi-kind { display: inline-flex; align-items: center; gap: 8px; font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rb-n { width: 22px; height: 22px; border-radius: 50%; background: var(--ink); color: var(--paper); display: inline-grid; place-items: center; font: 700 10.5px var(--font-mono); letter-spacing: 0; flex: none; }
.rb-n.p { background: transparent; color: var(--ink); border: 1.5px dashed var(--ink); }
.rbi-title { font: 600 18px/1.35 var(--font-ui); letter-spacing: -.012em; color: var(--ink); margin: 0 0 6px; }
.rbi-big { font: 650 34px/1.1 var(--font-mono); font-variant-numeric: tabular-nums; margin: 4px 0 2px; color: var(--ink); }
.rbi-unit { font: 11.5px var(--font-mono); color: var(--muted); }
.rbi-meta { font: 11.5px/1.6 var(--font-mono); color: var(--muted); margin: 0 0 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.rbi-meta b { color: var(--ink-soft); font-weight: 600; }
.rbi-sec { border-top: 1px solid var(--line); padding: 12px 0 2px; margin-top: 12px; display: grid; gap: 8px; }
.rbi-sec > h5 { margin: 0; font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.rbi-sec > h5 em { font-style: normal; font-weight: 500; letter-spacing: .02em; text-transform: none; color: var(--faint); margin-left: auto; }
.rbi-sec p { font-size: 13px; line-height: 1.5; margin: 0; color: var(--ink-soft); }
.rbi-none { color: var(--muted) !important; }
.rbi-q { margin: 0; font: 450 14.5px/1.5 var(--font-ui); color: var(--ink); border-left: 3px solid var(--rs-hl); padding: 2px 0 2px 12px; }
.rbi-srcline { font: 11.5px/1.6 var(--font-mono) !important; color: var(--muted) !important; }
.rbi-srcline button { all: unset; cursor: pointer; color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.rbi-ev2 { padding-left: 12px; border-left: 3px solid var(--line); }
.rbi-ev2 .rbi-q { border: 0; padding: 0; font-size: 13.5px; }
.st-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font: 700 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; border: 1px solid currentColor; }
.st-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.st-pill.ok { color: var(--ok); } .st-pill.warn { color: var(--warn); } .st-pill.bad { color: var(--alert); } .st-pill.mute { color: var(--muted); }
.lens-pill, .mk-pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border: 1px solid var(--line-strong); border-radius: 999px; font: 600 10.5px var(--font-mono); color: var(--ink-soft); }
.lens-pill i { width: 7px; height: 7px; border-radius: 50%; background: var(--ink); }
/* reasoning */
.rb-reason { display: grid; gap: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--card); }
.rb-rrow { display: grid; grid-template-columns: 96px 1fr; gap: 10px; padding: 9px 12px; font-size: 13px; line-height: 1.5; color: var(--ink-soft); }
.rb-rrow + .rb-rrow { border-top: 1px solid var(--line); }
.rb-rrow .rl { font: 700 10px/1.9 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.rb-rrow.dec { background: color-mix(in srgb, var(--rs-hl) 14%, transparent); color: var(--ink); font-weight: 550; }
.rb-bec, .rb-rej { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
.rb-bec li { position: relative; padding-left: 16px; }
.rb-bec li::before { content: ""; position: absolute; left: 2px; top: 8px; width: 6px; height: 6px; background: var(--ink); border-radius: 1px; }
.rb-rej li { padding-left: 16px; position: relative; }
.rb-rej li::before { content: "×"; position: absolute; left: 1px; top: -1px; font: 700 13px var(--font-mono); color: var(--alert); }
.rb-rej s { color: var(--muted); text-decoration-color: var(--alert); }
.rb-cites { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 6px; vertical-align: 1px; }
.rb-attn { display: flex; gap: 8px; padding: 9px 12px; border-top: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); background: color-mix(in srgb, var(--warn) 8%, transparent); font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rb-attn b { font: 700 10px/1.9 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--warn); white-space: nowrap; }
.rb-by { font: 11px var(--font-mono); color: var(--muted); padding: 7px 12px; border-top: 1px solid var(--line); }
/* chips */
.rb-chip, .rb-fchip, .rb-schip, .rb-dchip, .rb-cchip { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 0 7px; height: 20px; border-radius: 3px; border: 1px solid var(--line-strong); background: var(--card); font: 600 10.5px var(--font-mono); color: var(--ink); white-space: nowrap; vertical-align: middle; }
.rb-chip .pin { margin: 0; width: 7px; height: 7px; }
.rb-chip b { font-weight: 500; color: var(--ink-soft); }
.rb-chip.rej { text-decoration: line-through; color: var(--muted); }
.rb-fchip { border-radius: 999px; padding-left: 2px; }
.rb-fchip .rb-n { width: 15px; height: 15px; font-size: 8.5px; }
.rb-schip::before { content: ""; width: 7px; height: 7px; background: var(--ink); }
.rb-schip.t-social::before { background: color-mix(in srgb, var(--ink) 40%, transparent); } .rb-schip.t-gov::before { background: color-mix(in srgb, var(--ink) 22%, transparent); }
.rb-schip.t-client::before { background: repeating-linear-gradient(45deg, var(--ink) 0 1px, transparent 1px 3px); } .rb-schip.t-trade::before { background: color-mix(in srgb, var(--ink) 65%, transparent); }
.rb-dchip { color: var(--muted); border-style: dashed; }
.rb-cchip { border-radius: 999px; }
.rb-chip:hover, .rb-fchip:hover, .rb-schip:hover, .rb-dchip:hover, .rb-cchip:hover { border-color: var(--ink); background: color-mix(in srgb, var(--rs-hl) 30%, var(--card)); }
/* pins table in inspector */
.rbi-pins { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.rbi-pins td { padding: 7px 6px; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--ink-soft); }
.rbi-pins tr { cursor: pointer; }
.rbi-pins tr:hover td { background: color-mix(in srgb, var(--rs-hl) 16%, transparent); }
.rbi-pins td:first-child { padding-left: 0; white-space: nowrap; font: 600 11px var(--font-mono); color: var(--ink); }
.rbi-pins .v { font: 650 12.5px var(--font-mono); white-space: nowrap; color: var(--ink); }
.rbi-pins small { display: block; font: 10.5px/1.5 var(--font-mono); color: var(--muted); }
.rbi-pins .rej td { opacity: .6; } .rbi-pins .rej .v { text-decoration: line-through; }
.rbi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.rbi-grid > div { padding: 8px 11px; border-bottom: 1px solid var(--line); display: grid; gap: 2px; }
.rbi-grid > div:nth-child(odd) { border-right: 1px solid var(--line); }
.rbi-grid > div.w { grid-column: 1 / -1; border-right: 0; }
.rbi-grid > div:nth-last-child(-n+2):not(.w), .rbi-grid > div.w:last-child { border-bottom: 0; }
.rbi-grid dt { font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rbi-grid dd { margin: 0; font-size: 12.5px; line-height: 1.4; color: var(--ink); }
.rbi-grid dd small { display: block; font: 10.5px var(--font-mono); color: var(--muted); }
.rbi-warn { padding: 9px 12px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); background: color-mix(in srgb, var(--warn) 8%, transparent); font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rbi-warn b { color: var(--warn); }
.rbi-flag { padding: 9px 12px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--alert) 45%, transparent); background: color-mix(in srgb, var(--alert) 8%, transparent); font-size: 12.5px; color: var(--ink-soft); }
.rbi-flag b { color: var(--alert); }
.rbi-chain { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.rbi-chain li { position: relative; padding: 0 0 12px 22px; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rbi-chain li::before { content: ""; position: absolute; left: 4px; top: 5px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--ink); background: var(--paper); box-sizing: border-box; }
.rbi-chain li::after { content: ""; position: absolute; left: 8px; top: 15px; bottom: 0; border-left: 1px solid var(--line-strong); }
.rbi-chain li:last-child { padding-bottom: 0; } .rbi-chain li:last-child::after { display: none; }
.rbi-chain li.hl::before { background: var(--rs-hl); }
.rbi-chain span.k { display: block; font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rbi-chain code, .rbi-meta code { font: 11px var(--font-mono); background: color-mix(in srgb, var(--ink) 6%, transparent); padding: 0 4px; border-radius: 3px; }
.rbi-claims { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.rbi-claims button { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: grid; grid-template-columns: 20px 1fr auto; gap: 8px; align-items: start; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; line-height: 1.45; color: var(--ink); background: var(--card); }
.rbi-claims button:hover { border-color: var(--ink); }
.rbi-claims .no { font: 700 11px/1.7 var(--font-mono); color: var(--muted); }
.rbi-claims .fx { display: flex; gap: 3px; align-items: center; padding-top: 2px; }
.rbi-claims .fx .rb-n { width: 16px; height: 16px; font-size: 9px; }
.rbi-claims small { display: block; font: 10.5px var(--font-mono); color: var(--muted); margin-top: 2px; }
.rbi-claims .flagged { border-color: color-mix(in srgb, var(--alert) 50%, transparent); }
.rbi-uses { display: grid; gap: 6px; }
.rbi-use { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: var(--ink-soft); flex-wrap: wrap; }
.rbi-use > span:first-child { font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); min-width: 82px; }
.rbi-dec { border: 1px solid var(--line); border-radius: 6px; background: var(--card); }
.rbi-dec + .rbi-dec { margin-top: 6px; }
.rbi-dec > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 40px auto 1fr auto; gap: 8px; align-items: baseline; padding: 8px 10px; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rbi-dec > summary::-webkit-details-marker { display: none; }
.rbi-dec > summary b { color: var(--ink); }
.rbi-dec[open] > summary { border-bottom: 1px solid var(--line); }
.rbi-dec .rb-reason { border: 0; border-radius: 0; }
.rbi-dec .rb-tgts { padding: 7px 10px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font: 11px var(--font-mono); color: var(--muted); }
.rb-t { font: 11px var(--font-mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.rb-did { font: 11px var(--font-mono); color: var(--muted); }
.rb-kind { display: inline-block; padding: 0 6px; border-radius: 3px; font: 700 9.5px/16px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink-soft); }
.rb-kind.k-verify, .rb-kind.k-approve { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
.rb-kind.k-contest { background: color-mix(in srgb, var(--alert) 14%, transparent); color: var(--alert); }
.rb-kind.k-resolve { background: color-mix(in srgb, var(--rs-hl) 55%, transparent); color: #141413; }
.rb-kind.k-verdict { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
.rb-kind.k-reject { background: color-mix(in srgb, var(--alert) 14%, transparent); color: var(--alert); }
.rbi-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.rb-btn { height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); font: 600 12px var(--font-ui); cursor: pointer; }
.rb-btn:hover { border-color: var(--ink); }
.rb-btn.pri { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.rb-btn.bad { color: var(--alert); border-color: color-mix(in srgb, var(--alert) 45%, transparent); }
.rb-btn:disabled { opacity: .4; cursor: not-allowed; }
html[data-theme="dark"] .rb-btn.pri { color: #151412; }
.rbi-form { margin-top: 10px; padding: 12px; border: 1.5px solid var(--ink); border-radius: 8px; display: grid; gap: 8px; background: var(--card); }
.rbi-form[hidden] { display: none; }
.rbi-form label { font-size: 12.5px; display: flex; gap: 8px; align-items: center; color: var(--ink-soft); }
.rbi-form textarea { border: 1px solid var(--line-strong); border-radius: 6px; padding: 8px 10px; font: 13px/1.4 var(--font-ui); background: var(--paper); color: var(--ink); resize: vertical; }
.rbi-presets { display: flex; flex-wrap: wrap; gap: 5px; }
.rbi-presets button { all: unset; cursor: pointer; padding: 2px 9px; border: 1px solid var(--line-strong); border-radius: 999px; font: 600 11px var(--font-ui); color: var(--ink-soft); }
.rbi-presets button.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.rbi-needs { padding: 11px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 8%, transparent); display: grid; gap: 8px; margin: 10px 0 2px; }
.rbi-needs b { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); }
.rbi-needs p { font-size: 13px; margin: 0; color: var(--ink-soft); }
.rbi-needs div { display: flex; gap: 6px; }
.rbi-vs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rbi-vs > div { border: 1px solid var(--line); border-radius: 8px; padding: 10px 11px; display: grid; gap: 4px; font-size: 12px; line-height: 1.45; color: var(--ink-soft); background: var(--card); align-content: start; }
.rbi-vs > div.won { border: 1.5px solid var(--ink); box-shadow: inset 0 4px 0 var(--rs-hl); }
.rbi-vs .v { font: 650 22px var(--font-mono); color: var(--ink); }
.rbi-vs .lost .v { text-decoration: line-through; color: var(--muted); font-weight: 500; }
.rbi-vs .tag { font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rbi-vs .won .tag { color: var(--ink); }
.rbi-vs q { font-style: italic; color: var(--ink-soft); }
.rbi-tl { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.rbi-tl > li { position: relative; padding-left: 18px; }
.rbi-tl > li::before { content: ""; position: absolute; left: 3px; top: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--ink); }
.rbi-tl > li::after { content: ""; position: absolute; left: 6.5px; top: 16px; bottom: -10px; border-left: 1px solid var(--line-strong); }
.rbi-tl > li:last-child::after { display: none; }
.rbi-tl > li.ok::before { background: var(--ok); } .rbi-tl > li.warn::before { background: var(--warn); } .rbi-tl > li.contest::before { background: var(--alert); }
.rbi-tl-h { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 6px; }
.rbi-tl-h b { color: var(--ink); }
.rbi-cur { font: 11.5px var(--font-mono); color: var(--ink); background: color-mix(in srgb, var(--rs-hl) 30%, transparent); padding: 6px 10px; border-radius: 6px; }
.rbi-block { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.rbi-block li { display: grid; grid-template-columns: 18px 1fr auto; gap: 8px; align-items: start; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); }
.rbi-block li i { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; background: var(--warn); }
.rbi-block li.ok i { background: var(--ok); }
.rbi-block li.ok { color: var(--muted); }
.rbi-sec .r-askbox { margin-top: 0; }
#r-side-part .r-job, #r-side-part .r-ans { margin-top: 0; }
/* ── the report (centre) ── */
#research-sheet .rb-sec { scroll-margin-top: 84px; }
#research-sheet #r-findings { scroll-margin-top: 84px; }
#r-answer { cursor: pointer; border-radius: 8px; margin: -10px -14px; padding: 10px 14px; transition: background .15s, box-shadow .15s; outline: none; }
#r-answer:hover { background: color-mix(in srgb, var(--ink) 2.5%, transparent); }
#r-answer.rb-on { background: color-mix(in srgb, var(--rs-hl) 9%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent); }
#r-answer:focus-visible { box-shadow: 0 0 0 2px var(--ink); }
.rb-claim { border-radius: 3px; transition: background .12s, box-shadow .12s; box-decoration-break: clone; -webkit-box-decoration-break: clone; padding: 1px 0; }
.rb-claim:hover { background: color-mix(in srgb, var(--rs-hl) 34%, transparent); box-shadow: 0 2px 0 var(--ink); }
.rb-claim.sel { background: color-mix(in srgb, var(--rs-hl) 62%, transparent); box-shadow: 0 2px 0 var(--ink); }
.rb-claim.rel { box-shadow: 0 2px 0 var(--ink); background: color-mix(in srgb, var(--rs-hl) 22%, transparent); }
.rb-claim.rb-inf { text-decoration: underline dotted color-mix(in srgb, var(--ink) 45%, transparent); text-underline-offset: 5px; }
.rb-claim.rb-thin { color: var(--ink-soft); }
.rb-claim.flag { text-decoration: line-through; text-decoration-color: var(--alert); color: var(--muted); }
.rb-cite { font: 700 9px var(--font-mono); color: var(--muted); margin-left: 2px; padding: 0 3px; border: 1px solid var(--line-strong); border-radius: 3px; vertical-align: 7px; line-height: 1; }
.rb-claim.sel .rb-cite, .rb-claim:hover .rb-cite { color: var(--ink); border-color: var(--ink); background: #FFFDF8; }
.rb-ans-sep { color: var(--faint); }
.rb-howlink { font: 600 11.5px var(--font-mono) !important; }
#research-sheet .finding-card .finding-quote { display: block !important; margin: 2px 0 0; padding: 2px 0 2px 14px; font-size: 13.5px !important; line-height: 1.5; color: var(--ink-soft); }
#research-sheet .finding-card .prov-pill { display: inline-flex !important; }
#research-sheet .finding-card .finding-quote + div { margin-top: 2px; }
#research-sheet .finding-card .fid-chip { cursor: pointer; font-size: 11px; }
#research-sheet .finding-card .fid-chip:hover { background: color-mix(in srgb, var(--rs-hl) 40%, #fff) !important; }
#research-sheet .finding-card.rb-rejected .finding-stmt { text-decoration: line-through; text-decoration-color: var(--alert); color: var(--muted); }
#research-sheet .finding-card.rel { background: color-mix(in srgb, var(--rs-hl) 8%, transparent) !important; }
.rb-used { font: 11px var(--font-mono); color: var(--muted); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
/* provenance graph under the answer */
.rb-trace { margin-top: 18px; border: 1px solid var(--line); border-radius: 8px; background: #fff; background-image: var(--rs-grid); padding: 14px 16px 12px; cursor: default; }
.rb-trace-h { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.rb-trace-h b { font: 650 14px var(--font-ui); }
.rb-trace-h span { font: 11px var(--font-mono); color: var(--muted); flex: 1; }
.rb-tgrid { position: relative; display: grid; grid-template-columns: 1fr 1fr 1.05fr 1.2fr; gap: 30px; align-items: center; }
.rb-tcol { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 6px; }
.rb-tcol h6 { margin: 0 0 2px; font: 700 9.5px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.rb-tn { all: unset; box-sizing: border-box; cursor: pointer; display: block; padding: 5px 8px; border: 1px solid var(--ink); border-radius: 5px; background: #FFFDF8; font: 500 11.5px/1.3 var(--font-ui); color: #141413; transition: opacity .15s, background .15s; }
.rb-tn small { display: block; font: 10px var(--font-mono); color: #6D655A; }
.rb-tn:hover { background: color-mix(in srgb, var(--rs-hl) 40%, #FFFDF8); }
.rb-tn.dim { opacity: .28; }
.rb-tn.lit { background: color-mix(in srgb, var(--rs-hl) 55%, #FFFDF8); box-shadow: 2px 2px 0 #141413; }
.rb-tn.unused { border-style: dashed; color: #6D655A; }
.rb-tn.rej { border-style: dashed; }
.rb-tn.rej b { text-decoration: line-through; }
.rb-tn.f { border-width: 1.5px; }
.rb-tn.f.p { border-style: dashed; }
.rb-tn.c { border-radius: 3px; border-left-width: 3px; }
.rb-tsvg { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; overflow: visible; pointer-events: none; }
.rb-tsvg path { fill: none; stroke: #141413; stroke-width: 1; opacity: .35; transition: opacity .15s; }
.rb-tsvg path.rej { stroke: #C9462A; stroke-dasharray: 3 3; opacity: .6; }
.rb-tsvg path.on { stroke-width: 2; opacity: 1; }
.rb-tsvg path.off { opacity: .08; }
.rb-tleg { margin-top: 12px; font: 10.5px var(--font-mono); color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 14px; }
.rb-tleg i { display: inline-block; width: 18px; border-top: 2px solid #141413; vertical-align: 3px; margin-right: 4px; }
.rb-tleg i.r { border-top: 1.5px dashed #C9462A; }
/* contest */
.rb-contest { display: grid; gap: 12px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; transition: background .12s; }
.rb-contest:hover { background: color-mix(in srgb, var(--ink) 2.5%, transparent); }
.rb-contest.sel { background: color-mix(in srgb, var(--rs-hl) 14%, transparent); }
.rb-c-top { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
.rb-c-top b { font: 600 15px var(--font-ui); }
.rb-c-side { display: grid; gap: 3px; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rb-c-side .tag { font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rb-c-side.won .tag { color: var(--ink); }
.rb-c-side .v { font: 650 24px var(--font-mono); color: var(--ink); }
.rb-c-side.lost .v { text-decoration: line-through; color: var(--muted); font-weight: 500; }
.rb-c-why { font-size: 12.5px; color: var(--ink-soft); border-top: 1px solid var(--line); padding-top: 10px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.rb-c-why .side-link { font-size: 12px; }
.rb-contest .r-vs { gap: 10px 24px; }
/* gaps, excluded */
.rb-gaps, .rb-excl { display: grid; gap: 8px; }
.rb-gap { display: grid; grid-template-columns: 14px 1fr auto; gap: 4px 12px; align-items: start; border: 1px dashed var(--faint); border-radius: 6px; padding: 10px 14px; font-size: 13.5px; }
.rb-gap .cov { margin-top: 4px; width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--ink); box-sizing: border-box; display: inline-block; }
.rb-gap .cov.none { border-style: dashed; } .rb-gap .cov.empty { border-color: var(--warn); }
.rb-gap-k { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 3px; }
.rb-gap-k b { font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rb-gap-d { font: 11px/1.55 var(--font-mono); color: var(--muted); margin-top: 4px; }
.rb-gap .side-link { font-size: 12.5px; white-space: nowrap; }
.rb-ex { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 12px; align-items: baseline; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--ink-soft); }
.rb-ex:first-child { border-top: 1px solid var(--line); }
.rb-ex-k { font: 700 9.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--line-strong); border-radius: 3px; padding: 0 5px; white-space: nowrap; }
.rb-ex small { font: 11px var(--font-mono); color: var(--muted); white-space: nowrap; }
.rb-ex b { color: var(--ink); font-weight: 600; }
/* facts table */
.rb-facts { table-layout: auto; width: 100%; }
.rb-facts td { vertical-align: top; }
.rb-facts td:nth-child(2) b { font-weight: 600; }
.rb-facts td:nth-child(2) small { display: block; margin-top: 2px; font: 11px var(--font-mono); color: var(--muted); }
.rb-facts td:nth-child(5) { font: 11px var(--font-mono); color: var(--muted); white-space: nowrap; }
.rb-facts tr.stale td:nth-child(5) { color: var(--warn); }
.rb-facts tr.contested td:nth-child(5), .rb-facts tr.rb-wrong td:nth-child(5) { color: #C9462A; }
.rb-contest .rb-chip b { font: 500 10.5px var(--font-mono); text-decoration: none; color: var(--ink-soft); }
.rb-contest .rb-chip, .rb-contest .rb-schip { font-size: 10.5px; }
.rb-contest .r-vs > div > span { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.rb-facts tr.unused td { color: var(--muted); }
.rb-facts tr.rb-wrong td:nth-child(2) b { text-decoration: line-through; text-decoration-color: #C9462A; }
.rb-facts tr.rel { background: color-mix(in srgb, var(--rs-hl) 9%, transparent); }
.tier.t-client { background: repeating-linear-gradient(45deg, var(--ink) 0 1px, transparent 1px 3px); } .tier.t-trade { background: color-mix(in srgb, var(--ink) 65%, transparent); }
/* coverage matrix */
.rb-cov { width: 100%; border-collapse: collapse; font-size: 13px; }
.rb-cov th { font: 700 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); text-align: center; padding: 6px 4px; border-bottom: 1px solid var(--ink); }
.rb-cov th:first-child { text-align: left; }
.rb-cov td { padding: 6px 4px; border-bottom: 1px solid var(--line); text-align: center; }
.rb-cov td:first-child { text-align: left; font-weight: 500; }
.rb-cov td.note { text-align: left; font: 11px var(--font-mono); color: var(--muted); }
.rb-cov i { width: 16px; height: 16px; border-radius: 2px; display: inline-block; vertical-align: middle; }
.rb-cov i.n { border: 1px dashed var(--faint); }
.rb-cov-f { margin-top: 8px; font: 11px var(--font-mono); color: var(--muted); }
/* how it ran */
.rb-run { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; counter-reset: run; }
.rb-run > li { display: grid; grid-template-columns: 28px 1fr auto; gap: 4px 12px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--ink-soft); align-items: start; }
.rb-run > li::before { counter-increment: run; content: counter(run); width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--ink); display: grid; place-items: center; font: 700 10px var(--font-mono); color: var(--ink); }
.rb-run b { color: var(--ink); }
.rb-run small { display: block; font: 11px/1.55 var(--font-mono); color: var(--muted); margin-top: 2px; }
.rb-run .t { font: 11px var(--font-mono); color: var(--muted); white-space: nowrap; }
.rb-run details { grid-column: 2 / -1; }
.rb-run summary { cursor: pointer; font: 600 11.5px var(--font-mono); color: var(--ink-soft); }
.rb-run details ul { margin: 6px 0 0; padding-left: 16px; font: 11.5px/1.6 var(--font-mono); color: var(--muted); }
/* decision log */
.rb-logf { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; font: 11px var(--font-mono); color: var(--muted); }
.rb-logf button { all: unset; cursor: pointer; padding: 2px 9px; border: 1px solid var(--line); border-radius: 999px; font: 600 11px var(--font-mono); color: var(--ink-soft); }
.rb-logf button.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.rb-logf .sp { width: 10px; }
#rb-log .rbi-dec > summary { grid-template-columns: 40px 64px 1fr auto; }
.rb-foot { font: 11px var(--font-mono); color: var(--muted); border-top: 1px solid var(--line); padding-top: 14px; margin-top: -10px; }
@media (max-width: 1360px) { #r-workspace.rb-ws { grid-template-columns: minmax(0, 1fr) 400px; } .rb-rail { display: none; } }
@media (max-width: 900px) { #r-workspace.rb-ws { grid-template-columns: 1fr; } #r-side.rb-side { position: static; max-height: none; } #research-screen-output.rb { width: auto; margin-left: 0; } .rb-tgrid { grid-template-columns: 1fr 1fr; } }
/* dark: rail + inspector follow the theme; the report stays light paper */
html[data-theme="dark"] .rb-trace { background-color: #fff; }
html[data-theme="dark"] #research-sheet .rb-cov th { border-color: #141413; }
html[data-theme="dark"] .rb-ibar { background: var(--paper); }
html[data-theme="dark"] .rb-kind.k-resolve { color: var(--ink); background: color-mix(in srgb, var(--rs-hl) 25%, transparent); }
html[data-theme="dark"] .rb-outline button.on { background: color-mix(in srgb, var(--rs-hl) 12%, transparent); }
html[data-theme="dark"] .rbi-q { border-left-color: var(--rs-hl); }
html[data-theme="dark"] .rb-chip .pin, html[data-theme="dark"] .rb-fchip .rb-n { }
html[data-theme="dark"] .rb-n { color: #151412; }
html[data-theme="dark"] .rb-n.p { color: var(--ink); }
'''
last_style = s.rindex('</style>')
s = s[:last_style] + CSS + s[last_style:]

# ── 3. JS (inside the app's IIFE so it reaches rsSelect, RS_FACT, conf, hl, esc, showToast) ──
JS = (HERE / 'variant_b.js').read_text(encoding='utf-8')
rep('  renderBriefPage();\n  syncNavigation();\n  const urlBrand', JS + '\n  renderBriefPage();\n  syncNavigation();\n  const urlBrand')

s = s.replace('<title>', '<title>', 1)
OUT.write_text(s, encoding='utf-8')
print('wrote', OUT, len(s))
