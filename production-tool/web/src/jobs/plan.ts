// Dex's plan: the shot_list request, and its landing (contracts/collab.md §5).
//
// The request sends the main script's words (its scenes' unplanned text, then
// the planned shots' action: what Dex re-plans from), the target length, every
// named picture, and the shots already there (a re-plan keeps their ids).
//
// The landing moves the script's words out of the scenes into the shots and
// their beats: ONE undo step and ONE decision by dex citing the job
// (clan-store landPlan), on the CLAN store. A re-plan is a merge keyed by shot
// id: a planned shot with an existing id updates that shot's camera and length,
// and its words only when a person did not write them last; new shots are
// added after the others; a shot whose words or camera the plan changes gets a
// 'Script changed' mark on its frame (framing, words) or its clip (move, length);
// a shot the plan leaves out goes, unless a person wrote it last or something
// was made from it (frames, clips): then Dex asks first (an ask on the
// storyboard, Keep / Remove, answered in the Storyboard panel). Kept shots keep
// their status, frames and picks. On the snapshot store (no live text) the same entities are
// written with their words as flat text.

import { EMPTY_PROSE, landPlan, newUlidId, ranksBetween, type Patch, type PlanLanding, type Prose } from '../../../clan-store/src'
import type { Ask, BeatKind, Camera, DirectorCard, Job, JobInput, PlannedShot, ProductionDocument, Shot, StaleMark } from '../contracts/types'
import { landUpdate } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import type { JobCtx } from '../doc/ui'
import { proseFromText } from '../model/diff'
import { ModelStore } from '../model/store'
import { beatsOf, currentFrame, currentTake, framesOf, keyNamed, mainStoryboard, openAsks, refNamed, scenesOf, scriptOfStoryboard, scriptText, shotNumber, shotsOf, staleList, takesOf } from '../model/selectors'
import type { Relay } from '../relay'
import type { FrameDeps } from './frames'
import { SCRIPT_MAX } from './frames'
import { landingWhy } from './landing'
import { allNamed, jobShot } from './select'
import { isActive } from './runner'

// ── the request ─────────────────────────────────────────────────────────────

/** The storyboard a plan is for: this one when it is in the document, else the main one. */
const boardToPlan = (d: ProductionDocument, storyboardId?: string) => (storyboardId && d.storyboards[storyboardId]) || mainStoryboard(d)

/** The shot_list request: the script's words, the target, the named pictures, the shots already there.
 *  `storyboardId`: the storyboard to plan (absent: the main one), from the script that drives it. */
export async function planInput(relay: Relay, d: ProductionDocument, text?: string, storyboardId?: string): Promise<JobInput> {
  const sb = boardToPlan(d, storyboardId)
  if (!sb) throw new Error('This project has no storyboard.')
  const refs = await allNamed(relay, d)
  const shots = shotsOf(d, sb.id)
  const script = scriptOfStoryboard(d, sb.id)
  return {
    script: (script ? scriptText(d, script.id) : '').slice(0, SCRIPT_MAX),
    targetS: Math.min(600, Math.max(1, Math.round(sb.target_s))),
    ...(refs.length ? { refs } : {}),
    ...(shots.length ? { shots: shots.map((s) => jobShot(d, s, false)) } : {}),
    ...(text?.trim() ? { text: text.trim().slice(0, 1000) } : {}),
  }
}

/** Ask Dex for a plan (or a re-plan) of a storyboard (absent: the main one). */
export async function planShots(deps: FrameDeps, opts: { text?: string; storyboardId?: string } = {}): Promise<string> {
  const d = deps.doc.get()
  const input = await planInput(deps.relay, d, opts.text, opts.storyboardId)
  const sb = boardToPlan(d, opts.storyboardId)
  return deps.runner.submit('shot_list', input, [], sb && sb.id !== mainStoryboard(d)?.id ? { for: 'shot_list', storyboardId: sb.id } : { for: 'shot_list' })
}

