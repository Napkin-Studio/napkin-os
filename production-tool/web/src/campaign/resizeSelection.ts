// Resize selected pictures (features/resize-selection.clan; owner, Shrey 2026-10-16): pick canvas
// pictures and scamps (a Drawing frame, a sketch area), pick shapes and how, and each picture × shape
// is one resize job on the relay (the op of features/campaign-formats.clan phase 4: crop free, extend on
// Ideogram 4.5 high, regenerate on Gemini 3 Pro then crop), its result a canvas node beside its original,
// labelled with its shape. All placements are one undo step; each job reserves, spends and fails alone.
// The Campaign board (Make all sizes) stays the route for a full campaign.

import type { AssetRef, DeliveryPx, JobInput, JobInputRef, NamedRef, ProductionDocument, SizeMethod } from '../contracts/types'
import type { CanvasAdapter, CanvasElement } from '../canvas/core/canvasAdapter'
import { boardFrame, fitInto, withFields } from '../canvas/boards/fitting'
import { alive, bounds, cd, makeArrow, makeGenPlaceholder } from '../canvas/scene'
import { newId } from '../lib/ulid'
import type { JobRunner } from '../jobs/runner'
import { autoMethod, availableMethods, methodWords, PAID, type MethodModel } from './rules'

type El = CanvasElement
type Models = Partial<Record<SizeMethod, MethodModel>>

// ── shapes ──

export interface Shape {
  /** "9:16", or "1200×628" for a custom size in pixels. */
  id: string
  /** The chip's word ("Story"), absent for a custom one. */
  name?: string
  w: number
  h: number
  /** An exact size in pixels (custom W×H), else a ratio. */
  px?: boolean
}

export const SHAPES: readonly Shape[] = [
  { id: '9:16', name: 'Story', w: 9, h: 16 },
  { id: '4:5', name: 'Feed', w: 4, h: 5 },
  { id: '1:1', name: 'Square', w: 1, h: 1 },
  { id: '16:9', name: 'Wide', w: 16, h: 9 },
  { id: '2:3', name: 'Poster', w: 2, h: 3 },
  { id: '3:2', w: 3, h: 2 },
  { id: '21:9', name: 'Cinema', w: 21, h: 9 },
]

/** The longest side a ratio's result is made at (the relay's preview; Make all sizes exports bigger). */
export const LONG_SIDE = 2048
/** The most extreme shape Resize… takes (Gemini reaches 8:1; Ideogram extends past it). */
export const MAX_RATIO = 8

/** A custom shape from words: "1200x628", "1200 × 628" (pixels) or "4:1" (a ratio). Null when it is not one. */
export function parseCustom(text: string): Shape | null {
  const t = text.trim().toLowerCase()
  const px = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/.exec(t)
  const ratio = /^(\d{1,3}(?:\.\d+)?)\s*:\s*(\d{1,3}(?:\.\d+)?)$/.exec(t)
  const m = px ?? ratio
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0 && h > 0) || Math.max(w / h, h / w) > MAX_RATIO) return null
  if (px) {
    if (Math.min(w, h) < 64 || Math.max(w, h) > 8192) return null
    return { id: `${w}×${h}`, w, h, px: true }
  }
  return { id: `${m[1]}:${m[2]}`, w, h }
}

/** The size a shape is delivered at: a custom size as it is; a ratio at LONG_SIDE on its longest side. */
export function deliveryOf(s: Shape): DeliveryPx {
  if (s.px) return { width: s.w, height: s.h }
  const k = LONG_SIDE / Math.max(s.w, s.h)
  return { width: Math.max(1, Math.round(s.w * k)), height: Math.max(1, Math.round(s.h * k)) }
}

// ── what is selected ──

export type SourceKind = 'picture' | 'drawing' | 'sketch'

/** A thing in the selection that can be resized: a picture or result, a Drawing frame, a sketch area. */
export function resizableKind(e: El): SourceKind | null {
  const c = cd(e)
  if (e.isDeleted || !c) return null
  if (c.kind === 'pic') return 'picture'
  if (c.kind === 'gen') return c.asset && c.state === 'completed' ? 'picture' : null
  if (c.kind === 'drawn') return 'drawing'
  if (c.kind === 'sketch') return 'sketch'
  return null
}

