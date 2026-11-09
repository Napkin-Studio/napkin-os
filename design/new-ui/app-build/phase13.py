# Phase 13 (2026-11-08): polish (needs pill, no red rule under logos, toast wording) + dark mode for the app.
# The brief stays a light sheet of paper on the dark desk.

rep(".gi.needs .gi-head h3::after { content: \"Needs your call\"; margin-left: 10px; padding: 2px 7px; border-radius: 999px; background: var(--warn); color: #fff; font: 700 9.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; vertical-align: 1px; }",
    ".gi.needs::before { content: \"Needs your call\"; position: absolute; top: 14px; right: 10px; padding: 2px 8px; border-radius: 999px; background: var(--warn); color: #fff; font: 700 9.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; z-index: 2; }\n.gi.needs .gi-head { padding-right: 130px; }")
rep(".b-ident.b-basic { border-bottom: 1px solid color-mix(in srgb, var(--b-text) 12%, transparent) !important; }",
    ".brief-page .b-ident.b-basic, .brief-page .b-ident { border-bottom: 1px solid color-mix(in srgb, var(--b-text) 12%, transparent) !important; }")
rep("        showToast(a === 'apply' ? kit.name + \"'s brand applied: logos and colours from Brand Clan v\" + kit.v + '.' : 'Reset to the Brand Clan kit.');",
    "        showToast(a === 'apply' ? 'Brand applied: ' + kit.name + ' logos and colours from Brand Clan v' + kit.v + '.' : 'Reset to the Brand Clan kit.');")

# ═══ dark mode ═══
rep('    <button type="button" class="tb-decisions-btn" id="tb-decisions-btn" aria-expanded="false">',
    '''    <button type="button" class="tb-theme" id="tb-theme" title="Dark mode" aria-pressed="false">
      <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>
      <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>
    </button>
    <button type="button" class="tb-decisions-btn" id="tb-decisions-btn" aria-expanded="false">''')