/** The plan job running on a storyboard (absent: the main one) now, if any. */
export function runningPlan(d: ProductionDocument, storyboardId?: string): string | undefined {
  const sb = boardToPlan(d, storyboardId)
  if (!sb) return undefined
  return Object.values(d.jobs).find((j) => j.op === 'shot_list' && j.node?.kind === 'storyboard' && j.node.id === sb.id && isActive(j.state))?.id
}

/**
 * Plan shots from either entry point (the Storyboard stage, the Script editor): the same job, on the
 * same node {kind: 'storyboard', id}. One already running is joined, never started twice.
 */
export async function planOrJoin(deps: FrameDeps, opts: { text?: string; storyboardId?: string } = {}): Promise<{ jobId: string; joined: boolean }> {
  const running = runningPlan(deps.doc.get(), opts.storyboardId)
  if (running) return { jobId: running, joined: true }
  return { jobId: await planShots(deps, opts), joined: false }
}

// ── the landing ─────────────────────────────────────────────────────────────

const isPerson = (writer: string | undefined) => !!writer?.startsWith('human:')

interface ShotRow {
  id: string
  /** The shot already there that this plan updates. */
  existing?: Shot
  /** A new shot's fields (no text); a re-planned one's camera and length. */
  fields: Record<string, unknown>
  action: string
  direction?: string
  /** Its words are Dex's to write (a new shot, or one no person wrote last). */
  writeText: boolean
}

interface BeatRow { id: string; fields: { shot_id: string; rank: string; at_s: number; kind: BeatKind; speaker?: string; parenthetical?: string }; text: string }

/** What a shot_list job's result does to the document. */
export interface ShotListPlan {
  shots: ShotRow[]
  beats: BeatRow[]
  /** Shots the plan leaves out that no person wrote last and nothing was made from, and the beats that go
   *  with them or are replaced. */
  dropShots: string[]
  dropBeats: string[]
  /** 'Script changed' marks on the frames and clips of the shots the plan changes. */
  stale: StaleMark[]
  /** Dex's questions about the shots the plan leaves out that have frames or clips: keep or remove? */
  asks: Ask[]
}

/** The reason on the marks a re-plan leaves. */
export const SCRIPT_CHANGED = 'Script changed'
/** The routes of the Keep / Remove options of a left-out shot's ask (answered by keepOrRemove, stages/storyboardEdits.ts). */
export const KEEP_SHOT = 'keep_shot'
export const REMOVE_SHOT = 'remove_shot'

/** The shot a left-out shot's ask is about, if it is one. */
export function askedShot(a: Ask): string | undefined {
  for (const o of a.question.options) {
    const v = o.value as { route?: string; node?: { kind: string; id: string } } | undefined
    if ((v?.route === KEEP_SHOT || v?.route === REMOVE_SHOT) && v.node?.kind === 'shot') return v.node.id
  }
  return undefined
}

/** Dex's question about a shot the new plan leaves out that something was made from. */
function leftOutAsk(d: ProductionDocument, storyboardId: string, shot: Shot, why = 'The new plan leaves it out, but it has frames or clips.'): Ask {
  const id = newUlidId('q')
  const n = shotNumber(d, shot.id)
  const node = { kind: 'shot' as const, id: shot.id }
  return {
    id, v: 1, field_v: {}, node: { kind: 'storyboard', id: storyboardId }, crew: 'dex', state: 'open', answers: [],
    question: {
      id, kind: 'block', text: `Shot ${n} no longer has a scene. Keep it or remove it?`,
      why,
      options: [
        { id: 'keep', label: 'Keep', value: { route: KEEP_SHOT, node } },
        { id: 'remove', label: 'Remove', value: { route: REMOVE_SHOT, node } },
      ],
      allow_text: false,
    },
  }
}

