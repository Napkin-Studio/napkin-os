// What waits in a room's Booth (features/script-freeform.clan, owner 2026-11-16: "use what exists, do not
// invent agent logic"): 'Waiting for you' is the room's existing needs-you items (questions from the doc's
// asks model, failed jobs not cleared); 'Notes' is the recent decision-chain entries by that room's agent
// about that node. Pure, for the tests.

import type { DocJob, JobState, ProductionDocument } from '../../contracts/types'
import type { JobCtx, StageName } from '../../doc/ui'
import { askOf } from '../../jobs/runner'
import { entityOf } from '../../model/lineage'
import type { CastKey } from '../agents/cast'
import { plainWords, projectEntries, type ChainLike } from '../historyItems'
import { trayGroups, whereIs } from '../tray'

type Doc = ProductionDocument

export interface BoothNote { id: string; label: string; body: string; at: string }

const PAST: Record<string, string> = { plan: 'planned', write: 'wrote', render: 'made', edit: 'edited', check: 'checked', retouch: 'retouched', read: 'read', draw: 'drew', make: 'made' }

/** The newest few entries by `agent` that target or cite one of `addresses` (entity addresses), in words. */
export function agentNotes(entries: ChainLike[], agent: CastKey, addresses: string[], doc: Doc, limit = 3): BoothNote[] {
  const want = new Set(addresses.map((a) => entityOf(a) ?? a))
  const about = (e: ChainLike) => [...(e.targets ?? []), ...(e.cites ?? [])].some((a) => want.has(entityOf(a) ?? a))
  return projectEntries(entries)
    .filter((e) => e.agent === agent && about(e))
    .slice(0, limit)
    .map((e, i) => {
      const [verb, ...rest] = plainWords(e.action, doc).split(' ')
      const past = PAST[verb] ?? verb
      const body = `${past[0]?.toUpperCase() ?? ''}${past.slice(1)} ${rest.join(' ')}`.trim()
      return { id: e.id ?? `${e.timestamp}:${i}`, label: past, body: body.endsWith('.') ? body : `${body}.`, at: e.timestamp }
    })
}

/** The entity addresses of a storyboard and what is on it: its shots, their frames and the jobs that made them. */
export function storyboardAddresses(doc: Doc, docId: string, storyboardId: string | undefined): string[] {
  if (!storyboardId) return []
  const shots = Object.values(doc.shots).filter((s) => s.storyboard_id === storyboardId).map((s) => s.id)
  const frames = Object.values(doc.frames).filter((f) => f.shot_id && shots.includes(f.shot_id))
  return [`${docId}#storyboards[${storyboardId}]`, ...shots.map((id) => `${docId}#shots[${id}]`),
    ...frames.flatMap((f) => [`${docId}#frames[${f.id}]`, ...(f.job_id ? [`${docId}#jobs[${f.job_id}]`] : [])])]
}

/** The entity addresses of a video and its shots, takes and renders. */
export function videoAddresses(doc: Doc, docId: string, videoId: string, shotIds: string[]): string[] {
  const gens = Object.values(doc.generations ?? {}).filter((g) => g.shot_ids.some((s) => shotIds.includes(s)))
  const renders = Object.values(doc.renders ?? {}).filter((r) => r.video_id === videoId)
  return [`${docId}#videos[${videoId}]`, ...shotIds.map((id) => `${docId}#shots[${id}]`),
    ...gens.flatMap((g) => [`${docId}#generations[${g.id}]`, ...(g.job_id ? [`${docId}#jobs[${g.job_id}]`] : [])]),
    ...renders.flatMap((r) => [`${docId}#renders[${r.id}]`, ...(r.job_id ? [`${docId}#jobs[${r.job_id}]`] : [])])]
}

export interface Waiting {
  /** A job's question (needs_input), answered in its card. */
  asks: { job: DocJob; ask: NonNullable<ReturnType<typeof askOf>> }[]
  /** A job that failed and was not cleared or sent again. */
  failed: DocJob[]
}

/** The needs-you items on a stage for these shots (or the node itself): questions waiting and failures not cleared. */
export function stageWaiting(doc: Doc, stage: StageName, ctxOf: (id: string) => JobCtx | undefined,
  liveOf: (id: string) => { state?: JobState } | undefined, belongs: (job: DocJob, ctx: JobCtx | undefined) => boolean): Waiting {
  const g = trayGroups(Object.values(doc.jobs), ctxOf, liveOf)
  const here = (job: DocJob, ctx: JobCtx | undefined) => whereIs(job, ctx).stage === stage && belongs(job, ctx)
  const asks = g.waiting.filter((r) => here(r.job, r.ctx)).flatMap((r) => {
    const ask = askOf(doc, r.job.id)
    return ask && ask.state === 'open' ? [{ job: r.job, ask }] : []
  })
  return { asks, failed: g.needsYou.filter((r) => here(r.job, r.ctx)).map((r) => r.job) }
}
