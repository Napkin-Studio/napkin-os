// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The open app's buttons and chips in the OS bar (shell/appBar.ts,
// features/app-bar-actions.clan). Apart from Toolbar so it draws with nothing
// but the list it is given, and a test can draw it alone.

import { useState } from 'react'

import { BAR_BUTTONS_SHOWN, type BarItem } from '../shell/appBar'
import { Pop } from '../shell/nui/Pop'

type Button = Extract<BarItem, { kind: 'button' }>
type Chip = Extract<BarItem, { kind: 'chip' }>

const buttonsOf = (bar: BarItem[]) => bar.filter((i): i is Button => i.kind === 'button')
const chipsOf = (bar: BarItem[]) => bar.filter((i): i is Chip => i.kind === 'chip')

/** Read-only facts, beside the title. */
export function BarChips({ bar }: { bar: BarItem[] }) {
  return <>{chipsOf(bar).map((c, i) => (
    <span key={i} className={`ch-chip${c.tone ? ` ch-chip-${c.tone}` : ''}`} title={c.title || undefined}>{c.label}</span>
  ))}</>
}

/** The first two buttons; the app decides what pressing one does. A button with a menu ("Save · PDF ▾")
 *  opens it, and a choice tells the app its own id. */
export function BarButtons({ bar, onAction }: { bar: BarItem[]; onAction?: (id: string) => void }) {
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  return <>{buttonsOf(bar).slice(0, BAR_BUTTONS_SHOWN).map(b => (
    <span key={b.id} className={b.menu ? 'ch-menu-anchor' : undefined}>
      <button
        className={b.primary ? 'ch-btn ch-btn-primary' : 'ch-btn'}
        disabled={b.disabled}
        title={b.title || undefined}
        data-dogfood={`button: ${b.label}`}
        aria-haspopup={b.menu ? 'menu' : undefined}
        aria-expanded={b.menu ? open?.id === b.id : undefined}
        onClick={e => { if (!b.menu) { onAction?.(b.id); return } const el = e.currentTarget; setOpen(o => (o?.id === b.id ? null : { id: b.id, anchor: el })) }}
      >{b.label}{b.menu && <span className="ch-btn-car" aria-hidden> ▾</span>}</button>
      {b.menu && open?.id === b.id && (
        <Pop anchor={open.anchor} align="right" onClose={refocus => { if (refocus) open.anchor.focus(); setOpen(null) }} label={b.label} testid={`bar-menu-${b.id}`}>
          {b.menu.map(m => (
            <button key={m.id} type="button" role="menuitem" data-dogfood={`menu: ${m.label}`} onClick={() => { setOpen(null); onAction?.(m.id) }}>
              {m.label}{m.title && <small>{m.title}</small>}
            </button>
          ))}
        </Pop>
      )}
    </span>
  ))}</>
}
