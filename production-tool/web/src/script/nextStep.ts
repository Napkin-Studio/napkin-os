// What comes next after the script (features/production-ui.clan; ui-behaviour 3.5, 3.10): one short
// line signed by Dex under the Script editor's top bar, with the step's buttons. No chat: it says what
// the next step is and offers it, and moves on as the work does (plan, then frames, then clips, then
// the ad). Pure, so it is tested apart from the editor.

import type { Id, ProductionDocument } from '../contracts/types'
import { clipMode, countWords, planShotsBlocked, scriptOfVideo, shotCount } from '../jobs/scriptVideo'
import { runningPlan } from '../jobs/plan'
import { storyboardOfVideo } from '../jobs/prompt'
import { currentFrame, currentTake, shotsOf, staleList } from '../model/selectors'
import { drivenStoryboard } from '../canvas/nodes/make'

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

/** The next step for this script, or null when there is none to show (no words yet, or Dex is planning).
 *  `behind`: the editor's own reading that the storyboard is behind the script (Update storyboard). */
export function nextStep(d: Doc, scriptId: Id, storyboardId?: Id, behind = false): NextStep | null {
  if (planShotsBlocked(d, scriptId)) return null
  const sb = storyboardId ? d.storyboards[storyboardId] : drivenStoryboard(d, scriptId)
  if (sb && runningPlan(d, sb.id)) return null
  const video = videoOfScript(d, scriptId, sb?.id)
  const toVideo: NextAction = video ? 'open-video' : 'make-video'
  const shots = sb ? shotsOf(d, sb.id).filter((s) => s.kind !== 'end_card') : []
  if (!shots.length) {
    return { step: 'plan', line: `Ready when you are: Plan shots turns this into ${countWords(shotCount(d, scriptId), 'shot')}.`, actions: ['plan', toVideo] }
  }
  if (behind || staleList(d).some((m) => m.target.kind === ('storyboard' as string) && m.target.id === sb!.id)) {
    return { step: 'behind', line: 'The script changed since I planned. Update storyboard re-plans the shots it touches.', actions: ['update', 'open-storyboard'] }
  }
  const n = shots.length
  const framed = shots.filter((s) => !!currentFrame(d, s)).length
  const clipped = video ? shots.filter((s) => !!currentTake(d, s.id, video)).length : 0
  const planned = `${n} ${n === 1 ? 'shot' : 'shots'} planned.`
  if (video && clipped === n) return { step: 'render', line: `Every clip is made. Next: render the ad in the video.`, actions: ['open-video'] }
  if (video && clipMode(d, video) === 'straight' && framed < n) {
    return { step: 'clips', line: `${planned} Next: Make clips in the video makes them straight from the script.`, actions: ['open-video', 'open-storyboard'] }
  }
  if (framed < n) {
    return { step: 'frames', line: `${planned} Next: draw and check each shot's frame in the storyboard${framed ? ` (${framed} of ${n} drawn)` : ''}.`, actions: ['open-storyboard', toVideo] }
  }
  return { step: 'clips', line: 'Every shot has its frame. Next: make the clips in the video.', actions: [toVideo] }
}
