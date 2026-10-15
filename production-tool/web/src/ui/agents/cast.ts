// The Production Tool's cast (features/production-tool-look.clan): three of the house
// agents, as the app's figures draw them (app/src/studio/model.ts), and who is shown
// for which job. Dex is the Production Tool's own: the director (historyItems.ts
// AgentKind 'director'), in the tool's cobalt. Ellis and Jude are the house sheet's,
// with the same names and looks as in every app.

import type { CrewId, DocJob, JobState, ModelChoice } from '../../contracts/types'
import type { JobPurpose } from '../../doc/ui'
import { fellBack } from '../modelChoice'

export type CastKey = 'dex' | 'skye' | 'wren' | 'rhea' | 'edie' | 'ellis' | 'jude'
export type AgentState = 'idle' | 'working' | 'needs-you'

export type ShapeName = 'star' | 'crescent' | 'stack' | 'triangle' | 'column' | 'card' | 'diamond' | 'dome' | 'hex'
export type Emblem = 'none' | 'bars' | 'target' | 'dots' | 'mouth' | 'wave' | 'page' | 'spark' | 'tick' | 'frame'
export type Tone = 'ink' | 'cobalt' | 'coral' | 'marigold' | 'iris' | 'mint'

export interface AgentLook { shape: ShapeName; emblem: Emblem; tone: Tone; accent?: Tone; lightMark?: boolean }
export interface CastMember { given: string; job: string; role: string; look: AgentLook; /** The sheet's animation offset (crew-figures.json), when it is not phaseOf(key). */ phase?: number }

export const CAST: Readonly<Record<CastKey, CastMember>> = {
  // New here: a cobalt hex with a viewfinder for a mark.
  dex: { given: 'Dex', job: 'directs', role: 'Plans the shots, draws the frames and makes the clips.', look: { shape: 'hex', emblem: 'frame', tone: 'cobalt' } },
  // The house sheet's Extract and Judge (LOOK_OF.extract, LOOK_OF.judge).
  ellis: { given: 'Ellis', job: 'reads', role: 'Reads your notes back before anything is made again.', look: { shape: 'triangle', emblem: 'page', tone: 'ink' } },
  // The crew of the approved UI (BRIEF-2 A, docs/production-tool/ui-mocks/crew-figures.json):
  // Skye a coral column with a page, Wren a marigold star with a spark, Rhea a mint dome with
  // dots, Edie an iris stack with bars. agents.test.ts checks every one against the sheet.
  skye: { given: 'Skye', job: 'scripts', role: 'Drafts and rewrites the script.', look: { shape: 'column', emblem: 'page', tone: 'coral' }, phase: 0.924 },
  wren: { given: 'Wren', job: 'renders', role: 'Makes frames and clips on Runway.', look: { shape: 'star', emblem: 'spark', tone: 'marigold' }, phase: 0.939 },
  rhea: { given: 'Rhea', job: 'retouches', role: 'Cut-outs, fills and upscales.', look: { shape: 'dome', emblem: 'dots', tone: 'mint' }, phase: 0.497 },
  edie: { given: 'Edie', job: 'edits', role: 'Splices moments and renders the ad.', look: { shape: 'stack', emblem: 'bars', tone: 'iris' }, phase: 0.347 },
  jude: { given: 'Jude', job: 'checks', role: 'Checks each result as it lands, and says when one needs you.', look: { shape: 'card', emblem: 'tick', tone: 'ink' } },
}

/** The whole crew in the crew sheet's order (5.1): five who make the ad, then the two house agents. */
export const CREW_ORDER: readonly CastKey[] = ['dex', 'skye', 'wren', 'rhea', 'edie', 'ellis', 'jude']
export const HOUSE_AGENTS: readonly CastKey[] = ['ellis', 'jude']

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

/** The figure shown for a crew member: their own where the cast has one, else Dex (who directs the rest). */
export function castOf(crew: CrewId | undefined): CastKey {
  return crew && crew in CAST ? (crew as CastKey) : 'dex'
}

/** Who makes each op when the job names no crew member (ui-behaviour 5.1): Dex plans and directs,
 *  Skye writes, Wren renders on Runway, Rhea retouches, Edie edits, Ellis reads, Jude checks. */
