# Phase 15 (2026-11-08): the client dial is a ring of apps only: the same four for every client, no "+ New".
_a = s.index("  function areasFor(c) {")
_b = s.index("  function areaState(ar) {", _a)
s = s[:_a] + r'''  const APPS = [['brief', 'BR', 'Brief'], ['research', 'RS', 'Research'], ['deck', 'DK', 'Deck'], ['production', 'PR', 'Production']];
  function areasFor(c) {
    return APPS.map(([tool, code, name]) => {
      const a = (c.areas || []).find(x => x.tool === tool);
      return a ? a : { code, name, tool, items: [] };
    });
  }
''' + s[_b:]

# Dial labels: app icon + name + a short status line (no two-letter codes)
rep("      const sub = ar.isNew ? '' : (st === 'needs' ? '' : ar.items.length ? ar.items.length + (ar.items.length > 1 ? ' open' : ' open') : 'nothing yet');",
    "      const NOUN = { brief: ['brief', 'briefs'], research: ['question', 'questions'], deck: ['deck', 'decks'], production: ['film', 'films'] }[ar.tool] || ['item', 'items'];\n"
    "      const n = ar.items.length;\n"
    "      const sub = st === 'needs' ? '' : st === 'working' ? 'Agents working' : n ? n + ' ' + NOUN[n > 1 ? 1 : 0] : 'Nothing yet';")
rep('''        + `<text x="${f1(lx)}" y="${f1(ly - 16)}" class="dz-code">${ar.code}</text><text x="${f1(lx)}" y="${f1(ly + 16)}" class="dz-name">${esc(ar.name)}</text>`''',
    '''        + `<g class="dz-ico" transform="translate(${f1(lx - 14)} ${f1(ly - 50)}) scale(1.17)"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${(typeof TOOL_ICON !== 'undefined' && TOOL_ICON[ar.tool]) || ''}</g></g><text x="${f1(lx)}" y="${f1(ly + 4)}" class="dz-name">${esc(ar.name)}</text>`''')
rep('''        + (sub ? `<text x="${f1(lx)}" y="${f1(ly + 33)}" class="dz-sub">${sub}</text>` : '')''',
    '''        + (sub ? `<text x="${f1(lx)}" y="${f1(ly + 30)}" class="dz-sub">${sub}</text>` : '')''')
rep(".dz-sub { display: none; }", ".dz-sub { font: 500 15px var(--font-ui); fill: var(--muted); }\n.dz-ico { color: var(--ink-soft); opacity: .8; }\n.dz-out.dz-needs .dz-ico { color: var(--warn); opacity: 1; }")
rep("`<rect class=\"dz-tagbg\" x=\"${f1(lx - 58)}\" y=\"${f1(ly + 28)}\" width=\"116\" height=\"24\" rx=\"3\"/><text x=\"${f1(lx)}\" y=\"${f1(ly + 46)}\" class=\"dz-tag\">YOUR CALL</text>`",
    "`<rect class=\"dz-tagbg\" x=\"${f1(lx - 58)}\" y=\"${f1(ly + 16)}\" width=\"116\" height=\"24\" rx=\"3\"/><text x=\"${f1(lx)}\" y=\"${f1(ly + 34)}\" class=\"dz-tag\">YOUR CALL</text>`")
rep('<g class="dz-ico" transform="translate(${f1(lx - 14)} ${f1(ly - 50)}) scale(1.17)">', '<g class="dz-ico" transform="translate(${f1(lx - 22)} ${f1(ly - 64)}) scale(1.83)">')
