# Phase 35 (2026-11-09): one "needs your call" indicator. Decisions is the only one in the top bar; its call card
# carries each item's Open / Looks right / Set aside (from the old popover). The agent-status dot shows only while
# agents work; the medallion carries the needs state for the open app.
rep("      $('dtree-call-desc').innerHTML = n ? all.map((x, k) => `${k + 1}. <b>${esc(x.title)}</b> <span style=\"color:var(--muted)\">· ${esc(x.sub)}</span>`).join('<br>') : 'Every call is answered and on the record.';",
    "      $('dtree-call-desc').innerHTML = all.length || setAside.size ? `<div class=\"dc-rows\">${needsPopHtml().replace(/<div class=\"pp-h\">Needs your call · \\d+<\\/div>/, '')}</div>` : 'Every call is answered and on the record.';")
rep("      else if (ok) { resolveItem(x, 'list'); setAside.delete(id); syncNeeds(); if (needItems().length) POP.innerHTML = needsPopHtml(); else closePop(); }",
    "      else if (ok) { resolveItem(x, 'list'); setAside.delete(id); syncNeeds(); syncCallCard(); if (!POP.hidden) { if (needItems().length) POP.innerHTML = needsPopHtml(); else closePop(); } }")
rep("      else { setAside.has(id) ? setAside.delete(id) : setAside.add(id); syncNeeds(); POP.innerHTML = needsPopHtml();",
    "      else { setAside.has(id) ? setAside.delete(id) : setAside.add(id); syncNeeds(); if (!POP.hidden) POP.innerHTML = needsPopHtml();")
rep("      if (o) openItem(x);", "      if (o) { if (typeof setDecisionTreeOpen === 'function') setDecisionTreeOpen(false); openItem(x); }")
# the Decisions button carries the count, amber when something waits; set-aside items keep a quiet count
rep("      renderNeedsPill(); syncCallCard();\n    };", "      renderNeedsPill(); syncCallCard();\n      const act = all.filter(x => !setAside.has(x.id)).length;\n      $('tb-decisions-cnt').textContent = String(act || n); $('tb-decisions-cnt').hidden = !n;\n      $('tb-decisions-btn').classList.toggle('has-needs', act > 0);\n      $('tb-decisions-btn').title = act ? act + ' need your call' : n ? n + ' set aside' : 'Decisions';\n    };")
rep('\n</style>', r"""
/* ═══ Phase 35: one needs indicator ═══ */
#tb-needs { display: none !important; }
#bar-status.p33-idle { display: none !important; }
.tb-decisions-btn.has-needs { border-color: color-mix(in srgb, var(--warn) 55%, transparent); background: color-mix(in srgb, var(--warn) 12%, var(--paper)); }
.tb-decisions-btn.has-needs .cnt { background: var(--warn) !important; color: #fff !important; }
.dc-rows .pp-row { padding: 8px 0; border-top: 1px solid color-mix(in srgb, var(--warn) 18%, transparent); }
.dc-rows .pp-row:first-child { border-top: 0; }
.dc-rows .pp-h { margin-top: 8px; }
.dc-rows hr { border: 0; border-top: 1px dashed var(--line); margin: 8px 0; }
.dc-rows [data-np-open] { all: unset; cursor: pointer; display: block; }
.dc-rows [data-np-open]:hover b { text-decoration: underline; text-underline-offset: 3px; }
</style>""", 1)

# ═══ per-part Confidential (from the real tool's "Confidential…") ═══
rep("        const why = briefLocked ? LOCKED_WHY : p.keep ? 'Kept as it is. Click \"Kept\" to let it change.' : '';",
    "        if (acts && p.as !== 'cell') acts.insertAdjacentHTML('beforeend', `<button type=\"button\" class=\"sp-btn sp-conf ${p.conf ? 'on' : ''}\" data-p35-conf aria-pressed=\"${!!p.conf}\" title=\"${p.conf ? 'Confidential: left out of the client copy. Click to share it.' : 'Mark confidential: kept in the agency copy, left out of the client copy'}\">${p.conf ? '● Confidential' : 'Confidential'}</button>`);\n"
    "        const why = briefLocked ? LOCKED_WHY : p.keep ? 'Kept as it is. Click \"Kept\" to let it change.' : '';")
rep("        gi.classList.toggle('kept', !!p.keep);", "        gi.classList.toggle('kept', !!p.keep);\n        gi.classList.toggle('is-conf', !!p.conf);")
rep("  renderBriefPage();\n  syncNavigation();\n  const urlBrand", r'''  document.addEventListener('click', e => {
    const b = e.target.closest('[data-p35-conf]'); if (!b || selIdx === null) return;
    e.stopPropagation();
    const p = BRIEF_DATA[curBriefKey].parts[selIdx];
    if (briefLocked) { showToast('The brief is locked. Reopen a part to change it.'); return; }
    p.conf = !p.conf; renderBriefPage();
    showToast(p.conf ? '“' + p.n + '” is confidential: it stays in the agency copy and is left out of the client copy.' : '“' + p.n + '” is shared again.');
  }, true);
  renderBriefPage();
  syncNavigation();
  const urlBrand''')
rep('\n</style>', r"""
.sp-conf.on { background: #2A2620; color: #FFFDF8; border-color: #2A2620; }
html[data-theme="dark"] .sp-conf.on { background: var(--ink); color: #151412; }
#brief-page .gi.is-conf { background-image: repeating-linear-gradient(135deg, transparent 0 7px, rgba(42,38,32,.05) 7px 8px); }
#brief-page .gi.is-conf .gi-head h3::after { content: "Confidential"; margin-left: 8px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; font: 700 9px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; vertical-align: 1px; opacity: .8; }
@media print { #brief-page.client-copy .gi.is-conf { display: none !important; } }
</style>""", 1)