export const MAKER_OF: Readonly<Record<DocJob['op'], CastKey>> = {
  shot_list: 'dex', frame_edit: 'dex',
  write: 'skye',
  generate: 'wren', view: 'wren', frame: 'wren', clip: 'wren', bridge: 'wren', resize: 'wren', cutdown: 'wren',
  region_edit: 'rhea', cutout: 'rhea', upscale: 'rhea',
  clip_edit: 'edie', clip_patch: 'edie', stitch: 'edie',
  read: 'ellis', transcribe: 'ellis',
  check: 'jude',
}

/** The loader's department for a job (ui-behaviour 6.3): it follows the work, not the agent. */
export type Work = 'create' | 'plan' | 'learn' | 'produce'
export function workOf(op: DocJob['op'] | undefined, state?: JobState): Work {
  if (state === 'validating' || state === 'uncertain') return 'learn'
  switch (op) {
    case 'shot_list': case 'frame_edit': case 'write': return 'plan'
    case 'read': case 'transcribe': case 'check': return 'learn'
    case 'stitch': case 'clip_edit': case 'clip_patch': case 'resize': case 'cutdown': return 'produce'
    default: return 'create'
  }
}

const FAILED: JobState[] = ['failed', 'cancelled']

/** What a job is, in words: 'frame 2', 'the clip for shot 3', 'the ad'. */
export function jobWhat(job: Pick<DocJob, 'op'>, ctx: JobPurpose | undefined, shotOrder?: number): string {
  if (ctx?.for === 'frame') return shotOrder ? `frame ${shotOrder}` : 'a frame'
  if (ctx?.for === 'clip') return shotOrder ? `the clip for shot ${shotOrder}` : 'a clip'
  switch (job.op) {
    case 'shot_list': return 'the shots'
    case 'stitch': return 'the ad'
    case 'write': return 'a draft'
    case 'frame': return 'a frame'
    case 'clip': case 'clip_edit': return 'a clip'
    case 'view': return 'a view'
    case 'region_edit': return 'a change in a box'
    default: return 'a picture'
  }
}

const VERB: Partial<Record<DocJob['op'], string>> = { write: 'writing', shot_list: 'planning', generate: 'drawing', view: 'drawing', frame: 'drawing', stitch: 'putting together', clip: 'making', clip_edit: 'changing' }

/**
 * Who is shown for a job, and the line under them: Dex for planning, the job's crew member
 * while it is made (where the cast has a figure for them, else Dex), Jude while it is checked
 * and when it failed (needs you). A job waiting for an answer waits for you, with no loader
 * (ui-behaviour 5.2). Words only; the job is not touched. A job the relay made on Runway after
 * its pick could not says so (features/runway-fallback.clan).
 */
export function whoIsWorking(job: Pick<DocJob, 'op'> & Partial<Pick<DocJob, 'provider' | 'crew'>>, state: JobState,
  ctx?: JobPurpose & { fallbackFrom?: ModelChoice }, shotOrder?: number): { agent: CastKey; state: AgentState; line: string } {
  const what = jobWhat(job, ctx, shotOrder)
  if (FAILED.includes(state)) return { agent: 'jude', state: 'needs-you', line: state === 'cancelled' ? `${capital(what)} was stopped` : `${capital(what)} did not come back` }
  const maker: CastKey = job.op === 'shot_list' ? 'dex' : job.crew ? castOf(job.crew) : MAKER_OF[job.op] ?? 'dex'
  const name = CAST[maker].given
  if (state === 'needs_input') return { agent: maker, state: 'needs-you', line: `Waiting for you: ${name} has a question about ${what}` }
  const moved = fellBack(ctx?.fallbackFrom, job.provider)
  const note = moved ? ` · ${moved}` : ''
  if (state === 'validating' || state === 'uncertain') return { agent: 'jude', state: 'working', line: `Jude is checking ${what}${note}` }
  if (state === 'completed') return { agent: maker, state: 'idle', line: `${name} made ${what}${note}` }
  const verb = VERB[job.op] ?? 'making'
  return { agent: maker, state: 'working', line: (state === 'queued' ? `${name} is waiting to start ${what}` : `${name} is ${verb} ${what}`) + note }
}

const capital = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