/** What in a shot's frame and clip a re-plan changes: framing or words → its frame; move or length → its clip. */
function replanMarks(d: ProductionDocument, was: Shot, p: PlannedShot, wordsChange: boolean, now: string): StaleMark[] {
  const cam = (c: Camera, k: keyof Camera) => JSON.stringify(c[k] ?? null)
  const framing = (['size', 'angle', 'lens_mm', 'macro'] as const).some((k) => cam(was.camera, k) !== cam(p.camera, k))
  const move = (['movement', 'movement_speed'] as const).some((k) => cam(was.camera, k) !== cam(p.camera, k)) || was.duration_s !== p.duration_s
  const out: StaleMark[] = []
  const marked = (kind: 'frame' | 'take', id: string) => staleList(d).some((m) => m.target.kind === kind && m.target.id === id && m.caused_by.kind === 'shot' && m.caused_by.id === was.id)
  const frame = currentFrame(d, was)
  if (frame && (framing || wordsChange) && !marked('frame', frame.id)) {
    out.push({ id: newUlidId('stale'), v: 1, field_v: {}, target: { kind: 'frame', id: frame.id }, caused_by: { kind: 'shot', id: was.id }, reason: SCRIPT_CHANGED, marked_at: now })
  }
  const take = currentTake(d, was.id)
  if (take && move && !marked('take', take.id)) {
    out.push({ id: newUlidId('stale'), v: 1, field_v: {}, target: { kind: 'take', id: take.id }, caused_by: { kind: 'shot', id: was.id }, reason: SCRIPT_CHANGED, marked_at: now })
  }
  return out
}

const sameWords = (a: string | undefined, b: string | undefined) => (a ?? '').trim().replace(/\s+/g, ' ') === (b ?? '').trim().replace(/\s+/g, ' ')

/** The names a planned shot shows that its words do not mention yet: said in its direction, so they are
 *  mentions in its text (a shot's refs are the names its text mentions). Only names the document has. */
function directionOf(d: ProductionDocument, p: PlannedShot): string | undefined {
  const words = `${p.action} ${p.direction ?? ''}`
  const missing = p.refs.filter((n) => !new RegExp(`@${n}(?![a-z0-9_-])`).test(words) && (refNamed(d, n) || keyNamed(d, n)))
  const said = [p.direction?.trim(), missing.length ? `Shows ${missing.map((n) => `@${n}`).join(', ')}.` : ''].filter(Boolean).join(' ')
  return said ? said.slice(0, 4000) : undefined
}

function beatRows(shotId: string, p: PlannedShot): BeatRow[] {
  const beats = p.beats ?? []
  const ranks = beats.length ? ranksBetween(null, null, beats.length) : []
  return beats.map((b, i) => ({
    id: newUlidId('beat'),
    fields: {
      shot_id: shotId, rank: ranks[i], at_s: Math.min(b.at_s, p.duration_s), kind: b.kind,
      ...(b.speaker ? { speaker: b.speaker } : {}), ...(b.parenthetical ? { parenthetical: b.parenthetical } : {}),
    },
    text: b.text,
  }))
}

/** The plan a shot_list job's result makes of the document as it is now (see the top of this file). */
export function planOf(d: ProductionDocument, job: Pick<Job, 'shots'>, storyboardId?: string): ShotListPlan {
  const sb = boardToPlan(d, storyboardId)
  const out: ShotListPlan = { shots: [], beats: [], dropShots: [], dropBeats: [], stale: [], asks: [] }
  if (!sb) return out
  const now = new Date().toISOString()
  const planned = job.shots ?? []
  const existing = shotsOf(d, sb.id)
  const byId = new Map(existing.map((s) => [s.id, s]))
  const scenes = scenesOf(d, scriptOfStoryboard(d, sb.id)?.id)
  const fresh = planned.filter((p) => !(p.id && byId.has(p.id)))
  const ranks = fresh.length ? ranksBetween(existing.at(-1)?.rank ?? null, null, fresh.length) : []
  let k = 0
  for (const p of planned) {
    const was = p.id ? byId.get(p.id) : undefined
    const direction = directionOf(d, p)
    if (was) {
      const writeText = !isPerson(was.last_writer)
      out.stale.push(...replanMarks(d, was, p, writeText && !(sameWords(was.action, p.action) && sameWords(was.direction, direction)), now))
      out.shots.push({ id: was.id, existing: was, fields: { camera: p.camera, duration_s: p.duration_s }, action: p.action, ...(direction ? { direction } : {}), writeText })
      if (writeText) {
        out.dropBeats.push(...beatsOf(d, was.id).filter((b) => !isPerson(b.last_writer)).map((b) => b.id))
        out.beats.push(...beatRows(was.id, p))
      }
      continue
    }
    const scene = scenes.find((s) => p.scene_heading && s.heading === p.scene_heading) ?? scenes[0]
    const id = newUlidId('shot')
    out.shots.push({
      id,
      fields: {
        storyboard_id: sb.id, rank: ranks[k++], kind: p.kind, duration_s: p.duration_s, camera: p.camera, status: 'planned',
        ...(scene ? { scene_id: scene.id } : {}),
      },
      action: p.action,
      ...(direction ? { direction } : {}),
      writeText: true,
    })
    out.beats.push(...beatRows(id, p))
  }
  const named = new Set(planned.map((p) => p.id).filter(Boolean))
  const asked = new Set(openAsks(d).map(askedShot).filter(Boolean))
  for (const s of existing) {
    if (named.has(s.id) || isPerson(s.last_writer)) continue
    // Never silently: a shot something was made from, or whose scene is gone, stays until a person says Remove.
    const sceneGone = !!s.scene_id && !d.scenes[s.scene_id]
    if (sceneGone || framesOf(d, s.id).length || takesOf(d, s.id).length) {
      if (!asked.has(s.id)) out.asks.push(leftOutAsk(d, sb.id, s, sceneGone ? 'Its scene was taken out of the script.' : undefined))
      continue
    }
    out.dropShots.push(s.id)
    out.dropBeats.push(...beatsOf(d, s.id).map((b) => b.id))
  }
  return out
}

