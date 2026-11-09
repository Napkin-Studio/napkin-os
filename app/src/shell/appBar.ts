// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What an app asks the OS bar to show (features/app-bar-actions.clan).
//
// An app runs in a sandboxed frame, so it cannot draw in the shell's bar, and
// a second bar of its own under it is two bars. Instead the app sends the
// whole list it wants, `clan:bar {v: 1, items}`, whenever it changes and again
// when the shell asks (`clan:bar?`, on every frame load). The shell draws the
// list and sends `clan:bar-action {id}` when a button is pressed; the
// app does what its own button did. A full list is idempotent, so a repeated
// or lost message cannot leave the bar wrong, and a kind the shell does not
// know is left out, so a new kind can be added later without breaking anything.
//
// The `tab` kind is gone (owner removal of top tabs, features/new-ui-shell.clan):
// an app keeps its steps in its own page, and a tab sent by an older app is
// dropped like any unknown kind. `status` is the document's state as the app
// words it ("Draft", "Ready to lock"); the OS bar's slot shows it in its pill.

export type BarTone = 'ok' | 'warn' | null

export type BarItem =
  /** Something to do. Pressing it only tells the app; the app acts. */
  | { kind: 'button'; id: string; label: string; primary: boolean; disabled: boolean; title: string }
  /** A read-only fact: "0 errors · 2 to supply", "$1.14 so far". */
  | { kind: 'chip'; label: string; tone: BarTone; title: string }
  /** The document's state in the app's words, for the slot's pill. At most one. */
  | { kind: 'status'; label: string; tone: BarTone; locked: boolean }
  /** What Continue in says first, when the document is not ready to go on ("Not brief-ready yet: …"). At most one. */
  | { kind: 'gate'; label: string; tone: BarTone }
  /** Where the document is before there is one to act on (the mock's bar per step): `ask` (the prompt:
   *  the name alone) or `working` (the crew at work: the name and a status chip, "Working · step 1/4").
   *  At most one; none means the document itself, with every action. */
  | { kind: 'mode'; mode: 'ask' | 'working'; label: string }

export type BarStatus = Extract<BarItem, { kind: 'status' }>

/** What one bar takes. The rest of an app's list is dropped, in order. */
export const BAR_LIMITS = { button: 6, chip: 4, status: 1, gate: 1, mode: 1, label: 28, gateLabel: 200, id: 64, title: 140 } as const

/** The buttons drawn in the bar itself; any more go into More. */
export const BAR_BUTTONS_SHOWN = 2

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/**
 * The items an app asked for, as the bar will take them: text only (never
 * markup), a string id each (unique), a label of at most 28 characters, at
 * most 6 buttons, 4 chips and 1 status. An item the bar would
 * refuse is left out with a word in the console for the app's author, not
 * allowed to break the rest.
 */
export function barFrom(message: unknown): BarItem[] {
  const m = message as { v?: unknown; items?: unknown } | null
  if (!m || m.v !== 1 || !Array.isArray(m.items)) return []
  const out: BarItem[] = []
  const count = { button: 0, chip: 0, status: 0, gate: 0, mode: 0 }
  const ids = new Set<string>()
  for (const raw of m.items) {
    const it = (raw ?? {}) as Record<string, unknown>
    const kind = it.kind
    if (kind !== 'button' && kind !== 'chip' && kind !== 'status' && kind !== 'gate' && kind !== 'mode') continue // a kind from the future, or a retired tab
    if (kind === 'mode') {
      if ((it.mode === 'ask' || it.mode === 'working') && count.mode < BAR_LIMITS.mode) {
        out.push({ kind, mode: it.mode, label: text(it.label, BAR_LIMITS.label) })
        count.mode++
      }
      continue
    }
    const label = text(it.label, kind === 'gate' ? BAR_LIMITS.gateLabel : BAR_LIMITS.label)
    const title = text(it.title, BAR_LIMITS.title)
    const why = !label ? 'has no label' : count[kind] >= BAR_LIMITS[kind] ? `is past the ${BAR_LIMITS[kind]} ${kind}s a bar takes` : ''
    if (why) { console.warn(`app bar: ${kind} ${JSON.stringify(label)} ${why}; left out`); continue }
    const tone: BarTone = it.tone === 'ok' || it.tone === 'warn' ? it.tone : null
    if (kind === 'chip') {
      out.push({ kind, label, tone, title })
      count.chip++
      continue
    }
    if (kind === 'gate') {
      out.push({ kind, label, tone })
      count.gate++
      continue
    }
    if (kind === 'status') {
      out.push({ kind, label, tone, locked: it.locked === true })
      count.status++
      continue
    }
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const idWhy = !id || id.length > BAR_LIMITS.id ? 'has no usable id' : ids.has(id) ? 'repeats an id' : ''
    if (idWhy) { console.warn(`app bar: ${kind} ${JSON.stringify(label)} ${idWhy}; left out`); continue }
    ids.add(id)
    count[kind]++
    out.push({ kind, id, label, primary: it.primary === true, disabled: it.disabled === true, title })
  }
  return out
}

type Button = Extract<BarItem, { kind: 'button' }>

/** The app's own word for the document's state, when it sent one. */
export function statusOf(bar: BarItem[]): BarStatus | null {
  return bar.find((i): i is BarStatus => i.kind === 'status') ?? null
}

/** Where the document is, when the app says it is before the document (the prompt, the crew at work). */
export function modeOf(bar: BarItem[]): Extract<BarItem, { kind: 'mode' }> | null {
  return bar.find((i): i is Extract<BarItem, { kind: 'mode' }> => i.kind === 'mode') ?? null
}

/** The app's gate line for Continue in, when it sent one. */
export function gateOf(bar: BarItem[]): Extract<BarItem, { kind: 'gate' }> | null {
  return bar.find((i): i is Extract<BarItem, { kind: 'gate' }> => i.kind === 'gate') ?? null
}

/** The buttons past the ones the bar has room for: More carries them, a disabled one not at all. */
export function overflowButtons(bar: BarItem[]): Button[] {
  return bar.filter((i): i is Button => i.kind === 'button').slice(BAR_BUTTONS_SHOWN).filter(b => !b.disabled)
}
