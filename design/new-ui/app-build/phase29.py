# Phase 29 (2026-11-09): the source card reads like the real tool: the quote, whether to trust it, what it's used in
# (grouped, clickable); the knowledge/pin record folded away.
rep("""          <ol class="src-spine"><li><span>Source</span>${esc(x.publisher)}</li><li><span>Knowledge</span>${esc(x.layer)}</li><li><span>Pinned</span>${esc(x.pinned)}</li>${used.map(([k, n]) => `<li class="use"><span>${k === 'brief' ? 'Used in brief' : 'Used in research'}</span>${esc(n)}</li>`).join('')}</ol>""",
    """          ${/thin|2 clips/i.test(x.sample + x.pinned) ? '<p class="src-warn">Thin: 2 clips. Treat it as a lead, not a fact.</p>' : x.tier === 'Client' ? '<p class="src-warn">Client material: no stated method. Confidential.</p>' : ''}
          ${(() => { const b = used.filter(u => u[0] === 'brief'), r = used.filter(u => u[0] !== 'brief');
            return used.length ? `<div class="src-used"><span class="src-uk">Used in</span>${b.length ? `<div class="src-ug"><small>This brief</small>${b.map(([, n]) => `<button type="button" class="src-uchip" data-goto-part="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}${r.length ? `<div class="src-ug"><small>Research</small>${r.map(([, n]) => `<button type="button" class="src-uchip" data-osr="research" data-id="${id}">${esc(n)}</button>`).join('')}</div>` : ''}</div>` : '<p class="src-pub">Not used yet.</p>'; })()}
          <details class="src-rec"><summary>Record</summary><dl><div><dt>Knowledge</dt><dd>${esc(x.layer)}</dd></div><div><dt>Pinned</dt><dd>${esc(x.pinned)}</dd></div>${id.startsWith('f_') ? `<div><dt>Origin</dt><dd><code>fact://mcd/ie/${id}@v2</code></dd></div>` : ''}</dl></details>""")
rep("    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('src-stack')) closeStack(); });",
    """    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('src-stack')) closeStack(); });
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-goto-part]'); if (!g) return; e.stopPropagation();
      const i = BRIEF_DATA[curBriefKey].parts.findIndex(p => p.n === g.dataset.gotoPart); if (i < 0) return;
      closeStack(); selIdx = i; renderBriefPage();
      const el = $('brief-page').querySelector('.gi[data-idx="' + i + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, true);""")
rep('\n</style>', r"""
.src-warn { margin: 0; padding: 7px 10px; border-radius: 6px; font-size: 12.5px; background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn); }
.src-used { display: grid; gap: 8px; border-top: 1px solid #E2D9C8; padding-top: 10px; }
.src-uk { font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #8A8276; }
.src-ug { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.src-ug small { width: 100%; font-size: 11px; color: #8A8276; }
.src-uchip { all: unset; cursor: pointer; padding: 3px 9px; border: 1px solid #D8CDB8; border-radius: 999px; font: 500 12px var(--font-ui); }
.src-uchip:hover { border-color: currentColor; }
.src-rec summary { cursor: pointer; font: 700 9.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #8A8276; }
.src-rec dl { margin-top: 8px; grid-template-columns: 1fr !important; }
.src-rec code { font: 11px var(--font-mono); }
html[data-theme="dark"] .src-used { border-color: var(--line); }
html[data-theme="dark"] .src-uchip { border-color: var(--line); color: var(--ink); }
html[data-theme="dark"] .src-uk, html[data-theme="dark"] .src-ug small, html[data-theme="dark"] .src-rec summary { color: var(--muted); }
</style>""", 1)
rep('\n</style>', r"""
.brief-page .lay-statement .stmt { text-decoration-color: var(--b-accent) !important; }
</style>""", 1)
