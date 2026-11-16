// The Sizes overview screen's grouping (features/art-director.clan, slice 2): the sizes of one master
// grouped by channel, by shape or by status. Pure: sizes in, groups out, in a stable order.

import type { Size } from '../contracts/types'
import { channelOfSize } from './make'
import { LANES } from './formats'

export type GroupBy = 'channel' | 'shape' | 'status'
export type StatusWord = 'Needs a look' | 'Making' | 'Out of date' | 'Not made yet' | 'Ready'

export interface SizeGroup { key: string; label: string; sizes: Size[]; look: number; making: number }

/** A size's shape by its delivery ratio (width over height). */
export function shapeOf(w: number, h: number): 'Banner' | 'Wide' | 'Square' | 'Portrait' | 'Tall' {
  const r = w / h
  if (r >= 3) return 'Banner'
  if (r > 1.1) return 'Wide'
  if (r >= 0.9) return 'Square'
  if (r >= 0.55) return 'Portrait'
  return 'Tall'
}
const SHAPE_ORDER = ['Banner', 'Wide', 'Square', 'Portrait', 'Tall']

/** The words a size's state is shown in; `stale` is passed in because it comes from the master. */
export function statusWord(s: Size, stale: boolean): StatusWord {
  if (s.status === 'making') return 'Making'
  if (!s.status) return 'Not made yet'
  if (stale) return 'Out of date'
  return s.status === 'look' ? 'Needs a look' : 'Ready'
}
const STATUS_ORDER: StatusWord[] = ['Needs a look', 'Making', 'Out of date', 'Not made yet', 'Ready']

export function groupSizes(sizes: readonly Size[], by: GroupBy, staleIds: ReadonlySet<string> = new Set(), onlyLook = false): SizeGroup[] {
  const shown = onlyLook ? sizes.filter((s) => s.status === 'look') : sizes
  const labelOf = (s: Size): { key: string; label: string; order: number } => {
    if (by === 'channel') {
      const c = channelOfSize(s)
      const i = LANES.findIndex((l) => l.channel === c)
      return { key: c, label: LANES[i]?.label ?? c, order: i < 0 ? 99 : i }
    }
    if (by === 'shape') {
      const sh = shapeOf(s.delivery.width, s.delivery.height)
      return { key: sh, label: sh, order: SHAPE_ORDER.indexOf(sh) }
    }
    const w = statusWord(s, staleIds.has(s.id))
    return { key: w, label: w, order: STATUS_ORDER.indexOf(w) }
  }
  const groups = new Map<string, SizeGroup & { order: number }>()
  for (const s of shown) {
    const { key, label, order } = labelOf(s)
    const g = groups.get(key) ?? { key, label, sizes: [], look: 0, making: 0, order }
    g.sizes.push(s)
    if (s.status === 'look') g.look++
    if (s.status === 'making') g.making++
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ order: _o, ...g }) => g)
}
