// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Where each first-day pointer stands, as one table (features/first-day.clan). A pointer lists its anchors in order
// and stands beside the first one that is on the page; with none, it is skipped, so a changed desk costs a table edit
// and never a broken pointer. Pure: nothing here reads the page except through `has`.

import { BUTTONS, POINTER_NAMES, POINTER_WORDS } from './words'

export type PointerId = 'pages' | 'bar' | 'needs'

export interface PointerDef { id: PointerId; anchors: readonly string[]; words: string; name: string }

export const POINTERS: readonly PointerDef[] = [
  // the person's pages when they have that row, the client circles otherwise
  { id: 'pages', anchors: ['[data-testid="your-pages"]', '#cl-row'], words: POINTER_WORDS.pages, name: POINTER_NAMES.pages },
  { id: 'bar', anchors: ['[data-testid="os-bar"]'], words: POINTER_WORDS.bar, name: POINTER_NAMES.bar },
  // a row of Needs you (the first task is one), else the list that holds them, else the Decisions button
  { id: 'needs', anchors: ['[data-testid="me-row"]', '[data-testid="pick-up"]', '[data-testid="decisions"]'], words: POINTER_WORDS.needs, name: POINTER_NAMES.needs },
]

export interface Step { id: PointerId; anchor: string; words: string; name: string }

/** The pointers that have an anchor on the page, in order, each with the anchor it stands beside. */
export function stepsFrom(has: (selector: string) => boolean): Step[] {
  const out: Step[] = []
  for (const p of POINTERS) {
    let anchor: string | undefined
    try { anchor = p.anchors.find(a => has(a)) } catch { anchor = undefined }
    if (anchor) out.push({ id: p.id, anchor, words: p.words, name: p.name })
  }
  return out
}

/** What a key does while a pointer is open: only Escape, which ends them. Tab and the rest are the page's own. */
export function pointerKey(key: string): 'end' | null {
  return key === 'Escape' ? 'end' : null
}

export interface Box { top: number; left: number; width: number; height: number; bottom: number; right: number }
const GAP = 8

/**
 * Where the card goes: beside its anchor, never on it. Above first (the anchor stays in view below the card), then to its
 * right, then its left, then below it, each kept on screen, off the anchor and off whatever must stay clear (the consent
 * question); when none fits it stands at the top or bottom of the screen, whichever leaves the anchor free.
 */
export function placement(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }, avoid: readonly Box[]): { top: number; left: number } {
  const clampX = (x: number) => Math.max(GAP, Math.min(x, view.width - size.width - GAP))
  const clampY = (y: number) => Math.max(GAP, Math.min(y, view.height - size.height - GAP))
  const meets = (p: { top: number; left: number }, o: Box) => p.top < o.bottom && p.top + size.height > o.top && p.left < o.right && p.left + size.width > o.left
  const onScreen = (p: { top: number; left: number }) => p.top >= GAP && p.left >= GAP && p.top + size.height <= view.height - GAP && p.left + size.width <= view.width - GAP
  const ok = (p: { top: number; left: number }) => onScreen(p) && !meets(p, anchor) && !avoid.some(a => meets(p, a))
  const tries = [
    { top: anchor.top - GAP - size.height, left: clampX(anchor.left) },
    { top: clampY(anchor.top), left: anchor.right + GAP },
    { top: clampY(anchor.top), left: anchor.left - GAP - size.width },
    { top: anchor.bottom + GAP, left: clampX(anchor.left) },
    { top: GAP, left: clampX(anchor.left) },
    { top: view.height - GAP - size.height, left: clampX(anchor.left) },
  ]
  return tries.find(ok) ?? tries.find(p => onScreen(p) && !meets(p, anchor)) ?? { top: clampY(anchor.bottom + GAP), left: clampX(anchor.left) }
}

export { BUTTONS }
