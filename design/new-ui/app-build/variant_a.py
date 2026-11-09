#!/usr/bin/env python3
"""Research report, variant A: a long provenance drawer on the right.

Reads napkin-app-v1.html (generated; never edited here), applies exact-string
edits, and writes napkin-app-research-a.html. Each anchor must match once.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "napkin-app-v1.html"
OUT = ROOT / "napkin-app-research-a.html"

html = SRC.read_text(encoding="utf-8")


def sub(old, new, count=1):
    global html
    n = html.count(old)
    assert n == count, f"anchor matched {n}x (want {count}): {old[:90]!r}"
    html = html.replace(old, new)


def before_last(anchor, add):
    global html
    i = html.rfind(anchor)
    assert i >= 0, anchor
    html = html[:i] + add + html[i:]


# ── 1. The answer: each claim is its own span, so it can be traced ──
sub(
    """<p class="r-ans-t">Irish 16–24s don't plan treats; they stretch social moments. <mark class="rs-hl">68%</mark> of out-of-home treat stops are unplanned and social, while delivery desserts grew <mark class="rs-hl">23.4%</mark>: indulgence moves home unless the outing gives a reason. The two-spoon ritual is promising, but thin.</p>
          <div class="r-ans-c"><span class="conf" data-c="med"><i></i><i></i><i></i></span> Overall confidence · Medium</div>""",
    """<p class="r-ans-t"><span class="ra-c" data-claim="0">Irish 16–24s don't plan treats; they stretch social moments.</span> <span class="ra-c" data-claim="1"><mark class="rs-hl">68%</mark> of out-of-home treat stops are unplanned and social,</span> <span class="ra-c" data-claim="2">while delivery desserts grew <mark class="rs-hl">23.4%</mark>: indulgence moves home unless the outing gives a reason.</span> <span class="ra-c" data-claim="3">The two-spoon ritual is promising, but thin.</span></p>
          <div class="r-ans-c"><span class="conf" data-c="med"><i></i><i></i><i></i></span> Overall confidence · Medium <span class="ra-sep">·</span> <button type="button" class="ra-how" id="r-ans-how">How this was formed</button></div>""",
)

# ── 2. The record: six decisions, as the header says; d_046 composed the answer ──
sub('<details class="r-log"><summary><span>07 — On the record</span> 5 decisions</summary>',
    '<details class="r-log"><summary><span>07 — On the record</span> 6 decisions</summary>')
sub(
    """requires human sign-off <span style="font-family:var(--font-mono);font-size:11px;color:var(--muted)">· d_045</span></div>
            </li>
          </ol></details>""",
    """requires human sign-off <span style="font-family:var(--font-mono);font-size:11px;color:var(--muted)">· d_045</span></div>
            </li>
            <li>
              <div style="font-size:13.5px"><b>Report Agent</b> composed the answer from Findings 1–3 and left the weather pin (<code>f_014</code>) out <span style="font-family:var(--font-mono);font-size:11px;color:var(--muted)">· d_046</span></div>
            </li>
          </ol></details>""",
)
# the contest was resolved by d_044 (d_045 is the Proposed call)
sub("resolved for Kantar by the Review agent (d_045)</p>", "resolved for Kantar by the Review agent (d_044)</p>")
sub('<p class="side-hint">Click a finding or a fact to see its evidence here.</p>',
    '<p class="side-hint">Click the answer, a finding or a fact to see how it was formed.</p>')

# ── 3. The drawer shell (outside the workspace, fixed to the right) ──
sub(
    """        <p class="side-hint">Click the answer, a finding or a fact to see how it was formed.</p>
      </aside>
      </div>""",
    """        <p class="side-hint">Click the answer, a finding or a fact to see how it was formed.</p>
      </aside>
      </div>
      <aside class="rd" id="rd" aria-label="How this was formed" aria-hidden="true">
        <header class="rd-head" id="rd-head"></header>
        <div class="rd-body" id="rd-body"></div>
        <footer class="rd-acts" id="rd-acts"></footer>
      </aside>""",
)

CSS = r"""
/* ═══ Variant A: the long provenance drawer ═══ */
#r-answer { cursor: pointer; border-radius: 6px; margin: -10px -14px; padding: 10px 14px; transition: background .12s; }
#r-answer:hover { background: color-mix(in srgb, var(--ink) 3%, transparent); }
#r-answer.sel { background: color-mix(in srgb, var(--rs-hl) 12%, transparent); }
.ra-c { border-radius: 2px; transition: background .12s, box-shadow .12s; }
#r-answer:hover .ra-c:hover, .ra-c.ra-on { background: color-mix(in srgb, var(--rs-hl) 38%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--rs-hl) 38%, transparent); }
#r-answer.sel .ra-c:not(.ra-on) { color: var(--ink-soft); }
.ra-sep { color: var(--faint); }
.ra-how { background: none; border: 0; padding: 0; font: 600 11.5px var(--font-mono); color: var(--ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--rs-hl); text-decoration-thickness: 2px; cursor: pointer; }
.finding-card.rd-rejected .finding-stmt { text-decoration: line-through; color: var(--muted); }
#r-contests .r-vs, .r-log li { cursor: pointer; }
#r-contests .r-vs:hover { background: color-mix(in srgb, var(--ink) 3%, transparent); }
.r-log li:hover > div { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
#rs-workspace, #r-workspace { transition: grid-template-columns .22s ease; }
#r-side { transition: opacity .18s; }
body.rd-open #r-side { opacity: 0; pointer-events: none; }

.rd { position: fixed; top: var(--rd-top, 63px); right: 0; bottom: 0; width: min(468px, calc(100vw - 24px)); z-index: 45; display: flex; flex-direction: column;
  background: var(--paper); border-left: 1px solid var(--line); box-shadow: -24px 0 48px -32px rgba(50,38,18,.45);
  transform: translateX(104%); visibility: hidden; transition: transform .24s cubic-bezier(.2,.7,.2,1), visibility 0s .24s; }
.rd.open { transform: none; visibility: visible; transition: transform .24s cubic-bezier(.2,.7,.2,1); }
body:not([data-tool="research"]) .rd, body[data-tool="research"]:not([data-step="output"]) .rd { display: none; }
.rd-head { padding: 16px 22px 0; border-bottom: 1px solid var(--line); box-shadow: inset 0 4px 0 var(--rs-hl); flex: none; }
.rd-top { display: flex; align-items: center; gap: 8px; min-height: 26px; }
.rd-kick { flex: 1; font: 700 10.5px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.rd-kick .rs-dot { width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 700 10.5px var(--font-mono); letter-spacing: 0; }
.rd-kick .rs-dot.prop { background: transparent; color: var(--ink); border: 1.5px dashed var(--ink); }
.rd-nav { display: flex; gap: 2px; align-items: center; font: 11px var(--font-mono); color: var(--muted); }
.rd-ib { width: 26px; height: 26px; border-radius: 6px; border: 1px solid transparent; background: none; color: var(--ink); font: 15px/1 var(--font-ui); cursor: pointer; display: grid; place-items: center; }
.rd-ib:hover { border-color: var(--line); background: var(--card); }
.rd-ib:disabled { opacity: .3; cursor: default; }
.rd-title { font: 600 18px/1.32 var(--font-ui); letter-spacing: -.012em; margin: 10px 0 8px; color: var(--ink); }
.rd-title .rd-big { display: block; font: 600 30px var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -.02em; margin-top: 4px; }
.rd-title .rd-big small { font: 500 12px var(--font-mono); color: var(--muted); margin-left: 6px; letter-spacing: 0; }
.rd-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font: 11px var(--font-mono); color: var(--muted); }
.rd-st { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font: 700 9.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; border: 1px solid currentColor; }
.rd-st.ok { color: var(--ok); } .rd-st.warn { color: var(--warn); } .rd-st.bad { color: var(--alert); } .rd-st.mute { color: var(--muted); }
.rd-st.warn.fill { background: var(--warn); border-color: var(--warn); color: #fff; }
.rd-idx { display: flex; gap: 14px; margin: 12px -22px 0; padding: 0 22px; overflow-x: auto; scrollbar-width: none; }
.rd-idx button { flex: none; background: none; border: 0; border-bottom: 2px solid transparent; padding: 7px 0 8px; font: 600 11px var(--font-mono); letter-spacing: .04em; color: var(--muted); cursor: pointer; }
.rd-idx button.on { color: var(--ink); border-bottom-color: var(--ink); }
.rd-idx button:hover { color: var(--ink); }
.rd-body { position: relative; flex: 1; overflow-y: auto; padding: 0 22px 28px; scroll-behavior: smooth; overscroll-behavior: contain; }
.rd-sec { padding: 18px 0 4px; }
.rd-sec + .rd-sec { border-top: 1px solid var(--line); margin-top: 14px; }
.rd-sec > h4 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 10px; font: 600 14px var(--font-ui); color: var(--ink); text-transform: none; letter-spacing: 0; }
.rd-sec > h4 span { font: 700 10px var(--font-mono); letter-spacing: .12em; color: var(--muted); }
.rd-sec > h4 em { margin-left: auto; font: 11px var(--font-mono); font-style: normal; color: var(--muted); }
.rd-p { font-size: 13px; line-height: 1.5; color: var(--ink-soft); margin: 0; }
.rd-note { font: 11px/1.45 var(--font-mono); color: var(--muted); margin: 6px 0 0; }
/* provenance trail */
.rd-trail { position: relative; display: grid; gap: 0; }
.rd-stage { position: relative; display: grid; grid-template-columns: 74px 1fr; gap: 10px; padding: 7px 0; }
.rd-stage + .rd-stage::before { content: ""; position: absolute; left: 30px; top: -7px; height: 14px; border-left: 1.5px solid var(--ink); }
.rd-stage + .rd-stage::after { content: ""; position: absolute; left: 26px; top: 3px; border: 4.5px solid transparent; border-top: 5px solid var(--ink); }
.rd-stage > b { align-self: start; padding-top: 5px; font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rd-stage > div { display: flex; flex-wrap: wrap; gap: 5px; }
.rd-n { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); font: 500 11.5px var(--font-ui); color: var(--muted); cursor: pointer; text-align: left; opacity: .62; }
.rd-n:hover { opacity: 1; border-color: var(--ink); }
.rd-n.on { opacity: 1; color: var(--ink); border-color: var(--ink); background: color-mix(in srgb, var(--rs-hl) 30%, var(--card)); }
.rd-n.me { box-shadow: 0 0 0 2px var(--rs-hl), 0 0 0 3px var(--ink); }
.rd-n.cut { text-decoration: line-through; }
.rd-n .pin, .rd-n .tier { margin: 0; }
.rd-n i.nd { width: 16px; height: 16px; border-radius: 50%; background: var(--ink); color: var(--paper); font: 700 9px/16px var(--font-mono); text-align: center; font-style: normal; flex: none; }
.rd-n i.nd.prop { background: transparent; color: var(--ink); border: 1.2px dashed var(--ink); line-height: 14px; width: 14px; height: 14px; }
.rd-n i.sx { font: 700 9.5px var(--font-mono); font-style: normal; }
.rd-n s { color: var(--faint); }
/* reasoning */
.rd-why { display: grid; gap: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--card); overflow: hidden; }
.rd-row { display: grid; grid-template-columns: 86px 1fr; gap: 12px; padding: 11px 14px; font-size: 13px; line-height: 1.5; color: var(--ink-soft); }
.rd-row + .rd-row { border-top: 1px solid var(--line); }
.rd-row > b { font: 700 9.5px/1.9 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rd-row.dec > span { font-weight: 600; color: var(--ink); }
.rd-row ol, .rd-row ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.rd-because li { display: grid; grid-template-columns: 16px 1fr; gap: 4px; }
.rd-because li > i { font: 700 10px/1.9 var(--font-mono); font-style: normal; color: var(--muted); }
.rd-cites { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.rd-cite { display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px; border: 1px solid var(--line-strong); border-radius: 3px; background: var(--card); font: 600 10.5px var(--font-mono); color: var(--ink); cursor: pointer; white-space: nowrap; }
.rd-cite:hover { background: color-mix(in srgb, var(--rs-hl) 40%, var(--card)); }
.rd-cite .pin { width: 7px; height: 7px; margin: 0; }
.rd-cite.src { border-style: dashed; font-weight: 500; }
.rd-rej li > s { color: var(--ink); text-decoration-color: var(--alert); }
.rd-rej li > span { display: block; color: var(--muted); }
.rd-cert { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--ink); }
.rd-change li { padding-left: 16px; position: relative; } .rd-change li::before { content: "→"; position: absolute; left: 0; color: var(--muted); }
.rd-look { margin-top: 10px; display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--warn) 10%, var(--card)); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rd-look b { font: 700 9.5px/1.9 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); }
/* answer: claims tree */
.rd-claims { display: grid; gap: 12px; counter-reset: cl; }
.rd-claim { border: 1px solid var(--line); border-radius: 8px; background: var(--card); padding: 12px 14px; cursor: pointer; transition: border-color .12s; }
.rd-claim:hover { border-color: var(--faint); }
.rd-claim.on { border-color: var(--ink); box-shadow: inset 3px 0 0 var(--rs-hl); }
.rd-claim > q { display: block; font: 500 14px/1.45 var(--font-ui); color: var(--ink); quotes: none; }
.rd-claim > q i { font: 700 10px var(--font-mono); font-style: normal; color: var(--muted); margin-right: 6px; }
.rd-tree { margin: 10px 0 0 6px; padding-left: 14px; border-left: 1.5px solid var(--ink); display: grid; gap: 8px; }
.rd-tf { position: relative; display: grid; gap: 4px; }
.rd-tf::before { content: ""; position: absolute; left: -14px; top: 9px; width: 10px; border-top: 1.5px solid var(--ink); }
.rd-tf-h { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; line-height: 1.4; color: var(--ink-soft); }
.rd-tf-h .rd-n { flex: none; opacity: 1; }
.rd-tf-p { display: flex; flex-wrap: wrap; gap: 4px; padding-left: 2px; }
.rd-tf-x { font: 11px/1.45 var(--font-mono); color: var(--muted); }
/* evidence */
.rd-quote { margin: 0; padding: 2px 0 2px 14px; border-left: 3px solid var(--ink); font: 450 15px/1.5 var(--font-ui); color: var(--ink); }
.rd-srcl { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font: 11px var(--font-mono); color: var(--muted); }
.rd-srcl .tier { margin: 0 6px 0 0; }
.rd-srcl a, .rd-link { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line); cursor: pointer; background: none; border: 0; padding: 0; font: 600 11px var(--font-mono); }
.rd-corr { margin-top: 12px; padding: 10px 12px; border: 1px dashed var(--faint); border-radius: 8px; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rd-corr b { display: block; font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 3px; }
/* pins */
.rd-pins { display: grid; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--card); }
.rd-pr { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 12px; cursor: pointer; text-align: left; border: 0; background: none; font: inherit; color: inherit; width: 100%; }
.rd-pr + .rd-pr { border-top: 1px solid var(--line); }
.rd-pr:hover { background: color-mix(in srgb, var(--rs-hl) 14%, transparent); }
.rd-pr-a { display: flex; align-items: center; gap: 8px; font: 600 12px var(--font-mono); color: var(--ink); }
.rd-pr-a .pin { margin: 0; }
.rd-pr-v { font: 600 13px var(--font-mono); color: var(--ink); text-align: right; white-space: nowrap; }
.rd-pr-b { grid-column: 1 / -1; font-size: 12.5px; color: var(--ink-soft); }
.rd-pr-c { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font: 10.5px var(--font-mono); color: var(--muted); }
.rd-pr-c .tier { margin: 0 -6px 0 0; }
/* key-value grid for a fact */
.rd-kv { display: grid; grid-template-columns: 104px 1fr; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--card); }
.rd-kv > b, .rd-kv > span { padding: 8px 12px; border-top: 1px solid var(--line); }
.rd-kv > b:first-child, .rd-kv > b:first-child + span { border-top: 0; }
.rd-kv > b { font: 700 9.5px/1.9 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rd-kv > span { font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.rd-kv code { font: 11.5px var(--font-mono); }
.rd-stale { margin-top: 10px; padding: 9px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 8%, var(--card)); font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rd-stale b { color: var(--warn); font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; margin-right: 6px; }
.rd .r-chain { margin-top: 2px; }
.rd .r-chain li { color: var(--ink-soft); }
.rd .r-chain li.on::before { background: var(--rs-hl); box-shadow: 0 0 0 1.5px var(--ink); }
/* contests */
.rd-vs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rd-vs > div { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; gap: 3px; background: var(--card); }
.rd-vs > div.won { border-color: var(--ink); box-shadow: inset 0 3px 0 var(--rs-hl); }
.rd-vs small { font: 700 9.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.rd-vs .won small { color: var(--ink); }
.rd-vs strong { font: 600 20px var(--font-mono); color: var(--ink); }
.rd-vs .lost strong { text-decoration: line-through; color: var(--muted); font-weight: 500; }
.rd-vs span { font-size: 12px; line-height: 1.4; color: var(--ink-soft); }
.rd-vs code { font: 10.5px var(--font-mono); color: var(--muted); }
.rd-vs-why { grid-column: 1 / -1; font-size: 12.5px; color: var(--ink-soft); padding: 2px 2px 0; }
.rd-vs-why b { font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-right: 6px; }
.rd-none { font: 11.5px var(--font-mono); color: var(--muted); padding: 10px 12px; border: 1px dashed var(--line); border-radius: 8px; }
/* used by */
.rd-uses { display: grid; gap: 6px; }
.rd-use { display: grid; grid-template-columns: 74px 1fr; gap: 10px; align-items: start; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rd-use > b { font: 700 9.5px/1.9 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rd-use > div { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
/* decisions on record */
.rd-tl { margin: 0; padding: 0 0 0 16px; list-style: none; border-left: 1.5px solid var(--line); display: grid; gap: 10px; }
.rd-tl li { position: relative; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rd-tl li::before { content: ""; position: absolute; left: -21px; top: 5px; width: 9px; height: 9px; border-radius: 50%; background: var(--card); border: 1.5px solid var(--ink); }
.rd-tl li.ok::before { background: var(--ok); border-color: var(--ok); } .rd-tl li.warn::before { background: var(--warn); border-color: var(--warn); } .rd-tl li.contest::before { background: var(--alert); border-color: var(--alert); }
.rd-tl li.you::before { background: var(--rs-hl); }
.rd-tl-h { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font: 10.5px var(--font-mono); color: var(--muted); }
.rd-kind { padding: 0 6px; border: 1px solid var(--line-strong); border-radius: 3px; font: 700 9px/15px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink); }
.rd-tl details summary { cursor: pointer; list-style: none; }
.rd-tl details summary::-webkit-details-marker { display: none; }
.rd-tl details summary::after { content: " · why"; font: 600 10.5px var(--font-mono); color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
.rd-tl details[open] summary::after { content: ""; }
.rd-tl details > div { margin-top: 6px; padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 4%, transparent); font-size: 12px; }
.rd-tl .rd-tgt { font: 10.5px var(--font-mono); color: var(--muted); }
.rd-work { display: grid; grid-template-columns: 104px 1fr; gap: 6px 12px; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
.rd-work > b { font: 700 9.5px/1.9 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
/* actions + the ask */
.rd-acts { flex: none; border-top: 1px solid var(--line); padding: 12px 22px 14px; background: var(--paper); display: grid; gap: 10px; }
.rd-acts:empty { display: none; }
.rd-btns { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.rd-b { height: 32px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); font: 600 12.5px var(--font-ui); cursor: pointer; }
.rd-b:hover { background: color-mix(in srgb, var(--rs-hl) 30%, var(--card)); }
.rd-b.pri { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.rd-b.pri:hover { background: var(--ink-soft); }
.rd-b.ghost { border-color: transparent; background: none; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line); padding: 0 6px; }
.rd-b[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
.rd-b:disabled { opacity: .45; cursor: default; }
.rd-acts .rd-b.ghost:last-child { margin-left: auto; }
.rd-form { display: grid; gap: 8px; }
.rd-form p { margin: 0; font-size: 12.5px; color: var(--ink-soft); line-height: 1.45; }
.rd-form textarea { width: 100%; box-sizing: border-box; border: 1.5px solid var(--ink); border-radius: 12px; padding: 8px 12px; font: 13px/1.4 var(--font-ui); background: var(--card); color: var(--ink); resize: vertical; }
.rd-presets { display: flex; flex-wrap: wrap; gap: 5px; }
.rd-presets button { height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--ink-soft); font: 12px var(--font-ui); cursor: pointer; }
.rd-presets button:hover { border-color: var(--ink); }
.rd-job { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px dashed var(--ink); border-radius: 8px; font-size: 12.5px; color: var(--ink-soft); }
.rd-ans { padding: 10px 12px; border-left: 3px solid var(--rs-hl); background: color-mix(in srgb, var(--rs-hl) 10%, var(--card)); border-radius: 0 8px 8px 0; display: grid; gap: 6px; font-size: 13px; line-height: 1.5; color: var(--ink-soft); }
.rd-ans .r-ans-q { color: var(--muted); }
html[data-theme="dark"] .rd { box-shadow: -24px 0 48px -24px rgba(0,0,0,.8); }
html[data-theme="dark"] .rd .tier { background: var(--ink); }
html[data-theme="dark"] .rd-n.on { background: color-mix(in srgb, var(--rs-hl) 22%, var(--card)); }
html[data-theme="dark"] .rd-n i.nd, html[data-theme="dark"] .rd-kick .rs-dot { background: var(--ink); color: #151412; }
html[data-theme="dark"] .rd-n i.nd.prop, html[data-theme="dark"] .rd-kick .rs-dot.prop { background: transparent; color: var(--ink); }
html[data-theme="dark"] .rd-b.pri { color: #151412; }
@media (max-width: 1100px) { body.rd-open #r-side { opacity: 1; pointer-events: auto; } }
@media print { .rd { display: none !important; } }
"""
before_last("</style>", CSS)

JS = r"""
  /* ═══ Variant A: the long provenance drawer ═══ */
  (function researchDrawer() {
    const SRC = {
      s1: { n: 'Bord Bia Consumer Insights', tier: 'Panel', date: 'Jun 2026', loc: 'Republic of Ireland sample, n=1,400', lic: 'Licensed panel', mat: 'm_0412' },
      s2: { n: 'CSO Irish Life & Leisure Survey', tier: 'Panel', date: 'Mar 2026', loc: 'Table 4.2, ages 16–24, n=2,100', lic: 'Open data', mat: 'm_0413' },
      s3: { n: 'Kantar Worldpanel', tier: 'Panel', date: 'Aug 2026', loc: 'ROI Out-of-Home & Delivery Tracker, p.14', lic: 'Licensed panel', mat: 'm_0415' },
      s4: { n: 'Client deck', tier: 'Client', date: 'Jul 2026', loc: 'McD IE summer review, slide 9', lic: 'Client-confidential', mat: 'm_0401' },
      s5: { n: 'TikTok Ireland', tier: 'Social', date: 'Oct 2026', loc: '#McFlurry tag analytics, IE', lic: 'Public', mat: 'm_0420' },
      s6: { n: 'TikTok comment sample', tier: 'Social', date: 'Oct 2026', loc: '2 clips, 4.1k combined likes', lic: 'Public', mat: 'm_0421' },
      s7: { n: 'Met Éireann', tier: 'Gov', date: 'Sep 2026', loc: 'Summer climate statement 2026', lic: 'Open data', mat: 'm_0425' },
      s8: { n: 'Checkout Ireland', tier: 'Trade', date: 'May 2026', loc: 'Frozen confectionery review', lic: 'Licensed trade', mat: 'm_0430', ex: 'Excluded · not pinned: it restates the Bord Bia figure, so it adds no second source.' },
      s9: { n: 'Euromonitor', tier: 'Trade', date: 'Nov 2024', loc: 'Ice cream in Ireland', lic: 'Licensed trade', mat: 'm_0431', ex: 'Excluded · not pinned: 2024 data, older than Bord Bia and Kantar for the same measures.' }
    };
    const FX = {
      f_003: { src: 's1', key: 'occasion.unplanned_share', mk: 'IE', method: 'national panel survey', unit: 'of out-of-home treat occasions', quote: 'Among Irish 16–24s, 68% of out-of-home treat occasions were unplanned and social, up from 61% in 2024.', row: 'Audience layer · Ireland · 16–24s', rid: 'r_003', corr: ['s2', 'CSO Irish Life & Leisure puts the same share at 65%: within 3 points.'], claims: [0, 1], dec: ['d_041', 'd_042'] },
      f_004: { src: 's1', key: 'occasion.social_delta', mk: 'IE', method: 'national panel survey, wave on wave', unit: 'vs the 2024 wave', quote: '…up from 61% in 2024.', row: 'Audience layer · Ireland · 16–24s', rid: 'r_004', claims: [0], dec: ['d_041', 'd_042'] },
      f_007: { src: 's3', key: 'delivery.frozen_dessert_growth', mk: 'IE (ROI only)', method: 'purchase panel, like-for-like', unit: 'orders, year on year', quote: 'Frozen dessert delivery orders in the Republic of Ireland rose 23.4% against the prior 12 months.', row: 'Category layer · ROI · frozen desserts', rid: 'r_007', contest: true, claims: [2], dec: ['d_041', 'd_043', 'd_044'] },
      f_009: { src: 's5', key: 'social.tag_views', mk: 'IE', method: 'platform analytics', unit: 'views of #McFlurry in Ireland', quote: '#McFlurry · Ireland · 11.2M views (last 90 days).', row: 'Culture layer · Ireland · social', rid: 'r_009', stale: ['v3', '11.9M'], claims: [3], dec: ['d_041', 'd_045'] },
      f_011: { src: 's6', key: 'ugc.two_spoon_sharing', mk: 'IE', method: 'hand-read sample', unit: 'clips showing the behaviour', quote: '“the two spoons thing is so real, nobody orders their own mcflurry”', row: 'Culture layer · Ireland · social', rid: 'r_011', claims: [3], dec: ['d_041', 'd_045'] },
      f_014: { src: 's7', key: 'weather.warm_days_delta', mk: 'IE', method: 'station records', unit: 'days over 20 °C vs summer 2024', quote: 'Summer 2026 recorded 18% more days above 20 °C than summer 2024.', row: 'Market layer · Ireland · climate', rid: 'r_014', claims: [], unused: 'Pinned, but nothing links warm days to what 16–24s choose, so the answer leaves it out (rejected in d_046).', dec: ['d_041', 'd_046'] }
    };
    const DEC = {
      d_041: { t: '09:02', kind: 'extract', who: 'Knowledge agent', cls: '', what: 'extracted 14 candidate facts from 9 sources', tgt: ['f_003', 'f_004', 'f_007', 'f_009', 'f_011', 'f_014'], why: 'Read 9 sources with 41 queries. Kept 6 as pins; 8 dropped as duplicates (Checkout Ireland restates Bord Bia) or older than the window (Euromonitor, 2024).' },
      d_042: { t: '09:20', kind: 'verify', who: 'Review agent', cls: 'ok', what: 'verified f_003 (68% unplanned) across Bord Bia and CSO', tgt: ['f_003', 'f_004', 'F1'], why: 'Two independent national samples agree within 3 points, and the trend holds from 2024 to 2026. Written to the layer as pin f_003.' },
      d_043: { t: '09:31', kind: 'contest', who: 'Review agent', cls: 'contest', what: 'flagged a disagreement on delivery growth: 23.4% Kantar vs 31% client deck', tgt: ['f_007'], why: 'Two sources give different values for the same measure and market. Neither is picked until the method is read.' },
      d_044: { t: '09:38', kind: 'resolve', who: 'Review agent', cls: 'ok', what: 'resolved f_007 for Kantar’s 23.4%', tgt: ['f_007', 'F2'], why: 'Kantar documents a like-for-like ROI panel. The deck gives no method and its total likely includes Northern Ireland. The deck value is kept on record, not chosen.' },
      d_045: { t: '09:44', kind: 'verdict', who: 'Review agent', cls: 'warn', what: 'held Finding 3 as Proposed: it needs a person', tgt: ['f_011', 'f_009', 'F3'], why: '2 clips are too few to state as a national habit. The 11.2M tag views show the brand is talked about, not that people share it. A person decides whether it stays as a creative hook.' },
      d_046: { t: '09:51', kind: 'report', who: 'Report agent', cls: '', what: 'composed the answer from Findings 1–3 and left f_014 out', tgt: ['F1', 'F2', 'F3', 'Answer'], why: 'Led with the social occasion (two verified pins), framed delivery as the pull home, and named the two-spoon ritual as thin rather than stating it.' }
    };
    const FR = [
      { by: 'Synthesis agent', derived: 'synthesis · claude-cli · today 09:15', ver: ['Review agent', 'today 09:20', 'Two independent samples agree within 3 points.', 'f_003'], pins: ['f_003', 'f_004'], srcs: ['s1', 's2'],
        decided: 'Kept as the primary finding: it grounds the brief’s spontaneity insight.',
        because: [['68% of out-of-home treat occasions for 16–24s are unplanned and social (n=1,400).', ['f_003']], ['That share rose 7 points since 2024, so this is a trend, not one wave.', ['f_004']], ['A second, independent sample (CSO) puts it at 65%: the sources agree within 3 points.', ['s2']]],
        rejected: [['16–24s are price-led treat buyers', 'No pin shows price as the trigger, and the objective rules out price promotion.'], ['Treats anchor on meals (lunch, after dinner)', 'Bord Bia shows 68% are unplanned; meal-anchored stops are the minority.']],
        cert: ['high', 'High', 'Both pins are High (national panel, published method) and a second source agrees.'],
        change: ['CSO’s 2026 wave puts the share below 60%.', 'Someone rejects f_003, or takes a newer Bord Bia wave into the pin.'],
        brief: ['Insight · “the treat is the excuse to stay out”'] },
      { by: 'Synthesis agent', derived: 'synthesis · claude-cli · today 09:24', ver: ['Review agent', 'today 09:38', 'Resolved for the documented ROI panel.', 'f_007'], pins: ['f_007'], srcs: ['s3', 's4'],
        decided: 'Used Kantar’s 23.4% over the client deck’s 31%.',
        because: [['Kantar is a like-for-like Republic of Ireland panel with a documented method.', ['f_007']], ['The client deck gives no method, and its total likely blends Northern Ireland with ROI.', ['s4', 'd_044']]],
        rejected: [['Client deck · 31%', 'No stated method; likely includes Northern Ireland. Kept on record, not chosen.'], ['Average the two (27%)', 'Averaging a documented and an undocumented figure would hide the disagreement.']],
        cert: ['high', 'High', 'The pin is High (purchase panel, ROI definition). The contest is resolved and the losing value is kept.'],
        change: ['The client shares the deck’s method and it turns out to be ROI only.', 'Kantar restates the tracker in its next release.'],
        brief: ['Tension · “indulgence is moving home”'] },
      { by: 'Synthesis agent', derived: 'synthesis · claude-cli · today 09:41', ver: null, pins: ['f_011', 'f_009'], srcs: ['s6', 's5'],
        decided: 'Held as Proposed only: not verified automatically.',
        because: [['Two clips (4.1k combined likes) show the two-spoon habit is recognised.', ['f_011']], ['#McFlurry has 11.2M views in Ireland: the brand is talked about, but the views say nothing about sharing.', ['f_009']]],
        rejected: [['Verify it as a national habit', '2 clips is too small a sample to state as a norm.'], ['Cut it now', 'It is a vivid creative hook; whether it stays is a person’s call.']],
        cert: ['low', 'Low · thin', 'The pin that carries it, f_011, is Low (2 clips), and one lower again because only one source shows the behaviour. f_009 supports the brand, not the habit.'],
        change: ['A wider search finds the habit at scale (20+ posts, or a second platform).', 'Social listening across Instagram agrees.'],
        look: 'Needs you: keep it as a working hypothesis, or cut it. The answer’s last sentence depends on it.',
        brief: ['Creative hook · “two spoons, one McFlurry” (if kept)'] }
    ];
    const ANS = {
      claims: [
        { f: [0], why: 'Generalises Finding 1: the occasion is social first, so the treat follows the moment.' },
        { f: [0], why: 'States f_003 as written; the 7-point rise (f_004) is why it reads as a habit.' },
        { f: [1, 0], why: 'Puts Finding 2 against Finding 1: the outing has to give a reason, or indulgence stays home.' },
        { f: [2], why: 'Names Finding 3 and says it is thin, because it is still Proposed.' }
      ],
      decided: 'Lead with the social, unplanned occasion; frame delivery growth as the pull home; carry the two-spoon ritual as a hedge, not a claim.',
      because: [['68% of treat stops are unplanned and social, up 7 points: the strongest, verified signal.', ['F1', 'f_003', 'f_004']], ['Delivery desserts grew 23.4%: the same indulgence is moving home.', ['F2', 'f_007']], ['The ritual is vivid but rests on 2 clips, so it is named as thin.', ['F3', 'f_011']]],
      rejected: [['Lead with weather: “warm days drive treats”', 'f_014 shows 18% more warm days, but no pin links warm days to what 16–24s choose. It stays out.'], ['Lead with delivery as the opportunity', 'The objective is +12% units without price promotion; delivery growth argues the outing needs a reason, not that we chase delivery.'], ['State two-spoon sharing as a national habit', '2 clips; held as Proposed (d_045).']],
      cert: ['med', 'Medium', 'Claims 1–3 rest on High pins; claim 4 rests on a Low pin and says so. The answer takes the lowest claim it states plainly, one step up because the thin one is hedged.'],
      change: ['Finding 3 is cut: the last sentence goes and certainty rises to High.', 'A wider search finds the two-spoon habit at scale: “but thin” is dropped.', 'Kantar’s next tracker shows delivery slowing: the “moves home” clause weakens.'],
      look: 'Finding 3 is still yours to call. The brief will use the last sentence only if you keep it.'
    };
    const hlP = v => String(v).replace(/(\+?\d[\d.,]*(?:%|M|\s?pts))/g, '<mark class="rs-hl">$1</mark>');
    const CLAIM_TXT = () => [...document.querySelectorAll('#r-answer .ra-c')].map(s => s.textContent.trim());
    const rd = $('rd'), head = $('rd-head'), body = $('rd-body'), acts = $('rd-acts');
    const st = { rejected: {}, cut: {}, confirmed: {}, wrong: {}, extra: [] };
    const card = i => document.querySelector(`#r-findings-list .finding-card[data-fi="${i}"]`);
    const fStatus = i => { const c = card(i); if (!c || c.hidden || st.cut[i]) return 'cut'; if (st.rejected[i]) return 'rejected'; if (c.classList.contains('proposed')) return 'proposed'; return /you/.test(($('finding-3-badge') && i === 2) ? $('finding-3-badge').textContent : '') ? 'you' : 'verified'; };
    const stPill = s => ({ verified: '<span class="rd-st ok">Verified</span>', you: '<span class="rd-st ok">Verified by you</span>', proposed: '<span class="rd-st warn fill">Proposed · needs you</span>', rejected: '<span class="rd-st bad">Rejected</span>', cut: '<span class="rd-st mute">Cut from the report</span>' })[s];
    const fStmt = i => { const c = card(i); return c ? c.querySelector('.finding-stmt').textContent.replace(/^\d+\.\s*/, '') : ''; };
    const factSt = id => st.wrong[id] ? ['bad', 'Marked wrong'] : id === 'f_007' ? ['ok', 'Active · contest resolved'] : RS_FACT[id].st === 'thin' ? ['warn', 'Thin'] : FX[id].stale ? ['warn', 'Active · layer moved'] : st.confirmed[id] ? ['ok', 'Active · confirmed by you'] : ['ok', 'Active'];
    const tierM = t => `<span class="tier t-${t.toLowerCase()}"></span>`;
    // chips
    const cite = c => {
      if (RS_FACT[c]) return `<button type="button" class="rd-cite" data-go="fact:${c}"><span class="pin"></span>${c} · ${esc(RS_FACT[c].value)}</button>`;
      if (/^F\d/.test(c)) return `<button type="button" class="rd-cite" data-go="finding:${+c.slice(1) - 1}">Finding ${c.slice(1)}</button>`;
      if (SRC[c]) return `<button type="button" class="rd-cite src" data-go="src:${c}">${tierM(SRC[c].tier)}${esc(SRC[c].n)}</button>`;
      if (DEC[c]) return `<button type="button" class="rd-cite src" data-go="dec:${c}">${c}</button>`;
      return `<span class="rd-cite">${esc(c)}</span>`;
    };
    const fNode = (i, on, me) => { const s = fStatus(i); return `<button type="button" class="rd-n ${on ? 'on' : ''} ${me ? 'me' : ''} ${s === 'cut' || s === 'rejected' ? 'cut' : ''}" data-go="finding:${i}"><i class="nd ${s === 'proposed' ? 'prop' : ''}">${i + 1}</i>Finding ${i + 1}${s === 'proposed' ? ' · proposed' : ''}</button>`; };
    const pNode = (id, on, me) => `<button type="button" class="rd-n ${on ? 'on' : ''} ${me ? 'me' : ''} ${st.wrong[id] ? 'cut' : ''}" data-go="fact:${id}"><span class="pin"></span>${id} <s>·</s> ${esc(RS_FACT[id].value)}</button>`;
    const sNode = (k, on) => `<button type="button" class="rd-n ${on ? 'on' : ''}" data-go="src:${k}">${tierM(SRC[k].tier)}${esc(SRC[k].n)}</button>`;
    const cNode = (c, on, me) => `<button type="button" class="rd-n ${on ? 'on' : ''} ${me ? 'me' : ''}" data-go="answer:${c}"><i class="sx">S${c + 1}</i>${esc(CLAIM_TXT()[c].slice(0, 30))}…</button>`;
    // provenance trail: the whole graph, the selected path lit
    function trail(path) {
      const allP = Object.keys(RS_FACT), srcs = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
      const bOn = FR.map((f, i) => path.f.has(i) && fStatus(i) !== 'cut');
      return `<div class="rd-trail">
        <div class="rd-stage"><b>Sources</b><div>${srcs.map(k => sNode(k, path.s.has(k))).join('')}</div></div>
        <div class="rd-stage"><b>Pins</b><div>${allP.map(p => pNode(p, path.p.has(p), path.me === p)).join('')}</div></div>
        <div class="rd-stage"><b>Findings</b><div>${FR.map((_, i) => fNode(i, path.f.has(i), path.me === 'F' + i)).join('')}</div></div>
        <div class="rd-stage"><b>Answer</b><div>${ANS.claims.map((_, c) => cNode(c, path.c.has(c), path.me === 'C' + c)).join('')}</div></div>
        <div class="rd-stage"><b>Brief</b><div>${FR.map((f, i) => `<span class="rd-n ${bOn[i] ? 'on' : ''}">${esc(f.brief[0].split(' · ')[0])}</span>`).join('')}</div></div>
      </div><p class="rd-note">Lit: what this rests on and what rests on it. Click any node to open it.</p>`;
    }
    const pathFrom = { f: new Set(), p: new Set(), s: new Set(), c: new Set(), me: null };
    function pathFor(kind, id) {
      const P = { f: new Set(), p: new Set(), s: new Set(), c: new Set(), me: null };
      const addF = i => { P.f.add(i); FR[i].pins.forEach(p => { P.p.add(p); P.s.add(FX[p].src); }); FR[i].srcs.forEach(s => P.s.add(s)); };
      if (kind === 'finding') { P.me = 'F' + id; addF(id); ANS.claims.forEach((c, k) => { if (c.f.includes(id)) P.c.add(k); }); }
      if (kind === 'fact') { P.me = id; P.p.add(id); P.s.add(FX[id].src); if (FX[id].corr) P.s.add(FX[id].corr[0]); if (FX[id].contest) P.s.add('s4'); RS_FACT[id].used.forEach(i => P.f.add(i)); FX[id].claims.forEach(c => P.c.add(c)); }
      if (kind === 'answer') { const cs = id == null ? ANS.claims.map((_, k) => k) : [id]; if (id != null) P.me = 'C' + id; cs.forEach(k => { P.c.add(k); ANS.claims[k].f.forEach(addF); }); }
      return P;
    }
    const sec = (id, n, t, h, em) => `<section class="rd-sec" id="rd-s-${id}" data-sec="${id}"><h4><span>${n}</span>${t}${em ? `<em>${em}</em>` : ''}</h4>${h}</section>`;
    function reasoning(R, decId) {
      return `${R.look ? `<div class="rd-look" style="margin:0 0 10px"><b>Look at this</b><span>${esc(R.look)}</span></div>` : ''}<div class="rd-why">
        <div class="rd-row dec"><b>Decided</b><span>${esc(R.decided)}</span></div>
        <div class="rd-row"><b>Because</b><ol class="rd-because">${R.because.map(([t, cs], k) => `<li><i>${k + 1}</i><div>${esc(t)}<div class="rd-cites">${cs.map(cite).join('')}</div></div></li>`).join('')}</ol></div>
        <div class="rd-row"><b>Rejected</b><ul class="rd-rej">${R.rejected.map(([o, w]) => `<li><s>${esc(o)}</s><span>${esc(w)}</span></li>`).join('')}</ul></div>
        <div class="rd-row"><b>Certainty</b><div><span class="rd-cert">${conf(R.cert[0])} ${esc(R.cert[1])}</span><div>${esc(R.cert[2])}</div><p class="rd-note">Derived from the pins, never asked of the model: the lowest pin, one lower for a single or stale cite.</p></div></div>
        <div class="rd-row"><b>Would change if</b><ul class="rd-change">${R.change.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>
      </div>${decId ? `<p class="rd-note">On the record as ${cite(decId)}</p>` : ''}`;
    }
    function pinRows(ids) {
      return `<div class="rd-pins">${ids.map(id => { const x = RS_FACT[id], s = SRC[FX[id].src], fs = factSt(id);
        return `<button type="button" class="rd-pr" data-go="fact:${id}"><span class="rd-pr-a"><span class="pin"></span>${id}${conf(x.conf)}</span><span class="rd-pr-v">${hl(esc(x.value))}</span><span class="rd-pr-b">${esc(x.fact)}</span><span class="rd-pr-c">${tierM(s.tier)}<span>${esc(s.n)}</span><span>as of ${x.asof}</span><span>retrieved ${x.ret}</span><span class="rd-st ${fs[0]}">${fs[1]}</span></span></button>`; }).join('')}</div>`;
    }
    function contestBlock() {
      return `<div class="rd-vs">
        <div class="won"><small>Chosen</small><strong>23.4%</strong><span>Kantar Worldpanel · ROI panel, documented method</span><code>pin f_007 · Category layer r_007</code></div>
        <div class="lost"><small>Not chosen · kept</small><strong>31%</strong><span>Client deck · internal, no stated method</span><code>Client layer r_007b · slide 9</code></div>
        <p class="rd-vs-why"><b>Why</b>Like-for-like ROI definition beats an undocumented total that likely includes NI · Review agent · today 09:38 · ${cite('d_043')} ${cite('d_044')}</p>
      </div>`;
    }
    function timeline(ids, fk) {
      const all = ids.map(d => [d, DEC[d]]).concat(st.extra.filter(x => fk === '*' || x[1].for === fk));
      return `<ol class="rd-tl">${all.map(([id, d]) => `<li class="${d.cls}"><div class="rd-tl-h"><span>${d.t === 'now' ? 'just now' : 'today ' + d.t}</span><span class="rd-kind">${d.kind}</span><span>${id}</span></div><details><summary><b>${esc(d.who)}</b> ${esc(d.what)}</summary><div>${esc(d.why)}</div></details><div class="rd-tgt">→ ${d.tgt.map(t => t.replace(/^F(\d)/, 'Finding $1')).join(', ')}</div></li>`).join('')}</ol>`;
    }
    function askBlock(label) {
      return `<div class="rd-form" id="rd-askf"><textarea rows="2" placeholder="Ask about ${esc(label)}…"></textarea><div class="rd-btns"><button type="button" class="rd-b pri" data-act="ask-go">Ask</button><button type="button" class="rd-b ghost" data-act="ask-x">Cancel</button></div></div>`;
    }
    // ── head ──
    function headHTML(kick, title, meta, nav, idx) {
      return `<div class="rd-top"><span class="rd-kick">${kick}</span>${nav ? `<span class="rd-nav"><button type="button" class="rd-ib" data-act="prev" ${nav[0] ? '' : 'disabled'} aria-label="Previous">‹</button><span>${nav[2]}</span><button type="button" class="rd-ib" data-act="next" ${nav[1] ? '' : 'disabled'} aria-label="Next">›</button></span>` : ''}<button type="button" class="rd-ib" data-act="close" aria-label="Close">×</button></div>
        <h3 class="rd-title">${title}</h3><div class="rd-meta">${meta}</div>
        <nav class="rd-idx">${idx.map(([k, t], n) => `<button type="button" data-idx="${k}" class="${n ? '' : 'on'}">${t}</button>`).join('')}</nav>`;
    }
    // ── views ──
    function viewAnswer(claim) {
      const T = CLAIM_TXT();
      head.innerHTML = headHTML('01 · The answer', claim == null ? 'How the answer was formed' : `Sentence ${claim + 1}: “${esc(T[claim])}”`,
        `${conf('med')}<span>Medium</span><span>· 4 sentences · 3 findings · 5 pins · 6 sources</span>`, null,
        [['claims', 'Sentences'], ['trail', 'Trail'], ['why', 'Reasoning'], ['srcs', 'Sources'], ['rec', 'Record']]);
      const claims = ANS.claims.map((c, k) => `<div class="rd-claim ${claim === k ? 'on' : ''}" data-go="answer:${k}"><q><i>S${k + 1}</i>${hlP(esc(T[k]))}</q><div class="rd-tree">${c.f.map(i => `<div class="rd-tf"><div class="rd-tf-h">${fNode(i, true)}<span>${esc(fStmt(i))}</span></div><div class="rd-tf-p">${FR[i].pins.map(p => pNode(p, true)).join('')}${FR[i].srcs.filter(s => !FR[i].pins.some(p => FX[p].src === s)).map(s => sNode(s, true)).join('')}</div></div>`).join('')}<div class="rd-tf-x">${esc(c.why)}</div></div></div>`).join('');
      const used = ['s1', 's2', 's3', 's4', 's5', 's6'], others = ['s7', 's8', 's9'];
      const srcRow = k => { const s = SRC[k]; return `<div class="rd-pr" data-go="src:${k}"><span class="rd-pr-a">${tierM(s.tier)}${esc(s.n)}</span><span class="rd-pr-v" style="font-weight:500;font-size:11px;color:var(--muted)">${s.date}</span><span class="rd-pr-c"><span>${esc(s.loc)}</span><span>${esc(s.lic)}</span><span>${s.mat}</span></span>${s.ex ? `<span class="rd-pr-b" style="color:var(--muted)">${esc(s.ex)}</span>` : ''}</div>`; };
      body.innerHTML =
        sec('claims', '01', 'Each sentence, and what it stands on', `<div class="rd-claims">${claims}</div>`, 'S → finding → pins') +
        sec('trail', '02', 'Provenance trail', trail(pathFor('answer', claim))) +
        sec('why', '03', 'Why it says this', reasoning(ANS, 'd_046')) +
        sec('srcs', '04', 'Sources read', `<div class="rd-pins">${used.map(srcRow).join('')}</div><p class="rd-note" style="margin-top:12px">Read, but not in the answer</p><div class="rd-pins">${others.map(k => k === 's7' ? srcRow(k).replace('</div>', '') + `<span class="rd-pr-b" style="color:var(--muted)">Pinned as f_014, left out of the answer: ${esc(FX.f_014.unused.split(', so')[0].replace('Pinned, but n', 'n'))}.</span></div>` : srcRow(k)).join('')}</div>`, '9 read · 41 queries') +
        sec('rec', '05', 'On the record', timeline(['d_041', 'd_042', 'd_043', 'd_044', 'd_045', 'd_046'], '*') + `<div class="rd-work" style="margin-top:14px"><b>Composed by</b><span>Report agent · report.v3 · today 09:51</span><b>From</b><span>report version 3 · facts sha <code style="font:11px var(--font-mono)">9f2c41e</code></span></div>`, '6 decisions');
      acts.innerHTML = `<div class="rd-btns"><button type="button" class="rd-b" data-act="ask">Ask about this</button><button type="button" class="rd-b" data-act="refresh">Refresh from the pins</button>${fStatus(2) === 'proposed' ? '<button type="button" class="rd-b pri" data-go="finding:2">Decide Finding 3</button>' : ''}</div>`;
    }
    function viewFinding(i) {
      const c = card(i), s = fStatus(i), f = RS_FIND[i];
      const R = s === 'you' ? Object.assign({}, FR[i], { look: null, decided: 'Kept as a working hypothesis, by Siobhán Ryan. It stays thin: the brief may use it as a creative hook, not as a fact.' }) : FR[i];
      const q = c.querySelector('.finding-quote'), qc = q ? q.cloneNode(true) : null; if (qc) qc.querySelectorAll('div').forEach(d => d.remove()); const qt = qc ? qc.textContent.trim().replace(/\s+/g, ' ') : '', ql = q && q.querySelector('div') ? q.querySelector('div').textContent : '';
      const src0 = SRC[R.srcs[0]];
      const uses = ANS.claims.map((x, k) => x.f.includes(i) ? k : -1).filter(k => k >= 0);
      const shares = [...new Set(R.pins.flatMap(p => RS_FACT[p].used))].filter(j => j !== i);
      const decs = [...new Set(R.pins.flatMap(p => FX[p].dec))].filter(d => DEC[d].tgt.includes('F' + (i + 1)) || d === 'd_041');
      if (!decs.includes('d_046')) decs.push('d_046');
      if (s === 'you' && !st.extra.some(x => x[1].for === 'F3' && x[1].cls === 'you')) st.extra.push(['d_0' + (47 + st.extra.length), { t: 'now', kind: 'verdict', who: 'Siobhán Ryan', cls: 'you', what: 'kept Finding 3 as a working hypothesis', tgt: ['F3'], why: 'Vivid enough to brief as a creative hook; not to be stated as a national habit.', for: 'F3' }]);
      head.innerHTML = headHTML(`<span class="rs-dot ${s === 'proposed' ? 'prop' : ''}">${i + 1}</span>Finding ${i + 1} · ${f.lens} · ${f.mk.join(', ')}`, esc(fStmt(i)),
        `${stPill(s)}${conf(f.conf)}<span>${R.cert[1]}</span><span>· rests on ${R.pins.length} pin${R.pins.length === 1 ? '' : 's'} · ${uses.length} answer sentence${uses.length === 1 ? '' : 's'}</span>`,
        [i > 0, i < FR.length - 1, `${i + 1} of ${FR.length}`],
        [['why', 'Reasoning'], ['ev', 'Evidence'], ['pins', 'Pins'], ['trail', 'Trail'], ['ct', 'Contests'], ['use', 'Used by'], ['rec', 'Record']]);
      const worked = `<div class="rd-work"><b>Worked out by</b><span>${R.by}</span><b>Derived</b><span>${R.derived}</span>${
        s === 'you' ? `<b>Verified by</b><span>Siobhán Ryan · just now · kept as a working hypothesis</span>` :
        R.ver ? `<b>Verified by</b><span>${R.ver[0]} · ${R.ver[1]} · “${esc(R.ver[2])}” Written to the layer as pin ${R.ver[3]}.</span>` : `<b>Verified</b><span>Not yet. Held for a person by ${cite('d_045')}</span>`}${
        st.rejected[i] ? `<b>Rejected by</b><span>Siobhán Ryan · just now · “${esc(st.rejected[i])}”</span>` : ''}</div>`;
      body.innerHTML =
        sec('why', '01', 'Why it says this', reasoning(R) + `<div style="margin-top:14px">${worked}</div>`) +
        sec('ev', '02', 'Evidence', `<blockquote class="rd-quote">${esc(qt)}</blockquote><div class="rd-srcl"><span>${tierM(src0.tier)}${esc(ql)} · ${src0.lic} · ${src0.mat}</span><button type="button" class="rd-link" data-act="opensrc">Open the source ↗</button></div>${i === 0 ? `<div class="rd-corr"><b>Second source</b>“16–24s: 65% of snack and treat stops were not planned in advance.” <span class="rd-srcl" style="display:inline-flex;margin:0">CSO Irish Life & Leisure · Mar 2026 · Table 4.2 · n=2,100</span></div>` : ''}${i === 1 ? `<div class="rd-corr"><b>Against it</b>“Delivery desserts +31% YoY” <span class="rd-srcl" style="display:inline-flex;margin:0">Client deck · Jul 2026 · slide 9 · client-confidential</span></div>` : ''}${i === 2 ? `<div class="rd-corr"><b>Second clip</b>“me and the lads with two spoons, one mcflurry, every single time” <span class="rd-srcl" style="display:inline-flex;margin:0">TikTok · Oct 2026 · 1.3k likes</span></div>` : ''}`) +
        sec('pins', '03', 'Rests on', pinRows(R.pins), `${R.pins.length} pins`) +
        sec('trail', '04', 'Provenance trail', trail(pathFor('finding', i))) +
        sec('ct', '05', 'Contests touching it', i === 1 ? contestBlock() : `<p class="rd-none">No source disagrees with ${R.pins.join(' or ')}.</p>`, i === 1 ? '1 · resolved' : 'none') +
        sec('use', '06', 'Used by', `<div class="rd-uses"><div class="rd-use"><b>Answer</b><div>${uses.length ? uses.map(k => cNode(k, true)).join('') : '<span>Not in the answer.</span>'}</div></div><div class="rd-use"><b>Brief</b><div>${esc(R.brief[0])}</div></div><div class="rd-use"><b>Shares pins</b><div>${shares.length ? shares.map(j => fNode(j, true)).join('') : '<span>No other finding uses these pins.</span>'}</div></div><div class="rd-use"><b>Coverage</b><div><span class="cov filled" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--ink)"></span>${f.lens} · ${f.mk.join(', ')} · ran today · research.v2</div></div></div>`) +
        sec('rec', '07', 'Decisions on the record', timeline(decs, 'F' + (i + 1)), `${decs.length + st.extra.filter(x => x[1].for === 'F' + (i + 1)).length}`);
      const kept = s === 'verified' || s === 'you', keepLbl = kept ? 'Keep ✓' : 'Keep';
      acts.innerHTML = s === 'cut' ? `<div class="rd-btns"><span class="rd-note" style="margin:0">Cut from the report. It stays on the record.</span></div>` :
        `<div class="rd-btns"><button type="button" class="rd-b ${s === 'proposed' ? 'pri' : ''}" data-act="keep" ${kept ? 'aria-pressed="true"' : ''}>${keepLbl}</button><button type="button" class="rd-b" data-act="cut">Cut</button><button type="button" class="rd-b" data-act="verify">Verify or reject…</button><button type="button" class="rd-b ghost" data-act="ask">Ask about this</button></div>`;
    }
    function viewFact(id) {
      const x = RS_FACT[id], F = FX[id], s = SRC[F.src], fs = factSt(id), ids = Object.keys(RS_FACT), k = ids.indexOf(id);
      head.innerHTML = headHTML(`<span class="pin"></span>Pin · ${id} · ${x.lens}`, `${esc(x.fact)}<span class="rd-big">${hl(esc(x.value))}<small>${esc(F.unit)}</small></span>`,
        `<span class="rd-st ${fs[0]}">${fs[1]}</span>${conf(x.conf)}<span>${x.conf === 'med' ? 'Medium' : x.conf === 'high' ? 'High' : 'Low'}</span><span>· as of ${x.asof}</span>`,
        [k > 0, k < ids.length - 1, `${k + 1} of ${ids.length}`],
        [['rec0', 'The pin'], ['where', 'Where from'], ['ev', 'Source'], ['use', 'Used by'], ['trail', 'Trail'], ['rec', 'Record']]);
      const corr = F.corr ? `<div class="rd-corr"><b>Corroborated by</b>${cite(F.corr[0])} ${esc(F.corr[1])}</div>` : '';
      body.innerHTML =
        sec('rec0', '01', 'The pin', `<div class="rd-kv">
          <b>Key</b><span><code>${F.key}</code></span>
          <b>Value</b><span><b style="font:600 13px var(--font-mono)">${esc(x.value)}</b> ${esc(F.unit)}</span>
          <b>Market</b><span>${F.mk}</span>
          <b>Method</b><span>${F.method}</span>
          <b>As of</b><span>${x.asof} · learned ${x.ret}</span>
          <b>Source</b><span>${tierM(s.tier)}${esc(s.n)} · tier ${s.tier}</span>
          <b>Confidence</b><span title="Derived from source tier and corroboration">${conf(x.conf)} ${x.conf === 'med' ? 'Medium' : x.conf === 'high' ? 'High' : 'Low'} · from tier ${s.tier}${F.corr ? ' + a second source' : ''}${x.st === 'thin' ? ', one sample' : ''}</span>
          <b>Licence</b><span>${s.lic}${s.lic === 'Licensed panel' ? ' · fine to quote in the brief, not to export the table' : ''}</span>
          <b>Status</b><span><span class="rd-st ${fs[0]}">${fs[1]}</span></span>
        </div>${F.stale ? `<div class="rd-stale"><b>Stale</b>The layer moved to ${F.stale[0]}; its current value is ${F.stale[1]}. This pin stays at ${x.value} until you run again to take it.</div>` : ''}${F.unused ? `<div class="rd-stale"><b>Not used</b>${esc(F.unused)}</div>` : ''}`) +
        sec('where', '02', 'Where it came from', `<ol class="r-chain"><li class="on"><span>Source</span>${esc(s.n)} · ${s.tier} · ${esc(s.loc)}</li><li class="on"><span>Knowledge layer row</span>${F.row}, row ${F.rid} · layer ${F.stale ? 'v2 (now ' + F.stale[0] + ')' : 'v2'}</li><li class="on"><span>Frozen pin</span>a frozen copy, ${x.ret}. A pin never follows a newer row; you choose when to take one.</li><li class="on"><span>Origin</span><code>fact://mcd/ie/${id}@v2</code> · extracted by ${cite('d_041')}</li></ol>`) +
        sec('ev', '03', 'Source', `<blockquote class="rd-quote">${esc(F.quote)}</blockquote><div class="rd-srcl">${tierM(s.tier)}<span>${esc(s.n)} · ${s.date} · ${esc(s.loc)} · ${s.lic} · ${s.mat}</span><button type="button" class="rd-link" data-act="opensrc">Open the source ↗</button></div>${corr}${F.contest ? `<div style="margin-top:12px">${contestBlock()}</div>` : ''}`) +
        sec('use', '04', 'Used by', `<div class="rd-uses"><div class="rd-use"><b>Findings</b><div>${x.used.length ? x.used.map(i => fNode(i, true)).join('') : '<span>No finding uses it.</span>'}</div></div><div class="rd-use"><b>Answer</b><div>${F.claims.length ? F.claims.map(c => cNode(c, true)).join('') : '<span>Not in the answer.</span>'}</div></div><div class="rd-use"><b>Brief</b><div>${x.used.length ? x.used.map(i => esc(FR[i].brief[0])).join('<br>') : '<span>—</span>'}</div></div></div>`) +
        sec('trail', '05', 'Provenance trail', trail(pathFor('fact', id))) +
        sec('rec', '06', 'On the record', timeline(F.dec, id), `${F.dec.length + st.extra.filter(x => x[1].for === id).length}`);
      acts.innerHTML = `<div class="rd-btns"><button type="button" class="rd-b" data-act="confirm" ${st.confirmed[id] ? 'aria-pressed="true"' : ''}>${st.confirmed[id] ? 'Confirmed ✓' : 'Confirm'}</button><button type="button" class="rd-b" data-act="wrong">${st.wrong[id] ? 'Marked wrong' : 'Mark wrong…'}</button><button type="button" class="rd-b ghost" data-act="ask">Ask about this</button></div>`;
    }
    // ── open / close / fit ──
    let cur = null;
    function fit(anchor) {
      const ws = $('r-workspace'), before = anchor ? anchor.getBoundingClientRect().top : 0;
      if (!rd.classList.contains('open') || innerWidth <= 1100) ws.style.gridTemplateColumns = '';
      else {
        const w = rd.getBoundingClientRect().width, wr = ws.getBoundingClientRect().right;
        const over = (wr - 320 - 24) + 28 - (innerWidth - w);
        ws.style.gridTemplateColumns = over > 0 ? `minmax(0, 1fr) ${Math.ceil(320 + over)}px` : '';
      }
      if (anchor) requestAnimationFrame(() => setTimeout(() => { const d = anchor.getBoundingClientRect().top - before; if (Math.abs(d) > 2) scrollBy({ top: d, behavior: 'instant' }); }, 240));
    }
    function setTop() { const tb = document.querySelector('.topbar-outer'); rd.style.setProperty('--rd-top', (tb ? Math.max(0, Math.round(tb.getBoundingClientRect().bottom)) : 63) + 'px'); }
    function open(kind, id, anchor) {
      const keepScroll = cur && cur.kind === kind && cur.id === id;
      const sTop = body.scrollTop, secOn = keepScroll ? (head.querySelector('.rd-idx .on') || {}).dataset : null;
      cur = { kind, id };
      if (kind === 'answer') viewAnswer(id); else if (kind === 'finding') viewFinding(id); else viewFact(id);
      setTop();
      const was = rd.classList.contains('open');
      rd.classList.add('open'); rd.setAttribute('aria-hidden', 'false'); document.body.classList.add('rd-open');
      if (!was) fit(anchor);
      if (keepScroll) { body.style.scrollBehavior = 'auto'; body.scrollTop = sTop; body.style.scrollBehavior = ''; if (secOn) markIdx(secOn.idx); }
      else { body.style.scrollBehavior = 'auto'; body.scrollTop = 0; body.style.scrollBehavior = ''; }
      if (kind === 'answer' && id != null) { const el = body.querySelector('.rd-claim.on'); if (el && !keepScroll) body.scrollTop = Math.max(0, el.offsetTop - 70); }
    }
    function close() {
      if (!rd.classList.contains('open')) return;
      const anchor = document.querySelector('#research-sheet .sel') || null;
      cur = null; rd.classList.remove('open'); rd.setAttribute('aria-hidden', 'true'); document.body.classList.remove('rd-open'); fit(anchor);
    }
    const markIdx = k => head.querySelectorAll('.rd-idx button').forEach(b => b.classList.toggle('on', b.dataset.idx === k));
    body.addEventListener('scroll', () => { const secs = [...body.querySelectorAll('.rd-sec')]; let on = secs[0]; secs.forEach(s => { if (s.offsetTop - body.scrollTop < 90) on = s; }); if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) on = secs[secs.length - 1]; if (on) markIdx(on.dataset.sec); }, { passive: true });
    addEventListener('resize', () => { if (rd.classList.contains('open')) fit(); });
    addEventListener('scroll', () => { if (rd.classList.contains('open')) setTop(); }, { passive: true });

    // ── the selection: replaces the narrow side-bar part ──
    rsSelect = function (kind, id) {
      document.querySelectorAll('#research-sheet .sel').forEach(x => x.classList.remove('sel'));
      document.querySelectorAll('#r-answer .ra-on').forEach(x => x.classList.remove('ra-on'));
      const part = $('r-side-part'); part.hidden = true; part.innerHTML = '';
      if (!kind) { rsSel = null; close(); return; }
      let anchor = null;
      if (kind === 'finding') { const c = card(id); if (!c || c.hidden) { rsSel = null; close(); return; } c.classList.add('sel'); anchor = c; }
      else if (kind === 'fact') { if (!RS_FACT[id]) return; const row = document.querySelector(`#r-facts-body tr[data-fact="${id}"]`); if (row) { row.classList.add('sel'); anchor = row; } }
      else if (kind === 'answer') { $('r-answer').classList.add('sel'); anchor = $('r-answer'); if (id != null) { const s = document.querySelector(`#r-answer .ra-c[data-claim="${id}"]`); if (s) s.classList.add('ra-on'); } }
      rsSel = { kind, id };
      open(kind, id, anchor);
    };
    const goSheet = (kind, id) => { rsSelect(kind, id); const el = kind === 'finding' ? card(id) : kind === 'fact' ? document.querySelector(`#r-facts-body tr[data-fact="${id}"]`) : $('r-answer'); if (el) { const r = el.getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 20) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };

    // sheet: the answer, the contest, the record
    $('r-answer').addEventListener('click', e => {
      if (e.target.closest('.r-askbox, textarea, input')) return;
      e.stopPropagation();
      const c = e.target.closest('.ra-c');
      const id = c ? +c.dataset.claim : null;
      if (rsSel && rsSel.kind === 'answer' && rsSel.id === id && !e.target.closest('#r-ans-how')) { rsSelect(null); return; }
      rsSelect('answer', e.target.closest('#r-ans-how') ? null : id);
    });
    document.querySelector('#r-contests .r-vs').addEventListener('click', e => { e.stopPropagation(); rsSelect('fact', 'f_007'); });
    const LOGMAP = { d_041: ['answer', null], d_042: ['finding', 0], d_043: ['fact', 'f_007'], d_044: ['finding', 1], d_045: ['finding', 2], d_046: ['answer', null] };
    document.querySelectorAll('.r-log ol.decision-tl li').forEach(li => li.addEventListener('click', e => { e.stopPropagation(); const m = li.textContent.match(/d_04\d/); if (m && LOGMAP[m[0]]) rsSelect(...LOGMAP[m[0]]); }));

    // drawer: navigation and actions
    let askLabel = '';
    rd.addEventListener('click', e => {
      e.stopPropagation();
      const ix = e.target.closest('[data-idx]');
      if (ix) { const s = body.querySelector(`#rd-s-${ix.dataset.idx}`); if (s) { body.scrollTop = s.offsetTop - 8; markIdx(ix.dataset.idx); } return; }
      const go = e.target.closest('[data-go]');
      if (go && !e.target.closest('[data-act]')) {
        const [k, v] = go.dataset.go.split(':');
        if (k === 'fact') return goSheet('fact', v);
        if (k === 'finding') return goSheet('finding', +v);
        if (k === 'answer') return goSheet('answer', v === 'null' ? null : +v);
        if (k === 'src') { const s = SRC[v]; showToast(`${s.n} · ${s.date} · ${s.loc} · ${s.lic}`); return; }
        if (k === 'dec') { const s = body.querySelector('[data-sec="rec"]'); if (s) { body.scrollTop = s.offsetTop - 8; [...s.querySelectorAll('li')].forEach(li => { if (li.textContent.includes(v)) { const d = li.querySelector('details'); if (d) d.open = true; } }); } return; }
      }
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'close') return rsSelect(null);
      if (act === 'prev' || act === 'next') {
        const d = act === 'prev' ? -1 : 1;
        if (cur.kind === 'finding') { let j = cur.id + d; while (card(j) && card(j).hidden) j += d; if (card(j)) goSheet('finding', j); }
        else if (cur.kind === 'fact') { const ids = Object.keys(RS_FACT), j = ids.indexOf(cur.id) + d; if (ids[j]) goSheet('fact', ids[j]); }
        return;
      }
      if (act === 'opensrc') { const id = cur.kind === 'fact' ? FX[cur.id].src : FR[cur.id].srcs[0]; showToast(`Opening ${SRC[id].n} · ${SRC[id].mat} (mock)`); return; }
      if (act === 'refresh') { $('r-refresh').click(); return; }
      if (act === 'ask') {
        askLabel = cur.kind === 'finding' ? `Finding ${cur.id + 1}` : cur.kind === 'fact' ? cur.id : cur.id == null ? 'the answer' : `sentence ${cur.id + 1}`;
        if (!$('rd-askf')) acts.insertAdjacentHTML('afterbegin', askBlock(askLabel));
        $('rd-askf').querySelector('textarea').focus(); return;
      }
      if (act === 'ask-x') { const f = $('rd-askf'); if (f) f.remove(); return; }
      if (act === 'ask-go') {
        const f = $('rd-askf'), q = f.querySelector('textarea').value.trim(); if (!q) { f.querySelector('textarea').focus(); return; }
        const job = document.createElement('div'); job.className = 'rd-job'; job.innerHTML = `<span class="r-job-dot"></span><span><b>Research agent</b> is looking into ${esc(askLabel)}: “${esc(q)}”</span>`;
        f.replaceWith(job);
        setTimeout(() => { const [, ans, cites] = ASK_ANS.find(([re]) => re.test(q)); const box = document.createElement('div'); box.className = 'rd-ans'; box.innerHTML = `<div class="r-ans-q">${esc(q)}</div><div>${hlP(esc(ans))}</div><div class="rd-cites">${cites.map(c => RS_FACT[c] ? cite(c) : `<span class="rd-cite"><span class="pin"></span>${c} · new pin</span>`).join('')}</div>`; job.replaceWith(box); }, 1800);
        return;
      }
      if (cur.kind === 'finding') {
        const i = cur.id, s = fStatus(i);
        if (act === 'keep') { if (s === 'proposed') { $('r-approve-finding').click(); } else if (s === 'rejected') { delete st.rejected[i]; card(i).classList.remove('rd-rejected'); showToast(`Finding ${i + 1} kept. The rejection is withdrawn, and stays on the record.`); open('finding', i); } else showToast(`Finding ${i + 1} kept. ${FR[i].ver ? 'Verified by ' + FR[i].ver[0] : 'Verified by you'}.`); return; }
        if (act === 'cut') {
          if (i === 2 && s === 'proposed') { $('r-drop-finding').click(); return; }
          if (!$('rd-cutf')) acts.insertAdjacentHTML('afterbegin', `<div class="rd-form" id="rd-cutf"><p>Take Finding ${i + 1} out of the report? ${ANS.claims.some(c => c.f.includes(i)) ? 'The answer cites it, so the answer will be flagged until it is refreshed.' : ''}</p><div class="rd-btns"><button type="button" class="rd-b pri" data-act="cut-yes">Take it out</button><button type="button" class="rd-b ghost" data-act="cut-no">Keep it</button></div></div>`);
          return;
        }
        if (act === 'cut-no') { $('rd-cutf').remove(); return; }
        if (act === 'cut-yes') { st.cut[i] = true; card(i).hidden = true; showToast(`Finding ${i + 1} cut. It stays on the record.`); rsSelect(null); return; }
        if (act === 'verify') {
          if (!$('rd-verf')) acts.insertAdjacentHTML('afterbegin', `<div class="rd-form" id="rd-verf"><p>Verify Finding ${i + 1}, or reject it and say what is wrong. A rejection flags every part of the brief that cites it.</p><div class="rd-presets"><button type="button" data-preset="The sample is too small">Sample too small</button><button type="button" data-preset="The source is out of date">Out of date</button><button type="button" data-preset="It does not fit this market">Wrong market</button></div><textarea rows="2" placeholder="What is wrong with it? (needed to reject)"></textarea><div class="rd-btns"><button type="button" class="rd-b pri" data-act="ver-yes">Verify</button><button type="button" class="rd-b" data-act="ver-no">Reject</button><button type="button" class="rd-b ghost" data-act="ver-x">Cancel</button></div></div>`);
          return;
        }
        if (act === 'ver-x') { $('rd-verf').remove(); return; }
        if (act === 'ver-yes') { if (s === 'proposed') { $('r-approve-finding').click(); } else { delete st.rejected[i]; card(i).classList.remove('rd-rejected'); showToast(`Finding ${i + 1} verified by you.`); open('finding', i); } return; }
        if (act === 'ver-no') { const t = $('rd-verf').querySelector('textarea'); if (!t.value.trim()) { t.focus(); t.placeholder = 'Say what is wrong to reject it'; return; } st.rejected[i] = t.value.trim(); card(i).classList.add('rd-rejected'); st.extra.push(['d_0' + (47 + st.extra.length), { t: 'now', kind: 'verdict', who: 'Siobhán Ryan', cls: 'contest', what: `rejected Finding ${i + 1}`, tgt: ['F' + (i + 1)], why: t.value.trim(), for: 'F' + (i + 1) }]); showToast(`Finding ${i + 1} rejected. The answer is flagged until you refresh it.`); open('finding', i); return; }
      }
      if (cur.kind === 'fact') {
        const id = cur.id;
        if (act === 'confirm') { st.confirmed[id] = !st.confirmed[id]; delete st.wrong[id]; showToast(st.confirmed[id] ? `${id} confirmed. Written to the record.` : `${id}: confirmation withdrawn.`); open('fact', id); return; }
        if (act === 'wrong') { if (!$('rd-wrongf')) acts.insertAdjacentHTML('afterbegin', `<div class="rd-form" id="rd-wrongf"><p>What is wrong with ${id}? Findings that rest on it will be flagged.</p><div class="rd-presets"><button type="button" data-preset="A newer figure exists">Newer figure exists</button><button type="button" data-preset="Wrong market">Wrong market</button><button type="button" data-preset="Misread from the source">Misread</button></div><textarea rows="2" placeholder="Say what is wrong…"></textarea><div class="rd-btns"><button type="button" class="rd-b pri" data-act="wrong-yes">Mark wrong</button><button type="button" class="rd-b ghost" data-act="wrong-x">Cancel</button></div></div>`); return; }
        if (act === 'wrong-x') { $('rd-wrongf').remove(); return; }
        if (act === 'wrong-yes') { const t = $('rd-wrongf').querySelector('textarea'); if (!t.value.trim()) { t.focus(); return; } st.wrong[id] = t.value.trim(); delete st.confirmed[id]; st.extra.push(['d_0' + (47 + st.extra.length), { t: 'now', kind: 'verdict', who: 'Siobhán Ryan', cls: 'contest', what: `marked ${id} wrong`, tgt: [id].concat(RS_FACT[id].used.map(i => 'F' + (i + 1))), why: t.value.trim(), for: id }]); showToast(`${id} marked wrong. ${RS_FACT[id].used.length ? 'Finding ' + RS_FACT[id].used.map(i => i + 1).join(', ') + ' flagged.' : ''}`); open('fact', id); return; }
      }
    });
    rd.addEventListener('click', e => { const p = e.target.closest('[data-preset]'); if (p) { const t = p.closest('.rd-form').querySelector('textarea'); t.value = p.dataset.preset; t.focus(); } });
    rd.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.closest('#rd-askf')) { e.preventDefault(); rd.querySelector('[data-act="ask-go"]').click(); } });
    // after Keep / Cut on Finding 3 from the side, refresh what the drawer shows
    $('r-approve-finding').addEventListener('click', () => { const fp = document.querySelector('#finding-3-card .f-prop'); if (fp) fp.remove(); });
    ['r-approve-finding', 'r-drop-finding'].forEach(b => $(b).addEventListener('click', () => setTimeout(() => { if (cur && cur.kind !== 'finding') open(cur.kind, cur.id); }, 10)));
    window.__rdOpen = (k, i) => rsSelect(k, i);
  })();
"""
sub("""  if (urlBrand && AGENCIES[urlBrand]) applyBrandSkin(urlBrand);
})();
</script>""", "  if (urlBrand && AGENCIES[urlBrand]) applyBrandSkin(urlBrand);\n" + JS + """})();
</script>""")

OUT.write_text(html, encoding="utf-8")
print("wrote", OUT, len(html))
