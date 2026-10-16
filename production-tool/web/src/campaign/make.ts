// Make all sizes (features/campaign-formats.clan): the format set and its sizes in the document, the
// Campaign board on the canvas, and a free crop job per size on the relay. Then the per-tile actions:
// Adjust crop, Lock, Change method, Update sizes, and the landing of each crop.
//
// Writes: the board and the set are one person's step (the canvas's undoable transact, then the
// document as a system write, as nodes/make.ts does); a tile's Adjust crop, Lock and method are each
// one undo step (updateDoc); a landing is Wren's (landUpdate), never an undo step.

import { newUlidId, rankBetween, ranksBetween } from '../../../clan-store/src'
import type { Board, FormatSet, Job, JobInput, PersonRef, ProductionDocument, ProtectBox, PxBox, Size, SizeMethod } from '../contracts/types'
import type { CanvasAdapter, CanvasElement } from '../canvas/core/canvasAdapter'
import { isBoard, boardsByRank } from '../canvas/boards/boards'
import { landUpdate, systemUpdate, updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import type { JobCtx } from '../doc/ui'
import { assetRef } from '../jobs/assets'
import { landingWhy } from '../jobs/landing'
import type { JobRunner } from '../jobs/runner'
import type { Relay } from '../relay'
import { boardLayout, PAD } from './board'
import { cropBox, previewSize } from './crop'
import { channelOf, formatById, PACKS_VERSION, type PlanRow } from './formats'
import { currentMasterAsset, type MasterInfo } from './master'
import { aspectOf, rowFracs, type MethodChoice } from './rules'
import { checksFor, flagged } from './checks'
import { layersFor } from './layout'

export const FRAME_PAD = 32
export const FRAME_TOP = 48

export interface CampaignDeps {
  canvas: CanvasAdapter
  doc: DocumentStore
  runner: JobRunner
  relay: Relay
}

/** A row of the send tray as Send makes it: the format, the rule's choice, ticked or not. */
export interface TrayRow extends PlanRow { pick: MethodChoice; on: boolean }

export interface MakeRequest {
  master: MasterInfo
  plan: { kind: 'plan' | 'pack'; id: string; lengths_s?: number[] }
  protect: { boxes: ProtectBox[]; keep_middle?: boolean }
  /** The words every size lays out (type layers). */
  copy?: { line?: string; legal?: string }
  rows: TrayRow[]
  /** The canvas element of the master, to place the board beside it. */
  near?: CanvasElement
}

type Box = { x: number; y: number; w: number; h: number }

/** The size element's box for a set: the board layout of its sizes. */
export function setLayout(d: ProductionDocument, setId: string) {
  const sizes = sizesOf(d, setId)
  return boardLayout(sizes.map((s) => ({ id: s.id, channel: channelOfSize(s), aspect: { w: s.delivery.width, h: s.delivery.height } })))
}

export function channelOfSize(s: Size) {
  if (s.media === 'video') return 'film'
  const f = formatById(s.format.format_id)
  const c = f ? channelOf(f.format) : 'social'
  return c === 'film' ? 'social' : c
}

/** The sizes of a set, in rank order. */
export function sizesOf(d: ProductionDocument, setId: string): Size[] {
  return Object.values(d.sizes ?? {}).filter((s) => s.set_id === setId).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
}

/** Where a new board goes: right of every board on the canvas, level with the top one (else beside `near`). */
function placeBoard(els: readonly CanvasElement[], near: CanvasElement | undefined, w: number, h: number): Box {
  const frames = els.filter((e) => isBoard(e))
  if (frames.length) {
    const right = Math.max(...frames.map((f) => f.x + f.width))
    const top = Math.min(...frames.map((f) => f.y))
    return { x: Math.round(right + 96), y: Math.round(top), w, h }
  }
  if (near) return { x: Math.round(near.x + near.width + 96), y: Math.round(near.y), w, h }
  return { x: 0, y: 0, w, h }
}

/** The safe area copied onto a size, when its format has one. */
function sizeFromRow(row: TrayRow, setId: string, rank: string, master: MasterInfo, protect: ProtectBox[]): Size {
  const f = row.format
  const method: SizeMethod = row.pick.now ?? row.pick.method
  const { crop } = cropBox(master, aspectOf(row), protect, rowFracs(row))
  const size: Size = {
    id: newUlidId('size'), v: 1, field_v: {}, set_id: setId, rank,
    format: { pack_id: row.pack.id, pack_version: PACKS_VERSION, format_id: f.id },
    aspect: { w: f.delivery_px.width, h: f.delivery_px.height },
    delivery: { ...f.delivery_px },
    ...(f.bleed_mm !== undefined ? { bleed_mm: f.bleed_mm } : {}),
    ...(f.safe_area ? { safe_area: structuredClone(f.safe_area) } : {}),
    method, media: row.media,
    ...(row.length_s ? { length_s: row.length_s } : {}),
  }
  if (row.media === 'image' && row.pick.now) {
    size.crop = crop
    size.crop_by = 'rule'
    size.from_asset = master.asset
    size.status = 'making'
  }
  return size
}

/**
 * Make all sizes: the set, its sizes and the Campaign board (one step of the person's), then a crop job
 * for every size that can be made now. Returns the set and the board's element.
 */
export async function makeAllSizes(deps: CampaignDeps, req: MakeRequest, by: PersonRef): Promise<{ setId: string; el: CanvasElement }> {
  const { canvas, doc } = deps
  const d = doc.get()
  const rows = req.rows.filter((r) => r.on && !r.pick.unavailable)
  if (!rows.length) throw new Error('Nothing to make: tick at least one size that can be made now.')
  const setId = newUlidId('fset')
  const set: FormatSet = {
    id: setId, v: 1, field_v: {},
    master: { kind: req.master.kind, id: req.master.id, asset: req.master.asset, w: req.master.w, h: req.master.h },
    pack: { pack_id: req.plan.id, pack_version: PACKS_VERSION },
    plan: { kind: req.plan.kind, id: req.plan.id, ...(req.plan.lengths_s?.length ? { lengths_s: req.plan.lengths_s } : {}) },
    protect: { boxes: req.protect.boxes, ...(req.protect.keep_middle ? { keep_middle: true } : {}) },
    ...(req.copy?.line?.trim() || req.copy?.legal?.trim() ? { copy: { ...(req.copy.line?.trim() ? { line: req.copy.line.trim() } : {}), ...(req.copy.legal?.trim() ? { legal: req.copy.legal.trim() } : {}) } } : {}),
  }
  const ranks = ranksBetween(null, null, rows.length)
  const sizes = rows.map((r, i) => sizeFromRow(r, setId, ranks[i], req.master, req.protect.boxes))
  for (const s of sizes) if (s.crop) s.checks = checksFor(s, set, d)
  const layout = boardLayout(sizes.map((s) => ({ id: s.id, channel: channelOfSize(s), aspect: { w: s.delivery.width, h: s.delivery.height } })))
  const last = boardsByRank(d).at(-1)
  const board: Board = { id: newUlidId('board'), v: 1, field_v: {}, title: `Campaign · ${req.master.label}`, purpose: 'formats', rank: rankBetween(last?.rank ?? null, null) }
  const box = placeBoard(canvas.elements(), req.near, layout.w + FRAME_PAD * 2, layout.h + FRAME_TOP + FRAME_PAD)
  const frame = canvas.board({ x: box.x, y: box.y, width: box.w, height: box.h, title: board.title, boardId: board.id, purpose: 'formats' })
  const el = canvas.patch(canvas.node({ x: box.x + FRAME_PAD, y: box.y + FRAME_TOP, width: layout.w, height: layout.h, customData: { kind: 'format_set', id: setId } }), { frameId: frame.id })
  canvas.transact((all) => [...all, frame, el], { undoable: true })
  await systemUpdate(doc, (x) => {
    x.boards[board.id] = board
    x.format_sets[setId] = set
    for (const s of sizes) x.sizes[s.id] = s
  }, `make all sizes of ${req.master.label}: ${sizes.length} formats`)
  canvas.select([el.id])
  for (const s of sizes) if (s.status === 'making') void sendSize(deps, setId, s.id, by).catch((e) => console.warn('the size was not sent', e))
  return { setId, el }
}

/** The job input for one size: the master's clean plate, the shape, the crop and the type layers. */
export async function sizeInput(deps: Pick<CampaignDeps, 'relay' | 'doc'>, set: FormatSet, size: Size): Promise<JobInput> {
  const d = deps.doc.get()
  const image = await assetRef(deps.relay, set.master.asset!, d)
  const layers = await layersFor(deps, set, size)
  return {
    image,
    aspect: { w: size.delivery.width, h: size.delivery.height },
    delivery: size.delivery,
    ...(size.safe_area ? { safeArea: size.safe_area } : {}),
    resize: {
      method: size.method,
      masterSize: { w: set.master.w!, h: set.master.h! },
      ...(set.protect?.boxes?.length ? { protect: set.protect.boxes } : {}),
      ...(size.crop ? { crop: size.crop } : {}),
      previewMaxPx: 2048,
      ...(layers.length ? { layers } : {}),
    },
  }
}

/** Send one size's crop (free, on the relay). The size is marked making and names the job. */
export async function sendSize(deps: CampaignDeps, setId: string, sizeId: string, _by?: PersonRef): Promise<string | null> {
  const d = deps.doc.get()
  const set = d.format_sets[setId]
  const size = d.sizes[sizeId]
  if (!set || !size || size.media !== 'image' || size.method !== 'crop') return null
  const input = await sizeInput(deps, set, size)
  const jobId = newUlidId('job')
  await systemUpdate(deps.doc, (x) => {
    const s = x.sizes[sizeId]
    if (!s) return
    s.job_id = jobId
    s.status = 'making'
  }, 'sync')
  await deps.runner.submit('resize', input, [], { for: 'size', setId, sizeId }, jobId)
  return jobId
}

/** A crop's result as the size's picture (Wren's landing). A job the size no longer names is dropped. */
export function applySize(d: ProductionDocument, job: Job, sizeId: string): Size | undefined {
  const size = d.sizes[sizeId]
  const out = job.outputs?.[0]
  if (!size || !out || size.job_id !== job.jobId) return undefined
  const set = d.format_sets[size.set_id]
  size.asset = out.sha256
  if (job.resize?.crop && !size.crop) size.crop = job.resize.crop
  if (set) size.checks = checksFor(size, set, d)
  size.status = flagged(size) ? 'look' : 'ready'
  return size
}

export function landSize(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'size' }>) {
  const d = store.get()
  const s = d.sizes[ctx.sizeId]
  if (!s || s.job_id !== job.jobId) return Promise.resolve(d)
  const f = formatById(s.format.format_id)
  const what = `the ${f?.format.name ?? s.format.format_id} size`
  return landUpdate(store, (x) => { applySize(x, job, ctx.sizeId) }, landingWhy(store, job.jobId, what))
}

