// UI state that is not part of the document but must survive a reload: what
// each pending job is for (so its result lands in the right place after a
// reload), the dev switch, drafts. Snapshotted next to the document.

import type { JobRequest, Ratio, Region } from '../contracts/types'
import type { ConfigChoice, ProviderChoice } from '../capabilities'
import type { SessionResponse } from '../contracts/types'

export type JobPurpose =
  | { for: 'canvas' }
  | { for: 'shot_list'; revId: string }
  /** how: first (frame 1), next (Next frame →), rest (the click on Draw the rest), chain (Draw the rest
   *  moving on), again (Regenerate or a region edit); older jobs have none. */
  | { for: 'frame'; shotId: string; parentFrameId?: string; how?: 'first' | 'next' | 'rest' | 'chain' | 'again' }
  | { for: 'clip'; shotId: string; parentTakeId?: string; reviewIds?: string[] }
  | { for: 'stitch' }

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
