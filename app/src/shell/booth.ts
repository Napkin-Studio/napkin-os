// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Booth, the agents' panel beside a document (features/booth.clan), can be
// hidden to the window's right edge. Whether it is hidden is one person's, per
// tool, and the shell keeps it: the app frame is sandboxed without
// allow-same-origin, so the page's own storage throws. The page says
// `clan:booth {open}` when the person hides or shows it; the shell stores that
// and posts it back on every load of the frame, as it does `clan:jobs`.

/** The message both ways: the page says it, the shell posts it back on load. */
export interface BoothMessage { type: 'clan:booth'; open: boolean }

const PREFIX = 'napkin.booth.v1:'

/** Where one person's choice for one tool is kept. */
export const boothKey = (person: string | null | undefined, tool: string | null | undefined): string =>
  `${PREFIX}${(person ?? '').trim().toLowerCase() || '-'}:${(tool ?? '').trim() || '-'}`

/** A `clan:booth` the page posted, or null for anything else. */
export function boothFrom(m: unknown): boolean | null {
  const v = m as { type?: unknown; open?: unknown } | null
  return v && v.type === 'clan:booth' && typeof v.open === 'boolean' ? v.open : null
}

/** What the page hears on load: the stored choice, or open when there is none. */
export const boothMessage = (open: boolean): BoothMessage => ({ type: 'clan:booth', open })

type Store = Pick<Storage, 'getItem' | 'setItem'>

function store(): Store | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/** Open (true) unless this person hid the Booth in this tool. */
export function readBooth(key: string, s: Store | null = store()): boolean {
  try { return s?.getItem(key) !== 'hidden' } catch { return true }
}

/** Keep the person's choice; storage that refuses keeps it for this visit only. */
export function writeBooth(key: string, open: boolean, s: Store | null = store()): void {
  try { s?.setItem(key, open ? 'open' : 'hidden') } catch { /* kept for this visit */ }
}
