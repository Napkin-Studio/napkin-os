// The canvas's logic over the Excalidraw API. The canvas is free: draw, write or
// drop pictures anywhere. Every picture, drawing, note and result is a node;
// select any of them and Generate puts a new node beside them (or where you
// click), with a curved arrow from each input. Any image can be named
// key_variant (maya_front), set as a key's front, and turned into the other
// views. The React component only renders overlays and calls in.

import { CaptureUpdateAction, convertToExcalidrawElements, getVisibleSceneBounds, newElementWith } from '@excalidraw/excalidraw'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'
import type { CustomData, Job, JobInputRef, Key, LibraryEntry, ProductionDocument, RefRole, Variant, View } from '../contracts/types'
import type { Services } from '../app/context'
import { getBlob, idbLocation, putBlob, putBlobAs } from '../lib/blobs'
import { idbPut } from '../lib/idb'
import { mentions, nameOf, nameProblem, refByName } from '../lib/names'
import { newId } from '../lib/ulid'
import { systemUpdate } from '../doc/store'
import { markStale } from '../doc/remove'
import { assetRef } from '../jobs/assets'
import { namedInput } from '../jobs/select'
import {
  alive, bindArrow, bounds, byOwnId, cd, childrenOf, dataURLToBlob, downscale, exportElements, fileData, fileIdFor, idOf,
  imageOf, makeArrow, makeGenPlaceholder, nextSlot, textOf, type El,
} from './scene'
import { instruction, planSelection } from './selection'
import { CanvasDocSync } from './sync'
import { frameText } from './text'


export interface CanvasSnapshot {
  elements: El[]
  files: BinaryFiles
}

export const OTHER_VIEWS: View[] = ['three-quarter', 'side', 'back']
const NODE = { w: 300, h: 400 }

/** What a Generate on this selection would send, for the popover to show before it goes. */
export interface GeneratePreview {
  inputs: { nodeId: string; name?: string; kind: 'pic' | 'drawn' | 'gen' }[]
  drawings: number
  notes: string[]
  pending: number
}

export class CanvasController {
  readonly api: ExcalidrawImperativeAPI
  private readonly s: Services
  private readonly processing = new Set<string>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  /** Deletes and their undo (ours or Excalidraw's Ctrl+Z) kept in step with the document. */
  readonly sync: CanvasDocSync

  constructor(api: ExcalidrawImperativeAPI, services: Services) {
    this.api = api
    this.s = services
    this.sync = new CanvasDocSync({ doc: services.doc, cancel: (jobId) => void services.runner.cancel(jobId) })
    this.sync.gens(this.els())
  }

  private els(): El[] {
    return this.api.getSceneElementsIncludingDeleted() as El[]
  }

