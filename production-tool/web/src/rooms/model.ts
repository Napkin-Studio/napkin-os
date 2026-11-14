// What the two rooms read of the document (features/make-and-edit.clan): the boxes of the film (one box is one
// generation; its lines are cuts), every take in the Bin (newest first, each with its one-line change label),
// and the cut the Edit room works on. The rooms render these; they never read takes or the cut directly.

import { SHEETS } from '../contracts/load'
import type { Config, GenerationDelta, GenerationKind, Id, ProductionDocument, Shot } from '../contracts/types'
import type { UiState } from '../doc/ui'
import { lastWorkedModel } from '../jobs/follow'
import { videoJoin, videoModel, videoPlan, videoRows, type Row } from '../jobs/runView'
import { shotNumber, shotsOf, storyboardOfVideo } from '../model/selectors'
import { changeLabel, type DeltaRow } from './delta'
import type { ShotWindow } from './cut'

export type GenKind = GenerationKind

/** One take in the Bin: one generation, of one box. */
export interface Gen {
  id: Id
  kind: GenKind
  /** The box it belongs to (boxKey of its shots). */
  boxKey: string
  shotIds: Id[]
  /** v1, v2… within its box, oldest first. */
  version: number
  parentId?: Id
  delta: DeltaRow[]
  /** "Camera: handheld (shot 3)", "First take". */
  label: string
  asset?: string
  durationS: number
  /** Where each shot sits in the take. */
  segments: { shotId: Id; inS: number; outS: number }[]
  state: 'making' | 'ready' | 'failed'
  jobId?: Id
  createdAt?: string
  model?: string
  provider?: string
  /** Each shot's camera as it was sent, when known (for "Camera: handheld (shot 3)" on a take made again). */
  camera?: Record<Id, { movement?: string; size?: string }>
}

/** A box of the film: shots made as one generation, or one shot alone, or the end card. */
export interface Box {
  key: string
  /** 1-based among the boxes that are not the end card. */
  n: number
  shotIds: Id[]
  together: boolean
  endCard: boolean
  lengthS: number
  row?: Row
}

export const boxKeyOf = (shotIds: Id[]) => shotIds.join(',')

/** A shot's title: its words, else "Shot n". */
export const shotTitle = (s: Pick<Shot, 'action' | 'direction'> | undefined, n: number) => (s?.action?.trim() || s?.direction?.trim() || `Shot ${n}`)

/** Whether a model can repeat a take exactly (its clip sheet's seed). */
export function repeatsTake(provider: string | undefined, model: string | undefined): boolean {
  const clip = SHEETS[(provider ?? 'mock') as keyof typeof SHEETS]?.ops?.clip
  const e = clip && [clip, ...(clip.alternates ?? [])].find((x) => x.model === model)
  return !!(e && 'seed' in e && (e as { seed?: boolean }).seed)
}

/** "Box 2", or "End card". */
export const boxName = (b: Pick<Box, 'n' | 'endCard'>) => (b.endCard ? 'End card' : `Box ${b.n}`)

/** "Box 2 · v3 · 3.5 s". */
export function genTitle(g: Gen, boxes: Box[]): string {
  const b = boxes.find((x) => x.key === g.boxKey)
  const len = `${Math.round(g.durationS * 10) / 10} s`
  return [b ? boxName(b) : 'Not in a box', `v${g.version}`, len].join(' · ')
}

/** The video's boxes, in storyboard order. As one film (connected video), the planner's rows; otherwise each
 *  shot is its own box. */
export function roomBoxes(d: ProductionDocument, ui: Pick<UiState, 'jobs'>, videoId: Id | undefined, config: Config): Box[] {
  const sb = storyboardOfVideo(d, videoId)
  const shots = sb ? shotsOf(d, sb.id) : []
  let rows: Row[] | null = null
  if (videoId && videoJoin(d, videoId, config) === 'film') {
    const model = videoModel(d, videoId, config, lastWorkedModel(d, 'clip', config))
    if (model) rows = videoRows(d, ui, videoId, videoPlan(d, videoId, model))
  }
  const groups: { shotIds: Id[]; row?: Row }[] = rows?.length ? rows.map((r) => ({ shotIds: r.shotIds, row: r })) : shots.map((s) => ({ shotIds: [s.id] }))
  let n = 0
  return groups.map((g) => {
    const endCard = g.shotIds.length === 1 && d.shots[g.shotIds[0]]?.kind === 'end_card'
    if (!endCard) n++
    return {
      key: boxKeyOf(g.shotIds), n: endCard ? 0 : n, shotIds: g.shotIds, together: g.shotIds.length > 1, endCard,
      lengthS: Math.round(g.shotIds.reduce((a, id) => a + (d.shots[id]?.duration_s ?? 0), 0) * 1000) / 1000,
      ...(g.row ? { row: g.row } : {}),
    }
  })
}

/**
 * Every generation of the video's shots (and the video's own footage not in a box), filed under the box whose
 * shots it shows: its box_id's run, else the box with exactly its shots, else the box of its first shot.
 * Newest first. The label is the generation's own, else worked out from its kind and delta.
 */
