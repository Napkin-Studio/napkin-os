// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// An agency's pill as the OS bar draws it (components/Toolbar.tsx AgencyPill):
// its ground, ink and rim (palette.ts pillOf), its wordmark for that ground
// (pillLogoOf) or its name, over "Napkin Studio". Napkin's own says
// "Napkin Studio" once, as the bar does (owner, 2026-11-11).

import { pillLogoOf, pillOf, type AgencyColours } from '../../agency/palette'

export function LookPill({ colours, small = false }: { colours: AgencyColours; small?: boolean }) {
  const p = pillOf(colours)
  const { wordmark } = pillLogoOf(colours)
  const own = /^napkin(\s+studio)?$/i.test(colours.name.trim())
  return (
    <span className={`ag-pill${small ? ' small' : ''}`} data-testid="look-pill"
      style={{ background: p.bg, color: p.ink, ...(p.line ? { boxShadow: `inset 0 0 0 1.5px ${p.line}` } : {}) }}>
      <span className="stack">
        {own ? <span className="big">Napkin Studio</span>
          : wordmark ? <span className="big"><img src={wordmark} alt={colours.name} /></span>
            : <span className="big">{colours.name}</span>}
        {!own && <span className="monol"><i aria-hidden />NAPKIN STUDIO</span>}
      </span>
    </span>
  )
}