/** The selection as Resize… reads it: the things it resizes, and how many things are selected in all
 *  (a group of strokes counts once; arrows the tool drew never count). */
export function resizableIn(selected: readonly El[]): { items: El[]; total: number } {
  const units = selected.filter((e) => !e.isDeleted && cd(e)?.kind !== 'provenance' && cd(e)?.kind !== 'format_set')
  const items = units.filter((e) => resizableKind(e))
  // A Drawing frame's strokes and a group's members are one thing.
  const inside = new Set(items.map((e) => e.id))
  const groups = new Set<string>()
  let total = 0
  for (const e of units) {
    if (e.frameId && inside.has(e.frameId)) continue
    const g = !resizableKind(e) ? e.groupIds?.at(-1) : undefined
    if (g) {
      if (groups.has(g)) continue
      groups.add(g)
    }
    total++
  }
  return { items, total }
}

/** "3 of 5 selected are pictures", when not everything selected is one. */
export function mixedLine(pictures: number, total: number): string | undefined {
  if (total <= pictures) return undefined
  return `${pictures} of ${total} selected ${pictures === 1 ? 'is a picture' : 'are pictures'}`
}

/** One thing to resize, ready: its picture (a scamp's exported), its pixels, its name when it has one. */
export interface Source {
  elId: string
  /** The node id its provenance arrows name (a sketch area's sketch id). */
  nodeId: string
  asset: string
  w: number
  h: number
  kind: SourceKind
  /** A named picture (a ref with a key): Redraw also sends the key's other views. */
  named?: NamedRef
}

// ── how ──

export type How = 'regenerate' | 'extend' | 'crop' | 'auto'
export const HOWS: readonly How[] = ['regenerate', 'extend', 'crop', 'auto']
export const HOW_WORD: Record<How, string> = { regenerate: 'Redraw', extend: 'Extend', crop: 'Crop', auto: 'Auto' }
/** One plain line under each, in the panel. */
export const HOW_LINE: Record<How, string> = {
  regenerate: 'Draws each picture again at the new shape: the same people, things and light, recomposed to fit.',
  extend: 'Keeps the picture exactly and paints what is missing round its edges.',
  crop: 'Cuts the middle of each picture to the shape. Free, and in seconds.',
  auto: 'Crops when little is lost, extends when the shape is close, redraws when the picture would sit small.',
}
/** Said when a scamp is in the selection and the method draws (owner 2026-10-16). */
export const SKETCH_LINE = 'Redraw turns the sketch into a picture at each shape.'

/** The method for one picture at one shape, or null when the agency cannot run it. */
export function methodOf(how: How, src: Pick<Source, 'w' | 'h'>, shape: Shape, models: Models): SizeMethod | null {
  const m: SizeMethod = how === 'auto' ? autoMethod({ w: src.w, h: src.h }, { w: shape.w, h: shape.h }, availableMethods(models)) : how
  return PAID.has(m) && !models[m] ? null : m
}

/** Why a way cannot run for this agency, or undefined when it can. */
export function howOff(how: How, models: Models): string | undefined {
  if (how === 'regenerate' && !models.regenerate) return 'Redraw is off for your agency.'
  if (how === 'extend' && !models.extend) return 'Extend is off for your agency (Ideogram).'
  return undefined
}

export interface Planned { source: Source; shape: Shape; method: SizeMethod }

/** Every picture × shape, in order: picture by picture, shape by shape. */
export function planResize(sources: readonly Source[], shapes: readonly Shape[], how: How, models: Models): Planned[] {
  const out: Planned[] = []
  for (const source of sources) for (const shape of shapes) {
    const method = methodOf(how, source, shape, models)
    if (method) out.push({ source, shape, method })
  }
  return out
}

/** The footer's words: exactly what is made. */
export function makeWords(n: number): string {
  return `Make ${n} ${n === 1 ? 'picture' : 'pictures'}`
}

