// The Character stage's logic over the Excalidraw API: picture intake (downscale,
// hash, tag), refs ↔ document sync, Generate / Combine / views, and landing
// results on the canvas. The React component only renders overlays and calls in.

import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'
import type { CharacterRef, CustomData, Job, JobInputRef, ProductionDocument, RefRole, View } from '../contracts/types'
import type { Services } from '../app/context'
import { getBlob, idbLocation, putBlob, putBlobAs } from '../lib/blobs'
import { idbPut } from '../lib/idb'
import { badgeFor, uniqueTag } from '../lib/tags'
import { newId } from '../lib/ulid'
import { updateDoc } from '../doc/store'
import { assetRef } from '../jobs/assets'
import {
  alive, bindArrow, bounds, byOwnId, cd, childrenOf, dataURLToBlob, downscale, exportElements, fileData, fileIdFor,
  isUserDrawing, makeArrow, makeGenPlaceholder, nextSlot, sketchFrame, type El,
} from './scene'

export const CANVAS_KEY = 'canvas'

export interface CanvasSnapshot {
  elements: El[]
  files: BinaryFiles
}

export class CanvasController {
  readonly api: ExcalidrawImperativeAPI
  private readonly s: Services
  private readonly processing = new Set<string>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null

  constructor(api: ExcalidrawImperativeAPI, services: Services) {
    this.api = api
    this.s = services
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
    await idbPut('kv', CANVAS_KEY, { elements, files } satisfies CanvasSnapshot)
  }

