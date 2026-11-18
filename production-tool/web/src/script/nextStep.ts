// What comes next after the script (features/production-ui.clan; ui-behaviour 3.5, 3.10): one short
// line signed by Dex under the Script editor's top bar, with the step's buttons. No chat: it says what
// the next step is and offers it, and moves on as the work does (plan, then frames, then clips, then
// the ad). Pure, so it is tested apart from the editor.

import type { Id, ProductionDocument } from '../contracts/types'
import { clipMode, countWords, planShotsBlocked, scriptOfVideo, shotCount } from '../jobs/scriptVideo'
import { runningPlan } from '../jobs/plan'
import { storyboardOfVideo } from '../jobs/prompt'
import { currentFrame, currentRender, currentTake, scenesOf, shotsOf, staleList } from '../model/selectors'
import { clipBehind } from '../jobs/stale'
import { drivenStoryboard } from '../canvas/nodes/make'
import { scriptIsFree } from './freeText'

type Doc = ProductionDocument

export type NextAction = 'plan' | 'update' | 'make-video' | 'open-storyboard' | 'open-video'

export interface NextStep {
  /** Which step it is (for tests and the data attribute). */
  step: 'plan' | 'behind' | 'frames' | 'clips' | 'render'
  /** Dex's line, first person, short. */
  line: string
  /** The buttons, the first one primary. */
  actions: NextAction[]
}

/** The video this script's work goes into: one its storyboard renders, else one it drives. */
export function videoOfScript(d: Doc, scriptId: Id, storyboardId?: Id): Id | undefined {
  const vids = Object.values(d.videos ?? {})
  return (storyboardId ? vids.find((v) => storyboardOfVideo(d, v.id)?.id === storyboardId)?.id : undefined)
    ?? vids.find((v) => scriptOfVideo(d, v.id) === scriptId)?.id
}

/** Dex's line before anything is planned (features/script-freeform.clan): free text is read as it is; a
 *  screenplay keeps its scenes. `pasted`: it just came in as a paste. */
export function planLine(d: Doc, scriptId: Id, hasVideo: boolean, pasted = false): string {
  const shots = countWords(shotCount(d, scriptId), 'shot')
  if (scriptIsFree(d, scriptId)) return `I'll read your words as they are and plan ${shots}. Nothing needs a heading or an element first.`
  const n = scenesOf(d, scriptId).filter((s) => s.heading.trim()).length
  if (!n) return `Plan shots turns your screenplay into ${shots}.${hasVideo ? '' : ' Make film goes straight to the clips.'}`
  return `Your screenplay ${pasted ? 'came in with' : 'has'} its ${n} ${n === 1 ? 'scene' : 'scenes'}. Plan shots turns it into ${shots}${hasVideo ? '.' : '; Make film goes straight to the clips.'}`
}

/** The next step for this script, or null when there is none to show (no words yet, or Dex is planning).
 *  `behind`: the editor's own reading that the storyboard is behind the script (Update storyboard). */
export function nextStep(d: Doc, scriptId: Id, storyboardId?: Id, behind = false, opts: { pasted?: boolean } = {}): NextStep | null {
  if (planShotsBlocked(d, scriptId)) return null
  const sb = storyboardId ? d.storyboards[storyboardId] : drivenStoryboard(d, scriptId)
  if (sb && runningPlan(d, sb.id)) return null
  const video = videoOfScript(d, scriptId, sb?.id)
  const toVideo: NextAction = video ? 'open-video' : 'make-video'
  const shots = sb ? shotsOf(d, sb.id).filter((s) => s.kind !== 'end_card') : []
  if (!shots.length) {
    return { step: 'plan', line: planLine(d, scriptId, !!video, opts.pasted), actions: ['plan', toVideo] }
  }
  if (behind || staleList(d).some((m) => m.target.kind === ('storyboard' as string) && m.target.id === sb!.id)) {
    return { step: 'behind', line: 'The script changed since I planned. Update storyboard re-plans the shots it touches.', actions: ['update', 'open-storyboard'] }
  }
  const n = shots.length
  const framed = shots.filter((s) => !!currentFrame(d, s)).length
  const clipped = video ? shots.filter((s) => !!currentTake(d, s.id, video)).length : 0
  // The sheet counts the end card as a shot: say it, so the two agree (live test 2026-11-18: "6 SHOTS" on the
  // sheet, "5 shots planned" here).
  const card = sb ? shotsOf(d, sb.id).some((s) => s.kind === 'end_card') : false
  const planned = `${n} ${n === 1 ? 'shot' : 'shots'}${card ? ' and an end card' : ''} planned.`
  if (video && clipped === n) {
    // Not "every clip is made" while some are behind a changed frame, nor "render the ad" once it is rendered
    // (Playwright live test 2026-11-18: said so with 3 clips out of date and v1 rendered).
    const behindN = shots.filter((s) => !!clipBehind(d, s.id)).length
    if (behindN) return { step: 'clips', line: `${countWords({ n: behindN, exact: true }, 'clip')} ${behindN === 1 ? 'is' : 'are'} behind a changed frame. Next: make ${behindN === 1 ? 'it' : 'them'} again in the film.`, actions: ['open-video'] }
    const ad = currentRender(d, video)
    if (ad) return { step: 'render', line: `Every clip is made and the ad is rendered (v${ad.version}). Open the film to change the cut.`, actions: ['open-video'] }
    return { step: 'render', line: `Every clip is made. Next: render the ad in the film.`, actions: ['open-video'] }
  }
  if (video && clipMode(d, video) === 'straight' && framed < n) {
    return { step: 'clips', line: `${planned} Next: Make clips in the film makes them straight from the script.`, actions: ['open-video', 'open-storyboard'] }
  }
  if (framed < n) {
    return { step: 'frames', line: `${planned} Next: draw and check each shot's frame in the storyboard${framed ? ` (${framed} of ${n} drawn)` : ''}.`, actions: ['open-storyboard', toVideo] }
  }
  return { step: 'clips', line: 'Every shot has its frame. Next: make the clips in the film.', actions: [toVideo] }
}
