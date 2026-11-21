// A film's lengths and shapes as jobs (features/campaign-formats.clan, phases 5 and 6): Dex's plan (a free
// cutdown job, step plan; the sheet shows it before anything renders), the Film lane's sizes on a Campaign
// board, each size's render (a free cutdown job, step render: stitch draws the windows, the crops, the
// type, the captions and the end card), and the paid per-shot reframes: Aleph 2's new edges (a cutdown
// job, step outpaint) and Remake for vertical (a clip job on a model that carries the shot's characters),
// each its own job with its own reservation and its cost in History, kept in format_sets[id].reframes.
//
// Writes: the board and the set are one person's step (as make.ts); a tile's beats, crop, captions and
// lock are each one undo step (updateDoc); a landing is the crew's (landUpdate), never an undo step.

import { newUlidId, rankBetween, ranksBetween } from '../../../clan-store/src'
import type { AssetRef, Aspect, Board, CutdownClip, CutdownInput, CutdownPlan, FormatSet, Id, InputMime, Job, JobInput, ModelChoice, PersonRef, ProductionDocument, PxBox, Size, SizeBeat, TypeLayer } from '../contracts/types'
import { boardsByRank } from '../canvas/boards/boards'
import type { CanvasElement } from '../canvas/core/canvasAdapter'
import { landUpdate, systemUpdate, updateDoc } from '../doc/store'
import type { JobCtx } from '../doc/ui'
import { assetRef } from '../jobs/assets'
import { landingWhy } from '../jobs/landing'
import { jobShot, refsFor } from '../jobs/select'
import { getBlob } from '../lib/blobs'
import { boardLayout } from './board'
import { checksFor } from './checks'
import { CARD_S, alephRatio, captionBox, captionLayers, cardLengths, cropKeys, edlFor, isSocialShape, masterShots, reframeKey, reframesOf, sameShape, shapeOf, type MasterShot } from './film'
import { endCardFrom, readCut } from '../rooms/timeline'
import { formatById, PACKS_VERSION } from './formats'
import { brandKit, layersFor } from './layout'
import { FRAME_PAD, FRAME_TOP, channelOfSize, placeBoard, sizesOf, type CampaignDeps } from './make'
import type { MasterInfo } from './master'
import { rowFracs } from './rules'
import { liveGet } from '../model/live'
import { briefLink, sizesBriefOf } from '../brief/model'

/** What a film's jobs need: no canvas (they land after a reload too). */
export type FilmDeps = Pick<CampaignDeps, 'doc' | 'runner' | 'relay'>

/** How a shot is made for a shape: cropped (free), new edges on Aleph 2, or remade at the shape. */
export type ShotMethod = 'crop' | 'outpaint' | 'remake'
export interface FilmRow { lengthS: number; shapeId: string; on: boolean }
export interface FilmRequest {
  master: MasterInfo
  shots: MasterShot[]
  plan: CutdownPlan
  /** Each length's beats as the person left them on the plan. */
  beats: Record<number, SizeBeat[]>
  rows: FilmRow[]
  /** Per shape, per shot: how it is made (absent: crop). */
  methods: Record<string, Record<Id, ShotMethod>>
  /** The model Remake for vertical runs on. */
  remake?: ModelChoice
  copy?: { line?: string; legal?: string }
  near?: CanvasElement
}

// ── Dex's plan ──────────────────────────────────────────────────────────────

/** A film's plan as the sheet shows it: `simple` when the Director agent did not plan it (the relay's simple cut: the
 *  opening and the payoff), 'failed' when it tried and could not (UAT round 4, R4-F4: the sheet said "how I would cut
 *  it" over a plan Dex never made). */
export type FilmPlan = CutdownPlan & { simple?: 'failed' | 'off' }

const waiting = new Map<string, { resolve(p: FilmPlan): void; reject(e: Error): void }>()

/** Who made a plan job's plan: the Director agent, or the relay's simple cut (failed: Dex tried and could not). */
export function planBy(job: Pick<Job, 'director'>): FilmPlan['simple'] {
  if (job.director?.model !== 'passthrough') return undefined
  return /^Dex could not plan/.test(job.director.rationale ?? '') ? 'failed' : 'off'
}

/** The plan job's landing (wire.ts): it lands nowhere; the sheet waiting for it gets it. */
export function landFilmPlan(job: Job) {
  const w = waiting.get(job.jobId)
  if (!w) return
  waiting.delete(job.jobId)
  const simple = planBy(job)
  if (job.cutdownPlan) w.resolve(simple ? { ...job.cutdownPlan, simple } : job.cutdownPlan)
  else w.reject(new Error('The Director agent sent no plan. Try again.'))
}