/** A shot's words as its fragment's prose: action blocks, then one direction block. */
function shotProse(d: ProductionDocument, row: ShotRow): Prose {
  const lines = [{ type: 'action', text: row.action }]
  if (row.direction) lines.push({ type: 'direction', text: row.direction.replace(/\n/g, ' ') })
  return proseFromText(d, lines)
}

/** The ref and key ids words mention (the flat `refs` a shot's text gives it). */
function mentionedIds(d: ProductionDocument, words: string): string[] {
  const ids: string[] = []
  for (const m of words.matchAll(/@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)/g)) {
    const t = refNamed(d, m[1]) ?? (m[1].includes('_') ? undefined : keyNamed(d, m[1]))
    if (t && !ids.includes(t.id)) ids.push(t.id)
  }
  return ids
}

/** The plan written into a draft with its words as flat text (the snapshot store, and tests). */
export function applyShotList(d: ProductionDocument, job: Pick<Job, 'shots'>, ctx?: { storyboardId?: string }): ShotListPlan {
  const sbId = boardToPlan(d, ctx?.storyboardId)?.id
  const plan = planOf(d, job, sbId)
  for (const id of plan.dropBeats) delete d.beats[id]
  for (const id of plan.dropShots) delete d.shots[id]
  for (const row of plan.shots) {
    const text = row.writeText
      ? { action: row.action, ...(row.direction ? { direction: row.direction } : {}), refs: mentionedIds(d, `${row.action} ${row.direction ?? ''}`), last_writer: 'dex' }
      : {}
    if (row.existing) {
      const s = d.shots[row.id]
      Object.assign(s, row.fields, text)
      if (row.writeText && !row.direction) delete s.direction
      continue
    }
    d.shots[row.id] = { id: row.id, v: 1, field_v: {}, ...(row.fields as Omit<Shot, 'id' | 'v' | 'field_v'>), ...text }
  }
  for (const b of plan.beats) d.beats[b.id] = { id: b.id, v: 1, field_v: {}, ...b.fields, text: b.text, last_writer: 'dex' }
  for (const m of plan.stale) d.stale[m.id] = m
  for (const a of plan.asks) d.asks[a.id] = a
  // The words moved into the shots: nothing stays in the scenes (one owner per span).
  for (const sc of scenesOf(d, scriptOfStoryboard(d, sbId)?.id)) if (sc.text) sc.text = ''
  return plan
}

