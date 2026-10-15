// The canvas's logic over the CanvasAdapter (features/canvas-core.clan). The canvas is free: draw, write or
// drop pictures anywhere. Every picture, drawing, note and result is a node;
// select any of them and Generate puts a new node beside them (or where you
// click), with a curved arrow from each input. Any image can be named
// key_variant (maya_front), set as a key's front, and turned into the other
// views. The React component only renders overlays and calls in.

import type { CanvasAdapter, CanvasAsset } from './core/canvasAdapter'
import {
  AGENCY_SHELF, type Ask, type Aspect, type CustomData, type Job, type JobInput, type JobInputRef, type Key, type LibraryEntry, type Mime, type NamedRef,
  type ProductionDocument, type Ratio, type RefRole, type Variant, type View, type ModelChoice,
} from '../contracts/types'
import type { Services } from '../app/context'
import { getBlob, idbLocation, putBlob, putBlobAs } from '../lib/blobs'
import { idbPut } from '../lib/idb'
import { mentions, nameOf, nameProblem, refByName } from '../lib/names'
import { newId } from '../lib/ulid'
import { systemUpdate } from '../doc/store'
import { markStale } from '../doc/remove'
import { assetRef } from '../jobs/assets'
import { namedInput } from '../jobs/select'
import { landingWhy } from '../jobs/landing'
import { boardFrame, fitInto, holdFields, tellFull, withFields } from './boards/fitting'
import { applySketchFrame } from '../jobs/handlers'
import { LOCAL_PERSON } from '../jobs/runner'
import { purposeOf } from '../model/purpose'
import { keyNamed, mainStoryboard, refsList } from '../model/selectors'
import { cropLoss } from '../lib/runwaySizes'
import { BIG_CROP, BIG_CROP_LINE, aspectLabel, boxOf, exactRatio, exportPlan, intersects, lockAspect, membersOf, ratioFor, type Boxed, type Rect } from './core/sketch'
import { SKETCH_ASK, sketchAsk } from '../ui/asks'
import {
  alive, assetData, bounds, byOwnId, cd, childrenOf, dataURLToBlob, downscale, exportElements, idOf,
  imageOf, isText, makeArrow, makeGenPlaceholder, nextSlot, textOf, type El,
} from './scene'
import { instruction, planSelection, type CanvasPlan } from './selection'
import { CanvasDocSync } from './sync'
import { frameText } from './text'

/** The scene as this browser keeps it (engine-owned shape; core/canvasAdapter.ts). */
export type { CanvasSnapshot } from './core/canvasAdapter'

export const OTHER_VIEWS: View[] = ['three-quarter', 'side', 'back']
const NODE = { w: 300, h: 400 }

/** What a Generate on this selection would send, for the popover to show before it goes. */
export interface GeneratePreview {
  inputs: { nodeId: string; name?: string; kind: 'pic' | 'drawn' | 'gen' }[]
  drawings: number
  notes: string[]
  pending: number
  /** The sketch area it exports (a person's frame counts: it becomes one), with its size label. */
  sketch?: { label: string; aspect: Aspect; frame: boolean }
  /** More than one area: one Generate takes one. */
  areas: number
  /** The crop warning when the relay's crop would take most of the picture (frame-aspect, open question 7). */
  cropLine?: string
}

/** What a Generate did: sent a job, or (a sketch with no words and nothing linked) asked first. */
export type GenerateResult = { jobId: string } | { ask: Ask }

const ONE_AREA = 'Pick one sketch area for one Generate.'

export class CanvasController {
  private readonly canvas: CanvasAdapter
  private readonly s: Services
  private readonly processing = new Set<string>()
  /** Pictures (by sha256) restoreFiles has looked for once already. */
  private readonly restoreTried = new Set<string>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  /** Deletes and their undo (ours or Excalidraw's Ctrl+Z) kept in step with the document. */
  readonly sync: CanvasDocSync
  /** Each Drawing's members as last seen (ids, and boxes from the frame's corner), so a change re-exports its picture. */
  private readonly drawnSeen = new Map<string, string>()

  constructor(canvas: CanvasAdapter, services: Services) {
    this.canvas = canvas
    this.s = services
    this.sync = new CanvasDocSync({ doc: services.doc, cancel: (jobId) => void services.runner.cancel(jobId), drawnBy: () => this.person() })
    this.sync.gens(this.els())
    this.sync.sketches(this.els())
    void this.sync.nodes(this.els())
    void this.refreshDrawings()
  }

  private els(): El[] {
    return this.canvas.elements({ includeDeleted: true })
  }

  /** The scene's elements that are not deleted. */
  liveElements(): El[] {
    return this.canvas.elements()
  }

  private setEls(els: El[], undoable = true) {
    this.canvas.transact(() => els, { undoable })
  }

  private patchEl(id: string, fn: (e: El) => El, undoable = false) {
    this.setEls(this.els().map((e) => (e.id === id ? fn(e) : e)), undoable)
  }

  private doc(): ProductionDocument {
    return this.s.doc.get()
  }

  /** The element of a node (pic, drawn, note or gen) by its node id. */
  nodeEl(nodeId: string): El | undefined {
    return byOwnId(this.els(), nodeId)
  }

  // ── persistence ──

