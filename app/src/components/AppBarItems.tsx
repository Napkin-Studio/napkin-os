// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The open app's tabs, buttons and chips in the OS bar (shell/appBar.ts,
// features/app-bar-actions.clan). Apart from Toolbar so it draws with nothing
// but the list it is given, and a test can draw it alone.

import { BAR_BUTTONS_SHOWN, type BarItem } from '../shell/appBar'

type Tab = Extract<BarItem, { kind: 'tab' }>
type Button = Extract<BarItem, { kind: 'button' }>
type Chip = Extract<BarItem, { kind: 'chip' }>

const tabsOf = (bar: BarItem[]) => bar.filter((i): i is Tab => i.kind === 'tab')
const buttonsOf = (bar: BarItem[]) => bar.filter((i): i is Button => i.kind === 'button')
const chipsOf = (bar: BarItem[]) => bar.filter((i): i is Chip => i.kind === 'chip')

/** Read-only facts, beside the title. */
export function BarChips({ bar }: { bar: BarItem[] }) {
  return <>{chipsOf(bar).map((c, i) => (
    <span key={i} className={`ch-chip${c.tone ? ` ch-chip-${c.tone}` : ''}`} title={c.title || undefined}>{c.label}</span>
  ))}</>
}

/** The app's screens or sections, one current. */
export function BarTabs({ bar, onAction }: { bar: BarItem[]; onAction?: (id: string) => void }) {
  const tabs = tabsOf(bar)
  if (!tabs.length) return null
  return (
    <nav className="ch-bar-tabs" aria-label="Sections">
      {tabs.map(t => (
        <button
          key={t.id}
          className="ch-bar-tab"
          aria-current={t.current ? 'step' : undefined}
          disabled={t.disabled}
          data-dogfood={`tab: ${t.label}`}
          onClick={() => onAction?.(t.id)}
        >{t.label}</button>
      ))}
    </nav>
  )
}

/** The first two buttons; the app decides what pressing one does. */
export function BarButtons({ bar, onAction }: { bar: BarItem[]; onAction?: (id: string) => void }) {
  return <>{buttonsOf(bar).slice(0, BAR_BUTTONS_SHOWN).map(b => (
    <button
      key={b.id}
      className={b.primary ? 'ch-btn ch-btn-primary' : 'ch-btn'}
      disabled={b.disabled}
      title={b.title || undefined}
      data-dogfood={`button: ${b.label}`}
      onClick={() => onAction?.(b.id)}
    >{b.label}</button>
  ))}</>
}
