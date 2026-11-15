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
 * Where the card goes: 8 px below its anchor and kept on screen (Pop's rule), or above when below has no room or would
 * cover something that must stay clear (the consent question).
 */
export function placement(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }, avoid: readonly Box[]): { top: number; left: number } {
  const left = Math.max(GAP, Math.min(anchor.left, view.width - size.width - GAP))
  const below = anchor.bottom + GAP
  const covers = (top: number) => avoid.some(a => top < a.bottom && top + size.height > a.top && left < a.right && left + size.width > a.left)
  const fitsBelow = below + size.height <= view.height - GAP
  if (fitsBelow && !covers(below)) return { top: below, left }
  const above = anchor.top - GAP - size.height
  if (above >= GAP) return { top: above, left }
  // neither fits: stay on screen
  return { top: Math.max(GAP, Math.min(below, view.height - size.height - GAP)), left }
}

export { BUTTONS }
