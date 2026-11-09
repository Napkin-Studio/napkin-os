# Phase 6 (2026-11-08): nothing sits on the paper but the brief. The selected part's actions, its
# "Your call" questions, its why and the Redraft prompt all live in the side bar.

# on the part: no option bar, no why drawer, no question box
rep("      const chromeHtml = isSel && p.as === 'cell' ?", "      const chromeHtml = false && isSel && p.as === 'cell' ?")
rep("      const whyHtml = isSel && p.why ? `", "      const whyHtml = false && p.why ? `")
rep("          ${p.needs ? needsBox(p, idx) : ''}\n", "")

# side bar: Your call, Why, Layout
rep('''      <div class="sp-acts"><button type="button" class="sp-btn sp-edit" data-sp-act="edit">${editIdx === selIdx ? 'Done' : 'Edit'}</button><button type="button" class="sp-btn" data-sp-act="redraft">Redraft…</button></div>
      ${p.as !== 'cell' ? `<label class="sp-f">Show as''', '''      <div class="sp-acts"><button type="button" class="sp-btn sp-edit" data-sp-act="edit">${editIdx === selIdx ? 'Done' : 'Edit'}</button><button type="button" class="sp-btn" data-sp-act="redraft">Redraft…</button></div>
      <div id="sp-redraft-host"></div>
      ${p.needs ? needsBox(p, selIdx) : ''}
      ${p.why ? `<details class="sp-why" open><summary>Why it says this</summary>
        <div class="why-row"><span class="rl">Checked</span><span>${p.who}</span></div>
        <div class="why-row"><span class="rl">Decided</span><span><b>${p.why.decided}</b></span></div>
        <div class="why-row"><span class="rl">Because</span><span>${p.why.because}</span></div>
        <div class="why-row"><span class="rl">Rejected</span><span>${p.why.rejected}</span></div>
        <div class="why-row"><span class="rl">Certainty</span><span>${p.why.certainty}</span></div></details>` : ''}
      <details class="sp-lay"><summary>Layout</summary>
      ${p.as !== 'cell' ? `<label class="sp-f">Show as''')
rep('''      <div class="sp-acts"><button type="button" class="sp-btn" data-sp-act="up">↑ Move up</button><button type="button" class="sp-btn" data-sp-act="down">↓ Move down</button></div>
      ${p.needs ? '<p class="sp-needs">This part needs your call. Answer it on the brief.</p>' : ''}`;''',
    '''      <div class="sp-acts"><button type="button" class="sp-btn" data-sp-act="up">↑ Move up</button><button type="button" class="sp-btn" data-sp-act="down">↓ Move down</button></div>
      </details>`;''')

# answering works from the side bar (same handler, registered there too)
rep("  // Answer what needs you\n  $('brief-page').addEventListener('click', e => {\n    const b = e.target.closest('[data-ans]'); if (!b) return;",
    "  // Answer what needs you\n  const onAnswer = e => {\n    const b = e.target.closest('[data-ans]'); if (!b) return;")
rep("    inp.addEventListener('click', ev => ev.stopPropagation());\n  }, true);",
    "    inp.addEventListener('click', ev => ev.stopPropagation());\n  };\n  $('brief-page').addEventListener('click', onAnswer, true);\n  $('look-inspector').addEventListener('click', onAnswer, true);")
rep("      renderBriefPage();\n    };\n    if (b.dataset.v !== '?')", "      if (Object.keys(p.answers).length >= p.items.filter(t => /\\?\\s*$/.test(t.replace(/<[^>]+>/g, ''))).length) selIdx = null;\n      renderBriefPage();\n    };\n    if (b.dataset.v !== '?')")

# Redraft prompt opens in the side bar, not on the paper
rep("    const host = whole ? $('look-inspector') : gi;", "    const host = whole ? $('look-inspector') : ($('sp-redraft-host') || gi);")
rep("      askRedraft(gi, i, false); gi && gi.scrollIntoView({ behavior: 'smooth', block: 'center' });", "      askRedraft(gi, i, false);")
rep("    const i = +rd.dataset.redraft;\n    askRedraft(", "    const i = +rd.dataset.redraft;\n    askRedraft(")

# side bar scrolls on its own when the selected part brings a lot
rep(".side-part { border: 1px solid var(--line-strong);", r""".look-inspector { max-height: calc(100vh - 92px); overflow-y: auto; top: 76px; }
.side-part .needs-box { margin-top: 0; }
.sp-why, .sp-lay { border-top: 1px solid var(--line); padding-top: 9px; }
.sp-why summary, .sp-lay summary { cursor: pointer; font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.sp-why .why-row { display: grid; grid-template-columns: 74px 1fr; gap: 8px; font-size: 12.5px; line-height: 1.45; padding: 3px 0; }
.sp-lay { display: grid; gap: 9px; }
.sp-lay[open] { display: grid; }
.sp-lay .sp-f, .sp-lay .sp-acts { margin-top: 8px; }
.side-part .redraft-ask { margin-top: 0; box-shadow: none; }
.side-part { border: 1px solid var(--line-strong);""")
rep('<p class="side-hint">Click a part to see why it says what it says. Double-click to edit. Drag ⋮⋮ to move it, its right edge to resize.</p>',
    '<p class="side-hint">Click a part to see its why and options here. Double-click to edit. Drag ⋮⋮ to move it, its right edge to resize.</p>')
rep("      const chromeHtml = false && isSel && p.as === 'cell' ?", "      const chromeHtmlOld = isSel && p.as === 'cell' ?")
rep("        </div>` : '';\n\n      return `", "        </div>` : '';\n      const chromeHtml = '';\n\n      return `")
