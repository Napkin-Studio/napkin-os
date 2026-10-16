// How much each top bar shows (features/topbar-declutter.clan; ui-behaviour 3.1, 8): three fixed fit
// levels from the viewport's width, which the bar always spans, so no measuring and no flicker.
//   full     1280px and wider: every control with its words.
//   compact  1024-1279px: History and Assets go icon-only, the meta pills move into More's head,
//            the questions pill shows only its count.
//   tight    under 1024px: the "Napkin Studio" wordmark hides, Share moves into More, Save is a dot
//            unless it failed, Undo/Redo move into More on a fine pointer (they stay on touch).
// The CSS in chrome.css uses the same breakpoints. BUDGET below is the width each bar needs at each
// level; fit.test.ts fails when someone adds a control and a bar stops fitting.

import { useMedia } from '../hooks'

export type FitLevel = 'full' | 'compact' | 'tight'

export const COMPACT_BELOW = 1280
export const TIGHT_BELOW = 1024

export function fitLevel(width: number): FitLevel {
  return width < TIGHT_BELOW ? 'tight' : width < COMPACT_BELOW ? 'compact' : 'full'
}

/** Undo and Redo leave the bar only at tight on a fine pointer: on touch they are the nearest undo (8). */
export const undoInMore = (level: FitLevel, coarse: boolean) => level === 'tight' && !coarse

export function useFitLevel(): { level: FitLevel; coarse: boolean } {
  const compact = useMedia(`(max-width: ${COMPACT_BELOW - 1}px)`)
  const tight = useMedia(`(max-width: ${TIGHT_BELOW - 1}px)`)
  const coarse = useMedia('(pointer: coarse)')
  return { level: tight ? 'tight' : compact ? 'compact' : 'full', coarse }
}

// ── The width budget ───────────────────────────────────────────────────────────
// Declared widths in px per level [full, compact, tight], measured on the mock stack
// (features/topbar-declutter.clan findings) in the busiest state each control has (Saving…,
// Drawing the rest…, Making clips…). 0: not in the bar at that level (it is in More, or hidden).
// `coarse` is the same on touch (44px targets), when it differs. A title counts at its 120px minimum
// (the canvas's project name at 64): it shrinks with an ellipsis before anything else moves.
// Presence reserves room for live-sync's avatars (80, one avatar and a count at tight).

type Widths = [full: number, compact: number, tight: number]
export interface BudgetItem { item: string; fine: Widths; coarse?: Widths }

export const BAR_PAD = 32
export const BAR_GAP: Widths = [12, 8, 8]
const LEVELS: FitLevel[] = ['full', 'compact', 'tight']

const same = (w: number): Widths => [w, w, w]
const PRESENCE: BudgetItem = { item: 'presence', fine: [80, 80, 44] }
const JOB: BudgetItem = { item: 'job button', fine: same(32), coarse: same(44) }
const MORE: BudgetItem = { item: 'more', fine: same(32), coarse: same(44) }
const ACCOUNT: BudgetItem = { item: 'account', fine: same(32), coarse: same(44) }
const HISTORY: BudgetItem = { item: 'history', fine: [94, 32, 0], coarse: [104, 44, 0] }
const BACK = (w: number): BudgetItem => ({ item: 'back', fine: [w, w, 32], coarse: [w + 8, w + 8, 44] })
const HEAD: BudgetItem[] = [{ item: 'sep', fine: same(1) }, { item: 'node icon', fine: same(20) }, { item: 'title', fine: same(120) }]
const primary = (item: string, w: number): BudgetItem => ({ item, fine: same(w), coarse: same(w + 10) })

export const BUDGET: Record<'canvas' | 'script' | 'storyboard' | 'video' | 'image', BudgetItem[]> = {
  canvas: [
    { item: 'home', fine: same(28), coarse: same(44) }, { item: 'Napkin Studio', fine: [93, 93, 0] }, { item: 'Production', fine: same(72) },
    { item: 'project', fine: same(64) }, { item: 'beta and thumbs', fine: [110, 110, 44] }, { item: 'questions pill', fine: [200, 96, 96] },
    PRESENCE, JOB, { item: 'save', fine: [96, 96, 12], coarse: [104, 104, 44] }, HISTORY,
    { item: 'assets', fine: [92, 32, 32], coarse: [102, 44, 44] }, { item: 'share', fine: [66, 66, 0], coarse: [76, 76, 0] }, MORE, ACCOUNT,
  ],
  script: [
    BACK(92), ...HEAD, { item: 'saved', fine: [56, 0, 0] }, { item: 'Screenplay | Video · Audio', fine: [214, 214, 0], coarse: [230, 230, 0] },
    PRESENCE, JOB, { item: 'undo', fine: [68, 68, 0], coarse: [96, 96, 96] }, HISTORY, MORE, primary('Update storyboard', 150), ACCOUNT,
  ],
  storyboard: [
    BACK(92), ...HEAD, { item: 'ratio', fine: [64, 0, 0] },
    PRESENCE, JOB, HISTORY, MORE, primary('Drawing the rest…', 150), ACCOUNT,
  ],
  video: [
    BACK(92), ...HEAD, { item: 'ratio · length', fine: [92, 0, 0] }, { item: 'Picture | Sound', fine: [150, 150, 0], coarse: [166, 166, 0] },
    PRESENCE, JOB, { item: 'Making clips…', fine: same(126), coarse: same(136) }, HISTORY, MORE, primary('Rendering…', 106), ACCOUNT,
  ],
  image: [
    BACK(118), ...HEAD, { item: '16:9 locked', fine: [84, 0, 0] },
    PRESENCE, JOB, { item: '3 edits not applied', fine: [140, 140, 64] }, { item: 'v3 of 3', fine: [92, 92, 56], coarse: [100, 100, 60] }, HISTORY, MORE,
    primary('Apply as new version', 172), ACCOUNT,
  ],
}

/** The controls a bar shows at a level, with their widths. */
export function barItems(bar: keyof typeof BUDGET, level: FitLevel, coarse: boolean): { item: string; w: number }[] {
  const at = LEVELS.indexOf(level)
  return BUDGET[bar]
    .map((i) => ({ item: i.item, w: (coarse && i.coarse ? i.coarse : i.fine)[at] }))
    .filter((i) => i.w > 0)
}

/** The width a bar needs at a level: its controls, the gaps between them and the padding. */
export function barWidth(bar: keyof typeof BUDGET, level: FitLevel, coarse: boolean): number {
  const items = barItems(bar, level, coarse)
  return BAR_PAD + items.reduce((a, i) => a + i.w, 0) + BAR_GAP[LEVELS.indexOf(level)] * (items.length - 1)
}
