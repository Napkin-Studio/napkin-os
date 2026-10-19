// "Out of date", in words that say what an item is behind (features/production-tool-look.clan):
// 'Behind frame 2', 'Behind clip 3', 'Behind @maya_front'; a change to the item's own shot says
// what changed: 'Words changed', 'Camera move changed' (features/one-to-one-updates.clan). The
// mark's own reason stays the tooltip. Pure, for the tests; the marks themselves are jobs/stale.ts.

import type { ProductionDocument, StaleMark } from '../contracts/types'
import { shotChange } from '../jobs/stale'

export function behindLabel(d: ProductionDocument, mark: Pick<StaleMark, 'caused_by'> & Partial<Pick<StaleMark, 'reason'>>): string {
  const { kind, id } = mark.caused_by
  const order = (shotId: string | undefined) => (d.shots ?? []).find((s) => s.id === shotId)?.order
  switch (kind) {
    case 'frame': {
      const n = order((d.frames ?? []).find((f) => f.id === id)?.shot_id)
      return n ? `Behind frame ${n}` : 'Behind a frame'
    }
    case 'take': {
      const n = order((d.takes ?? []).find((t) => t.id === id)?.shot_id)
      return n ? `Behind clip ${n}` : 'Behind a clip'
    }
    case 'ref': {
      const r = d.refs.find((x) => x.id === id)
      return r ? `Behind @${r.key}_${r.variant}` : 'Behind a reference'
    }
    case 'shot': {
      const what = mark.reason ? shotChange({ reason: mark.reason }) : undefined
      if (what) return `${what[0].toUpperCase()}${what.slice(1)} changed`
      const n = order(id)
      return n ? `Behind shot ${n}` : 'Behind the shots'
    }
    default:
      return 'Behind your changes'
  }
}

/** The shot row's line after an edit: 'Frame 3 uses the old words', 'Clip 3 uses the old camera move'. */
export function oldWordsLine(kind: 'frame' | 'take', n: number, mark: Pick<StaleMark, 'reason'>): string {
  return `${kind === 'frame' ? 'Frame' : 'Clip'} ${n} uses the old ${shotChange(mark) ?? 'shot'}`
}

/** The quiet note on a frame drawn from an older frame before it (jobs/stale.ts frameDrift): not out of date. */
export const driftLabel = (n: number) => `Drawn from an older frame ${n}`

/** The ad, which carries no mark (jobs/stale.ts adStatus): behind its clips, or the shots. */
export function adBehindLabel(reason: string | undefined): string {
  return reason === 'A shot was deleted' ? 'Behind the shots' : 'Behind the clips'
}

/** The floating bar's count of what is out of date (never what is not made yet, or being made). */
export const behindCount = (n: number) => `${n} out of date`

/** The floating bar's not-made part: '3 clips not made yet', '1 frame and 2 clips not made yet'. */
export function notMadeCount(frames: number, clips: number): string {
  const n = (k: number, one: string) => k && `${k} ${one}${k === 1 ? '' : 's'}`
  return `${[n(frames, 'frame'), n(clips, 'clip')].filter(Boolean).join(' and ')} not made yet`
}