/** Sizes that are out of date: their master changed (and they are not locked), or they were marked stale. */
export function staleSizes(d: ProductionDocument, els: readonly CanvasElement[], setId: string): Size[] {
  const set = d.format_sets[setId]
  if (!set) return []
  const now = currentMasterAsset(d, els, set)
  return sizesOf(d, setId).filter((s) => !s.locked && s.media === 'image' && (s.status === 'stale' || (!!s.from_asset && !!now && s.from_asset !== now)))
}

/**
 * Update sizes: every out-of-date size that is not locked is made again from the master as it is now
 * (a person's crop kept), as one write, then sent. Locked sizes never change.
 */
export async function updateSizes(deps: CampaignDeps, setId: string, by: PersonRef): Promise<number> {
  const d = deps.doc.get()
  const set = d.format_sets[setId]
  if (!set) return 0
  const els = deps.canvas.elements()
  const now = currentMasterAsset(d, els, set) ?? set.master.asset
  const stale = staleSizes(d, els, setId)
  if (!stale.length) return 0
  let dims = { w: set.master.w!, h: set.master.h! }
  const a = now ? d.assets[now] : undefined
  if (a?.w && a?.h) dims = { w: a.w, h: a.h }
  await updateDoc(deps.doc, (x) => {
    const s0 = x.format_sets[setId]
    if (!s0) return
    if (now && now !== s0.master.asset) {
      // A new picture of another size: protected boxes and people's crops scale with it.
      const kx = dims.w / (s0.master.w ?? dims.w)
      const ky = dims.h / (s0.master.h ?? dims.h)
      if (kx !== 1 || ky !== 1) {
        s0.protect = { ...s0.protect, boxes: (s0.protect?.boxes ?? []).map((b) => ({ ...b, x: b.x * kx, y: b.y * ky, w: b.w * kx, h: b.h * ky })) }
      }
      s0.master = { ...s0.master, asset: now, w: dims.w, h: dims.h }
    }
    for (const st of stale) {
      const s = x.sizes[st.id]
      if (!s) continue
      const row = formatById(s.format.format_id)
      if (s.crop_by !== 'person' || !s.crop || s.crop.x + s.crop.w > dims.w + 0.5 || s.crop.y + s.crop.h > dims.h + 0.5) {
        const fr = row ? rowFracs({ format: row.format }) : undefined
        s.crop = cropBox(dims, { w: s.delivery.width, h: s.delivery.height }, s0.protect?.boxes, fr).crop
        s.crop_by = 'rule'
      }
      s.from_asset = now
      s.status = 'making'
    }
  }, `update ${stale.length} sizes of format_sets[${setId}]`)
  for (const s of stale) void sendSize(deps, setId, s.id, by).catch((e) => console.warn('the size was not sent', e))
  return stale.length
}