/** The leaf patches that turn a shot's camera into another (one per part). */
function cameraPatches(s: Shot, camera: Camera): Patch[] {
  const a = s.camera as unknown as Record<string, unknown>
  const b = camera as unknown as Record<string, unknown>
  const out: Patch[] = []
  for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[p]) === JSON.stringify(b[p])) continue
    out.push({ op: 'set', entity: 'shots', id: s.id, path: `camera/${p}`, value: (b[p] ?? null) as Patch['value'], base_version: s.v })
  }
  return out
}

/**
 * Dex's plan lands: on the CLAN store, through clan-store landPlan (the entities and the text move in one
 * undo step, one decision by dex citing the job); on the snapshot store, as flat text. Resolves the plan.
 */
export async function landShotList(store: DocumentStore, job: Job, ctx?: Extract<JobCtx, { for: 'shot_list' }>): Promise<ShotListPlan> {
  const cards: DirectorCard[] | undefined = job.director?.cards ?? ctx?.cards
  if (!(store instanceof ModelStore)) {
    const n = job.shots?.length ?? 0
    let plan: ShotListPlan = { shots: [], beats: [], dropShots: [], dropBeats: [], stale: [], asks: [] }
    await landUpdate(store, (x) => { plan = applyShotList(x, job, ctx) }, landingWhy(store, job.jobId, `${n} ${n === 1 ? 'shot' : 'shots'} for the storyboard`, cards))
    return plan
  }
  await store.flush()
  const d = store.get()
  const sbId = boardToPlan(d, ctx?.storyboardId)?.id
  const plan = planOf(d, job, sbId)
  const n = plan.shots.length
  const why = landingWhy(store, job.jobId, `${n} ${n === 1 ? 'shot' : 'shots'} for the storyboard`, cards)
  const patches: Patch[] = []
  for (const row of plan.shots.filter((r) => r.existing)) {
    const s = row.existing!
    patches.push(...cameraPatches(s, row.fields.camera as Camera))
    if (s.duration_s !== row.fields.duration_s) patches.push({ op: 'set', entity: 'shots', id: s.id, path: 'duration_s', value: row.fields.duration_s as number, base_version: s.v })
  }
  for (const id of plan.dropBeats) patches.push({ op: 'delete', entity: 'beats', id, base_version: d.beats[id].v })
  for (const id of plan.dropShots) patches.push({ op: 'delete', entity: 'shots', id, base_version: d.shots[id].v })
  // The marks and the questions are part of the same step: undo takes the plan back with them.
  for (const m of plan.stale) patches.push({ op: 'create', entity: 'stale', id: m.id, value: m, base_version: 0 })
  for (const a of plan.asks) patches.push({ op: 'create', entity: 'asks', id: a.id, value: a, base_version: 0 })
  const landing: PlanLanding = {
    scenes: scenesOf(d, scriptOfStoryboard(d, sbId)?.id).map((s) => ({ id: s.id, remainder: EMPTY_PROSE })),
    shots: plan.shots.filter((r) => !r.existing).map((r) => ({ id: r.id, value: r.fields, prose: shotProse(d, r) })),
    beats: plan.beats.map((b) => ({ id: b.id, value: b.fields, prose: proseFromText(d, [{ type: b.fields.kind === 'line' ? 'dialogue' : 'action', text: b.text.replace(/\n/g, ' ') }]) })),
    patches,
  }
  const agent = why.agent ?? 'dex'
  if (!landing.shots.length && !landing.beats?.length && !patches.length && !plan.shots.some((x) => x.writeText)) return plan
  const r = await landPlan(store.bus, store.text, landing, {
    action: why.action, agent, ...(why.rationale ? { rationale: why.rationale } : {}), ...(why.cites ? { cites: why.cites } : {}),
  })
  if (!r.applied) throw new Error(`The plan could not land: ${[...r.refused.map((x) => x.message), ...r.conflicts.map((c) => `${c.entity} ${c.id} changed since`)].join('; ')}`)
  // A re-planned shot's words, when they are Dex's: part of the same undo step.
  for (const row of plan.shots.filter((x) => x.existing && x.writeText)) {
    await store.text.replace('shot', row.id, shotProse(store.bus.doc() as unknown as ProductionDocument, row), agent, { label: why.action, joinStep: true })
  }
  await store.flush() // the store shows what the buses hold now
  return plan
}