/** Up to three stills of a take's window (in, middle, out) as small JPEGs, for Claude to look at. Empty
 *  where this browser cannot read the video (the plan goes on without them). */
export async function takeStills(blob: Blob, times: number[], side = 512): Promise<Blob[]> {
  if (typeof document === 'undefined' || !blob.type.startsWith('video/')) return blob.type.startsWith('image/') ? [blob] : []
  const url = URL.createObjectURL(blob)
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = url
  const out: Blob[] = []
  try {
    await new Promise<void>((ok, no) => { v.onloadeddata = () => ok(); v.onerror = () => no(new Error('unreadable')); setTimeout(() => no(new Error('slow')), 8000) })
    for (const t of times) {
      await new Promise<void>((ok) => { v.onseeked = () => ok(); v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05)); setTimeout(ok, 3000) })
      const k = Math.min(1, side / Math.max(v.videoWidth, v.videoHeight))
      const c = document.createElement('canvas')
      c.width = Math.max(2, Math.round(v.videoWidth * k))
      c.height = Math.max(2, Math.round(v.videoHeight * k))
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85))
      if (b) out.push(b)
    }
  } catch {
    return out
  } finally {
    URL.revokeObjectURL(url)
    v.removeAttribute('src')
  }
  return out
}

/** Dex's plan of these lengths and shapes: a free job; resolves with the plan, or fails with its words. */
export async function planFilm(deps: FilmDeps, master: MasterInfo, shots: MasterShot[], lengths: number[], shapes: Aspect[], timeoutMs = 180_000): Promise<FilmPlan> {
  const wire = []
  let stills = 0
  for (const s of shots) {
    const { number: _n, frameAsset: _f, takeAsset, ...shot } = s
    void _n
    void _f
    const refs: AssetRef[] = []
    if (takeAsset && !s.endCard && stills < 36) {
      const blob = await getBlob(takeAsset)
      const mid = (s.inS + s.outS) / 2
      for (const b of blob ? await takeStills(blob, [s.inS + 0.05, mid, s.outS - 0.1]) : []) {
        try {
          const res = await deps.relay.upload(b, (b.type || 'image/jpeg') as InputMime)
          refs.push({ sha256: res.sha256, url: res.url, mime: (b.type || 'image/jpeg') as InputMime })
          stills++
        } catch { /* the plan goes on without this still */ }
      }
    }
    wire.push({ ...shot, ...(refs.length ? { stills: refs.slice(0, 3) } : {}) })
  }
  const others = shapes.filter((a) => !sameShape(a, master))
  const input: JobInput = {
    aspect: { w: master.w, h: master.h }, delivery: { width: master.w, height: master.h },
    cutdown: { step: 'plan', shots: wire, lengths, aspects: others },
  }
  const jobId = newUlidId('job')
  const plan = new Promise<FilmPlan>((resolve, reject) => {
    waiting.set(jobId, { resolve, reject })
    const started = Date.now()
    const watch = () => {
      if (!waiting.has(jobId)) return
      const live = deps.runner.liveInfo(jobId)
      if (live?.state === 'failed' || live?.state === 'cancelled' || live?.state === 'uncertain') {
        waiting.delete(jobId)
        reject(new Error(liveGet(deps.doc).jobs[jobId]?.error?.message ?? 'The Director agent could not plan the cuts. Try again.'))
        return
      }
      if (Date.now() - started > timeoutMs) {
        waiting.delete(jobId)
        reject(new Error('The Director agent took too long to plan. Try again.'))
        return
      }
      setTimeout(watch, 400)
    }
    setTimeout(watch, 400)
  })
  // The sizes' brief: one linked straight to a Format set of this film overrides the film's own (re-test N2).
  const linked = sizesBriefOf(liveGet(deps.doc), master.id)
  await deps.runner.submit('cutdown', input, [], { for: 'film_plan', videoId: master.id }, jobId, undefined,
    linked ? { briefFrom: { kind: 'format_set', id: linked.setId } } : {})
  return plan
}

// ── the sizes ───────────────────────────────────────────────────────────────

const FILM_FORMATS: Record<string, string> = { '16:9': 'film-16x9', '9:16': 'film-9x16', '4:5': 'film-4x5', '1:1': 'film-1x1' }
export const formatOfShape = (label: string) => FILM_FORMATS[label]

/** How long the line and legal hold at the end of a size's clips (UAT round 5, R5-F6: over the last 3 s of a 3.5 s
 *  cutdown they ran over the whole picture), the same as the ad's end-line super (rooms/endLine END_LINE_S). */
export const LINE_S = 2.5
/** The least the line holds when it waits for a caption to end. */
export const LINE_MIN_S = 1.5