rep("  // Desk card deep links\n", r'''  (function themeToggle() {
    const root = document.documentElement, btn = $('tb-theme');
    let pref = null; try { pref = localStorage.getItem('napkin-app-theme'); } catch (e) {}
    const sysDark = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref ? pref === 'dark' : sysDark.matches;
      root.dataset.theme = dark ? 'dark' : 'light';
      btn.setAttribute('aria-pressed', String(dark)); btn.title = dark ? 'Light mode' : 'Dark mode';
    };
    apply();
    sysDark.addEventListener('change', () => { if (!pref) apply(); });
    btn.addEventListener('click', () => { pref = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('napkin-app-theme', pref); } catch (e) {} apply(); });
  })();

  // Desk card deep links
''', 1)
rep(".colour-rows { display: grid; }", r""".colour-rows { display: grid; }
.tb-theme { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--paper); color: var(--ink); display: grid; place-items: center; cursor: pointer; margin-right: 8px; }
.tb-theme svg { width: 17px; height: 17px; }
.tb-theme .i-sun, html[data-theme="dark"] .tb-theme .i-moon { display: none; }
html[data-theme="dark"] .tb-theme .i-sun { display: block; }
/* ── Dark mode: the desk goes dark; the brief stays paper ── */
html[data-theme="dark"] {
  --desk: #151412; --paper: #1E1C19; --paper-2: #262320; --card: #221F1C;
  --ink: #EFE9DE; --ink-soft: #D6CEC0; --muted: #A49B8D; --faint: #7B7367;
  --line: #34302A; --line-strong: #CFC6B6;
  --warn: #E09A4B; --warn-soft: #3A2A18; --ok: #5DBB83; --ok-soft: #1C2E23;
  color-scheme: dark;
}
html[data-theme="dark"] .topbar-outer { background: rgba(21, 20, 18, .92); }
html[data-theme="dark"] .brief-page { color-scheme: light; --b-text: #2A2620; --b-muted: #6D655A; color: #2A2620; box-shadow: 0 24px 60px -24px rgba(0,0,0,.7); border-color: transparent; }
html[data-theme="dark"] .bm-sheet::before { background: linear-gradient(225deg, var(--desk) 50%, transparent 50%); }
html[data-theme="dark"] .side-part, html[data-theme="dark"] .brand-line, html[data-theme="dark"] .lbox, html[data-theme="dark"] .logo-menu,
html[data-theme="dark"] .redraft-ask, html[data-theme="dark"] .logo-edit, html[data-theme="dark"] .le-prev, html[data-theme="dark"] .cp-menu,
html[data-theme="dark"] .nb-act button, html[data-theme="dark"] .theme-custom input { background: var(--card); color: var(--ink); }
html[data-theme="dark"] .needs-box { background: color-mix(in srgb, var(--warn) 10%, var(--card)); }
html[data-theme="dark"] .nb-a { color: var(--ok); }
html[data-theme="dark"] .cp-row:hover, html[data-theme="dark"] .np-row:hover, html[data-theme="dark"] .cp-menu button:hover, html[data-theme="dark"] .logo-menu button:hover, html[data-theme="dark"] .tb-client:hover { background: #2A2723; }
html[data-theme="dark"] .bl-apply, html[data-theme="dark"] .ra-go, html[data-theme="dark"] .btn-rect.primary, html[data-theme="dark"] .side-save { background: var(--ink); color: #151412; border-color: var(--ink); }
html[data-theme="dark"] .seg-row button[aria-pressed="true"] { background: var(--ink); color: #151412; }
html[data-theme="dark"] .cl-disc, html[data-theme="dark"] .dz-out path, html[data-theme="dark"] .dz-new path { fill: var(--card); }
html[data-theme="dark"] .cl-disc { background: var(--card); }
html[data-theme="dark"] .dz path { stroke: #3A362F; }
html[data-theme="dark"] .dz-out.dz-needs path { fill: #2E2A24; }
html[data-theme="dark"] .dz-out:hover path { fill: #2A2723; }
html[data-theme="dark"] .dial-hub { box-shadow: 0 0 0 4px var(--card), 0 0 0 6px var(--ag-acc); }
html[data-theme="dark"] .rs-prompt .prompt-ta, html[data-theme="dark"] .bm-prompt .prompt-ta { background-color: var(--card); color: var(--ink); }
html[data-theme="dark"] .bm-prompt .prompt-ta { background-image: repeating-linear-gradient(transparent 0 26px, rgba(122,156,198,.18) 26px 27px); }
html[data-theme="dark"] .rs-prompt .prompt-ta { border-color: var(--ink); }
html[data-theme="dark"] #r-start-run { background: var(--ink); color: #151412; }
html[data-theme="dark"] .research-sheet, html[data-theme="dark"] .finding-card { background-color: var(--card) !important; }
html[data-theme="dark"] .rs-node { box-shadow: 0 0 0 4px var(--card); }
html[data-theme="dark"] #r-findings-list::before, html[data-theme="dark"] .finding-quote { border-color: var(--ink) !important; }
html[data-theme="dark"] .fid-chip { background: var(--card) !important; border-color: var(--line-strong) !important; color: var(--ink); }
html[data-theme="dark"] .mock-panel { background: rgba(30,28,25,.97); }
html[data-theme="dark"] .mock-head { color: var(--ink-soft); }
html[data-theme="dark"] .bm-card { background: #2B261C !important; border-color: #5A4A2A !important; }
html[data-theme="dark"] .bm-card b { color: var(--ink); }
html[data-theme="dark"] .bm-card .bm-tab { background: #2B261C; border-color: #5A4A2A; color: #E7D5AC; }
html[data-theme="dark"] .bm-peek { background: var(--card); }
html[data-theme="dark"] .rs-card { background-color: var(--card) !important; }
html[data-theme="dark"] .rs-band { background: #0E0D0C; }
html[data-theme="dark"] .look-inspector, html[data-theme="dark"] .processing-wrap, html[data-theme="dark"] .proc-topbar { background: var(--paper); }
html[data-theme="dark"] .wcard, html[data-theme="dark"] .paper-composer { background: var(--card); color: var(--ink); }""")
rep("html[data-theme=\"dark\"] .research-sheet,", "html[data-theme=\"dark\"] .r-header { background: #0B0A09; color: #EFE9DE; }\nhtml[data-theme=\"dark\"] .r-question { color: #EFE9DE; }\nhtml[data-theme=\"dark\"] .r-header .eyebrow, html[data-theme=\"dark\"] .r-header p { color: rgba(239,233,222,.65) !important; }\nhtml[data-theme=\"dark\"] mark.rs-hl { color: #151412; }\nhtml[data-theme=\"dark\"] .rs-node { background: #EFE9DE; color: #151412; }\nhtml[data-theme=\"dark\"] .research-sheet,")
rep("html[data-theme=\"dark\"] mark.rs-hl { color: #151412; }", "html[data-theme=\"dark\"] mark.rs-hl { color: #151412; background: var(--rs-hl); }")

# "Why it says this" folded by default; remembers if you open it
rep('<details class="sp-why" open><summary>Why it says this</summary>', '<details class="sp-why" ${window.__whyOpen ? \'open\' : \'\'}><summary>Why it says this</summary>')
rep("  // Side tab actions for the selected part\n", "  // Side tab actions for the selected part\n  $('look-inspector').addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('sp-why')) window.__whyOpen = e.target.open; }, true);\n")

# Redraft indicator: a small light pill on the part's top edge (the paper stays light in dark mode), text stays readable
rep(".agent-work { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 12px; z-index: 4; pointer-events: none; }",
    ".agent-work { position: absolute; top: -14px; left: 10px; display: flex; align-items: center; gap: 8px; z-index: 4; pointer-events: none; padding: 4px 12px 4px 4px; border-radius: 999px; background: #FFFDF8; border: 1px solid #E2D9C8; box-shadow: 0 6px 16px -8px rgba(20,20,19,.35); }")
