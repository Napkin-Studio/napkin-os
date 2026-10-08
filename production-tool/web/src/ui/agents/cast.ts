// The Production Tool's cast (features/production-tool-look.clan): three of the house
// agents, as the app's figures draw them (app/src/studio/model.ts), and who is shown
// for which job. Dex is the Production Tool's own: the director (historyItems.ts
// AgentKind 'director'), in the tool's cobalt. Ellis and Jude are the house sheet's,
// with the same names and looks as in every app.

import type { DocJob, JobState } from '../../contracts/types'
import type { JobPurpose } from '../../doc/ui'

export type CastKey = 'dex' | 'ellis' | 'jude'
export type AgentState = 'idle' | 'working' | 'needs-you'

export type ShapeName = 'star' | 'crescent' | 'stack' | 'triangle' | 'column' | 'card' | 'diamond' | 'dome' | 'hex'
export type Emblem = 'none' | 'bars' | 'target' | 'dots' | 'mouth' | 'wave' | 'page' | 'spark' | 'tick' | 'frame'
export type Tone = 'ink' | 'cobalt' | 'coral' | 'marigold' | 'iris' | 'mint'

export interface AgentLook { shape: ShapeName; emblem: Emblem; tone: Tone; accent?: Tone; lightMark?: boolean }
export interface CastMember { given: string; job: string; role: string; look: AgentLook }

export const CAST: Readonly<Record<CastKey, CastMember>> = {
  // New here: a cobalt hex with a viewfinder for a mark.
  dex: { given: 'Dex', job: 'directs', role: 'Plans the shots, draws the frames and makes the clips.', look: { shape: 'hex', emblem: 'frame', tone: 'cobalt' } },
  // The house sheet's Extract and Judge (LOOK_OF.extract, LOOK_OF.judge).
  ellis: { given: 'Ellis', job: 'reads', role: 'Reads your notes back before anything is made again.', look: { shape: 'triangle', emblem: 'page', tone: 'ink' } },
  jude: { given: 'Jude', job: 'checks', role: 'Checks each result as it lands, and says when one needs you.', look: { shape: 'card', emblem: 'tick', tone: 'ink' } },
}

/** How an agent signs what it says: 'Dex · directs'. */
export const sayer = (k: CastKey) => `${CAST[k].given} · ${CAST[k].job}`

/** CSS colours for a tone (model.ts TONE_VARS): ink follows the theme, the rest are fixed. */
export const TONE_VARS: Readonly<Record<Tone, { body: string; mark: string }>> = {
  ink: { body: 'var(--plan)', mark: 'var(--plan-eye)' },
  cobalt: { body: 'var(--af-cobalt)', mark: 'var(--af-mark)' },
  coral: { body: 'var(--af-coral)', mark: 'var(--af-mark)' },
  marigold: { body: 'var(--af-marigold)', mark: 'var(--af-mark)' },
  iris: { body: 'var(--af-iris)', mark: 'var(--af-mark)' },
  mint: { body: 'var(--af-mint)', mark: 'var(--af-mark)' },
}

const FAILED: JobState[] = ['failed', 'cancelled']

/** What a job is, in words: 'frame 2', 'the clip for shot 3', 'the ad'. */
export function jobWhat(job: Pick<DocJob, 'op'>, ctx: JobPurpose | undefined, shotOrder?: number): string {
  if (ctx?.for === 'frame') return shotOrder ? `frame ${shotOrder}` : 'a frame'
  if (ctx?.for === 'clip') return shotOrder ? `the clip for shot ${shotOrder}` : 'a clip'
  switch (job.op) {
    case 'shot_list': return 'the shots'
    case 'stitch': return 'the ad'
    case 'frame': return 'a frame'
    case 'clip': case 'clip_edit': return 'a clip'
    case 'view': return 'a view'
    case 'region_edit': return 'a change in a box'
    default: return 'a picture'
  }
}

const VERB: Partial<Record<DocJob['op'], string>> = { shot_list: 'planning', generate: 'drawing', view: 'drawing', frame: 'drawing', stitch: 'putting together', clip: 'making', clip_edit: 'changing' }

/**
 * Who is shown for a job, and the line under them: Dex while it is made, Jude while it
 * is checked and when it failed (needs you). Words only; the job is not touched.
 */
export function whoIsWorking(job: Pick<DocJob, 'op'>, state: JobState, ctx?: JobPurpose, shotOrder?: number): { agent: CastKey; state: AgentState; line: string } {
  const what = jobWhat(job, ctx, shotOrder)
  if (FAILED.includes(state)) return { agent: 'jude', state: 'needs-you', line: state === 'cancelled' ? `${capital(what)} was stopped` : `${capital(what)} did not come back` }
  if (state === 'validating' || state === 'uncertain') return { agent: 'jude', state: 'working', line: `Jude is checking ${what}` }
  if (state === 'completed') return { agent: 'dex', state: 'idle', line: `Dex made ${what}` }
  const verb = VERB[job.op] ?? 'making'
  return { agent: 'dex', state: 'working', line: state === 'queued' ? `Dex is waiting to start ${what}` : `Dex is ${verb} ${what}` }
}

const capital = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
