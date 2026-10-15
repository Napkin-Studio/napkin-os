// How a video's clips are made (ui-behaviour 3.5, 3.17): from frames you check (the default), or straight
// from the script, as the person answered Dex's "Plan a storyboard first?" on the video. Pure reads of the
// document, shared by the clip requests (jobs/clips.ts) and the editors; jobs/scriptVideo.ts writes the answer.

import type { Ask, Id, ProductionDocument } from '../contracts/types'
import { videoOfShot } from '../model/selectors'

type Doc = ProductionDocument

/** The answers' option ids (and their routes). */
export const PLAN_FIRST = 'plan_first'
export const STRAIGHT = 'straight'

/** How the video's clips are made: from frames you check (the default), or straight from the script. */
export type ClipMode = 'frames' | 'straight'

/** Is this ask Dex's "Plan a storyboard first?" (found by its options' routes)? */
export function isScriptVideoAsk(a: Ask): boolean {
  return a.question.options.some((o) => (o.value as { route?: string } | undefined)?.route === STRAIGHT)
}

/** The person's stored answer about this video, if they gave one. */
export function scriptVideoAsk(d: Doc, videoId: Id): Ask | undefined {
  return Object.values(d.asks ?? {}).find((a) => a.node.kind === 'video' && a.node.id === videoId && isScriptVideoAsk(a))
}

/** How this video's clips are made: straight from the script once that was chosen (and not changed back). */
export function clipMode(d: Doc, videoId: Id | undefined): ClipMode {
  if (!videoId) return 'frames'
  const a = scriptVideoAsk(d, videoId)
  return a?.answers.at(-1)?.option_id === STRAIGHT ? 'straight' : 'frames'
}

/** Whether a shot with no frame makes its clip from its words: the video it lands in (`videoId` when that
 *  one shows it) makes its clips straight from the script. Every clip request reads this, so New take,
 *  a note's new version and Remake work on a shot that never had a frame (2026-10-15). */
export function shotFromWords(d: Doc, shotId: Id, videoId?: Id): boolean {
  return clipMode(d, videoOfShot(d, shotId, videoId)?.id) === 'straight'
}
