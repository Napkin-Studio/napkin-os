# Phase 18 (2026-11-08): brief folders carry the brief's details (client, budget & scope, version).
rep('''      ? `<button type="button" class="home-card bm-card" data-j="${j}"><span class="bm-tab">${esc(it.c)}</span><span class="bm-peek"></span><b>${esc(it.t)}</b><span class="home-st ${ST[it.st] ? ST[it.st][1] : ''}">${ST[it.st] ? ST[it.st][0] : ''}</span></button>`''',
    '''      ? `<button type="button" class="home-card bm-card" data-j="${j}"><span class="bm-tab">${esc(it.c)}</span><span class="bm-peek"></span><b>${esc(it.t)}</b><span class="home-st ${ST[it.st] ? ST[it.st][1] : ''}">${ST[it.st] ? ST[it.st][0] : ''}</span>${(() => { const m = BRIEF_META[it.c] || {}; return `<dl class="bm-meta"><div><dt>Client</dt><dd>${esc(c.full || c.name)}</dd></div><div><dt>Budget &amp; scope</dt><dd>${esc(m.budget || '—')}</dd></div><div><dt>Version</dt><dd>${esc(m.version || 'v0.1')}</dd></div></dl>`; })()}</button>`''')
rep("  window.renderToolHome = function (tool) {", '''  const BRIEF_META = {
    SM: { budget: '€140k prod · OOH, Social, Film', version: 'v1.3 · 12 facts' }, SP: { budget: '€60k · Social', version: 'v0.2 · 3 facts' },
    BW: { budget: '€150k · 30s TV & Social', version: 'v1.0 · 9 facts' }, AP: { budget: '€90k · On-trade', version: 'v0.1 · 2 facts' },
    DA: { budget: '€80k · Trade print', version: 'v2.0 · 14 facts' }
  };
  window.renderToolHome = function (tool) {''')
rep('\n</style>', r"""
.bm-meta { display: grid; gap: 6px; margin: 12px 0 0; padding-top: 10px; border-top: 1px solid color-mix(in srgb, #5A4A2A 22%, transparent); width: 100%; }
.bm-meta div { display: grid; grid-template-columns: 96px 1fr; gap: 8px; align-items: baseline; }
.bm-meta dt { font: 600 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #8A7A58; }
.bm-meta dd { margin: 0; font: 500 13px/1.35 var(--font-ui); color: #2A2620; }
.bm-card { min-height: 0 !important; }
html[data-theme="dark"] .bm-meta dd { color: var(--ink); }
html[data-theme="dark"] .bm-meta dt { color: #B8A47A; }
</style>""", 1)
# no Client row on folders (it's always this client); show when it was last updated instead
rep('<dl class="bm-meta"><div><dt>Client</dt><dd>${esc(c.full || c.name)}</dd></div><div><dt>Budget &amp; scope</dt>', '<dl class="bm-meta"><div><dt>Budget &amp; scope</dt>')
rep('<div><dt>Version</dt><dd>${esc(m.version || \'v0.1\')}</dd></div></dl>', '<div><dt>Version</dt><dd>${esc(m.version || \'v0.1\')}</dd></div><div><dt>Updated</dt><dd>${esc(m.updated || \'—\')}</dd></div></dl>')
rep("SM: { budget: '€140k prod · OOH, Social, Film', version: 'v1.3 · 12 facts' }, SP: { budget: '€60k · Social', version: 'v0.2 · 3 facts' },",
    "SM: { budget: '€140k prod · OOH, Social, Film', version: 'v1.3 · 12 facts', updated: '2 days ago · Siobhán' }, SP: { budget: '€60k · Social', version: 'v0.2 · 3 facts', updated: '1 week ago · Cian' },")
rep("BW: { budget: '€150k · 30s TV & Social', version: 'v1.0 · 9 facts' }, AP: { budget: '€90k · On-trade', version: 'v0.1 · 2 facts' },",
    "BW: { budget: '€150k · 30s TV & Social', version: 'v1.0 · 9 facts', updated: '2 hours ago · Aoife' }, AP: { budget: '€90k · On-trade', version: 'v0.1 · 2 facts', updated: 'today · Siobhán' },")
rep("DA: { budget: '€80k · Trade print', version: 'v2.0 · 14 facts' }", "DA: { budget: '€80k · Trade print', version: 'v2.0 · 14 facts', updated: '3 weeks ago · Niamh' }")