export function roomGens(d: ProductionDocument, _ui: Pick<UiState, 'jobs'>, videoId: Id | undefined, boxes: Box[]): Gen[] {
  const sb = storyboardOfVideo(d, videoId)
  const mine = new Set((sb ? shotsOf(d, sb.id) : []).map((s) => s.id))
  const runs = (videoId && d.videos[videoId]?.runs) || {}
  const out: Gen[] = []
  for (const g of Object.values(d.generations ?? {})) {
    if (!g.shot_ids.some((id) => mine.has(id))) continue
    if (g.kind === 'render' || g.kind === 'upload' || g.kind === 'combine') continue
    const run = g.box_id ? runs[g.box_id] : undefined
    const key = boxKeyOf(run?.shot_ids ?? g.shot_ids)
    const box = boxes.find((b) => b.key === key) ?? boxes.find((b) => b.shotIds.includes(g.shot_ids[0]))
    const durationS = g.duration_s ?? (g.asset ? d.assets[g.asset]?.duration_s : undefined) ?? 0
    const segments = g.segments?.length
      ? g.segments.map((x) => ({ shotId: x.shot_id, inS: x.in_s, outS: x.out_s }))
      : g.shot_ids.length === 1 ? [{ shotId: g.shot_ids[0], inS: 0, outS: durationS }] : []
    out.push({
      id: g.id, kind: g.kind, boxKey: box?.key ?? key, shotIds: g.shot_ids, version: 0,
      ...(g.parent_id ? { parentId: g.parent_id } : {}),
      delta: (g.delta ?? []).map((x) => deltaRow(x, g.patched?.find((p) => p.job_id === g.job_id))), label: g.label ?? '', ...(g.asset ? { asset: g.asset } : {}),
      durationS, segments, state: g.state, ...(g.job_id ? { jobId: g.job_id } : {}), createdAt: g.created_at,
      ...(g.inputs?.model ? { model: g.inputs.model } : {}), ...(g.provider ? { provider: g.provider } : {}),
      ...(g.inputs?.camera ? { camera: g.inputs.camera } : {}),
    })
  }
  numberAndLabel(out, (id) => shotNumber(d, id))
  return out.sort(newestFirst)
}

/** A document delta as the drawer's row: a moment's window is the stretch its own job made again (as the
 *  relay snapped it), else the one its `to` says. */
function deltaRow(x: GenerationDelta, own?: { in_s: number; out_s: number }): DeltaRow {
  const to = x.to as unknown
  if (x.field === 'moment' && to && typeof to === 'object') {
    const m = to as { note?: string; window?: { from_s: number; to_s: number }; in_s?: number; out_s?: number; inS?: number; outS?: number }
    const w = own ? { from_s: own.in_s, to_s: own.out_s } : m.window ?? (m.in_s !== undefined && m.out_s !== undefined ? { from_s: m.in_s, to_s: m.out_s }
      : m.inS !== undefined && m.outS !== undefined ? { from_s: m.inS, to_s: m.outS } : undefined)
    return { field: 'moment', to: m.note ?? '', ...(w ? { window: w } : {}) }
  }
  if (x.field === 'feel' && to && typeof to === 'object') return { field: 'feel', to: (to as { words?: string }).words ?? '' }
  const scalar = (v: unknown) => (v == null ? null : typeof v === 'number' ? v : String(v))
  return { field: x.field, from: scalar(x.from), to: scalar(to), ...(x.shot_id ? { shot_id: x.shot_id } : {}) }
}

/** v1…vn per box, oldest first; and each take's label from its delta. */
export function numberAndLabel(gens: Gen[], shotNo: (id: Id) => number) {
  const byBox = new Map<string, Gen[]>()
  for (const g of gens) byBox.set(g.boxKey, [...(byBox.get(g.boxKey) ?? []), g])
  const before = new Map<string, Gen>()
  for (const list of byBox.values()) {
    list.sort((a, b) => -newestFirst(a, b)).forEach((g, i) => {
      g.version = i + 1
      if (i > 0) before.set(g.id, list[i - 1])
    })
  }
  for (const g of gens) {
    if (g.state === 'making') { g.label = 'Making'; continue }
    if (g.state === 'failed') { g.label = 'Not made'; continue }
    if (g.delta.length) g.label = changeLabel(g.delta, shotNo)
    else if (g.label) continue
    else if (sentDiffers(g, before.get(g.id))) g.label = changeLabel(sentDiffers(g, before.get(g.id))!, shotNo)
    else if (g.kind === 'feel') g.label = 'Feel changed'
    else if (g.kind === 'patch') g.label = 'A moment changed'
    else g.label = g.parentId || g.version > 1 ? 'New take' : 'First take'
  }
}

/** A box made again after a person changed a shot's camera: what differs from the take before it, as a delta. */
function sentDiffers(g: Gen, prev: Gen | undefined): DeltaRow[] | undefined {
  if (!g.camera || !prev?.camera) return undefined
  for (const id of g.shotIds) {
    const a = prev.camera[id]
    const b = g.camera[id]
    if (!a || !b) continue
    if ((a.movement ?? 'static') !== (b.movement ?? 'static')) return [{ field: 'camera.movement', from: a.movement ?? 'static', to: b.movement ?? 'static', shot_id: id }]
    if (a.size !== b.size) return [{ field: 'camera.size', from: a.size ?? null, to: b.size ?? null, shot_id: id }]
  }
  return undefined
}

/** Newest first: by when its job was made, then by id. */
export function newestFirst(a: Pick<Gen, 'createdAt' | 'id' | 'state'>, b: Pick<Gen, 'createdAt' | 'id' | 'state'>): number {
  if ((a.state === 'making') !== (b.state === 'making')) return a.state === 'making' ? -1 : 1
  const t = (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  return t || b.id.localeCompare(a.id)
}

/** A take's window for one shot: where that shot sits in it (the whole take for a lone shot). */
export function shotWindow(g: Pick<Gen, 'segments' | 'durationS'>, shotId: Id | undefined): ShotWindow {
  const s = g.segments.find((x) => x.shotId === shotId)
  return s ? { inS: s.inS, outS: s.outS } : { inS: 0, outS: g.durationS }
}
