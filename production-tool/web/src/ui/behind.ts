// "Out of date", in words that say what an item is behind (features/production-tool-look.clan):
// 'Behind frame 2', 'Behind clip 3', 'Behind @maya_front'. The mark's own reason stays the
// tooltip. Pure, for the tests; the chain itself is jobs/stale.ts.

import type { ProductionDocument, StaleMark } from '../contracts/types'

export function behindLabel(d: ProductionDocument, mark: Pick<StaleMark, 'caused_by'>): string {
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
      const n = order(id)
      return n ? `Behind shot ${n}` : 'Behind the shots'
    }
    default:
      return 'Behind your changes'
  }
}

/** The ad, which carries no mark (jobs/stale.ts adStatus): behind its clips, or the shots. */
export function adBehindLabel(reason: string | undefined): string {
  return reason === 'A shot was deleted' ? 'Behind the shots' : 'Behind the clips'
}

/** The floating bar's count: '1 behind your changes', '3 behind your changes'. */
export const behindCount = (n: number) => `${n} behind your changes`