/** The film layers of a size: the line and legal over the last 2.5 s of the clips, the logo over the first
 *  3 (the brand early), and the captions of the spoken lines on the social shapes (CF9) unless hidden;
 *  on the TV shapes only when a person turned them on. The line is never on screen with a caption (linesApart). */
export async function filmLayers(deps: Pick<CampaignDeps, 'relay' | 'doc'>, set: FormatSet, size: Size, card?: { headline?: string; line: string; cta?: string }): Promise<TypeLayer[]> {
  const d = liveGet(deps.doc)
  const body = (size.edl ?? []).reduce((a, w) => a + (w.out_s - w.in_s), 0)
  // The end card says its own words last, so they are not also laid over the picture. Taken out here, before the
  // captions are fitted around the line: the line once sat under a spoken caption's start, pushed the caption's end
  // before its start, and the caption went with it (UAT walkthrough 2026-11-21, R6-F1).
  const laid = withoutCardWords((await layersFor(deps, set, size)).map((l): TypeLayer => l.kind === 'logo'
    ? { ...l, fromS: 0, toS: Math.min(3, body) }
    : { ...l, fromS: Math.max(0, body - LINE_S), toS: body }), card)
  const want = size.layers?.captions
  const show = want ? !want.hidden : isSocialShape(shapeOf(size))
  if (!show) return laid
  const f = formatById(size.format.format_id)
  const fr = f ? rowFracs({ format: f.format }) : ([0, 0, 0, 0] as const)
  const caps = withoutRepeats(captionLayers(d, size.edl ?? [], want?.box ?? captionBox(fr), brandKit(d).colour, size.delivery.height), laid)
  const apart = linesApart(laid, caps, body)
  return [...apart.laid, ...apart.caps.map((c) => (want?.scale && c.sizeFrac ? { ...c, sizeFrac: Math.min(0.5, c.sizeFrac * want.scale) } : c))].slice(0, 40)
}

/** The line and legal never on screen with a caption (UAT round 5, R5-F6: "Quietboil. Let them sleep." sat under the
 *  "Good boy." caption). A caption that ends with LINE_MIN_S or more of the clips left: the line waits for it. Else the
 *  caption ends where the line starts (a caption that starts later than the line, with LINE_MIN_S of line before it:
 *  the line ends where it starts). The logo is left as it is. */
export function linesApart(laid: readonly TypeLayer[], caps: readonly TypeLayer[], body: number): { laid: TypeLayer[]; caps: TypeLayer[] } {
  const words = laid.map((l) => ({ ...l }))
  const out = caps.map((c) => ({ ...c }))
  for (const l of words) {
    if (l.kind === 'logo') continue
    for (const c of out) {
      const lf = l.fromS ?? 0
      const lt = l.toS ?? body
      const cf = c.fromS ?? 0
      const ct = c.toS ?? body
      if (ct <= lf || cf >= lt) continue
      if (body - ct >= LINE_MIN_S - 1e-6) l.fromS = Math.round(ct * 1000) / 1000
      else if (cf > lf && cf - lf >= LINE_MIN_S - 1e-6) l.toS = cf // a late caption: the line shows before it
      else if (cf <= lf) c.toS = lf // an early caption: it ends where the line starts
      else l.toS = l.fromS = lf // no room either side: the caption (the sound-off words) stays, the line is left out
    }
  }
  const room = (l: TypeLayer) => (l.toS ?? body) - (l.fromS ?? 0) > 0.05
  return { laid: words.filter((l) => l.kind === 'logo' || room(l)), caps: out.filter(room) }
}