/** A method in the panel's words: "Redraw · Gemini 3 Pro", "Extend · Ideogram 4.5", "Crop · free". No price. */
export function methodLine(m: SizeMethod, models: Models): string {
  if (m === 'regenerate') return models.regenerate ? `Redraw · ${models.regenerate.label}` : 'Redraw'
  return methodWords(m, models)
}

/** The send tray's rows: each picture × shape with its method and model, never a price. */
export function trayRows(planned: readonly Planned[], models: Models, label: (s: Source, i: number) => string): { id: string; name: string; words: string }[] {
  const order = [...new Set(planned.map((p) => p.source))]
  return planned.map((p) => ({
    id: `${p.source.elId}:${p.shape.id}`,
    name: `${label(p.source, order.indexOf(p.source))} · ${p.shape.id}`,
    words: methodLine(p.method, models),
  }))
}

// ── the preview ──

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Where a shape sits over a picture of w × h, in its pixels: a crop inside it (the middle), an extend or
 * a redraw round it (the picture in the middle of the bigger shape).
 */
export function frameOver(src: { w: number; h: number }, shape: Shape, method: SizeMethod): Box {
  const r = shape.w / shape.h
  if (method === 'crop') {
    const w = Math.min(src.w, src.h * r)
    const h = w / r
    return { x: (src.w - w) / 2, y: (src.h - h) / 2, w, h }
  }
  const w = Math.max(src.w, src.h * r)
  const h = w / r
  return { x: (src.w - w) / 2, y: (src.h - h) / 2, w, h }
}

/** The picture and every frame over it, scaled into a box at most `max` wide and high. */
export function previewLayout(src: { w: number; h: number }, frames: readonly { id: string; box: Box }[], max = { w: 132, h: 104 }) {
  const all = [{ x: 0, y: 0, w: src.w, h: src.h }, ...frames.map((f) => f.box)]
  const x0 = Math.min(...all.map((b) => b.x))
  const y0 = Math.min(...all.map((b) => b.y))
  const x1 = Math.max(...all.map((b) => b.x + b.w))
  const y1 = Math.max(...all.map((b) => b.y + b.h))
  const k = Math.min(max.w / (x1 - x0), max.h / (y1 - y0))
  const at = (b: Box): Box => ({ x: (b.x - x0) * k, y: (b.y - y0) * k, w: b.w * k, h: b.h * k })
  return { w: (x1 - x0) * k, h: (y1 - y0) * k, picture: at({ x: 0, y: 0, w: src.w, h: src.h }), frames: frames.map((f) => ({ id: f.id, box: at(f.box) })) }
}

// ── the last pick, in this browser ──

const MEMORY = 'napkin.resize.last'
export interface ResizePick { shapes: Shape[]; how: How }
export const DEFAULT_PICK: ResizePick = { shapes: [], how: 'regenerate' }

export function loadPick(store: Pick<Storage, 'getItem'> | undefined = safeStorage()): ResizePick {
  try {
    const raw = store?.getItem(MEMORY)
    if (!raw) return DEFAULT_PICK
    const p = JSON.parse(raw) as Partial<ResizePick>
    const shapes = (Array.isArray(p.shapes) ? p.shapes : []).filter((s): s is Shape => !!s && typeof s.id === 'string' && s.w > 0 && s.h > 0).slice(0, 12)
    const how = HOWS.includes(p.how as How) ? (p.how as How) : DEFAULT_PICK.how
    return { shapes, how }
  } catch {
    return DEFAULT_PICK
  }
}