  /** Called on every scene change (throttled by the component). */
  onChange() {
    this.scheduleSave()
    void this.intakePictures()
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => this.syncRefs(), 250)
  }

  ensureSketchFrame(): El | undefined {
    return sketchFrame(this.els())
  }

  // ── pictures: downscale ≤1536 px, hash, tag ──

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
        const doc = this.s.doc.get()
        const tag = uniqueTag(`ref_${doc.character.refs.length + 1}`, doc.character.refs.map((r) => r.tag))
        const refId = newId('ref')
        const badge = badgeFor(this.nextBadgeIndex())
        const customData: CustomData = { kind: 'ref', id: refId, asset: sha, tag, role: 'other', badge }
        this.patchEl(el.id, (e) => newElementWith(e as ExcalidrawImageElement, { fileId, status: 'saved', customData }), true)
        updateDoc(this.s.doc, (d) => {
          if (!d.assets.some((a) => a.sha256 === sha)) {
            d.assets.push({ sha256: sha, kind: 'image', mime: blob.type || 'image/png', bytes: blob.size, w, h, origin: 'uploaded', locations: [idbLocation(sha)] })
          }
        }, 'add picture')
        this.syncRefs()
      } catch (e) {
        console.warn('Could not take in a picture', e)
      }
    }
  }

  private nextBadgeIndex(): number {
    const used = alive(this.els()).map((e) => cd(e)).filter((c) => c?.kind === 'ref').length
    return used
  }

  /** The canvas is the source for refs: mirror their customData into document.character.refs. */
  syncRefs() {
    const onCanvas = alive(this.els())
      .map((e) => ({ e, c: cd(e) }))
      .filter((x): x is { e: El; c: Extract<CustomData, { kind: 'ref' }> } => x.c?.kind === 'ref')
    const doc = this.s.doc.get()
    const next: CharacterRef[] = onCanvas.map(({ e, c }) => {
      const prev = doc.character.refs.find((r) => r.id === c.id)
      const ref: CharacterRef = { id: c.id, asset: c.asset, tag: c.tag, role: c.role, kind: e.type === 'frame' ? 'sketch' : 'picture' }
      if (prev?.label) ref.label = prev.label
      return ref
    })
    if (JSON.stringify(next) !== JSON.stringify(doc.character.refs)) {
      updateDoc(this.s.doc, (d) => {
        d.character.refs = next
      }, 'sync refs')
    }
  }

  setRefTag(elId: string, label: string) {
    const el = this.els().find((e) => e.id === elId)
    const c = cd(el)
    if (!el || c?.kind !== 'ref') return
    const taken = this.s.doc.get().character.refs.filter((r) => r.id !== c.id).map((r) => r.tag)
    const tag = uniqueTag(label, taken, c.tag)
    this.patchEl(elId, (e) => newElementWith(e, { customData: { ...c, tag } }), true)
    updateDoc(this.s.doc, (d) => {
      const r = d.character.refs.find((x) => x.id === c.id)
      if (r) {
        r.tag = tag
        r.label = label.slice(0, 60)
      }
    }, 'tag')
    this.syncRefs()
  }

  setRefRole(elId: string, role: RefRole) {
    const el = this.els().find((e) => e.id === elId)
    const c = cd(el)
    if (!el || c?.kind !== 'ref') return
    this.patchEl(elId, (e) => newElementWith(e, { customData: { ...c, role } }), true)
    this.syncRefs()
  }

  removeRef(elId: string) {
    const el = this.els().find((e) => e.id === elId)
    const c = cd(el)
    if (!el || c?.kind !== 'ref') return
    if (el.type === 'frame') {
      // A drawing ref: keep the strokes, drop the frame around them.
      this.setEls(this.els().map((e) => (e.id === elId ? newElementWith(e, { isDeleted: true }) : e.frameId === elId ? newElementWith(e, { frameId: null }) : e)))
    } else {
      this.patchEl(elId, (e) => newElementWith(e, { customData: undefined }), true)
      this.processing.add(elId) // don't take it back in as a new picture
    }
    this.syncRefs()
  }

  /** Wrap the user's selected strokes in a frame and make that a reference. */
  async drawingToRef(ids: string[]) {
    const els = this.els()
    const strokes = els.filter((e) => ids.includes(e.id) && isUserDrawing(e))
    if (!strokes.length) return
    const b = bounds(strokes)
    const pad = 16
    const refId = newId('ref')
    const blob = (await downscale(await exportElements(strokes, this.api.getFiles()))).blob
    const sha = await putBlob(blob)
    const doc = this.s.doc.get()
    const tag = uniqueTag(`drawing_${doc.character.refs.length + 1}`, doc.character.refs.map((r) => r.tag))
    const [frame] = convertToExcalidrawElements(
      [{ type: 'frame', x: b.minX - pad, y: b.minY - pad, width: b.w + pad * 2, height: b.h + pad * 2, name: '', children: [], customData: { kind: 'ref', id: refId, asset: sha, tag, role: 'shape', badge: badgeFor(this.nextBadgeIndex()) } }],
    )
    const next = els.map((e) => (ids.includes(e.id) ? newElementWith(e, { frameId: frame.id }) : e))
    // Frames sit below their children.
    this.setEls([frame, ...next])
    updateDoc(this.s.doc, (d) => {
      if (!d.assets.some((a) => a.sha256 === sha)) d.assets.push({ sha256: sha, kind: 'image', mime: 'image/png', bytes: blob.size, origin: 'drawn', locations: [idbLocation(sha)] })
    })
    this.syncRefs()
    this.api.updateScene({ appState: { selectedElementIds: { [frame.id]: true } } })
  }

  /** Re-export drawing refs whose strokes changed, so their asset is current. */
  private async refreshDrawingRefs() {
    const els = this.els()
    for (const f of alive(els).filter((e) => e.type === 'frame' && cd(e)?.kind === 'ref')) {
      const c = cd(f) as Extract<CustomData, { kind: 'ref' }>
      const kids = childrenOf(els, f.id)
      if (!kids.length) continue
      const blob = (await downscale(await exportElements(kids, this.api.getFiles()))).blob
      const sha = await putBlob(blob)
      if (sha !== c.asset) {
        this.patchEl(f.id, (e) => newElementWith(e, { customData: { ...c, asset: sha } }))
        updateDoc(this.s.doc, (d) => {
          if (!d.assets.some((a) => a.sha256 === sha)) d.assets.push({ sha256: sha, kind: 'image', mime: 'image/png', bytes: blob.size, origin: 'drawn', locations: [idbLocation(sha)] })
        })
      }
    }
    this.syncRefs()
  }

  private async inputRefs(only?: string[]): Promise<JobInputRef[]> {
    const refs = this.s.doc.get().character.refs.filter((r) => !only || only.includes(r.id))
    const out: JobInputRef[] = []
    for (const r of refs) out.push({ id: r.id, tag: r.tag, role: r.role, asset: await assetRef(this.s.relay, r.asset) })
    return out
  }

  // ── jobs that land on the canvas ──

  private placeGen(jobId: string, op: 'generate' | 'combine' | 'view', parentIds: string[], sources: { el: El; id: string }[], at: { x: number; y: number; w: number; h: number }, view?: View) {
    const gen = makeGenPlaceholder(jobId, op, parentIds, at, { w: at.w, h: at.h }, view)
    let els = [...this.els(), gen]
    for (const s of sources) {
      const arrow = makeArrow(s.el, gen, s.id, jobId)
      els = bindArrow([...els, arrow], arrow)
    }
    this.setEls(els)
  }

  /** Generate front view from the sketch frame and every reference on the canvas. */
  async generateFront(moreOptions = false) {
    await this.refreshDrawingRefs()
    const els = this.els()
    const frame = sketchFrame(els)
    if (!frame) throw new Error('The sketch frame is missing.')
    const kids = childrenOf(els, frame.id)
    const refs = await this.inputRefs()
    let sketch
    if (kids.length) {
      const blob = (await downscale(await exportElements(kids, this.api.getFiles()))).blob
      const sha = await putBlob(blob)
      updateDoc(this.s.doc, (d) => {
        if (!d.assets.some((a) => a.sha256 === sha)) d.assets.push({ sha256: sha, kind: 'image', mime: 'image/png', bytes: blob.size, origin: 'drawn', locations: [idbLocation(sha)] })
      })
      sketch = await assetRef(this.s.relay, sha)
    }
    if (!sketch && !refs.length) throw new Error('Draw in the frame or add a picture first.')
    const fb = bounds([frame])
    const jobId = newId('job')
    const at = nextSlot(els, fb, { w: 300, h: 400 })
    const refEls = alive(els).filter((e) => cd(e)?.kind === 'ref')
    this.placeGen(jobId, 'generate', [], [{ el: frame, id: (cd(frame) as { id: string }).id }, ...refEls.map((e) => ({ el: e, id: (cd(e) as { id: string }).id }))], at)
    // "More options" (flag moreOptions) asks the director for 4 variants; v1 has no
    // input field for it, so it travels as a chip.
    const input = { sketch, refs, ratio: '4:5' as const, ...(moreOptions ? { chips: ['more_options'] } : {}) }
    await this.s.runner.submit('generate', input, [], { for: 'canvas' }, jobId)
  }

  /** The items a Combine would use, with the @tag each is called by (gens get gen_1, gen_2…). */
  combineItems(elIds: string[]): { el: El; id: string; tag: string; role: RefRole; asset: string; isGen: boolean }[] {
    const els = this.els()
    const taken = this.s.doc.get().character.refs.map((r) => r.tag)
    const out: { el: El; id: string; tag: string; role: RefRole; asset: string; isGen: boolean }[] = []
    let n = 0
    for (const id of elIds) {
      const el = els.find((e) => e.id === id && !e.isDeleted)
      const c = cd(el)
      if (!el) continue
      if (c?.kind === 'ref') out.push({ el, id: c.id, tag: c.tag, role: c.role, asset: c.asset, isGen: false })
      else if (c?.kind === 'gen' && c.asset) {
        const tag = uniqueTag(`gen_${++n}`, [...taken, ...out.map((o) => o.tag)])
        out.push({ el, id: c.id, tag, role: 'character', asset: c.asset, isGen: true })
      }
    }
    return out
  }

  /** Combine 2-4 selected items with one instruction. */
  async combine(elIds: string[], text: string) {
    await this.refreshDrawingRefs()
    const els = this.els()
    const items = this.combineItems(elIds)
    const refs: JobInputRef[] = []
    for (const it of items) refs.push({ id: it.id, tag: it.tag, role: it.role, asset: await assetRef(this.s.relay, it.asset) })
    const parentIds = items.filter((i) => i.isGen).map((i) => i.id)
    const sources = items.map((i) => ({ el: i.el, id: i.id }))
    if (refs.length < 2 || refs.length > 4) throw new Error('Pick 2 to 4 pictures to combine.')
    const jobId = newId('job')
    const at = nextSlot(els, bounds(items.map((i) => i.el)), { w: 300, h: 400 })
    this.placeGen(jobId, 'combine', parentIds, sources, at)
    updateDoc(this.s.doc, (d) => {
      d.character.combines ??= []
      d.character.combines.push({ id: newId('combine'), sources: sources.map((s) => s.id), text: text.slice(0, 1000), job_id: jobId })
    })
    await this.s.runner.submit('combine', { text, refs, ratio: '4:5' }, parentIds, { for: 'canvas' }, jobId)
  }

  /** The 3/4, side and back views from the chosen front. */
  async makeViews(views: View[] = ['three_quarter', 'side', 'back']) {
    const doc = this.s.doc.get()
    const front = doc.character.views.front
    if (!front) throw new Error('Pick a front view first.')
    const els = this.els()
    const frontEl = byOwnId(els, front.job_id)
    const anchor = frontEl ? bounds([frontEl]) : { maxX: 1200, minY: 0, minX: 900, maxY: 400, w: 300, h: 400 }
    const frontRef = await assetRef(this.s.relay, front.asset)
    const refs = await this.inputRefs()
    // A row to the right of the front, clear of anything already there.
    const slot = nextSlot(els, anchor, { w: 300 * 3 + 80, h: 400 })
    let x = slot.x
    const y = slot.y
    const placed: { jobId: string; view: View }[] = []
    for (const view of views) {
      const jobId = newId('job')
      const at = { x, y, w: 300, h: 400 }
      x += 340
      const gen = makeGenPlaceholder(jobId, 'view', [front.job_id], at, { w: 300, h: 400 }, view)
      let all = [...this.els(), gen]
      if (frontEl) {
        const arrow = makeArrow(frontEl, gen, front.job_id, jobId)
        all = bindArrow([...all, arrow], arrow)
      }
      this.setEls(all)
      placed.push({ jobId, view })
    }
    for (const p of placed) {
      await this.s.runner.submit('view', { character: { front: frontRef }, view: p.view, refs }, [front.job_id], { for: 'canvas' }, p.jobId)
    }
  }

  /** Put a generated image into a view slot. */
  pickView(jobId: string, view: View) {
    const els = this.els()
    const el = byOwnId(els, jobId)
    const c = cd(el)
    if (!el || c?.kind !== 'gen' || !c.asset) return
    const doc = this.s.doc.get()
    const previous = doc.character.views[view]
    this.setEls(els.map((e) => {
      const x = cd(e)
      if (x?.kind !== 'gen') return e
      if (e.id === el.id) return newElementWith(e, { customData: { ...x, pickedAs: view } })
      if (x.pickedAs === view) {
        const { pickedAs: _p, ...rest } = x
        return newElementWith(e, { customData: rest })
      }
      return e
    }))
    updateDoc(this.s.doc, (d) => {
      d.character.views[view] = { asset: c.asset!, job_id: jobId, picked_at: new Date().toISOString() }
      if (d.character.locked && previous && previous.asset !== c.asset) {
        d.stale ??= []
        for (const f of d.frames ?? []) {
          if (f.selected) d.stale.push({ target: { kind: 'frame', id: f.id }, caused_by: { kind: 'view', id: view }, reason: `The ${view.replace('_', ' ')} view changed.`, marked_at: new Date().toISOString() })
        }
      }
    }, `pick ${view}`)
  }

  /** A failed canvas job was retried as a new job: move the node and its arrows to the new id. */
  retarget(oldId: string, newJobId: string) {
    const els = this.els()
    const old = byOwnId(els, oldId)
    if (!old) return
    const c = cd(old) as Extract<CustomData, { kind: 'gen' }>
    const gen = makeGenPlaceholder(newJobId, c.op, c.parentIds, { x: old.x, y: old.y }, { w: old.width, h: old.height }, c.view)
    let next: El[] = els.map((e) => (e.id === old.id ? newElementWith(e, { isDeleted: true }) : e))
    next.push(gen)
    for (const a of els.filter((e) => !e.isDeleted && cd(e)?.kind === 'provenance' && (cd(e) as { to: string }).to === oldId)) {
      const from = (cd(a) as { from: string }).from
      const fromEl = byOwnId(els, from)
      next = next.map((e) => (e.id === a.id ? newElementWith(e, { isDeleted: true }) : e))
      if (fromEl) {
        const arrow = makeArrow(fromEl, gen, from, newJobId)
        next = bindArrow([...next, arrow], arrow)
      }
    }
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

  /** A canvas job finished: put the image in its node, size it, and fill an empty view slot. */
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
    const doc = this.s.doc.get()
    if (c.op === 'view' && c.view && !doc.character.views[c.view]) this.pickView(job.jobId, c.view)
    if ((c.op === 'generate' || c.op === 'combine') && !doc.character.views.front) this.pickView(job.jobId, 'front')
  }

  scrollTo(id: string) {
    const el = byOwnId(this.els(), id)
    if (el) this.api.scrollToContent(el, { animate: true, fitToViewport: true, viewportZoomFactor: 0.5 })
  }
}

export function viewLabel(v: View): string {
  return { front: 'Front', three_quarter: '3/4', side: 'Side', back: 'Back', side_2: 'Side 2' }[v]
}