rep(".aw-t { display: grid; background: var(--paper); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; box-shadow: 0 8px 20px -12px rgba(20,20,19,.35); }",
    ".aw-t { display: flex; align-items: baseline; gap: 6px; background: none; border: 0; padding: 0; box-shadow: none; color: #2A2620; }")
rep(".aw-t b { font: 700 12.5px var(--font-ui); } .aw-t small { font-size: 12px; color: var(--muted); max-width: 280px; }",
    ".aw-t b { font: 700 12px var(--font-ui); color: #2A2620; } .aw-t small { font-size: 12px; color: #6D655A; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }")
rep(".mini-orb { position: relative; width: 54px; height: 54px;", ".mini-orb { position: relative; width: 24px; height: 24px; flex: none;")
rep(".mini-orb i { width: 40px; height: 40px;", ".mini-orb i { width: 18px; height: 18px;")
rep(".gi.working > *:not(.agent-work):not(.gi-grip):not(.gi-resize) { opacity: .35; filter: blur(.4px); transition: opacity .3s; }",
    ".gi.working > *:not(.agent-work):not(.gi-grip):not(.gi-resize) { opacity: .5; transition: opacity .3s; }\n.gi.working { background-image: linear-gradient(100deg, transparent 30%, rgba(201,70,42,.06) 50%, transparent 70%); background-size: 200% 100%; animation: aw-sheen 1.4s linear infinite; }\n@keyframes aw-sheen { from { background-position: 150% 0; } to { background-position: -50% 0; } }\n.sheet-work { place-items: start center; padding-top: 120px; }\n.sheet-work .agent-work { position: static; }")

# Redraft: a real, live Brief agent sphere (same 3D engine as the agents screen) in the pill.
rep('    return `<div class="agent-work"><span class="mini-orb"><i></i></span><span class="aw-t"><b>Brief agent</b><small>${esc(label)}</small></span></div>`;',
    '    return `<div class="agent-work"><span class="mini-agent"></span><span class="mini-orb"><i></i></span><span class="aw-t"><b>Brief agent</b><small>${esc(label)}</small></span></div>`;')
rep("  function runRedraft(i, ctx) {", r'''  let miniView = null;
  function mountMiniAgent() {
    const el = document.querySelector('#brief-page .agent-work .mini-agent'); if (!el || !S || !A) return;
    try {
      const ag = AGENCIES[curBrand] || AGENCIES.wk;
      miniView = A.create(S, el, { level: 4, accent: ag.ring, inkAccent: ag.base, bg: '#FFFDF8', dark: false, rFrac: [0.34, 0.3], cyFrac: 0.5 });
      miniView.setEnvelope({ agentKey: 'brief', phase: 'run', steps: [{ label: 'Redraft', kind: 'write' }], step: { index: 0 }, stepStartedAt: Date.now(), streaming: true });
      S.canvas.style.zIndex = '30';   // above the sheet while the agent works
      el.closest('.agent-work').classList.add('live');
      S.wake(true);
    } catch (e) { miniView = null; }
  }
  function unmountMiniAgent() {
    if (miniView && S) { try { S.remove(miniView); } catch (e) {} }
    miniView = null; if (S) { S.canvas.style.zIndex = '3'; S.wake(true); }
  }
  function runRedraft(i, ctx) {''')
rep("      if (gi) { gi.classList.add('working'); gi.insertAdjacentHTML('beforeend', agentOrb(label)); }\n    }",
    "      if (gi) { gi.classList.add('working'); gi.insertAdjacentHTML('beforeend', agentOrb(label)); }\n    }\n    mountMiniAgent();")
rep("    setTimeout(() => {\n      const parts = i === null ?", "    setTimeout(() => {\n      unmountMiniAgent();\n      const parts = i === null ?")
rep(".mini-orb { position: relative; width: 24px; height: 24px; flex: none;",
    ".mini-agent { display: none; width: 46px; height: 46px; margin: -10px -4px -10px -8px; flex: none; }\n.agent-work.live .mini-agent { display: block; }\n.agent-work.live .mini-orb { display: none; }\n.agent-work.live { padding-left: 6px; }\n.mini-orb { position: relative; width: 24px; height: 24px; flex: none;")
rep(".mini-agent { display: none; width: 46px; height: 46px; margin: -10px -4px -10px -8px; flex: none; }", ".mini-agent { display: none; width: 72px; height: 72px; margin: -24px -6px -24px -14px; flex: none; }")
rep("rFrac: [0.34, 0.3], cyFrac: 0.5 });", "rFrac: [0.4, 0.36], cyFrac: 0.5 });")
rep(".agent-work { position: absolute; top: -14px; left: 10px;", ".agent-work { position: absolute; top: -18px; left: 14px;")
