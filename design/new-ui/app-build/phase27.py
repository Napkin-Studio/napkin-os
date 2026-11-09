# Phase 27 (2026-11-09): Lock button sized properly; a brief starts with its client's brand applied (no asking);
# the source card follows the theme.
rep("  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { tpl: 'basic', base: null, cacc: null, logos: [], brand: null, dismissed: false, aud: 'internal', doc: 'off' });",
    """  const bt = () => {
    if (!BT[curBriefKey]) {
      const k = kitOf(curClient), withAg = !(AGENCIES[curBrand] || {}).isDefault;
      BT[curBriefKey] = { tpl: 'basic', base: k.sw[0], cacc: k.sw[1], logos: [{ kind: 'client' }].concat(withAg ? [{ kind: 'agency' }] : []), brand: curClient + '@v' + k.v, dismissed: true, aud: 'internal', doc: 'off' };
    }
    return BT[curBriefKey];
  };""")
rep('\n</style>', r"""
/* side-tab buttons keep their size */
.look-inspector > * { flex-shrink: 0; }
.b-lock-side { height: 36px; display: inline-flex; align-items: center; justify-content: center; font: 600 13px var(--font-ui); border-radius: 8px; }
/* source card follows the theme */
html[data-theme="dark"] .src-card { background-color: var(--card); color: var(--ink); border-color: var(--line); box-shadow: 0 12px 28px -18px rgba(0,0,0,.7);
  background-image: repeating-linear-gradient(transparent 0 27px, rgba(239,233,222,.05) 27px 28px); }
html[data-theme="dark"] .src-card dl, html[data-theme="dark"] .src-spine, html[data-theme="dark"] .src-acts { background: transparent; }
html[data-theme="dark"] .src-kind, html[data-theme="dark"] .src-pub, html[data-theme="dark"] .src-card dt, html[data-theme="dark"] .src-spine span { color: var(--muted); }
html[data-theme="dark"] .src-card blockquote, html[data-theme="dark"] .src-spine { border-color: var(--ink); }
html[data-theme="dark"] .src-spine li::before { background: var(--ink); }
html[data-theme="dark"] .src-spine li.use::before { background: #F6E36B; box-shadow: 0 0 0 1.5px var(--ink); }
html[data-theme="dark"] .src-acts { border-color: var(--line); }
html[data-theme="dark"] .src-acts .sp-btn { background: transparent; color: var(--ink); border-color: var(--line); }
html[data-theme="dark"] .src-acts .side-link, html[data-theme="dark"] .src-link { color: var(--ink); }
</style>""", 1)
rep('\n</style>', r"""
#r-side-show, #r-srcmix { display: none !important; }
#r-side-show { }
#r-side div:has(> #r-side-show), #r-side div:has(> #r-srcmix) { display: none !important; }
</style>""", 1)
rep('''          <button type="button" class="sp-btn b-lock-side" id="b-lock-side">Lock the brief</button>''',
    '''          <div class="b-state" id="b-state"><b>Brief</b><span id="b-state-t">Draft · v1.3 · edited 2 days ago</span></div>
          <button type="button" class="sp-btn b-lock-side" id="b-lock-side">Lock the brief</button>''')
rep("    $('b-lock-side').textContent = briefLocked ? 'Unlock' : 'Lock the brief'; renderAppSlot();",
    "    $('b-lock-side').textContent = briefLocked ? 'Unlock' : 'Lock the brief'; $('b-state-t').textContent = briefLocked ? 'Locked · v1.3 · by Siobhán Ryan, today' : 'Draft · v1.3 · edited 2 days ago'; $('b-state').classList.toggle('locked', briefLocked); renderAppSlot();")
rep('\n</style>', r"""
.b-state { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; }
.b-state b { font: 700 13.5px var(--font-ui); }
.b-state span { font: 11px var(--font-mono); color: var(--muted); }
.b-state.locked span { color: var(--ok); }
</style>""", 1)
# status as a visible pill (Research Report box + Brief side tab)
rep('<div class="r-rep-h"><b>Report</b><span id="r-rep-st">Draft · refreshed 4m ago</span></div>',
    '<div class="r-rep-h"><b>Report <span class="st-chip" id="r-rep-chip">Draft</span></b><span id="r-rep-st">refreshed 4m ago</span></div>')
rep("    $('r-rep-st').textContent = locked ? 'Locked by Siobhán Ryan · today' : 'Draft · unlocked';",
    "    $('r-rep-st').textContent = locked ? 'by Siobhán Ryan · today' : 'unlocked just now'; $('r-rep-chip').textContent = locked ? 'Locked' : 'Draft'; $('r-rep-chip').classList.toggle('locked', locked);")
rep("    setTimeout(() => { $('r-rep-st').textContent = 'Draft · refreshed just now';", "    setTimeout(() => { $('r-rep-st').textContent = 'refreshed just now';")
rep('<div class="b-state" id="b-state"><b>Brief</b><span id="b-state-t">Draft · v1.3 · edited 2 days ago</span></div>',
    '<div class="b-state" id="b-state"><b>Brief <span class="st-chip" id="b-state-chip">Draft</span></b><span id="b-state-t">v1.3 · edited 2 days ago</span></div>')
rep("$('b-state-t').textContent = briefLocked ? 'Locked · v1.3 · by Siobhán Ryan, today' : 'Draft · v1.3 · edited 2 days ago';",
    "$('b-state-t').textContent = briefLocked ? 'v1.3 · by Siobhán Ryan, today' : 'v1.3 · edited 2 days ago'; $('b-state-chip').textContent = briefLocked ? 'Locked' : 'Draft'; $('b-state-chip').classList.toggle('locked', briefLocked);")
rep('\n</style>', r"""
.st-chip { display: inline-flex; align-items: center; margin-left: 8px; padding: 2px 9px; border: 1px solid var(--line-strong); border-radius: 999px; font: 700 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--ink); vertical-align: 2px; }
.st-chip.locked { border-color: var(--ok); color: #fff; background: var(--ok); }
.r-rep-h, .b-state { align-items: center; }
</style>""", 1)
rep('\n</style>', r"""
.st-chip { padding: 4px 12px !important; font-size: 11.5px !important; letter-spacing: .12em !important; border: 0 !important; background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn) !important; }
.st-chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; margin-right: 7px; }
.st-chip.locked { background: var(--ok) !important; color: #fff !important; }
html[data-theme="dark"] .st-chip { background: color-mix(in srgb, var(--warn) 22%, transparent); }
</style>""", 1)
