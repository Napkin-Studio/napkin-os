// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What an app asks the OS bar to show (features/app-bar-actions.clan).
//
// An app runs in a sandboxed frame, so it cannot draw in the shell's bar, and
// a second bar of its own under it is two bars. Instead the app sends the
// whole list it wants, `clan:bar {v: 1, items}`, whenever it changes and again
// when the shell asks (`clan:bar?`, on every frame load). The shell draws the
// list and sends `clan:bar-action {id}` when a tab or button is pressed; the
// app does what its own button did. A full list is idempotent, so a repeated
// or lost message cannot leave the bar wrong, and a kind the shell does not
// know is left out, so a new kind can be added later without breaking anything.

export type BarTone = 'ok' | 'warn' | null

export type BarItem =
  /** One of the app's screens or sections; at most one is current. */
  | { kind: 'tab'; id: string; label: string; current: boolean; disabled: boolean }
  /** Something to do. Pressing it only tells the app; the app acts. */
  | { kind: 'button'; id: string; label: string; primary: boolean; disabled: boolean; title: string }
  /** A read-only fact: "0 errors · 2 to supply", "$1.14 so far". */
  | { kind: 'chip'; label: string; tone: BarTone; title: string }

/** What one bar takes. The rest of an app's list is dropped, in order. */
export const BAR_LIMITS = { tab: 6, button: 6, chip: 4, label: 28, id: 64, title: 140 } as const

/** The buttons drawn in the bar itself; any more go into More. */
export const BAR_BUTTONS_SHOWN = 2

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/**
 * The items an app asked for, as the bar will take them: text only (never
 * markup), a string id each (unique), a label of at most 28 characters, at
 * most 6 tabs, 6 buttons and 4 chips, one current tab. An item the bar would
 * refuse is left out with a word in the console for the app's author, not
 * allowed to break the rest.
 */
export function barFrom(message: unknown): BarItem[] {
  const m = message as { v?: unknown; items?: unknown } | null
  if (!m || m.v !== 1 || !Array.isArray(m.items)) return []
  const out: BarItem[] = []
  const count = { tab: 0, button: 0, chip: 0 }
  const ids = new Set<string>()
  let current = false
  for (const raw of m.items) {
    const it = (raw ?? {}) as Record<string, unknown>
    const kind = it.kind
    if (kind !== 'tab' && kind !== 'button' && kind !== 'chip') continue // a kind from the future
    const label = text(it.label, BAR_LIMITS.label)
    const title = text(it.title, BAR_LIMITS.title)
    const why = !label ? 'has no label' : count[kind] >= BAR_LIMITS[kind] ? `is past the ${BAR_LIMITS[kind]} ${kind}s a bar takes` : ''
    if (why) { console.warn(`app bar: ${kind} ${JSON.stringify(label)} ${why}; left out`); continue }
    if (kind === 'chip') {
      out.push({ kind, label, tone: it.tone === 'ok' || it.tone === 'warn' ? it.tone : null, title })
      count.chip++
      continue
    }
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const idWhy = !id || id.length > BAR_LIMITS.id ? 'has no usable id' : ids.has(id) ? 'repeats an id' : ''
    if (idWhy) { console.warn(`app bar: ${kind} ${JSON.stringify(label)} ${idWhy}; left out`); continue }
    ids.add(id)
    count[kind]++
    if (kind === 'tab') {
      const now: boolean = it.current === true && !current
      current = current || now
      out.push({ kind, id, label, current: now, disabled: it.disabled === true })
    } else {
      out.push({ kind, id, label, primary: it.primary === true, disabled: it.disabled === true, title })
    }
  }
  return out
}

type Button = Extract<BarItem, { kind: 'button' }>

/** The buttons past the ones the bar has room for: More carries them, a disabled one not at all. */
export function overflowButtons(bar: BarItem[]): Button[] {
  return bar.filter((i): i is Button => i.kind === 'button').slice(BAR_BUTTONS_SHOWN).filter(b => !b.disabled)
}
