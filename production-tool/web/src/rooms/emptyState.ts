// The Make room with nothing to show yet (owner, 2026-10-21): why there are no shots (Dex planning, a plan
// that cannot go because a bare @key has no front, or one that failed, in plain words), or that a box has
// no take yet, and what to do: + New box, Try again, or Open the Storyboard.

import type { ProductionDocument } from '../contracts/types'
import { plainJobError } from '../jobs/errorWords'
import { runningPlan } from '../jobs/plan'
import { FrontsMissingError, keysWithoutFront } from '../lib/names'
import { jobsList, scriptOfStoryboard, scriptText, storyboardOfVideo } from '../model/selectors'

/** The Make room with nothing to show yet: why, and what to do (owner, 2026-10-21). */
export interface RoomEmpty {
  kind: 'no-shots' | 'no-takes' | null
  /** No shots, because the last Plan shots could not go (or failed): in plain words. */
  why?: string
  /** The player's line when there is no take to play. */
  player?: string
  storyboardId?: string
  /** Dex is planning the video's shots now. */
  planning?: boolean
  /** The video's script has words to plan from (Plan shots, or Try again after it failed). */
  canPlan?: boolean
}

export function roomEmpty(live: ProductionDocument, stored: ProductionDocument, videoId: string, shots: number, takes: number): RoomEmpty {
  const sb = storyboardOfVideo(live, videoId)
  const base = sb ? { storyboardId: sb.id } : {}
  if (!shots) {
    const script = sb ? scriptOfStoryboard(live, sb.id) : undefined
    const canPlan = !!script && !!scriptText(live, script.id).trim()
    if (sb && runningPlan(live, sb.id)) return { kind: 'no-shots', ...base, planning: true, canPlan, player: 'Dex is planning the shots…' }
    const fronts = script ? keysWithoutFront(live, stored, scriptText(live, script.id)) : []
    const plan = sb ? jobsList(live).filter((j) => j.op === 'shot_list' && j.node?.kind === 'storyboard' && j.node.id === sb.id).at(-1) : undefined
    const why = fronts.length ? new FrontsMissingError(fronts).message
      : plan?.state === 'failed' && plan.error ? `The last Plan shots did not work: ${plainJobError(plan.error, 'shot_list').message}` : undefined
    return { kind: 'no-shots', ...base, canPlan, ...(why ? { why } : {}), player: 'No shots yet. Make a box, or plan them in the Storyboard first.' }
  }
  if (!takes) return { kind: 'no-takes', ...base, player: 'Press Make on a box to make its first take.' }
  return { kind: null, ...base }
}