/** Adjust crop: the person's crop for this size (one undo step), then the size is made again. */
export async function adjustCrop(deps: CampaignDeps, sizeId: string, crop: PxBox | null, by: PersonRef) {
  const d = deps.doc.get()
  const size = d.sizes[sizeId]
  const set = size && d.format_sets[size.set_id]
  if (!size || !set) return
  const row = formatById(size.format.format_id)
  const next = crop ?? cropBox({ w: set.master.w!, h: set.master.h! }, { w: size.delivery.width, h: size.delivery.height }, set.protect?.boxes, row ? rowFracs({ format: row.format }) : undefined).crop
  await updateDoc(deps.doc, (x) => {
    const s = x.sizes[sizeId]
    if (!s) return
    s.crop = next
    s.crop_by = crop ? 'person' : 'rule'
    s.checks = checksFor({ ...s, crop: next }, set, x)
  }, `${crop ? 'adjust the crop of' : 'reset the crop of'} sizes[${sizeId}]`)
  await sendSize(deps, size.set_id, sizeId, by)
}

/** Lock or unlock a size (one undo step). */
export function setLocked(store: DocumentStore, sizeId: string, locked: boolean) {
  return updateDoc(store, (x) => {
    const s = x.sizes[sizeId]
    if (!s) return
    if (locked) s.locked = true
    else delete s.locked
  }, `${locked ? 'lock' : 'unlock'} sizes[${sizeId}]`)
}

/** What must stay changed: crop sizes go out of date, nothing is sent until Update sizes. */
export function setProtect(store: DocumentStore, setId: string, protect: { boxes: ProtectBox[]; keep_middle?: boolean }) {
  return updateDoc(store, (x) => {
    const set = x.format_sets[setId]
    if (!set) return
    set.protect = { ...set.protect, boxes: protect.boxes, ...(protect.keep_middle ? { keep_middle: true } : {}) }
    if (!protect.keep_middle) delete set.protect.keep_middle
    for (const s of Object.values(x.sizes)) {
      if (s.set_id !== setId || s.locked || s.method !== 'crop' || s.crop_by === 'person') continue
      if (s.asset) s.status = 'stale'
    }
  }, `change what must stay in format_sets[${setId}]`)
}

/** The preview each size is made at (the relay's), for names and the manifest. */
export const previewOf = (s: Size) => previewSize(s.delivery)
export const BOARD_PAD = PAD
