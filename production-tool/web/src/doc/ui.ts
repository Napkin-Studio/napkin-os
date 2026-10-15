// UI state that is not part of the document but must survive a reload: the
// panel that is open, what only this browser keeps about each job, frame
// regions, undo steps, update runs. Snapshotted next to the document.
//
// Two parts (features/project-home.clan): the app's (AppUi: who is signed in,
// the dev switch, which view and project are open) is kept once, under 'ui';
// the rest (ProjectUi) is kept per project, under 'ui:<projectId>'. The panels
// see both as one UiState (projects/uiStore.ts).
//
// Contract 3 moved what a job is for, the ratio, the target length and the
// script's words into the document (features/contract-v3.clan).

import type { SerializedUndo } from '../../../clan-store/src'
import type { DirectorCard, JobRequest, Me, ModelChoice, Region } from '../contracts/types'
import type { ConfigChoice, ProviderChoice } from '../capabilities'
import type { JobPurpose } from '../model/purpose'

export type { JobPurpose } from '../model/purpose'

/** Today's three panels. Which one is open is the person's, not the project's. */
export type StageName = 'character' | 'storyboard' | 'video'

/** What only this browser keeps about a job. What the job is for (its purpose, node and inputs) is in
 *  the document (model/purpose.ts); this is the rest: the request to send again or retry, and notices. */
export interface JobLocal {
  /** Absent for a job another browser started. */
  request?: JobRequest
  /** Set when the person cleared a failed job, or it was retried as another job. */
  dismissed?: boolean
  retriedAs?: string
  /** The relay made it elsewhere: Job.fallbackFrom and fallbackReason (features/runway-fallback.clan). */
  fallbackFrom?: ModelChoice
  fallbackReason?: string
  /** The "Napkin's got you" notice for this fallback was shown: once per job. */
  fallbackShown?: boolean
  /** The character cards the director was given: they go into the landing's rationale. */
  cards?: DirectorCard[]
  /** Started by that run of "Update what follows" (jobs/follow.ts). */
  followRun?: string
  /** A "Fix it in the shot" edit: the clip model the person picked for the clip made after it lands. */
  fixModelChoice?: ModelChoice
}

/** A job's purpose (from the document) with what this browser keeps about it: what handlers get. */
export type JobCtx = JobPurpose & JobLocal

/** Kept once for the app, whichever project is open. */
export interface AppUi {
  configChoice: ConfigChoice
  providerChoice: ProviderChoice
  /** Who is signed in (GET /me), asked again on every load; absent when signed out. */
  me?: Me
  hintDismissed?: boolean
  /** Home, or the project `project` (features/project-home.clan). */
  view: 'home' | 'project'
  project?: string
  /** How Home orders the projects. */
  homeSort: 'recent' | 'name'
  /** When the server last took a project (POST /clan), for Home's footer. */
  savedAt?: string
  /** Reduce motion, from the account menu (ui-behaviour 6.6): 'still' stops every loader and animation. */
  motion?: 'still'
}

/** The UiState fields that are the app's, not the project's. */
export const APP_UI_KEYS = ['configChoice', 'providerChoice', 'me', 'hintDismissed', 'view', 'project', 'homeSort', 'savedAt', 'motion'] as const satisfies readonly (keyof AppUi)[]

/** Kept per project. */
export interface ProjectUi {
  /** What only this browser keeps about each job (JobLocal). */
  jobs: Record<string, JobLocal>
  /** The panel that is open. */
  stage: StageName
  /** Which storyboard and which video the Storyboard and Video panels show, when the project has more
   *  than one (the node opened on the canvas; features/canvas-nodes.clan). Absent: the main ones. */
  openNode?: { storyboard?: string; video?: string }
  /** Region drawn on each frame (by frame id) before Regenerate. */
  frameRegions: Record<string, Region | undefined>
  /** "Draw the rest" is under way: each finished frame starts the next shot (jobs/frames.ts). */
  drawingRest?: boolean
  /** Per shot, the references the person unticked from "Added by Dex" (features/canvas-nodes.clan): they are
   *  not offered to Dex on that shot's frames and clips, so Dex cannot add them again (jobs/select.ts). */
  declinedAdds?: Record<string, string[]>
  /** "Update what follows" is under way (jobs/follow.ts). */
  following?: FollowRun
  /** The person's undo and redo steps (clan-store LocalUndo), kept here so they survive a reload. */
  undo?: SerializedUndo
  /** The Script editor's choices, per script: its view, and which storyboard's shots it shows. */
  script?: Record<string, ScriptUi>
}

/** One person's choices in one script (features/script-editor.clan). */
export interface ScriptUi {
  view: 'screenplay' | 'av'
  /** 'Shots from:' when the script drives more than one storyboard. */
  storyboard?: string
  /** The Skye suggestion whose bubble is open, kept across back and forward. */
  openSuggestion?: string
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
  /** Steered (the Update button): each item waits in the update box for the person's words, model and
   *  "Make it". Off: the run goes on by itself ("Do the rest as they are"). */
  steer?: boolean
  /** The update box shows the plan (items in order) and nothing is sent until "Start". */
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
  return { configChoice: 'live', providerChoice: 'mock', view: 'home', homeSort: 'recent' }
}

export function initialProjectUi(): ProjectUi {
  return { jobs: {}, stage: 'character', frameRegions: {} }
}

export function initialUi(): UiState {
  return { ...initialProjectUi(), ...initialAppUi() }
}

/** A UiState split into the app's part and the project's. */
export function splitUi(v: Partial<UiState>): { app: Partial<AppUi>; project: Partial<ProjectUi> } {
  const app: Record<string, unknown> = {}
  const project: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    if ((APP_UI_KEYS as readonly string[]).includes(k)) app[k] = x
    else project[k] = x
  }
  return { app: app as Partial<AppUi>, project: project as Partial<ProjectUi> }
}
