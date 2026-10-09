// UI state that is not part of the document but must survive a reload: what
// each pending job is for (so its result lands in the right place after a
// reload), the dev switch, drafts. Snapshotted next to the document.
//
// Two parts (features/project-home.clan): the app's (AppUi: who is signed in,
// the dev switch, which view and project are open) is kept once, under 'ui';
// the rest (ProjectUi: job purposes, drafts, frame regions, undo steps, update
// runs) is kept per project, under 'ui:<projectId>'. The panels see both as
// one UiState (projects/uiStore.ts).

import type { DirectorCard, JobRequest, ModelChoice, Ratio, Region } from '../contracts/types'
import type { ConfigChoice, ProviderChoice } from '../capabilities'
import type { UndoState } from './undo'
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
  /** The relay made it elsewhere: Job.fallbackFrom and fallbackReason (features/runway-fallback.clan). */
  fallbackFrom?: ModelChoice
  fallbackReason?: string
  /** The character cards the director was given (the relay's agent block), held here for the
   *  director's History entry: the document's jobs[].agent leaves them out. */
  cards?: DirectorCard[]
}

/** Kept once for the app, whichever project is open. */
export interface AppUi {
  configChoice: ConfigChoice
  providerChoice: ProviderChoice
  session?: SessionResponse
  /** relayId() of the server that issued `session`. */
  sessionFor?: string
  hintDismissed?: boolean
  /** Home, or the project `project` (features/project-home.clan). */
  view: 'home' | 'project'
  project?: string
  /** How Home orders the projects. */
  homeSort: 'recent' | 'name'
  /** When the server last took a project (POST /clan), for Home's footer. */
  savedAt?: string
}

/** The UiState fields that are the app's, not the project's. */
export const APP_UI_KEYS = ['configChoice', 'providerChoice', 'session', 'sessionFor', 'hintDismissed', 'view', 'project', 'homeSort', 'savedAt'] as const satisfies readonly (keyof AppUi)[]

/** Kept per project. */
export interface ProjectUi {
  jobCtx: Record<string, JobCtx>
  ratio: Ratio
  scriptDraft: string
  targetS: 10 | 15 | 20
  /** Region drawn on each frame (by frame id) before Regenerate. */
  frameRegions: Record<string, Region | undefined>
  /** "Draw the rest" is under way: each finished frame starts the next shot (jobs/frames.ts). */
  drawingRest?: boolean
  /** "Update what follows" is under way (jobs/follow.ts). */
  following?: FollowRun
  /** The person's undo and redo steps (doc/undo.ts), kept here so they survive a reload. */
  undo?: UndoState
}

/** What the panels see: the open project's UI with the app's. */
export type UiState = ProjectUi & AppUi

/** One run of an update (jobs/follow.ts): the plan's frames in order, then its clips, then the ad. Snapshotted,
 *  so it resumes after a reload. */
export interface FollowRun {
  id: string
  startedAt: string
  /** Render the ad at the end (there was one, and it will be out of date). */
  ad: boolean
  /** Shots whose frame this run draws (the plan's frames). */
  frameShots?: string[]
  /** Shots whose clip this run makes (the plan's clips). */
  clipShots: string[]
  framesDone: string[]
  clipsDone: string[]
  adDone: boolean
  /** Stop after the job running now. */
  cancel?: boolean
  /** Steered (the Update button): each item waits in the update box for the user's words, model and
   *  "Make it". Off: the run goes on by itself ("Do the rest as they are"). */
  steer?: boolean
  /** The update box shows the plan (items in order, cost) and nothing is sent until "Start". */
  reviewing?: boolean
  /** The item the update box shows now. */
  awaiting?: FollowItem
  /** The model to send per step (absent: the routed default): the last that worked, then the box's pick. */
  models?: { frame?: ModelChoice; clip?: ModelChoice }
  /** Old versions already taken out because their replacement landed. */
  replaced?: string[]
  /** How many items the run started with, for "2 of 5". */
  total?: number
}

export interface FollowItem { kind: 'frame' | 'clip'; shotId: string }

export function initialAppUi(): AppUi {
  return { configChoice: 'event', providerChoice: 'mock', view: 'home', homeSort: 'recent' }
}

export function initialProjectUi(): ProjectUi {
  return { jobCtx: {}, ratio: '9:16', scriptDraft: '', targetS: 15, frameRegions: {} }
}

export function initialUi(): UiState {
  return { ...initialProjectUi(), ...initialAppUi() }
}

/** A UiState (or an older single snapshot) split into the app's part and the project's. */
export function splitUi(v: Partial<UiState>): { app: Partial<AppUi>; project: Partial<ProjectUi> } {
  const app: Record<string, unknown> = {}
  const project: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    if ((APP_UI_KEYS as readonly string[]).includes(k)) app[k] = x
    else project[k] = x
  }
  return { app: app as Partial<AppUi>, project: project as Partial<ProjectUi> }
}