  private setEls(els: El[], undoable = true) {
    this.api.updateScene({ elements: els, captureUpdate: undoable ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER })
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

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), 600)
  }

  async save() {
    const elements = this.els().filter((e) => !e.isDeleted)
    const used = new Set(elements.map((e) => (e as ExcalidrawImageElement).fileId).filter(Boolean) as string[])
    const files: BinaryFiles = {}
    for (const [k, v] of Object.entries(this.api.getFiles())) if (used.has(k)) files[k] = v
    await idbPut('kv', this.s.project.canvasKey, { elements, files } satisfies CanvasSnapshot)
  }

  /** Called on every scene change (throttled by the component). */
  onChange() {
    this.scheduleSave()
    void this.intakePictures()
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => this.syncNow(), 250)
  }

  private syncNow() {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = null
    void this.sync.gens(this.els())
  }

  // ── delete and undo ──

  /** What deleting these elements takes with it: a drawing's strokes, and the arrows to and from them. */
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
    }
    return [...out]
  }

  /** Delete elements (undoable with Ctrl+Z too). Returns what went, for Undo, and where it was. */
  deleteElements(ids: string[]): { ids: string[]; at: { x: number; y: number }; label: string } | null {
    const gone = this.deletionOf(ids)
    if (!gone.length) return null
    const els = this.els()
    const shown = alive(els).filter((e) => gone.includes(e.id) && cd(e)?.kind !== 'provenance' && !e.frameId)
    const b = bounds(shown.length ? shown : alive(els).filter((e) => gone.includes(e.id)))
    const label = shown.length === 1 ? (cd(shown[0])?.kind === 'gen' ? 'Image deleted' : 'Deleted') : `${shown.length} deleted`
    this.setEls(els.map((e) => (gone.includes(e.id) ? newElementWith(e, { isDeleted: true }) : e)))
    this.api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER })
    this.syncNow()
    return { ids: gone, at: { x: b.minX + b.w / 2, y: b.minY + b.h / 2 }, label }
  }

  /** Undo a delete from the inline Undo (Ctrl+Z does the same through Excalidraw). */
  undelete(ids: string[]) {
    this.setEls(this.els().map((e) => (ids.includes(e.id) && e.isDeleted ? newElementWith(e, { isDeleted: false }) : e)))
    this.syncNow()
  }

  /** The selected elements that the Delete key and 🗑 act on: everything but the tool's arrows. */
  deletable(selected: El[]): El[] {
    return selected.filter((e) => cd(e)?.kind !== 'provenance')
  }

  // ── pictures: downscale ≤1536 px, hash, keep as a node ──

  private addAsset(sha: string, blob: Blob, origin: 'uploaded' | 'drawn', size?: { w: number; h: number }) {
    systemUpdate(this.s.doc, (d) => {
      if (!d.assets.some((a) => a.sha256 === sha)) {
        d.assets.push({ sha256: sha, kind: 'image', mime: blob.type || 'image/png', bytes: blob.size, ...(size ?? {}), origin, locations: [idbLocation(sha)] })
      }
    }, 'add picture')
  }

  private async intakePictures() {
    const files = this.api.getFiles()
    const fresh = alive(this.els()).filter(
      (e) => e.type === 'image' && !cd(e) && (e as ExcalidrawImageElement).fileId && files[(e as ExcalidrawImageElement).fileId!] && !this.processing.has(e.id),
    ) as ExcalidrawImageElement[]
    for (const el of fresh) {
      this.processing.add(el.id)
      try {
        const file = files[el.fileId!]
        const original = await dataURLToBlob(file.dataURL)
        const { blob, w, h, changed } = await downscale(original)
        const sha = await putBlob(blob)
        let fileId = el.fileId!
        if (changed) {
          const data = await fileData(sha, blob)
          this.api.addFiles([data])
          fileId = data.id
        }
        const customData: CustomData = { kind: 'pic', id: newId('node'), asset: sha }
        this.patchEl(el.id, (e) => newElementWith(e as ExcalidrawImageElement, { fileId, status: 'saved', customData }), true)
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
    const blob = (await downscale(await exportElements(strokes, this.api.getFiles()))).blob
    const sha = await putBlob(blob)
    const [frame] = convertToExcalidrawElements(
      [{ type: 'frame', x: b.minX - pad, y: b.minY - pad, width: b.w + pad * 2, height: b.h + pad * 2, name: 'Drawing', children: [], customData: { kind: 'drawn', id: newId('node'), asset: sha } }],
    )
    const next = els.map((e) => (ids.includes(e.id) ? newElementWith(e, { frameId: frame.id }) : e))
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
      const blob = (await downscale(await exportElements(kids, this.api.getFiles()))).blob
      const sha = await putBlob(blob)
      if (sha === c.asset) continue
      this.patchEl(f.id, (e) => newElementWith(e, { customData: { ...c, asset: sha } }))
      this.addAsset(sha, blob, 'drawn')
      // A name on the drawing follows its new picture.
      systemUpdate(this.s.doc, (d) => {
        for (const r of d.refs) if (r.node === c.id) r.asset = sha
      }, 'name')
    }
  }

  /** Give a text element a node id, so arrows can name it. */
  private noteId(elId: string): string {
    const el = this.els().find((e) => e.id === elId)
    const c = cd(el)
    if (c?.kind === 'note') return c.id
    const id = newId('node')
    this.patchEl(elId, (e) => newElementWith(e, { customData: { kind: 'note', id } }))
    return id
  }

  // ── Generate from any selection ──

  /** What a Generate on these elements would use (for the popover). */
  preview(elIds: string[]): GeneratePreview {
    const doc = this.doc()
    const plan = planSelection(this.els(), elIds)
    return {
      inputs: plan.images.map((i) => {
        const r = doc.refs.find((x) => x.node === i.nodeId)
        return { nodeId: i.nodeId, kind: i.kind, ...(r ? { name: nameOf(r) } : {}) }
      }),
      drawings: plan.strokes.length ? 1 : 0,
      notes: plan.notes.map((n) => n.text),
      pending: plan.pending.length,
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
  async generate(elIds: string[], typed: string, opts: { at?: { x: number; y: number }; more?: boolean; limits?: { max: number; characters: number } } = {}) {
    const doc = this.doc()
    let plan = planSelection(this.els(), elIds)
    if (plan.pending.length) throw new Error('One of these is still being made. Wait for it, or leave it out.')
    // Loose strokes become one drawing node first.
    if (plan.strokes.length) {
      const frame = await this.wrapDrawing(plan.strokes)
      if (frame) plan = planSelection(this.els(), [...elIds.filter((id) => !plan.strokes.includes(id)), frame.id])
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
      const named = this.doc().refs.find((r) => r.node === i.nodeId)
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
    const slot = opts.at ? { ...opts.at, ...NODE } : nextSlot(this.els(), bounds(sources.map((s) => s.el)), NODE)
    this.placeGen(jobId, 'generate', sources.map((s) => s.id), sources, slot)
    const input = { refs, ratio: '4:5' as const, ...(text ? { text } : {}), ...(opts.more ? { chips: ['more_options'] } : {}) }
    await this.s.runner.submit('generate', input, plan.images.filter((i) => i.kind === 'gen').map((i) => i.nodeId), { for: 'canvas' }, jobId)
  }

  // ── names: key_variant on any image ──

  /** The name on a node, if it has one. */
  nameOn(nodeId: string) {
    return this.doc().refs.find((r) => r.node === nodeId)
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
      const mine = d.refs.find((r) => r.node === nodeId)
      const other = d.refs.find((r) => nameOf(r) === name && r !== mine)
      if (other) {
        // The name moves here: one image per name.
        if (other.asset !== asset) markStale(d, other.asset, other.id, `@${name} now shows another image.`, now)
        if (mine) d.refs = d.refs.filter((r) => r !== mine)
        Object.assign(other, { asset, node: nodeId, named_at: now })
      } else if (mine) {
        Object.assign(mine, { key, variant, named_at: now })
      } else {
        d.refs.push({ id: newId('ref'), key, variant, asset, node: nodeId, named_at: now })
      }
      if (!d.keys.some((k) => k.key === key)) d.keys.push({ key, role })
      d.keys = d.keys.filter((k) => d.refs.some((r) => r.key === k.key) || k.library)
    }, 'name')
  }

  /** Take the name off a node. The key goes too when nothing else uses it and it was never published. */
  unname(nodeId: string) {
    systemUpdate(this.s.doc, (d) => {
      d.refs = d.refs.filter((r) => r.node !== nodeId)
      d.keys = d.keys.filter((k) => d.refs.some((r) => r.key === k.key) || k.library)
    }, 'name')
  }

  setRole(key: Key, role: RefRole) {
    systemUpdate(this.s.doc, (d) => {
      const k = d.keys.find((x) => x.key === key)
      if (k) k.role = role
    }, 'name')
  }

  // ── views: any named image is a key's front; the others are generated from it ──

  /** Generate the other views of a key from its front (any image named key_front). */
  async makeViews(key: Key, views: View[] = OTHER_VIEWS) {
    const doc = this.doc()
    const front = refByName(doc, `${key}_front`)
    if (!front) throw new Error(`Set an image as ${key}'s front first.`)
    const frontEl = front.node ? this.nodeEl(front.node) : undefined
    const image = await assetRef(this.s.relay, front.asset)
    // Other variants of the key keep the identity (up to 3, fal's element limit).
    const refs: JobInputRef[] = []
    for (const r of doc.refs.filter((x) => x.key === key && x.id !== front.id).slice(0, 3)) refs.push(await namedInput(this.s.relay, doc, r))
    const els = this.els()
    const anchor = frontEl ? bounds([frontEl]) : { maxX: 0, minY: 0 }
    // A row to the right of the front, clear of anything already there.
    const slot = nextSlot(els, anchor, { w: NODE.w * views.length + 40 * (views.length - 1), h: NODE.h })
    const placed: { jobId: string; view: View }[] = []
    let x = slot.x
    for (const view of views) {
      const jobId = newId('job')
      const parents = front.node ? [front.node] : []
      const gen = makeGenPlaceholder(jobId, 'view', parents, { x, y: slot.y }, NODE, view)
      x += NODE.w + 40
      let all = [...this.els(), gen]
      if (frontEl && front.node) {
        const arrow = makeArrow(frontEl, gen, front.node, jobId, 0, true)
        all = bindArrow([...all, arrow], arrow)
      }
      this.setEls(all)
      placed.push({ jobId, view })
    }
    this.reveal([...placed.map((p) => p.jobId), ...(frontEl ? [frontEl.id] : [])])
    for (const p of placed) {
      // Same ratio as the front, so the views line up (the relay refuses a view without one).
      await this.s.runner.submit('view', { view: p.view, image, ...(refs.length ? { refs } : {}), ratio: '4:5' }, front.node ? [front.node] : [], { for: 'canvas' }, p.jobId)
    }
  }

  // ── the library: a key's refs out to the workspace, and back into a document ──

  /** Publish a key's refs as the next library version. */
  async publish(key: Key) {
    const doc = this.doc()
    const k = doc.keys.find((x) => x.key === key)
    const refs = doc.refs.filter((r) => r.key === key)
    if (!k || !refs.length) throw new Error(`Name at least one image ${key}_… first.`)
    const out = []
    for (const r of refs) out.push({ variant: r.variant, asset: await assetRef(this.s.relay, r.asset) })
    const entry = await this.s.relay.publish(key, { role: k.role, baseVer: k.library?.ver ?? 0, refs: out })
    systemUpdate(this.s.doc, (d) => {
      const kk = d.keys.find((x) => x.key === key)
      if (kk) kk.library = { workspace: entry.workspace, ver: entry.ver, by: entry.by, at: entry.at }
    }, 'publish')
  }

  /**
   * Bring a library version into this document: its images land on the canvas as named
   * pictures in a row (a copy; the library entry is never linked live). Variants this
   * document already has are replaced, and what was made from them is marked out of date.
   */
  async importEntry(entry: LibraryEntry) {
    const files: Parameters<ExcalidrawImperativeAPI['addFiles']>[0] = []
    const got: { variant: Variant; sha: string; w: number; h: number }[] = []
    for (const r of entry.refs) {
      const blob = await this.s.relay.fetchOutput(r.asset)
      const sha = await putBlob(blob)
      await putBlobAs(r.asset.sha256, blob)
      files.push(await fileData(sha, blob))
      const bmp = await createImageBitmap(blob).catch(() => null)
      got.push({ variant: r.variant, sha, w: bmp?.width ?? NODE.w, h: bmp?.height ?? NODE.h })
      bmp?.close?.()
      this.addAsset(sha, blob, 'uploaded', bmp ? { w: bmp.width, h: bmp.height } : undefined)
    }
    this.api.addFiles(files)
    const [vx0, vy0] = getVisibleSceneBounds(this.api.getAppState())
    const start = nextSlot(this.els(), { maxX: vx0, minY: vy0 + 40 }, { w: (NODE.w + 40) * got.length, h: NODE.h })
    const nodes: { nodeId: string; variant: Variant; sha: string }[] = []
    const added: El[] = []
    got.forEach((g, i) => {
      const nodeId = newId('node')
      const h = Math.round((NODE.w * g.h) / Math.max(1, g.w))
      const [el] = convertToExcalidrawElements(
        [{ type: 'image', x: start.x + i * (NODE.w + 40), y: start.y, width: NODE.w, height: h, fileId: fileIdFor(g.sha), customData: { kind: 'pic', id: nodeId, asset: g.sha } }],
      )
      added.push(newElementWith(el as ExcalidrawImageElement, { status: 'saved' }))
      nodes.push({ nodeId, variant: g.variant, sha: g.sha })
    })
    for (const el of added) this.processing.add(el.id)
    this.setEls([...this.els(), ...added])
    systemUpdate(this.s.doc, (d) => {
      const now = new Date().toISOString()
      for (const n of nodes) {
        const existing = d.refs.find((r) => r.key === entry.key && r.variant === n.variant)
        if (existing) {
          if (existing.asset !== n.sha) markStale(d, existing.asset, existing.id, `@${entry.key}_${n.variant} was replaced from the library.`, now)
          Object.assign(existing, { asset: n.sha, node: n.nodeId, named_at: now })
        } else {
          d.refs.push({ id: newId('ref'), key: entry.key, variant: n.variant, asset: n.sha, node: n.nodeId, named_at: now })
        }
      }
      const lib = { workspace: entry.workspace, ver: entry.ver, by: entry.by, at: entry.at }
      const k = d.keys.find((x) => x.key === entry.key)
      if (k) Object.assign(k, { role: entry.role, library: lib })
      else d.keys.push({ key: entry.key, role: entry.role, library: lib })
    }, 'import')
    this.reveal(added.map((e) => e.id))
  }

  // ── jobs that land on the canvas ──

  private placeGen(jobId: string, op: 'generate' | 'view', parentIds: string[], sources: { el: El; id: string }[], at: { x: number; y: number; w: number; h: number }, view?: View) {
    const gen = makeGenPlaceholder(jobId, op, parentIds, at, { w: at.w, h: at.h }, view)
    let els = [...this.els(), gen]
    sources.forEach((s, i) => {
      const arrow = makeArrow(s.el, gen, s.id, jobId, i)
      els = bindArrow([...els, arrow], arrow)
    })
    this.setEls(els)
    this.reveal([gen.id, ...sources.map((s) => s.el.id)])
  }

  /** Make sure new results land in view: zoom out to them and their inputs when any part is off-screen. */
  reveal(ids: string[]) {
    const els = alive(this.els()).filter((e) => ids.includes(e.id))
    if (!els.length) return
    const [vx0, vy0, vx1, vy1] = getVisibleSceneBounds(this.api.getAppState())
    const b = bounds(els)
    if (b.minX >= vx0 && b.minY >= vy0 && b.maxX <= vx1 && b.maxY <= vy1) return
    this.api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.85, animate: true })
  }

  /** A failed canvas job was retried as a new job: move the node and its arrows to the new id. */
  retarget(oldId: string, newJobId: string) {
    const els = this.els()
    const old = byOwnId(els, oldId)
    if (!old) return
    const c = cd(old) as Extract<CustomData, { kind: 'gen' }>
    this.sync.moved.add(oldId)
    const gen = makeGenPlaceholder(newJobId, c.op, c.parentIds, { x: old.x, y: old.y }, { w: old.width, h: old.height }, c.view)
    let next: El[] = els.map((e) => (e.id === old.id ? newElementWith(e, { isDeleted: true }) : e))
    next.push(gen)
    const into = els.filter((e) => !e.isDeleted && cd(e)?.kind === 'provenance' && (cd(e) as { to: string }).to === oldId)
    into.forEach((a, i) => {
      const from = (cd(a) as { from: string }).from
      const fromEl = byOwnId(els, from)
      next = next.map((e) => (e.id === a.id ? newElementWith(e, { isDeleted: true }) : e))
      if (fromEl) {
        const arrow = makeArrow(fromEl, gen, from, newJobId, i, c.op === 'view')
        next = bindArrow([...next, arrow], arrow)
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
      const j = doc.jobs.find((x) => x.id === c.id)
      if (j && j.state !== c.state && j.state !== 'completed') {
        changed = true
        return newElementWith(e, { customData: { ...c, state: j.state } })
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
    const data = await fileData(out.sha256, blob)
    this.api.addFiles([data])
    const c = cd(el) as Extract<CustomData, { kind: 'gen' }>
    const h = out.w && out.h ? Math.round((el.width * out.h) / out.w) : el.height
    this.patchEl(el.id, (e) => newElementWith(e as ExcalidrawImageElement, {
      fileId: fileIdFor(out.sha256), status: 'saved', height: h,
      customData: { ...c, state: 'completed', asset: out.sha256, ...(job.kind === 'mock' ? { mock: true } : {}) },
    }))
    if (c.op === 'view' && c.view) {
      const source = this.doc().refs.find((r) => r.node === c.parentIds[0])
      const key = source?.key
      if (key && !refByName(this.doc(), `${key}_${c.view}`)) this.name(job.jobId, key, c.view)
    }
  }

  scrollTo(nodeId: string) {
    const el = byOwnId(this.els(), nodeId)
    if (el) this.api.scrollToContent(el, { animate: true, fitToViewport: true, viewportZoomFactor: 0.5 })
  }

  /** The text of a note node or loose text element (for labels). */
  textOfEl(elId: string): string {
    const el = this.els().find((e) => e.id === elId)
    return el ? textOf(el) : ''
  }
}

export function viewLabel(v: View): string {
  return { front: 'Front', 'three-quarter': '3/4', side: 'Side', back: 'Back' }[v]
}