  /**
   * Put back the pictures of image elements whose file the scene lacks: a canvas that came from the
   * server (features/personal-workspaces.clan) carries its elements only. Each picture is found by
   * the node's asset, else by the document's assets the engine recognises it as, among this browser's blobs.
   */
  async restoreFiles(): Promise<number> {
    const known = Object.keys(this.doc().assets)
    const lacking = new Set<string>()
    for (const e of alive(this.els())) {
      const img = this.canvas.imageOf(e, known)
      if (img?.sha256 && !img.loaded && !this.restoreTried.has(img.sha256)) lacking.add(img.sha256)
    }
    if (!lacking.size) return 0
    for (const sha of lacking) this.restoreTried.add(sha)
    const add: CanvasAsset[] = []
    for (const sha of lacking) {
      const blob = await getBlob(sha)
      if (blob) add.push(await assetData(sha, blob))
    }
    if (add.length) this.canvas.addAssets(add)
    return add.length
  }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), 600)
  }

  async save() {
    await idbPut('kv', this.s.project.canvasKey, this.canvas.serialize())
  }

  /** Called on every scene change (throttled by the component). */
  onChange() {
    this.scheduleSave()
    void this.intakePictures()
    void this.restoreFiles().catch(() => {})
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => this.syncNow(), 250)
  }

  private syncNow() {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = null
    void this.sync.gens(this.els())
    void this.sync.sketches(this.els())
    void this.sync.nodes(this.els())
    void this.refreshDrawings().catch((e) => console.warn('Could not update a drawing’s picture', e))
  }

  // ── delete and undo ──

  /** What deleting these elements takes with it: a drawing's strokes, and the arrows and links to and from them. */
  private deletionOf(ids: string[]): string[] {
    const els = alive(this.els())
    const out = new Set(ids)
    for (const e of els) {
      if (e.frameId && out.has(e.frameId)) out.add(e.id)
    }
    const owned = new Set(els.filter((e) => out.has(e.id)).map((e) => idOf(e)).filter((x): x is string => !!x))
    for (const e of els) {
      const c = cd(e)
      if (c?.kind === 'provenance' && (owned.has(c.from) || owned.has(c.to))) out.add(e.id)
      // A link or arrow bound to something that goes, goes with it (canvas-edit-tools).
      const b = e as El & { startBinding?: { elementId?: string } | null; endBinding?: { elementId?: string } | null }
      if ((b.startBinding?.elementId && out.has(b.startBinding.elementId)) || (b.endBinding?.elementId && out.has(b.endBinding.elementId))) out.add(e.id)
    }
    return [...out]
  }

  /** Delete elements (undoable with Ctrl+Z too). Returns what went, for Undo, and where it was. */
  deleteElements(ids: string[]): { ids: string[]; at: { x: number; y: number }; label: string } | null {
    const gone = this.deletionOf(ids)
    if (!gone.length) return null
    const els = this.els()
    // What the person picked: not the strokes, arrows and links that went along with it.
    const shown = alive(els).filter((e) => gone.includes(e.id) && (ids.includes(e.id) || cd(e)?.kind !== 'link') && cd(e)?.kind !== 'provenance' && !(e.frameId && gone.includes(e.frameId)))
    const node = shown.length === 1 ? cd(shown[0])?.kind : undefined
    const NODE_WORD: Record<string, string> = { script: 'Script deleted', storyboard: 'Storyboard deleted', video: 'Video deleted', gen: 'Image deleted', link: 'Link deleted' }
    // A link is drawn between its ends, wherever its own box says: the chip goes between them.
    const byId = new Map(alive(els).map((e) => [e.id, e]))
    const placed = shown.flatMap((e) => {
      const ends = e as El & { startBinding?: { elementId?: string } | null; endBinding?: { elementId?: string } | null }
      const a = cd(e)?.kind === 'link' ? byId.get(ends.startBinding?.elementId ?? '') : undefined
      const z = cd(e)?.kind === 'link' ? byId.get(ends.endBinding?.elementId ?? '') : undefined
      return a && z ? [a, z] : [e]
    })
    const b = bounds(placed.length ? placed : alive(els).filter((e) => gone.includes(e.id)))
    const label = shown.length === 1 ? NODE_WORD[node ?? ''] ?? 'Deleted' : `${shown.length} deleted`
    this.setEls(els.map((e) => (gone.includes(e.id) ? this.canvas.patch(e, { isDeleted: true }) : e)))
    this.canvas.select([])
    this.syncNow()
    return { ids: gone, at: { x: b.minX + b.w / 2, y: b.minY + b.h / 2 }, label }
  }

  /** Undo a delete from the inline Undo (Ctrl+Z does the same through Excalidraw). */
  undelete(ids: string[]) {
    this.setEls(this.els().map((e) => (ids.includes(e.id) && e.isDeleted ? this.canvas.patch(e, { isDeleted: false }) : e)))
    this.syncNow()
  }

  /** The selected elements that the Delete key and 🗑 act on: everything but the tool's arrows. */
  deletable(selected: El[]): El[] {
    return selected.filter((e) => cd(e)?.kind !== 'provenance')
  }

  // ── pictures: downscale ≤1536 px, hash, keep as a node ──

  private addAsset(sha: string, blob: Blob, origin: 'uploaded' | 'drawn', size?: { w: number; h: number }) {
    systemUpdate(this.s.doc, (d) => {
      if (!d.assets[sha]) {
        d.assets[sha] = { sha256: sha, kind: 'image', mime: (blob.type || 'image/png') as Mime, bytes: blob.size, ...(size ?? {}), origin, locations: [idbLocation(sha)] }
      }
    }, 'add picture')
  }

  private async intakePictures() {
    const fresh = alive(this.els()).filter((e) => e.type === 'image' && !cd(e) && !this.processing.has(e.id) && this.canvas.imageDataURL(e))
    for (const el of fresh) {
      this.processing.add(el.id)
      try {
        const original = await dataURLToBlob(this.canvas.imageDataURL(el)!)
        const { blob, w, h } = await downscale(original)
        const sha = await putBlob(blob)
        this.canvas.addAssets([await assetData(sha, blob)])
        const customData: CustomData = { kind: 'pic', id: newId('node'), asset: sha }
        this.patchEl(el.id, (e) => this.canvas.patch(this.canvas.withAsset(e, sha), { customData }), true)
        this.addAsset(sha, blob, 'uploaded', { w, h })
      } catch (e) {
        console.warn('Could not take in a picture', e)
      }
    }
  }

  // ── drawings and notes become nodes when they are used ──

  /** Wrap strokes in a drawn frame (a node with the strokes exported as its picture). */
  private async wrapDrawing(ids: string[]): Promise<El | null> {
    const els = this.els()
    const strokes = els.filter((e) => ids.includes(e.id) && !e.isDeleted)
    if (!strokes.length) return null
    const b = bounds(strokes)
    const pad = 16
    const blob = (await downscale(await exportElements(this.canvas, strokes))).blob
    const sha = await putBlob(blob)
    const frame = this.canvas.frameAround(
      { x: b.minX - pad, y: b.minY - pad, width: b.w + pad * 2, height: b.h + pad * 2, name: 'Drawing', customData: { kind: 'drawn', id: newId('node'), asset: sha } },
    )
    const next = els.map((e) => (ids.includes(e.id) ? this.canvas.patch(e, { frameId: frame.id }) : e))
    this.setEls([frame, ...next]) // frames sit below their children
    this.addAsset(sha, blob, 'drawn')
    return frame
  }

  /** Re-export drawn frames whose strokes changed, so their picture is current. */
  private async refreshDrawn(frameIds: string[]) {
    const els = this.els()
    for (const f of alive(els).filter((e) => frameIds.includes(e.id) && cd(e)?.kind === 'drawn')) {
      const c = cd(f) as Extract<CustomData, { kind: 'drawn' }>
      const kids = childrenOf(els, f.id).filter((k) => k.type !== 'text')
      if (!kids.length) continue
      const blob = (await downscale(await exportElements(this.canvas, kids))).blob
      const sha = await putBlob(blob)
      if (sha === c.asset) continue
      this.patchEl(f.id, (e) => this.canvas.patch(e, { customData: { ...c, asset: sha } }))
      this.addAsset(sha, blob, 'drawn')
      // A name on the drawing follows its new picture.
      systemUpdate(this.s.doc, (d) => {
        for (const r of Object.values(d.refs)) if (r.node === c.id) r.asset = sha
      }, 'name')
    }
  }

  /**
   * Re-export the Drawings whose strokes changed since they were last seen: a stroke joined,
   * left, moved, was scaled or erased (features/container-select.clan). Moving a whole Drawing
   * changes nothing here. The first sight of a Drawing only records it.
   */
  async refreshDrawings() {
    const els = alive(this.els())
    const changed: string[] = []
    for (const f of els.filter((e) => cd(e)?.kind === 'drawn')) {
      const kids = childrenOf(els, f.id).filter((k) => k.type !== 'text')
      const seen = kids.map((k) => `${k.id}:${k.x - f.x},${k.y - f.y},${k.width},${k.height}`).sort().join(' ')
      const was = this.drawnSeen.get(f.id)
      this.drawnSeen.set(f.id, seen)
      if (was !== undefined && was !== seen) changed.push(f.id)
    }
    if (changed.length) await this.refreshDrawn(changed)
  }

  /** Give a text element a node id, so arrows can name it. */
  private noteId(elId: string): string {
    const el = this.els().find((e) => e.id === elId)
    const c = cd(el)
    if (c?.kind === 'note') return c.id
    const id = newId('node')
    this.patchEl(elId, (e) => this.canvas.patch(e, { customData: { kind: 'note', id } }))
    return id
  }

  // ── Generate from any selection ──

  /** What a Generate on these elements would use (for the popover). */
  preview(elIds: string[], model?: string): GeneratePreview {
    const doc = this.doc()
    const els = this.els()
    const frames = this.userFramesIn(elIds)
    const plan = planSelection(els, elIds.filter((id) => !frames.some((f) => f.id === id)))
    const areas = plan.sketches.map((s) => ({ aspect: doc.sketches[s.sketchId]?.aspect ?? this.aspectOfEl(els.find((e) => e.id === s.elId)!), frame: false }))
      .concat(frames.map((f) => ({ aspect: this.aspectOfEl(f), frame: true })))
    const area = areas.length === 1 ? areas[0] : undefined
    const loss = area ? cropLoss(area.aspect, model) : 0
    return {
      inputs: plan.images.map((i) => {
        const r = this.nameOn(i.nodeId, doc)
        return { nodeId: i.nodeId, kind: i.kind, ...(r ? { name: nameOf(r) } : {}) }
      }),
      drawings: plan.strokes.length && !area ? 1 : 0,
      notes: plan.notes.map((n) => n.text),
      pending: plan.pending.length,
      areas: areas.length,
      ...(area ? { sketch: { label: aspectLabel(area.aspect), aspect: area.aspect, frame: area.frame } } : {}),
      ...(loss > BIG_CROP ? { cropLine: BIG_CROP_LINE } : {}),
    }
  }

  /** Where a new node goes by default: to the right of the selection, clear of what is there. */
  slotBeside(elIds: string[]): { x: number; y: number; w: number; h: number } {
    const els = this.els()
    const sel = alive(els).filter((e) => elIds.includes(e.id) && cd(e)?.kind !== 'provenance')
    const b = sel.length ? bounds(sel) : { maxX: 0, minY: 0 }
    return nextSlot(els, b, NODE)
  }

  /**
   * One new image from the selected nodes and the typed words. `at` is the spot the participant
   * clicked (top-left of the new node); without it the node goes beside the selection.
   */
  /** `modelChoice`: the model picked on the Generate popover (absent: the routed default). `layoutOnly`: the
   *  answer to Wren's ask on a sketch with no words ("Use it as a layout only"). */
  async generate(elIds: string[], typed: string, opts: { at?: { x: number; y: number }; more?: boolean; limits?: { max: number; characters: number }; modelChoice?: ModelChoice; layoutOnly?: boolean } = {}): Promise<GenerateResult> {
    let plan = planSelection(this.els(), elIds)
    if (plan.pending.length) throw new Error('One of these is still being made. Wait for it, or leave it out.')
    // A person's own frame used in Generate becomes a sketch area (one undo step), its strokes where they are.
    const frames = this.userFramesIn(elIds)
    if (frames.length + plan.sketches.length > 1) throw new Error(ONE_AREA)
    if (frames.length) {
      const area = await this.frameToArea(frames[0])
      elIds = [...elIds.filter((id) => id !== frames[0].id), area.id]
      plan = planSelection(this.els(), elIds)
    }
    if (plan.sketches.length) return await this.generateSketch(plan, typed, opts)
    const doc = this.doc()
    // Loose strokes become one drawing node first.
    if (plan.strokes.length) {
      const frame = await this.wrapDrawing(plan.strokes)
      if (frame) {
        const kept = elIds.filter((id) => !plan.strokes.includes(id))
        // The Drawing is selected, not its strokes, so the next drag moves it whole.
        this.canvas.select([...kept, frame.id])
        plan = planSelection(this.els(), [...kept, frame.id])
      }
    }
    await this.refreshDrawn(plan.images.filter((i) => i.kind === 'drawn').map((i) => i.elId))
    plan = planSelection(this.els(), plan.images.map((i) => i.elId).concat(plan.notes.map((n) => n.elId)))
    const els = this.els()
    // Words written inside a drawing go with the instruction ("When happy" beside a pose).
    const written = plan.images.filter((i) => i.kind === 'drawn').map((i) => frameText(els, els.find((e) => e.id === i.elId)!)).filter(Boolean)
    const text = instruction(typed, [...plan.notes, ...written.map((w) => ({ text: w }))])
    if (!plan.images.length && !text) throw new Error('Select a drawing, a picture or some words first.')

    const limits = opts.limits ?? { max: 14, characters: 14 }
    if (plan.images.length > limits.max) {
      throw new Error(`Pick at most ${limits.max} pictures and drawings for one Generate.`)
    }
    const refs: JobInputRef[] = []
    for (const i of plan.images) {
      const named = this.nameOn(i.nodeId)
      if (named) {
        refs.push(await namedInput(this.s.relay, this.doc(), named))
        continue
      }
      const role: RefRole = i.kind === 'pic' ? 'other' : 'character'
      refs.push({ id: i.nodeId, role, kind: i.kind === 'drawn' ? 'drawing' : i.kind === 'gen' ? 'generated' : 'picture', asset: await assetRef(this.s.relay, i.asset) })
    }
    const characters = refs.filter((r) => r.role === 'character').length
    if (characters > limits.characters) {
      throw new Error(`This provider takes at most ${limits.characters} character pictures at once. Leave some out.`)
    }
    // A name typed in the words must be one of the inputs, so the relay can find it; a bare
    // @key brings the whole character (its front and up to 3 more), or says to set a front.
    const said = mentions(doc, text)
    if (said.unknown.length) throw new Error(`@${said.unknown[0]} is not a name in this project. Name an image first, or check the spelling.`)
    for (const r of said.found) {
      if (!refs.some((x) => x.id === r.id)) refs.push(await namedInput(this.s.relay, this.doc(), r))
    }

    const noteIds = plan.notes.map((n) => n.nodeId ?? this.noteId(n.elId))
    const sources: { el: El; id: string }[] = [
      ...plan.images.map((i) => ({ el: this.els().find((e) => e.id === i.elId)!, id: i.nodeId })),
      ...plan.notes.map((n, k) => ({ el: this.els().find((e) => e.id === n.elId)!, id: noteIds[k] })),
    ]
    const jobId = newId('job')
    // The shape: the first picture or drawing's, snapped to the nearest of the four; words only, the storyboard's.
    const first = plan.images[0]
    const ratio: Ratio = first ? ratioFor(this.aspectOfImage(first.elId, first.asset)) : mainStoryboard(doc)?.ratio ?? '16:9'
    const size = nodeSize(ratio === '16:9' ? { w: 16, h: 9 } : ratio === '9:16' ? { w: 9, h: 16 } : ratio === '1:1' ? { w: 1, h: 1 } : { w: 4, h: 5 })
    const slot = opts.at ? { ...opts.at, ...size } : nextSlot(this.els(), bounds(sources.map((s) => s.el)), size)
    this.placeGen(jobId, 'generate', sources.map((s) => s.id), sources, slot)
    const input = { refs, ratio, ...(text ? { text } : {}), ...(opts.more ? { chips: ['more_options'] } : {}) }
    await this.s.runner.submit('generate', input, plan.images.filter((i) => i.kind === 'gen').map((i) => i.nodeId), { for: 'canvas' }, jobId, opts.modelChoice)
    return { jobId }
  }

  // ── sketch areas (features/frame-aspect.clan; ui-behaviour 3.7) ──

  /** The person this browser acts for, as the document names them. */
  private person(): string {
    const me = this.s.ui.get().me
    return me ? `human:${me.participantId}` : LOCAL_PERSON
  }

  /** An element's shape in whole units. */
  private aspectOfEl(e: El): Aspect {
    return { w: Math.max(1, Math.round(Math.abs(e.width))), h: Math.max(1, Math.round(Math.abs(e.height))) }
  }

  /** An image input's shape: its picture's measured size, else its node's. */
  private aspectOfImage(elId: string, asset: string): Aspect {
    const a = this.doc().assets[asset]
    if (a?.w && a?.h) return { w: a.w, h: a.h }
    const el = this.els().find((e) => e.id === elId)
    return el ? this.aspectOfEl(el) : { w: 1, h: 1 }
  }

  /** The person's own Excalidraw frames this selection uses: selected, or holding a selected stroke. */
  private userFramesIn(elIds: readonly string[]): El[] {
    const live = new Map(alive(this.els()).map((e) => [e.id, e]))
    const out = new Map<string, El>()
    const own = (e: El | undefined) => !!e && e.type === 'frame' && !cd(e)
    for (const id of elIds) {
      const e = live.get(id)
      if (!e) continue
      if (own(e)) out.set(e.id, e)
      else if (e.frameId && own(live.get(e.frameId))) out.set(e.frameId, live.get(e.frameId)!)
    }
    return [...out.values()]
  }

  /**
   * A person's frame becomes a sketch area, in one undo step: a white area with the frame's exact
   * bounds and aspect (and its ratio when it is one of the four), and the frame's strokes taken out
   * of it where they are. Frames never used in Generate stay frames.
   */
  async frameToArea(frame: El): Promise<El> {
    const sketchId = newId('sketch')
    const aspect = this.aspectOfEl(frame)
    const ratio = exactRatio(aspect)
    const area = this.canvas.sketchArea({ x: frame.x, y: frame.y, w: frame.width, h: frame.height, sketchId })
    const next: El[] = []
    for (const e of this.els()) {
      if (e.id === frame.id) {
        next.push(area) // where the frame was: below its strokes
        next.push(this.canvas.patch(e, { isDeleted: true }))
      } else next.push(e.frameId === frame.id ? this.canvas.patch(e, { frameId: null }) : e)
    }
    this.setEls(next)
    await systemUpdate(this.s.doc, (d) => {
      d.sketches[sketchId] = { id: sketchId, v: 1, field_v: {}, aspect, ...(ratio ? { ratio } : {}), drawn_by: this.person() }
    }, 'sketch area')
    void this.sync.sketches(this.els())
    return area
  }

  /** What an area's Generate sends: exactly the area, its strokes clipped to it, at its shape, as a layout. */
  private async generateSketch(plan: CanvasPlan, typed: string, opts: { at?: { x: number; y: number }; more?: boolean; limits?: { max: number; characters: number }; modelChoice?: ModelChoice; layoutOnly?: boolean }): Promise<GenerateResult> {
    const doc = this.doc()
    const els = alive(this.els())
    const s = plan.sketches[0]
    const areaEl = els.find((e) => e.id === s.elId)
    if (!areaEl) throw new Error('That sketch area is gone.')
    const sketch = doc.sketches[s.sketchId]
    const aspect = sketch?.aspect ?? this.aspectOfEl(areaEl)
    const rect: Rect = { x: areaEl.x, y: areaEl.y, w: areaEl.width, h: areaEl.height }
    // Words typed inside the area go as words, as a drawing's do.
    const written = els.filter((e) => isText(e) && e.id !== areaEl.id && intersects(boxOf(e as unknown as Boxed), rect)).map((e) => textOf(e)).filter(Boolean)
    const notes = plan.notes.filter((n) => !els.some((e) => e.id === n.elId && intersects(boxOf(e as unknown as Boxed), rect)))
    const text = instruction(typed, [...notes, ...written.map((w) => ({ text: w }))])
    const said = mentions(doc, text)
    if (said.unknown.length) throw new Error(`@${said.unknown[0]} is not a name in this project. Name an image first, or check the spelling.`)
    // Nothing says what it is: Wren asks first, and nothing is sent (or spent) until someone answers.
    if (!text && !plan.images.length && !said.found.length && !opts.layoutOnly) return { ask: await this.askAboutSketch(s.sketchId) }

    const limits = opts.limits ?? { max: 14, characters: 14 }
    if (plan.images.length + 1 > limits.max) throw new Error(`Pick at most ${limits.max} pictures and drawings for one Generate.`)
    await this.refreshDrawn(plan.images.filter((i) => i.kind === 'drawn').map((i) => i.elId))
    const members = membersOf(els as unknown as Boxed[], rect).filter((e) => e.id !== areaEl.id)
    const ex = exportPlan(rect, aspect)
    const blob = await this.canvas.exportRegion({ rect, elementIds: members.map((e) => e.id), outW: ex.outW, outH: ex.outH, background: '#ffffff' })
    const sha = await putBlob(blob)
    this.addAsset(sha, blob, 'drawn', { w: ex.outW, h: ex.outH })
    const refs: JobInputRef[] = [{ id: s.sketchId, role: 'layout', kind: 'drawing', asset: await assetRef(this.s.relay, sha) }]
    for (const i of plan.images) {
      const named = this.nameOn(i.nodeId)
      if (named) refs.push(await namedInput(this.s.relay, this.doc(), named))
      else refs.push({ id: i.nodeId, role: i.kind === 'pic' ? 'other' : 'character', kind: i.kind === 'drawn' ? 'drawing' : i.kind === 'gen' ? 'generated' : 'picture', asset: await assetRef(this.s.relay, i.asset) })
    }
    for (const r of said.found) if (!refs.some((x) => x.id === r.id)) refs.push(await namedInput(this.s.relay, this.doc(), r))

    const noteIds = notes.map((n) => n.nodeId ?? this.noteId(n.elId))
    const live = this.els()
    const sources: { el: El; id: string }[] = [
      { el: areaEl, id: s.sketchId },
      ...plan.images.map((i) => ({ el: live.find((e) => e.id === i.elId)!, id: i.nodeId })),
      ...notes.map((n, k) => ({ el: live.find((e) => e.id === n.elId)!, id: noteIds[k] })),
    ]
    const jobId = newId('job')
    // The new frame sits to the right of the area, at its true shape.
    const size = nodeSize(aspect)
    const slot = opts.at ? { ...opts.at, ...size } : nextSlot(this.els(), bounds([areaEl]), size)
    this.placeGen(jobId, 'generate', sources.map((x) => x.id), sources, slot)
    const ratio = exactRatio(aspect)
    const input: JobInput = { refs, ...(ratio ? { ratio } : { aspect }), ...(text ? { text } : {}), ...(opts.more ? { chips: ['more_options'] } : {}) }
    await this.s.runner.submit('generate', input, plan.images.filter((i) => i.kind === 'gen').map((i) => i.nodeId), { for: 'sketch', sketchId: s.sketchId }, jobId, opts.modelChoice)
    return { jobId }
  }

  /**
   * Put resized sketch areas back on their shape: anchored top-left, led by the width (core/sketch.ts
   * lockAspect). Called once on pointer-up, as a system write, so the resize stays one undo step of
   * the person's and two browsers correcting it write the same thing. Returns how many moved.
   */
  lockAreas(): number {
    const d = this.doc()
    let moved = 0
    const next = this.els().map((e) => {
      const c = cd(e)
      if (c?.kind !== 'sketch' || e.isDeleted || e.type !== 'rectangle') return e
      const s = d.sketches[c.id]
      const r = s && lockAspect({ x: e.x, y: e.y, w: e.width, h: e.height }, s.aspect)
      if (!r) return e
      moved++
      return this.canvas.patch(e, { height: r.h })
    })
    if (moved) this.setEls(next, false)
    return moved
  }

  /** Wren's ask on a sketch with no words and nothing linked: an asks[id] row on the sketch, with no job. */
  private async askAboutSketch(sketchId: string): Promise<Ask> {
    const open = Object.values(this.doc().asks).find((a) => a.node.kind === 'sketch' && a.node.id === sketchId && a.state === 'open' && !a.job_id)
    if (open) return open
    const ask = sketchAsk(sketchId)
    await systemUpdate(this.s.doc, (d) => { d.asks[ask.id] = ask }, SKETCH_ASK)
    return ask
  }

  // ── names: key_variant on any image ──

  /** The name on a node, if it has one. */
  nameOn(nodeId: string, doc = this.doc()): NamedRef | undefined {
    return refsList(doc).find((r) => r.node === nodeId)
  }

  /**
   * Name an image node key_variant. A name another image has moves to this one (the
   * frames and clips made from the old picture are marked out of date). A new key gets
   * `role` (character by default).
   */
  name(nodeId: string, key: Key, variant: Variant, role: RefRole = 'character') {
    const problem = nameProblem(key, variant)
    if (problem) throw new Error(problem)
    const img = imageOf(this.nodeEl(nodeId))
    if (!img?.asset) throw new Error('Name a picture once it is finished.')
    const asset = img.asset
    const name = `${key}_${variant}`
    systemUpdate(this.s.doc, (d) => {
      const now = new Date().toISOString()
      const refs = Object.values(d.refs)
      const mine = refs.find((r) => r.node === nodeId)
      const other = refs.find((r) => nameOf(r) === name && r !== mine)
      // A ref has its key's role; a new key gets `role`.
      let k = keyNamed(d, key)
      if (!k) {
        const id = newId('key')
        k = d.keys[id] = { id, v: 1, field_v: {}, key, role }
      }
      if (other) {
        // The name moves here: one image per name.
        if (other.asset && other.asset !== asset) markStale(d, other.asset, other.id, `@${name} now shows another image.`, now)
        if (mine) delete d.refs[mine.id]
        Object.assign(other, { asset, node: nodeId, named_at: now })
      } else if (mine) {
        Object.assign(mine, { key, variant, role: k.role, named_at: now })
      } else {
        const id = newId('ref')
        d.refs[id] = { id, v: 1, field_v: {}, key, variant, role: k.role, asset, node: nodeId, named_at: now }
      }
      dropUnusedKeys(d)
    }, 'name')
  }

  /** Take the name off a node. The key goes too when nothing else uses it and it was never published. */
  unname(nodeId: string) {
    systemUpdate(this.s.doc, (d) => {
      for (const r of Object.values(d.refs)) if (r.node === nodeId) delete d.refs[r.id]
      dropUnusedKeys(d)
    }, 'name')
  }

  /** A key's role, and its refs' with it. */
  setRole(key: Key, role: RefRole) {
    systemUpdate(this.s.doc, (d) => {
      const k = keyNamed(d, key)
      if (k) k.role = role
      for (const r of Object.values(d.refs)) if (r.key === key) r.role = role
    }, 'name')
  }

  // ── views: any named image is a key's front; the others are generated from it ──

  /** Generate the other views of a key from its front (any image named key_front). */
  async makeViews(key: Key, views: View[] = OTHER_VIEWS, modelChoice?: ModelChoice) {
    const doc = this.doc()
    const front = refByName(doc, `${key}_front`)
    if (!front) throw new Error(`Set an image as ${key}'s front first.`)
    const frontEl = front.node ? this.nodeEl(front.node) : undefined
    if (!front.asset) throw new Error(`${key}'s front has no picture.`)
    const image = await assetRef(this.s.relay, front.asset)
    // Other variants of the key keep the identity (up to 3, KEY_EXTRAS in lib/names.ts).
    const refs: JobInputRef[] = []
    for (const r of refsList(doc).filter((x) => x.key === key && x.id !== front.id && x.asset).slice(0, 3)) refs.push(await namedInput(this.s.relay, doc, r))
    const els = this.els()
    const anchor = frontEl ? bounds([frontEl]) : { maxX: 0, minY: 0 }
    // The views keep the front's exact shape, so they line up with it (frame-aspect).
    const known = doc.assets[front.asset]
    const aspect: Aspect = known?.w && known?.h ? { w: known.w, h: known.h } : frontEl ? this.aspectOfEl(frontEl) : { w: 4, h: 5 }
    const size = nodeSize(aspect)
    // A row to the right of the front, clear of anything already there.
    const slot = nextSlot(els, anchor, { w: size.w * views.length + 40 * (views.length - 1), h: size.h })
    const placed: { jobId: string; view: View }[] = []
    let x = slot.x
    for (const view of views) {
      const jobId = newId('job')
      const parents = front.node ? [front.node] : []
      let gen = makeGenPlaceholder(this.canvas, jobId, 'view', parents, { x, y: slot.y }, size, view)
      x += size.w + 40
      let all = this.onSourceBoard([...this.els(), gen], gen, frontEl, { x: gen.x, y: gen.y })
      gen = all.find((e) => e.id === gen.id) ?? gen
      if (frontEl && front.node) {
        const arrow = makeArrow(this.canvas, frontEl, gen, front.node, jobId, 0, true)
        all = this.canvas.bindArrow([...all, arrow], arrow)
      }
      this.setEls(all)
      placed.push({ jobId, view })
    }
    this.reveal([...placed.map((p) => p.jobId), ...(frontEl ? [frontEl.id] : [])])
    for (const p of placed) {
      // The front's own shape: the relay asks for the nearest size and crops back to it.
      await this.s.runner.submit('view', { view: p.view, image, ...(refs.length ? { refs } : {}), aspect }, front.node ? [front.node] : [], { for: 'canvas' }, p.jobId, modelChoice)
    }
  }

  // ── the library: a key's refs out to the workspace, and back into a document ──

  /** Publish a key's refs as the next library version. */
  async publish(key: Key) {
    const doc = this.doc()
    const k = keyNamed(doc, key)
    const refs = refsList(doc).filter((r) => r.key === key && r.asset)
    if (!k || !refs.length) throw new Error(`Name at least one image ${key}_… first.`)
    const out = []
    for (const r of refs) out.push({ variant: r.variant, asset: await assetRef(this.s.relay, r.asset!) })
    const shelf = k.library?.shelf ?? AGENCY_SHELF
    const entry = await this.s.relay.publish(key, { kind: 'key', role: k.role, baseVer: k.library?.ver ?? 0, refs: out }, shelf)
    systemUpdate(this.s.doc, (d) => {
      const kk = keyNamed(d, key)
      if (kk) kk.library = libraryCopy(entry)
    }, 'publish')
  }

  /**
   * Bring a library version into this document: its images land on the canvas as named
   * pictures in a row (a copy; the library entry is never linked live). Variants this
   * document already has are replaced, and what was made from them is marked out of date.
   */
  async importEntry(entry: LibraryEntry) {
    const pictures: CanvasAsset[] = []
    const got: { variant: Variant; sha: string; w: number; h: number }[] = []
    for (const r of entry.refs ?? []) {
      const blob = await this.s.relay.fetchOutput(r.asset)
      const sha = await putBlob(blob)
      await putBlobAs(r.asset.sha256, blob)
      pictures.push(await assetData(sha, blob))
      const bmp = await createImageBitmap(blob).catch(() => null)
      got.push({ variant: r.variant, sha, w: bmp?.width ?? NODE.w, h: bmp?.height ?? NODE.h })
      bmp?.close?.()
      this.addAsset(sha, blob, 'uploaded', bmp ? { w: bmp.width, h: bmp.height } : undefined)
    }
    this.canvas.addAssets(pictures)
    const { minX: vx0, minY: vy0 } = this.canvas.visibleBounds()
    const start = nextSlot(this.els(), { maxX: vx0, minY: vy0 + 40 }, { w: (NODE.w + 40) * got.length, h: NODE.h })
    const nodes: { nodeId: string; variant: Variant; sha: string }[] = []
    const added: El[] = []
    got.forEach((g, i) => {
      const nodeId = newId('node')
      const h = Math.round((NODE.w * g.h) / Math.max(1, g.w))
      added.push(this.canvas.imageNode(
        { x: start.x + i * (NODE.w + 40), y: start.y, width: NODE.w, height: h, assetSha: g.sha, customData: { kind: 'pic', id: nodeId, asset: g.sha }, status: 'saved' },
      ))
      nodes.push({ nodeId, variant: g.variant, sha: g.sha })
    })
    for (const el of added) this.processing.add(el.id)
    this.setEls([...this.els(), ...added])
    systemUpdate(this.s.doc, (d) => {
      const now = new Date().toISOString()
      const lib = libraryCopy(entry)
      let k = keyNamed(d, entry.key)
      if (!k) {
        const id = newId('key')
        k = d.keys[id] = { id, v: 1, field_v: {}, key: entry.key, role: entry.role ?? 'character' }
      }
      Object.assign(k, { ...(entry.role ? { role: entry.role } : {}), library: lib })
      for (const n of nodes) {
        const existing = Object.values(d.refs).find((r) => r.key === entry.key && r.variant === n.variant)
        if (existing) {
          if (existing.asset && existing.asset !== n.sha) markStale(d, existing.asset, existing.id, `@${entry.key}_${n.variant} was replaced from the library.`, now)
          Object.assign(existing, { asset: n.sha, node: n.nodeId, role: k.role, named_at: now })
        } else {
          const id = newId('ref')
          d.refs[id] = { id, v: 1, field_v: {}, key: entry.key, variant: n.variant, role: k.role, asset: n.sha, node: n.nodeId, named_at: now }
        }
      }
    }, 'import')
    this.reveal(added.map((e) => e.id))
  }

  // ── jobs that land on the canvas ──

  private placeGen(jobId: string, op: 'generate' | 'view', parentIds: string[], sources: { el: El; id: string }[], at: { x: number; y: number; w: number; h: number }, view?: View) {
    let gen = makeGenPlaceholder(this.canvas, jobId, op, parentIds, at, { w: at.w, h: at.h }, view)
    let els = this.onSourceBoard([...this.els(), gen], gen, sources[0]?.el, at)
    gen = els.find((e) => e.id === gen.id) ?? gen
    sources.forEach((s, i) => {
      const arrow = makeArrow(this.canvas, s.el, gen, s.id, jobId, i)
      els = this.canvas.bindArrow([...els, arrow], arrow)
    })
    this.setEls(els)
    this.reveal([gen.id, ...sources.map((s) => s.el.id)])
  }

  /**
   * A new result whose source sits on a board goes on that board too (owner decision 2026-10-15):
   * beside the source when that is clear (the board growing toward it), else the board's next free slot,
   * or just outside a board that cannot grow. `els` already holds `gen`; returns them with it placed.
   */
  private onSourceBoard(els: El[], gen: El, source: El | undefined, at: { x: number; y: number }): El[] {
    const frameId = source?.frameId
    if (!frameId || !boardFrame(els, frameId)) return els
    const fit = fitInto(els, frameId, [[gen.id]], () => at)
    tellFull(frameId, fit)
    return withFields(this.canvas, els, fit.fields)
  }

  /** Make sure new results land in view: zoom out to them and their inputs when any part is off-screen. */
  reveal(ids: string[]) {
    const els = alive(this.els()).filter((e) => ids.includes(e.id))
    if (!els.length) return
    const { minX: vx0, minY: vy0, maxX: vx1, maxY: vy1 } = this.canvas.visibleBounds()
    const b = bounds(els)
    if (b.minX >= vx0 && b.minY >= vy0 && b.maxX <= vx1 && b.maxY <= vy1) return
    this.canvas.fit(els, { zoomFactor: 0.85, animate: true })
  }

  /** A failed canvas job was retried as a new job: move the node and its arrows to the new id. */
  retarget(oldId: string, newJobId: string) {
    const els = this.els()
    const old = byOwnId(els, oldId)
    if (!old) return
    const c = cd(old) as Extract<CustomData, { kind: 'gen' }>
    this.sync.moved.add(oldId)
    const gen = makeGenPlaceholder(this.canvas, newJobId, c.op, c.parentIds, { x: old.x, y: old.y }, { w: old.width, h: old.height }, c.view)
    let next: El[] = els.map((e) => (e.id === old.id ? this.canvas.patch(e, { isDeleted: true }) : e))
    next.push(gen)
    const into = els.filter((e) => !e.isDeleted && cd(e)?.kind === 'provenance' && (cd(e) as { to: string }).to === oldId)
    into.forEach((a, i) => {
      const from = (cd(a) as { from: string }).from
      const fromEl = byOwnId(els, from)
      next = next.map((e) => (e.id === a.id ? this.canvas.patch(e, { isDeleted: true }) : e))
      if (fromEl) {
        const arrow = makeArrow(this.canvas, fromEl, gen, from, newJobId, i, c.op === 'view')
        next = this.canvas.bindArrow([...next, arrow], arrow)
      }
    })
    this.setEls(next, false)
  }

  /** Mirror job states into gen customData (failed, cancelled), so the canvas file matches the record. */
  syncGenStates(doc: ProductionDocument) {
    let changed = false
    const next = this.els().map((e) => {
      const c = cd(e)
      if (c?.kind !== 'gen' || e.isDeleted) return e
      const j = doc.jobs[c.id]
      if (j && j.state !== c.state && j.state !== 'completed') {
        changed = true
        return this.canvas.patch(e, { customData: { ...c, state: j.state } })
      }
      return e
    })
    if (changed) this.setEls(next, false)
  }

  /** A canvas job finished: put the image in its node and size it. A view of a key is named key_view when that name is free. */
  async land(job: Job) {
    const out = job.outputs?.[0]
    const el = byOwnId(this.els(), job.jobId)
    if (!out || !el) return
    const blob = await getBlob(out.sha256)
    if (!blob) return
    await putBlobAs(out.sha256, blob)
    this.canvas.addAssets([await assetData(out.sha256, blob)])
    const c = cd(el) as Extract<CustomData, { kind: 'gen' }>
    const h = out.w && out.h ? Math.round((el.width * out.h) / out.w) : el.height
    const landed = this.els().map((e) => (e.id === el.id ? this.canvas.patch(this.canvas.withAsset(e, out.sha256), {
      height: h,
      customData: { ...c, state: 'completed', asset: out.sha256, ...(job.kind === 'mock' ? { mock: true } : {}) },
    }) : e))
    // Landed taller than its placeholder on a board: the board grows to hold it when it can.
    this.setEls(el.frameId ? withFields(this.canvas, landed, holdFields(landed, el.frameId)) : landed, false)
    // The landing is the crew's decision, citing the job and the refs it used, as for frames and clips.
    const why = landingWhy(this.s.doc, job.jobId, c.op === 'view' && c.view ? `the ${c.view} view on the canvas` : 'a picture on the canvas')
    if (this.s.doc.record) {
      const docId = this.s.doc.documentId?.()
      await this.s.doc.record(why.action, why.rationale, {
        agent: why.agent, cites: why.cites, ...(docId ? { targets: [`${docId}#jobs[${job.jobId}]`] } : {}),
      }).catch((e) => console.warn('could not record the canvas landing', e))
    }
    // A Generate on a sketch area lands as a frame made from it, with its crop (frame-aspect).
    const p = this.doc().jobs[job.jobId] ? purposeOf(this.doc().jobs[job.jobId]) : null
    if (p?.for === 'sketch') await systemUpdate(this.s.doc, (d) => { applySketchFrame(d, job, p.sketchId) }, 'frame')
    if (c.op === 'view' && c.view) {
      const source = this.nameOn(c.parentIds[0])
      const key = source?.key
      if (key && !refByName(this.doc(), `${key}_${c.view}`)) this.name(job.jobId, key, c.view)
    }
  }

  scrollTo(nodeId: string) {
    const el = byOwnId(this.els(), nodeId)
    if (el) this.canvas.fit([el], { zoomFactor: 0.5, animate: true })
  }

  /** The text of a note node or loose text element (for labels). */
  textOfEl(elId: string): string {
    const el = this.els().find((e) => e.id === elId)
    return el ? textOf(el) : ''
  }
}

/** What a document keeps of the library version it copied (key.library). */
function libraryCopy(entry: LibraryEntry) {
  return { shelf: entry.shelf, key: entry.key, ver: entry.ver, by: entry.by, at: entry.at }
}

/** Keys no ref uses and never published go. */
function dropUnusedKeys(d: ProductionDocument) {
  const used = new Set(Object.values(d.refs).map((r) => r.key))
  for (const k of Object.values(d.keys)) if (!used.has(k.key) && !k.library) delete d.keys[k.id]
}

/** A node's size on the canvas at this shape: 300 wide (as before), at most 400 tall. */
export function nodeSize(aspect: Aspect): { w: number; h: number } {
  const w = aspect.h > aspect.w * (NODE.h / NODE.w) ? Math.round((NODE.h * aspect.w) / aspect.h) : NODE.w
  return { w, h: Math.round((w * aspect.h) / aspect.w) }
}

export function viewLabel(v: View): string {
  return { front: 'Front', 'three-quarter': '3/4', side: 'Side', back: 'Back' }[v]
}
