// UI state that is not part of the document but must survive a reload: what
// each pending job is for (so its result lands in the right place after a
// reload), the dev switch, drafts. Snapshotted next to the document.

import type { JobRequest, ModelChoice, Ratio, Region } from '../contracts/types'
import type { ConfigChoice, ProviderChoice } from '../capabilities'
import type { SessionResponse } from '../contracts/types'

export type JobPurpose =
  | { for: 'canvas' }
  | { for: 'shot_list'; revId: string }
  /** how: first (frame 1), next (Next frame →), rest (the click on Draw the rest), chain (Draw the rest
   *  moving on), again (Regenerate or a region edit), update (Update what follows); older jobs have none.
   *  fixReviewIds: a "Fix it in the shot" region edit; when it lands, a clip is made from it for these notes (jobs/fix.ts),
   *  on fixModelChoice when the participant picked a clip model in the menu.
   *  followRun: started by that run of "Update what follows" (jobs/follow.ts). */
  | { for: 'frame'; shotId: string; parentFrameId?: string; how?: 'first' | 'next' | 'rest' | 'chain' | 'again' | 'update'; fixReviewIds?: string[]; fixModelChoice?: ModelChoice; followRun?: string }
  | { for: 'clip'; shotId: string; parentTakeId?: string; reviewIds?: string[]; followRun?: string }
  | { for: 'stitch'; followRun?: string }

export type JobCtx = JobPurpose & {
  request: JobRequest
  /** Set when the user cleared a failed job, or it was retried as another job. */
  dismissed?: boolean
  retriedAs?: string
}

export interface UiState {
  jobCtx: Record<string, JobCtx>
  configChoice: ConfigChoice
  providerChoice: ProviderChoice
  ratio: Ratio
  scriptDraft: string
  targetS: 10 | 15 | 20
  /** Region drawn on each frame (by frame id) before Regenerate. */
  frameRegions: Record<string, Region | undefined>
  session?: SessionResponse
  /** relayId() of the server that issued `session`. */
  sessionFor?: string
  hintDismissed?: boolean
  /** "Draw the rest" is under way: each finished frame starts the next shot (jobs/frames.ts). */
  drawingRest?: boolean
  /** "Update what follows" is under way (jobs/follow.ts). */
  following?: FollowRun
}

/** One run of "Update what follows": frames in order, then clips, then the ad. Snapshotted, so it resumes after a reload. */
export interface FollowRun {
  id: string
  startedAt: string
  /** Render the ad at the end (there was one, and it will be out of date). */
  ad: boolean
  /** Shots whose clip must be made again (their frame is redrawn in this run). */
  clipShots: string[]
  framesDone: string[]
  clipsDone: string[]
  adDone: boolean
  /** Stop after the job running now. */
  cancel?: boolean
}

export function initialUi(): UiState {
  return {
    jobCtx: {},
    configChoice: 'event',
    providerChoice: 'mock',
    ratio: '9:16',
    scriptDraft: '',
    targetS: 15,
    frameRegions: {},
  }
}