export function savePick(p: ResizePick, store: Pick<Storage, 'setItem'> | undefined = safeStorage()) {
  try {
    store?.setItem(MEMORY, JSON.stringify({ shapes: p.shapes, how: p.how }))
  } catch {
    // Private windows and blocked storage: the panel simply starts empty next time.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

// ── placing the results ──

export const ROW_GAP = 40
export const AWAY = 80

/** A result's node size: its shape, its longest side the original's longest side. */
export function resultSize(src: Pick<El, 'width' | 'height'>, shape: Shape): { w: number; h: number } {
  const long = Math.max(Math.abs(src.width), Math.abs(src.height), 120)
  const r = shape.w / shape.h
  return r >= 1 ? { w: Math.round(long), h: Math.round(long / r) } : { w: Math.round(long * r), h: Math.round(long) }
}

const overlaps = (a: Box, b: Box, gap = 16) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y

/**
 * Where each original's results go: in a row to its right, or in a column under it, the same way for
 * every original when that is clear for all of them (pictures side by side get columns, a stack of them
 * rows); else each on its own: right, under, or the next free place to the right of everything in its
 * row. Clear of everything on the canvas (boards aside: a result on its original's board is fitted
 * there) and of the results placed before it.
 */
export function planSlots(els: readonly El[], groups: readonly { el: El; sizes: readonly { w: number; h: number }[] }[]): { x: number; y: number }[][] {
  const live = alive(els).filter((e) => e.type !== 'arrow' && cd(e)?.kind !== 'provenance' && cd(e)?.kind !== 'board')
  const base: Box[] = live.map((e) => ({ x: Math.min(e.x, e.x + e.width), y: Math.min(e.y, e.y + e.height), w: Math.abs(e.width), h: Math.abs(e.height) }))
  const lay = (g: (typeof groups)[number], mode: 'right' | 'below') => {
    const b = bounds([g.el])
    let x = mode === 'right' ? b.maxX + AWAY : b.minX
    let y = mode === 'right' ? b.minY : b.maxY + AWAY
    return g.sizes.map((z) => {
      const p = { x, y, w: z.w, h: z.h }
      if (mode === 'right') x += z.w + ROW_GAP
      else y += z.h + ROW_GAP
      return p
    })
  }
  const tryAll = (mode: 'right' | 'below') => {
    const taken = [...base]
    const out: Box[][] = []
    for (const g of groups) {
      const boxes = lay(g, mode)
      if (boxes.some((bx) => taken.some((t) => overlaps(bx, t)))) return null
      taken.push(...boxes)
      out.push(boxes)
    }
    return out
  }
  const strip = (all: Box[][]) => all.map((bs) => bs.map(({ x, y }) => ({ x, y })))
  const same = tryAll('right') ?? tryAll('below')
  if (same) return strip(same)
  const taken = [...base]
  const out: Box[][] = []
  for (const g of groups) {
    const clear = (bs: Box[]) => !bs.some((bx) => taken.some((t) => overlaps(bx, t)))
    let boxes = lay(g, 'right')
    if (!clear(boxes)) {
      const under = lay(g, 'below')
      if (clear(under)) boxes = under
      else {
        for (let i = 0; i < 400 && !clear(boxes); i++) {
          const hit = taken.filter((t) => boxes.some((bx) => overlaps(bx, t)))
          const dx = Math.max(...hit.map((t) => t.x + t.w)) + AWAY - boxes[0].x
          boxes = boxes.map((bx) => ({ ...bx, x: bx.x + dx }))
        }
      }
    }
    taken.push(...boxes)
    out.push(boxes)
  }
  return strip(out)
}

/**
 * Put every result's placeholder, with its arrow from its original, on the canvas as one step of the
 * person's (one undo takes them all away; their jobs are stopped with them, as for Generate). A result
 * whose original sits on a board goes on that board (fitInto: beside it when clear). Returns the job id
 * of each planned result, in order.
 */
export function placeResults(canvas: CanvasAdapter, planned: readonly Planned[]): string[] {
  let els = canvas.elements({ includeDeleted: true })
  const byEl = new Map(els.map((e) => [e.id, e]))
  const order = [...new Set(planned.map((p) => p.source))]
  const groups = order.map((s) => {
    const el = byEl.get(s.elId)!
    return { el, sizes: planned.filter((p) => p.source === s).map((p) => resultSize(el, p.shape)) }
  })
  const slots = planSlots(els, groups)
  const ids: string[] = []
  const gens: { gen: El; src: El; srcId: string; prefer: { x: number; y: number } }[] = []
  order.forEach((s, gi) => {
    const mine = planned.filter((p) => p.source === s)
    mine.forEach((p, i) => {
      const jobId = newId('job')
      ids[planned.indexOf(p)] = jobId
      const size = groups[gi].sizes[i]
      const gen = makeGenPlaceholder(canvas, jobId, 'resize', [s.nodeId], slots[gi][i], size, undefined, p.shape.id)
      gens.push({ gen, src: groups[gi].el, srcId: s.nodeId, prefer: slots[gi][i] })
    })
  })
  els = [...els, ...gens.map((g) => g.gen)]
  // On a board: fitted there, each beside its original when that is clear.
  const frames = new Map<string, number[]>()
  gens.forEach((g, i) => {
    if (g.src.frameId && boardFrame(els, g.src.frameId)) frames.set(g.src.frameId, [...(frames.get(g.src.frameId) ?? []), i])
  })
  for (const [frameId, idx] of frames) {
    const fit = fitInto(els, frameId, idx.map((i) => [gens[i].gen.id]), (k) => gens[idx[k]].prefer)
    els = withFields(canvas, els, fit.fields)
  }
  const placed = new Map(els.map((e) => [e.id, e]))
  gens.forEach((g, i) => {
    const gen = placed.get(g.gen.id)!
    const arrow = makeArrow(canvas, g.src, gen, g.srcId, gen.id, i % 3)
    els = canvas.bindArrow([...els, arrow], arrow)
  })
  canvas.transact(() => els, { undoable: true })
  return ids
}

// ── the jobs ──

/** The resize job for one picture × shape (relay-api resize): the picture, the shape, the method. A
 *  Redraw of a named picture also carries the key's other views (`refs`); a scamp is redrawn as a sketch. */
export function resizeInput(p: Planned, image: AssetRef, refs: readonly JobInputRef[] = []): JobInput {
  const delivery = deliveryOf(p.shape)
  return {
    image,
    aspect: p.shape.px ? { w: p.shape.w, h: p.shape.h } : { w: delivery.width, h: delivery.height },
    delivery,
    resize: {
      method: p.method,
      masterSize: { w: p.source.w, h: p.source.h },
      previewMaxPx: LONG_SIDE,
      ...(p.method === 'regenerate' && p.source.kind !== 'picture' ? { source: 'sketch' as const } : {}),
    },
    ...(p.method === 'regenerate' && refs.length ? { refs: [...refs] } : {}),
  }
}

/** The key's other views of a named picture (at most 4, the relay's REGENERATE_REFS_MAX), for a Redraw. */
export function otherViews(doc: Pick<ProductionDocument, 'refs'>, named: NamedRef | undefined): NamedRef[] {
  if (!named) return []
  return Object.values(doc.refs).filter((r) => r.key === named.key && r.id !== named.id && !!r.asset && r.asset !== named.asset).slice(0, 4)
}

export interface ResizeDeps {
  canvas: CanvasAdapter
  runner: Pick<JobRunner, 'submit'>
  /** A picture's assetRef for the relay (jobs/assets.assetRef). */
  ref(sha: string): Promise<AssetRef>
  /** A named ref as a job input (jobs/select.namedInput). */
  named(r: NamedRef): Promise<JobInputRef>
  doc(): Pick<ProductionDocument, 'refs'>
}

/**
 * Resize: the placeholders first (one undo step), then one job per picture × shape. Each job is sent on
 * its own, so one refused (the spend stop, a model's refusal) fails on its own card and the others carry
 * on. Returns the job ids.
 */
export async function resizePictures(deps: ResizeDeps, planned: readonly Planned[]): Promise<string[]> {
  if (!planned.length) throw new Error('Pick a shape first.')
  const ids = placeResults(deps.canvas, planned)
  const images = new Map<string, Promise<AssetRef>>()
  const views = new Map<string, Promise<JobInputRef[]>>()
  await Promise.allSettled(planned.map(async (p, i) => {
    const s = p.source
    if (!images.has(s.asset)) images.set(s.asset, deps.ref(s.asset))
    let refs: JobInputRef[] = []
    if (p.method === 'regenerate' && s.named) {
      if (!views.has(s.elId)) views.set(s.elId, Promise.all(otherViews(deps.doc(), s.named).map((r) => deps.named(r))))
      refs = await views.get(s.elId)!
    }
    const input = resizeInput(p, await images.get(s.asset)!, refs)
    await deps.runner.submit('resize', input, [], { for: 'canvas' }, ids[i])
  }))
  return ids
}