const sameWords = (a?: string, b?: string) => {
  const n = (x?: string) => (x ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return !!n(a) && n(a) === n(b)
}

/** The captions, none saying the same words as a line or legal on screen at the same time (re-test N-G: the 1:1
 *  showed "Lumo. Calm, on." twice, as the spoken line's caption and as the words on every version). A caption
 *  that starts before the line ends where the line starts; one that starts under it goes. */
export function withoutRepeats(caps: TypeLayer[], laid: readonly TypeLayer[]): TypeLayer[] {
  const out: TypeLayer[] = []
  for (const c of caps) {
    let cap: TypeLayer | null = c
    for (const l of laid) {
      if (!cap || l.kind === 'logo' || !sameWords(cap.text, l.text)) continue
      const cf: number = cap.fromS ?? 0
      const ct: number = cap.toS ?? Infinity
      const lf: number = l.fromS ?? 0
      const lt: number = l.toS ?? Infinity
      if (ct <= lf || cf >= lt) continue
      cap = cf < lf - 0.25 ? { ...cap, toS: lf } : null
    }
    if (cap) out.push(cap)
  }
  return out
}

/** Make the film's sizes: the set, its sizes on the Film lane of a Campaign board, the paid reframes each
 *  as its own job, and a render of every size that waits for none. */
export async function makeFilmSizes(deps: CampaignDeps, req: FilmRequest, by: PersonRef): Promise<{ setId: string; el: CanvasElement }> {
  const { canvas, doc } = deps
  const d = doc.get()
  const rows = req.rows.filter((r) => r.on)
  if (!rows.length) throw new Error('Nothing to make: tick at least one length and shape.')
  const setId = newUlidId('fset')
  const lengths = [...new Set(rows.map((r) => r.lengthS))].sort((a, b) => b - a)
  const set: FormatSet = {
    id: setId, v: 1, field_v: {},
    master: { kind: 'video', id: req.master.id, asset: req.master.asset, w: req.master.w, h: req.master.h },
    pack: { pack_id: 'film', pack_version: PACKS_VERSION },
    plan: { kind: 'pack', id: 'film', lengths_s: lengths.map((x) => Math.round(x)).filter((x) => x >= 1).slice(0, 8) },
    ...(req.copy?.line?.trim() || req.copy?.legal?.trim() ? { copy: { ...(req.copy.line?.trim() ? { line: req.copy.line.trim() } : {}), ...(req.copy.legal?.trim() ? { legal: req.copy.legal.trim() } : {}) } } : {}),
  }
  // What must stay in each take, as Dex saw it: a new kept shot is cropped round it later.
  const takes: Record<Id, PxBox[]> = {}
  for (const c of req.plan.crops) {
    const s = req.shots.find((x) => x.shotId === c.shotId)
    if (s?.takeId && c.subject && !takes[s.takeId]) takes[s.takeId] = [{ ...c.subject }]
  }
  if (Object.keys(takes).length) set.protect = { generations: Object.fromEntries(Object.entries(takes).map(([k, v]) => [k, v.map((b) => ({ role: 'subject' as const, ...b }))])) }
  const ranks = ranksBetween(null, null, rows.length)
  const sizes: Size[] = []
  const reframes: NonNullable<FormatSet['reframes']> = {}
  for (const [i, r] of rows.entries()) {
    const f = formatById(r.shapeId)
    if (!f) continue
    const shape = { w: f.format.delivery_px.width, h: f.format.delivery_px.height }
    const beats = req.beats[r.lengthS] ?? []
    const { edl } = edlFor(req.shots, beats, r.lengthS, shape, req.plan.crops)
    const size: Size = {
      id: newUlidId('size'), v: 1, field_v: {}, set_id: setId, rank: ranks[i],
      format: { pack_id: 'film', pack_version: PACKS_VERSION, format_id: f.format.id },
      aspect: { ...shape }, delivery: { ...f.format.delivery_px },
      ...(f.format.safe_area ? { safe_area: structuredClone(f.format.safe_area) } : {}),
      method: sameShape(req.master, shape) ? 'reedit' : 'reframe', media: 'video', length_s: r.lengthS,
      edl, beats: beats.map((b) => ({ ...b })), status: 'making', from_asset: req.master.asset,
    }
    sizes.push(size)
    for (const w of edl) {
      const how = req.methods[r.shapeId]?.[w.shot_id]
      if (!w.generation_id || !how || how === 'crop' || sameShape(req.master, shape)) continue
      const key = reframeKey(w.generation_id, size.delivery)
      if (!reframes[key]) {
        reframes[key] = { generation_id: w.generation_id, shot_id: w.shot_id, aspect: { ...shape }, method: how, job_id: newUlidId('job'),
          ...(how === 'remake' && req.remake ? { model: req.remake.model } : how === 'outpaint' ? { model: 'aleph2' } : {}) }
      }
    }
  }
  if (Object.keys(reframes).length) set.reframes = reframes
  for (const s of sizes) s.checks = checksFor(s, set, d)
  const layout = boardLayout(sizes.map((s) => ({ id: s.id, channel: channelOfSize(s), aspect: { w: s.delivery.width, h: s.delivery.height } })))
  const last = boardsByRank(d).at(-1)
  const board: Board = { id: newUlidId('board'), v: 1, field_v: {}, title: `Campaign · ${req.master.label}`, purpose: 'formats', rank: rankBetween(last?.rank ?? null, null) }
  const box = placeBoard(canvas.elements(), req.near, layout.w + FRAME_PAD * 2, layout.h + FRAME_TOP + FRAME_PAD)
  const frame = canvas.board({ x: box.x, y: box.y, width: box.w, height: box.h, title: board.title, boardId: board.id, purpose: 'formats' })
  const el = canvas.patch(canvas.node({ x: box.x + FRAME_PAD, y: box.y + FRAME_TOP, width: layout.w, height: layout.h, customData: { kind: 'format_set', id: setId } }), { frameId: frame.id })
  canvas.transact((all) => [...all, frame, el], { undoable: true })
  // A brief linked straight to this film's sizes carries on to the new set, so its sizes and reframes read it
  // as the plan did (re-test N2: the Booth said "the sizes read this brief", and the new set never did).
  const linked = sizesBriefOf(d, req.master.id)
  await systemUpdate(doc, (x) => {
    x.boards[board.id] = board
    x.format_sets[setId] = set
    for (const s of sizes) x.sizes[s.id] = s
    if (linked) {
      const l = briefLink(linked.briefId, { kind: 'format_set', id: setId })
      x.links[l.id] = l
    }
  }, `make the film's sizes of ${req.master.label}: ${sizes.length} versions`)
  canvas.select([el.id])
  for (const [key, r] of Object.entries(reframes)) {
    void sendReframe(deps, setId, key, r.method === 'remake' ? req.remake : undefined, r.job_id).catch((e) => console.warn('the reframe was not sent', e))
  }
  for (const s of sizes) {
    if (reframesOf(set, s).every((x) => x.done)) void sendCutdown(deps, setId, s.id, by).catch((e) => console.warn('the cutdown was not sent', e))
  }
  return { setId, el }
}

/** A size's render input: its windows of the takes (a reframed shot's own clip where the set has one,
 *  filled from its middle), its crops, its type and captions, the end card and the mix's fade. */
export async function cutdownInput(deps: Pick<CampaignDeps, 'relay' | 'doc'>, set: FormatSet, size: Size): Promise<JobInput> {
  const d = liveGet(deps.doc)
  const clips: CutdownClip[] = []
  for (const w of size.edl ?? []) {
    const take = w.generation_id ? d.generations[w.generation_id] : undefined
    const r = w.generation_id ? set.reframes?.[reframeKey(w.generation_id, size.delivery)] : undefined
    if (r?.asset) {
      const len = w.out_s - w.in_s
      // An outpaint keeps the take's timing; a remake is a new clip, from its start.
      const [ins, outs] = r.method === 'outpaint' ? [w.in_s, w.out_s] : [0, len]
      clips.push({ asset: await assetRef(deps.relay, r.asset, d), inS: ins, outS: outs, ...(r.size ? { takeSize: { ...r.size } } : {}) })
      continue
    }
    if (!take?.asset) continue
    clips.push({
      asset: await assetRef(deps.relay, take.asset, d), inS: w.in_s, outS: w.out_s,
      ...(w.take_size ? { takeSize: { ...w.take_size } } : {}),
      ...(w.crop_keys?.length ? { cropKeys: w.crop_keys.map((k) => ({ at: k.at, box: { ...k.box } })) } : w.crop ? { crop: { ...w.crop } } : {}),
    })
  }
  if (!clips.length) throw new Error('This version keeps no shot: keep a beat first.')
  const clientCard = await clientCardOf(deps, set, size.length_s)
  // The film's card says its line: the size's own line goes from the picture, so it is not said twice (R3-F12).
  const layers = await filmLayers(deps, set, size, clientCard)
  const { studioS } = cardLengths(size.length_s, clientCard ? clientCardLen(d, set) : undefined, !!clientCard)
  return {
    aspect: { w: size.delivery.width, h: size.delivery.height }, delivery: { ...size.delivery },
    ...(size.safe_area ? { safeArea: size.safe_area } : {}),
    cutdown: {
      step: 'render', lengthS: size.length_s ?? clips.reduce((a, c) => a + (c.outS - c.inS), 0) + (clientCard?.s ?? 0) + studioS, clips, endCard: true, fadeOutS: 0.5,
      ...(studioS < CARD_S ? { studioS } : {}),
      ...(layers.length ? { layers } : {}), ...(clientCard ? { clientCard } : {}),
    },
  }
}

const words = (x?: string) => (x ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** A size's type without the words its end card says (its line, its headline and line together, or its call to
 *  action): the card says them last, so the picture does not say them too (UAT round 3, R3-F12: the 6 s 9:16 had
 *  "Quietboil. Let them sleep." burnt in as a super, then on the card). Logos and captions of what is spoken stay. */
export function withoutCardWords(layers: TypeLayer[], card?: { headline?: string; line: string; cta?: string }): TypeLayer[] {
  if (!card) return layers
  const said = [card.line, card.headline, card.cta, `${card.headline ?? ''} ${card.line}`, `${card.headline ?? ''} ${card.line} ${card.cta ?? ''}`].map(words).filter(Boolean)
  return layers.filter((l) => l.kind === 'logo' || l.kind === 'captions' || !said.includes(words(l.text)))
}

/** The film's own card's own length: its storyboard shot's, else the Edit room card's. */
function clientCardLen(d: ProductionDocument, set: FormatSet): number | undefined {
  const videoId = set.master.kind === 'video' ? set.master.id : undefined
  if (!videoId) return undefined
  const shot = masterShots(d, videoId).find((s) => s.endCard)
  return shot ? shot.outS - shot.inS : (readCut(d, videoId).endCard ?? endCardFrom(d, videoId))?.durS
}

/** The film's own end card (the client's) for a size: the Edit room's card, else the storyboard's end card shot's
 *  (rooms/timeline endCardFrom), at its cutdown length (film.ts clientCardS). Every size ends on it, then on the
 *  studio card (owner 2026-11-18; UAT 2026-11-21, B4: the sizes ended on the studio card alone). */
export async function clientCardOf(deps: Pick<CampaignDeps, 'relay' | 'doc'>, set: FormatSet, lengthS?: number): Promise<CutdownInput['clientCard'] | undefined> {
  const d = liveGet(deps.doc)
  const videoId = set.master.kind === 'video' ? set.master.id : undefined
  if (!videoId) return undefined
  const card = readCut(d, videoId).endCard ?? endCardFrom(d, videoId)
  if (!card || !(card.line.trim() || card.headline.trim())) return undefined
  const logo = card.logo ? await assetRef(deps.relay, card.logo, d).catch(() => undefined) : undefined
  return {
    ...(card.headline.trim() ? { headline: card.headline.trim().slice(0, 120) } : {}), line: (card.line.trim() || card.headline.trim()).slice(0, 200),
    ...(card.cta?.trim() ? { cta: card.cta.trim().slice(0, 80) } : {}), bg: /^#[0-9a-f]{6}$/i.test(card.bg) ? card.bg : '#14161B',
    ...(logo ? { logo } : {}), s: cardLengths(lengthS, clientCardLen(d, set), true).clientS,
  }
}

/** Render one size (free): marked making, its job named on it. */
export async function sendCutdown(deps: FilmDeps, setId: string, sizeId: string, _by?: PersonRef): Promise<string | null> {
  const d = liveGet(deps.doc)
  const set = d.format_sets[setId]
  const size = d.sizes[sizeId]
  if (!set || !size || size.media !== 'video') return null
  const input = await cutdownInput(deps, set, size)
  const jobId = newUlidId('job')
  await systemUpdate(deps.doc, (x) => {
    const s = x.sizes[sizeId]
    if (!s) return
    s.job_id = jobId
    s.status = 'making'
  }, 'sync')
  await deps.runner.submit('cutdown', input, [], { for: 'size', setId, sizeId }, jobId)
  return jobId
}

/** A picture of the shot (its frame, else a still of its take) cropped to the size's shape round its crop
 *  (a remake's first frame), uploaded. */
async function croppedFrame(deps: Pick<CampaignDeps, 'relay'>, blob: Blob | undefined, crop: PxBox | undefined, take: Aspect | undefined, shape: Aspect): Promise<AssetRef | undefined> {
  if (!blob || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return undefined
  const bmp = await createImageBitmap(blob)
  const kx = take ? bmp.width / take.w : 1
  const ky = take ? bmp.height / take.h : 1
  const box = crop ? { x: crop.x * kx, y: crop.y * ky, w: crop.w * kx, h: crop.h * ky }
    : cropKeys({ w: bmp.width, h: bmp.height }, shape, []).keys[0].box
  const c = new OffscreenCanvas(Math.max(2, Math.round(box.w)), Math.max(2, Math.round(box.h)))
  c.getContext('2d')!.drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height)
  bmp.close?.()
  const png = await c.convertToBlob({ type: 'image/png' })
  const res = await deps.relay.upload(png, 'image/png')
  return { sha256: res.sha256, url: res.url, mime: 'image/png' }
}

/** Send one reframe of the set (paid): Aleph 2's new edges of the take (a cutdown job, step outpaint), or
 *  Remake for vertical (a clip job: the shot's frame cropped to the shape, its words and its characters,
 *  at the shape, on `remake`). The reframe names its job. */
export async function sendReframe(deps: FilmDeps, setId: string, key: string, remake?: ModelChoice, jobId = newUlidId('job')): Promise<string | null> {
  const d = liveGet(deps.doc)
  const set = d.format_sets[setId]
  const r = set?.reframes?.[key]
  if (!set || !r) return null
  const take = d.generations[r.generation_id]
  const shot = d.shots[r.shot_id]
  if (!take?.asset || !shot) return null
  const takeAsset = d.assets[take.asset]
  const takeSize = takeAsset?.w && takeAsset?.h ? { w: takeAsset.w, h: takeAsset.h } : undefined
  const seconds = Math.max(2, Math.min(30, takeAsset?.duration_s ?? take.duration_s ?? shot.duration_s))
  await systemUpdate(deps.doc, (x) => {
    const rf = x.format_sets[setId]?.reframes?.[key]
    if (!rf) return
    rf.job_id = jobId
    delete rf.asset
    if (r.method === 'remake' && remake) rf.model = remake.model
  }, 'sync')
  if (r.method === 'outpaint') {
    const input: JobInput = {
      aspect: { ...r.aspect }, delivery: { width: r.aspect.w, height: r.aspect.h },
      cutdown: { step: 'outpaint', lengthS: seconds, targetRatio: alephRatio(r.aspect),
        clips: [{ asset: await assetRef(deps.relay, take.asset, d), inS: 0, outS: seconds, ...(takeSize ? { takeSize } : {}), outpaint: true }] },
    }
    await deps.runner.submit('cutdown', input, [take.job_id ?? ''].filter(Boolean), { for: 'reframe', setId, key }, jobId)
    return jobId
  }
  // Remake for vertical: the frame cropped round where the shot's crop sits at this shape.
  const any = Object.values(d.sizes).find((s) => s.set_id === setId && sameShape(shapeOf(s), r.aspect))
  const w = any?.edl?.find((x) => x.generation_id === r.generation_id)
  const frame = shot.pick?.current ? d.frames[shot.pick.current] : undefined
  // Its frame, else (a clip made straight from the script has none) a still from the middle of its window.
  let picture = frame ? await getBlob(frame.asset) : undefined
  if (!picture) {
    const clip = await getBlob(take.asset!)
    const mid = w ? (w.in_s + w.out_s) / 2 : seconds / 2
    picture = clip ? (await takeStills(clip, [mid], 1920))[0] : undefined
  }
  const image = await croppedFrame(deps, picture, w?.crop ?? w?.crop_keys?.[0]?.box, w?.take_size ?? takeSize, r.aspect)
  const refs = await refsFor(deps.relay, d, shot)
  const ratio = (['9:16', '1:1', '4:5', '16:9'] as const).find((x) => { const [a, b] = x.split(':').map(Number); return sameShape(r.aspect, { w: a, h: b }, 0.02) }) ?? '9:16'
  const input: JobInput = { shot: jobShot(d, shot), ...(image ? { image } : {}), ...(refs.length ? { refs } : {}), ratio }
  await deps.runner.submit('clip', input, [take.job_id ?? ''].filter(Boolean), { for: 'reframe', setId, key }, jobId, remake)
  return jobId
}

/** A reframe's clip landed (Wren's or Edie's): kept on the set, then every size of its shape that keeps the
 *  shot renders again (unless locked), once all its reframes are in. */
export async function landReframe(deps: FilmDeps, job: Job, ctx: Extract<JobCtx, { for: 'reframe' }>) {
  const out = job.outputs?.[0]
  const d = liveGet(deps.doc)
  const r = d.format_sets[ctx.setId]?.reframes?.[ctx.key]
  if (!out || !r || r.job_id !== job.jobId) return
  const what = `${r.method === 'outpaint' ? 'new edges' : 'a vertical remake'} of a shot at ${r.aspect.w}×${r.aspect.h}`
  await landUpdate(deps.doc, (x) => {
    const rf = x.format_sets[ctx.setId]?.reframes?.[ctx.key]
    if (!rf || rf.job_id !== job.jobId) return
    rf.asset = out.sha256
    if (out.w && out.h) rf.size = { w: out.w, h: out.h }
    if (job.model) rf.model = job.model
  }, landingWhy(deps.doc, job.jobId, what))
  const after = liveGet(deps.doc)
  const set = after.format_sets[ctx.setId]
  for (const s of sizesOf(after, ctx.setId)) {
    if (s.locked || s.media !== 'video' || !s.edl?.some((w) => w.generation_id === r.generation_id) || !sameShape(shapeOf(s), r.aspect)) continue
    if (reframesOf(set, s).every((x) => x.done)) void sendCutdown(deps, ctx.setId, s.id).catch((e) => console.warn('the cutdown was not sent', e))
  }
}

// ── per tile ────────────────────────────────────────────────────────────────

/** Keep or drop a beat on a film's tile (one undo step): the windows refit to its length, then it renders
 *  again, free. A newly kept shot is cropped round what Dex saw in its take. */
export async function setBeat(deps: FilmDeps, sizeId: string, shotId: Id, keep: boolean, by: PersonRef) {
  const d = liveGet(deps.doc)
  const size = d.sizes[sizeId]
  const set = size && d.format_sets[size.set_id]
  const video = set?.master.kind === 'video' ? set.master.id : undefined
  if (!size || !set || !video || !size.length_s) return
  const shots = masterShots(d, video)
  const beats = (size.beats?.length ? size.beats : shots.filter((s) => !s.endCard).map((s) => ({ shot_id: s.shotId, keep: !!size.edl?.some((w) => w.shot_id === s.shotId) })))
    .map((b) => (b.shot_id === shotId ? { ...b, keep, by: 'person' as const } : b))
  const shape = shapeOf(size)
  const crops: CutdownPlan['crops'] = []
  for (const s of shots) {
    if (!s.takeId || !s.takeSize) continue
    const old = size.edl?.find((w) => w.shot_id === s.shotId)
    if (old?.crop_keys?.length) crops.push({ shotId: s.shotId, aspect: shape, keys: old.crop_keys, cuts: false })
    else if (old?.crop) crops.push({ shotId: s.shotId, aspect: shape, keys: [{ at: 0, box: old.crop }], cuts: false })
    else crops.push({ shotId: s.shotId, aspect: shape, ...cropKeys(s.takeSize, shape, (set.protect?.generations?.[s.takeId] ?? []).map(({ x, y, w, h }) => ({ x, y, w, h }))) })
  }
  const { edl } = edlFor(shots, beats, size.length_s, shape, crops, size.edl)
  await updateDoc(deps.doc, (x) => {
    const s = x.sizes[sizeId]
    if (!s) return
    s.beats = beats
    s.edl = edl
    s.checks = checksFor(s, set, x)
  }, `${keep ? 'keep' : 'drop'} shots[${shotId}] in sizes[${sizeId}]`)
  await sendCutdown(deps, size.set_id, sizeId, by)
}

/** Adjust crop on a clip tile (one undo step): a person's still box for one shot, then it renders again. */
export async function setShotCrop(deps: FilmDeps, sizeId: string, shotId: Id, crop: PxBox | null, by: PersonRef) {
  const size = liveGet(deps.doc).sizes[sizeId]
  if (!size) return
  await updateDoc(deps.doc, (x) => {
    const s = x.sizes[sizeId]
    const w = s?.edl?.find((e) => e.shot_id === shotId)
    if (!w) return
    if (crop) {
      w.crop = { ...crop }
      delete w.crop_keys
      w.crop_by = 'person'
    } else w.crop_by = 'rule'
  }, `adjust the crop of shots[${shotId}] in sizes[${sizeId}]`)
  await sendCutdown(deps, size.set_id, sizeId, by)
}

/** Captions on a film's tile on or off (one undo step), then it renders again. */
export async function setCaptions(deps: FilmDeps, sizeId: string, on: boolean, by: PersonRef) {
  const size = liveGet(deps.doc).sizes[sizeId]
  if (!size) return
  await updateDoc(deps.doc, (x) => {
    const s = x.sizes[sizeId]
    if (!s) return
    s.layers = { ...s.layers, captions: { ...s.layers?.captions, hidden: !on } }
  }, `${on ? 'show' : 'hide'} the captions of sizes[${sizeId}]`)
  await sendCutdown(deps, size.set_id, sizeId, by)
}

/** Remake for vertical on a tile: each named shot made again at the tile's shape on `model` (paid, each its
 *  own job); the sizes of that shape render again as they land. */
export async function remakeShots(deps: FilmDeps, sizeId: string, shotIds: Id[], model: ModelChoice) {
  const d = liveGet(deps.doc)
  const size = d.sizes[sizeId]
  const set = size && d.format_sets[size.set_id]
  if (!size || !set) return []
  const shape = shapeOf(size)
  const keys: string[] = []
  await updateDoc(deps.doc, (x) => {
    const st = x.format_sets[size.set_id]
    if (!st) return
    st.reframes = st.reframes ?? {}
    for (const w of size.edl ?? []) {
      if (!w.generation_id || !shotIds.includes(w.shot_id)) continue
      const key = reframeKey(w.generation_id, size.delivery)
      st.reframes[key] = { generation_id: w.generation_id, shot_id: w.shot_id, aspect: { ...shape }, method: 'remake', job_id: newUlidId('job'), model: model.model }
      keys.push(key)
    }
    for (const s of Object.values(x.sizes)) if (s.set_id === size.set_id && sameShape(shapeOf(s), shape) && !s.locked && s.edl?.some((w) => shotIds.includes(w.shot_id))) s.status = 'making'
  }, `remake ${shotIds.length} shots of format_sets[${size.set_id}] for ${shape.w}x${shape.h}`)
  const st = liveGet(deps.doc).format_sets[size.set_id]
  return Promise.all(keys.map((k) => sendReframe(deps, size.set_id, k, model, st?.reframes?.[k]?.job_id)))
}
