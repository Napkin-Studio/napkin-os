// What every piece of media is called when it leaves the tool (features/media-download.clan):
// one list, so a single Download and Download all media give the same file the same name.
//
//   pictures/<project>-maya_front.png        a named picture (its key_variant)
//   pictures/<project>-maya-side.png         a turnaround view whose name was taken
//   pictures/<project>-picture-3.png         any other picture, numbered in the document's order
//   storyboard/<project>-shot3-frame-v2.png  every version of every frame (shots numbered by rank)
//   clips/<project>-shot3-clip-v1.mp4        every version of every clip (its version as the Bin numbers it)
//   ad/<project>-ad.mp4                      the ad's render (ad-v1, ad-v2… when there are several)
//   ad/<project>-ad-6s-9x16.mp4              each made size of the film (its length and shape; -v2… when two match)
//
// A document can hold several films (one per Territories route), each its own video, storyboard, takes and renders.
// The first made keeps the names above; each later one, numbered in the order they were made, starts its names with
// film2-, film3-… (<project>-film2-shot1-frame-v1.png, <project>-film2-ad.mp4, <project>-film2-ad-6s-9x16.mp4). A
// storyboard no video renders comes after them, numbered the same way.
//
// The extension comes from the asset's mime. Drawings the canvas turns into pictures are left out
// unless they are named: one is made each time the strokes change.

import type { CustomData, Id, Key, ProductionDocument, Render, Sha256, Shot, Size, View } from '../contracts/types'
import { extFor } from '../lib/hash'
import { nameOf } from '../lib/names'
import { assetsList, framesOf, mainStoryboard, refsList, rendersOf, shotsOf, storyboardOfVideo, takesOf, takeVersion } from '../model/selectors'

export type MediaKind = 'picture' | 'view' | 'frame' | 'clip' | 'ad' | 'cutdown'
export type MediaFolder = 'pictures' | 'storyboard' | 'clips' | 'ad'

export interface MediaItem {
  kind: MediaKind
  sha256: Sha256
  mime: string
  /** The file's name, the same in a single download and in the zip. */
  name: string
  folder: MediaFolder
  /** What the beta record names it by: a ref name, a frame, take or render id, the asset. Never bytes. */
  which: string
}

/** A turnaround view on the canvas: its picture, and the key and view it was made for. */
export interface ViewOf { key: Key; view: View }

const UNSAFE = /[/\\:*?"<>|.]/g
const MAX_PROJECT = 40

/** A project's name as the start of a file name: no / \ : * ? " < > | . or control characters (dots: the owner, 2026-10-09), spaces as one hyphen, at most 40 characters. */
export function fileSafe(project: string | undefined): string {
  const printable = [...(project ?? '')].map((ch) => (ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f ? ch : ' ')).join('')
  const s = printable.replace(UNSAFE, '').trim().replace(/\s+/g, '-').replace(/-{2,}/g, '-')
  return s.slice(0, MAX_PROJECT).replace(/^[-.\s]+|[-.\s]+$/g, '') || 'napkin'
}

/** The views on a canvas, by picture: a finished view result whose source is named. */
export function viewsOnCanvas(doc: ProductionDocument, elements: readonly { customData?: unknown; isDeleted?: boolean }[]): Map<Sha256, ViewOf> {
  const out = new Map<Sha256, ViewOf>()
  for (const e of elements) {
    const c = e.customData as CustomData | undefined
    if (e.isDeleted || c?.kind !== 'gen' || c.op !== 'view' || !c.view || !c.asset) continue
    const key = refsList(doc).find((r) => r.node === c.parentIds[0])?.key
    if (key) out.set(c.asset, { key, view: c.view })
  }
  return out
}

/** Every piece of media in the document, named, in the zip's order. */
export function mediaItems(doc: ProductionDocument, project: string | undefined, views: Map<Sha256, ViewOf> = new Map()): MediaItem[] {
  const p = fileSafe(project)
  const mimeOf = (sha: Sha256) => doc.assets[sha]?.mime ?? 'image/png'
  const file = (base: string, sha: Sha256) => `${p}-${base}.${extFor(mimeOf(sha))}`
  const out: MediaItem[] = []
  const taken = new Set<Sha256>()
  const films = filmsOf(doc)
  const elsewhere = new Set<Sha256>([
    ...Object.values(doc.frames).map((f) => f.asset), ...Object.values(doc.generations).map((g) => g.asset).filter((a): a is Sha256 => !!a),
    ...Object.values(doc.renders).map((r) => r.asset), ...Object.values(doc.exports).map((e) => e.asset),
  ])

  // Pictures: the named ones, then views, then the rest.
  for (const r of refsList(doc)) {
    if (!r.asset || taken.has(r.asset)) continue
    taken.add(r.asset)
    out.push({ kind: 'picture', sha256: r.asset, mime: mimeOf(r.asset), name: file(nameOf(r), r.asset), folder: 'pictures', which: nameOf(r) })
  }
  const unnamed = assetsList(doc).filter((a) => a.kind === 'image' && a.origin !== 'drawn' && !taken.has(a.sha256) && !elsewhere.has(a.sha256))
  let n = 0
  for (const a of unnamed) {
    const v = views.get(a.sha256)
    const base = v ? `${v.key}-${v.view}` : `picture-${++n}`
    taken.add(a.sha256)
    out.push({ kind: v ? 'view' : 'picture', sha256: a.sha256, mime: a.mime, name: file(base, a.sha256), folder: 'pictures', which: v ? `${v.key}_${v.view}` : a.sha256 })
  }
  // A canvas picture's versions from the Image editor (v1 as it was, v2, v3…), each a file of its own, named after
  // the picture: they were left out, so the versions menu and a result's bar had no Download (UAT round 1 IMG-16).
  const versions = Object.values(doc.frames).filter((f) => !f.shot_id && !!f.node && !taken.has(f.asset))
    .sort((a, b) => (a.node! < b.node! ? -1 : a.node! > b.node! ? 1 : a.version - b.version))
  const pictureNo = new Map<string, number>()
  for (const f of versions) {
    if (taken.has(f.asset)) continue
    const r = refsList(doc).find((x) => x.node === f.node)
    if (!r && !pictureNo.has(f.node!)) pictureNo.set(f.node!, ++n)
    taken.add(f.asset)
    out.push({ kind: 'picture', sha256: f.asset, mime: mimeOf(f.asset), name: file(`${r ? nameOf(r) : `picture-${pictureNo.get(f.node!)}`}-v${f.version}`, f.asset), folder: 'pictures', which: f.id })
  }

  // A result made from a sketch area (a frame with sketch_id, no shot, no node yet) is a picture too: before an Apply
  // gave it a node it had no file, so its bar had no Download (UAT round 2, IMG-16 leftover).
  const sketchNo = new Map<string, number>()
  for (const f of Object.values(doc.frames).filter((x) => !x.shot_id && !x.node && !taken.has(x.asset)).sort((a, b) => a.id < b.id ? -1 : 1)) {
    const key = f.sketch_id ?? f.id
    if (!sketchNo.has(key)) sketchNo.set(key, sketchNo.size + 1)
    taken.add(f.asset)
    out.push({ kind: 'picture', sha256: f.asset, mime: mimeOf(f.asset), name: file(`sketch-${sketchNo.get(key)}-v${f.version}`, f.asset), folder: 'pictures', which: f.id })
  }

  // Storyboard frames and clips, every version, by shot (numbered by rank), film by film: only the first film's were
  // listed, so a later route's video had no Download for its render (live 3-route run, 2026-11-26).
  for (const { prefix, shots } of films) {
    shots.forEach((s, i) => {
      for (const f of framesOf(doc, s.id)) {
        out.push({ kind: 'frame', sha256: f.asset, mime: mimeOf(f.asset), name: file(`${prefix}shot${i + 1}-frame-v${f.version}`, f.asset), folder: 'storyboard', which: f.id })
      }
    })
  }
  // A take of several shots (joined) is one file, named for its shots, once (UAT 2026-11-21, F15: the zip held each
  // joined take twice, once under each shot).
  const clipped = new Set<string>()
  for (const { prefix, shots } of films) {
    const numberOf = new Map(shots.map((s, i) => [s.id, i + 1]))
    shots.forEach((s, i) => {
      for (const t of takesOf(doc, s.id)) {
        if (!t.asset || clipped.has(t.id)) continue
        clipped.add(t.id)
        // Its one version number, the Bin's (UAT round 3, F15: the zip said shot1-clip-v2 for the Bin's "Box 1 · v1").
        const v = takeVersion(doc, t.id)
        const ns = (t.shot_ids ?? []).map((id) => numberOf.get(id)).filter((n): n is number => !!n)
        const base = ns.length > 1 ? `shots${ns[0]}-${ns.at(-1)}-clip-v${v}` : `shot${i + 1}-clip-v${v}`
        out.push({ kind: 'clip', sha256: t.asset, mime: mimeOf(t.asset), name: file(`${prefix}${base}`, t.asset), folder: 'clips', which: t.id })
      }
    })
  }
  for (const { prefix, ads } of films) {
    for (const r of ads) {
      out.push({ kind: 'ad', sha256: r.asset, mime: mimeOf(r.asset), name: file(`${prefix}${ads.length > 1 ? `ad-v${r.version}` : 'ad'}`, r.asset), folder: 'ad', which: r.id })
    }
  }
  // The film's sizes (cutdowns and re-aspects), each made one by its length and shape, in the ad folder (UAT round 3,
  // R3-F12: they were missing from the zip). Two of the same length and shape (two sets) are -v2, -v3…
  const seen = new Map<string, number>()
  const sizes = Object.values(doc.sizes ?? {}).filter((z) => z.media === 'video' && !!z.asset && !taken.has(z.asset!))
    .sort((a, b) => ((a.length_s ?? 0) - (b.length_s ?? 0)) || (a.set_id < b.set_id ? -1 : a.set_id > b.set_id ? 1 : a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
  const prefixOf = new Map(films.filter((f) => f.video).map((f) => [f.video!, f.prefix]))
  for (const z of sizes) {
    taken.add(z.asset!)
    const base = [`${prefixOf.get(videoOfSize(doc, z) ?? '') ?? ''}ad`, z.length_s ? `${Math.round(z.length_s)}s` : '', shapeWord(z)].filter(Boolean).join('-')
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    const mime = doc.assets[z.asset!]?.mime ?? 'video/mp4'
    out.push({ kind: 'cutdown', sha256: z.asset!, mime, name: `${p}-${k > 1 ? `${base}-v${k}` : base}.${extFor(mime)}`, folder: 'ad', which: z.id })
  }
  return out
}

/** One film: its video (none for a storyboard no video renders), its shots, its renders and its names' start. */
interface Film { video?: Id; shots: Shot[]; ads: Render[]; prefix: string }

/** Every film, the first made first (ids are ULIDs): each video with its storyboard's shots and its renders, then each
 *  storyboard no video took (the main one first, so a document with no video names its shots as before). A storyboard
 *  two videos share is listed once, under the first. The first film's names have no prefix; the next are film2-, film3-… */
function filmsOf(doc: ProductionDocument): Film[] {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const used = new Set<Id>()
  const films: Omit<Film, 'prefix'>[] = []
  for (const v of Object.values(doc.videos ?? {}).sort(byId)) {
    const sb = storyboardOfVideo(doc, v.id)?.id
    const shots = sb && !used.has(sb) ? shotsOf(doc, sb) : []
    if (sb) used.add(sb)
    films.push({ video: v.id, shots, ads: rendersOf(doc, v.id) })
  }
  const main = mainStoryboard(doc)?.id
  const rest = [...new Set([...Object.keys(doc.storyboards ?? {}), ...Object.values(doc.shots ?? {}).map((s) => s.storyboard_id)])]
    .filter((id) => !!id && !used.has(id)).sort((a, b) => (a === main ? -1 : b === main ? 1 : a < b ? -1 : a > b ? 1 : 0))
  for (const sb of rest) {
    const shots = shotsOf(doc, sb)
    if (shots.length) films.push({ shots, ads: [] })
  }
  return films.map((f, i) => ({ ...f, prefix: i ? `film${i + 1}-` : '' }))
}

/** The video a size was made from: its set's master (a video, or one of its renders). */
function videoOfSize(doc: ProductionDocument, z: Pick<Size, 'set_id'>): Id | undefined {
  const m = doc.format_sets?.[z.set_id]?.master
  return m?.kind === 'video' ? m.id : m?.kind === 'render' ? doc.renders[m.id]?.video_id : undefined
}

/** A size's shape for its file name: its format's ("film-9x16" → 9x16), else its delivery's, reduced. */
function shapeWord(z: Pick<Size, 'format' | 'delivery'>): string {
  const named = /(\d+x\d+)$/.exec(z.format?.format_id ?? '')?.[1]
  if (named) return named
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(z.delivery.width, z.delivery.height) || 1
  return `${z.delivery.width / g}x${z.delivery.height / g}`
}

/** The item for one asset (a picture, a frame version, a clip version or an ad). */
export function mediaItem(doc: ProductionDocument, project: string | undefined, sha: Sha256 | undefined, kind?: MediaKind, views?: Map<Sha256, ViewOf>): MediaItem | undefined {
  if (!sha) return undefined
  const all = mediaItems(doc, project, views)
  return all.find((m) => m.sha256 === sha && (!kind || m.kind === kind)) ?? all.find((m) => m.sha256 === sha)
}

/** The zip's name: `<project>-media.zip`. */
export function zipName(project: string | undefined): string {
  return `${fileSafe(project)}-media.zip`
}
