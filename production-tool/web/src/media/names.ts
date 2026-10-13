// What every piece of media is called when it leaves the tool (features/media-download.clan):
// one list, so a single Download and Download all media give the same file the same name.
//
//   pictures/<project>-maya_front.png        a named picture (its key_variant)
//   pictures/<project>-maya-side.png         a turnaround view whose name was taken
//   pictures/<project>-picture-3.png         any other picture, numbered in the document's order
//   storyboard/<project>-shot3-frame-v2.png  every version of every frame (shots numbered by rank)
//   clips/<project>-shot3-clip-v1.mp4        every version of every clip
//   ad/<project>-ad.mp4                      the ad's render (ad-v1, ad-v2… when there are several)
//
// The extension comes from the asset's mime. Drawings the canvas turns into pictures are left out
// unless they are named: one is made each time the strokes change.

import type { CustomData, Key, ProductionDocument, Sha256, View } from '../contracts/types'
import { extFor } from '../lib/hash'
import { nameOf } from '../lib/names'
import { assetsList, framesOf, refsList, rendersOf, shotsOf, takesOf } from '../model/selectors'

export type MediaKind = 'picture' | 'view' | 'frame' | 'clip' | 'ad'
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
  const shots = shotsOf(doc)
  const ads = rendersOf(doc)
  const elsewhere = new Set<Sha256>([
    ...Object.values(doc.frames).map((f) => f.asset), ...Object.values(doc.takes).map((t) => t.asset),
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

  // Storyboard frames and clips, every version, by shot (numbered by rank).
  shots.forEach((s, i) => {
    for (const f of framesOf(doc, s.id)) {
      out.push({ kind: 'frame', sha256: f.asset, mime: mimeOf(f.asset), name: file(`shot${i + 1}-frame-v${f.version}`, f.asset), folder: 'storyboard', which: f.id })
    }
  })
  shots.forEach((s, i) => {
    for (const t of takesOf(doc, s.id)) {
      out.push({ kind: 'clip', sha256: t.asset, mime: mimeOf(t.asset), name: file(`shot${i + 1}-clip-v${t.version}`, t.asset), folder: 'clips', which: t.id })
    }
  })
  for (const r of ads) {
    out.push({ kind: 'ad', sha256: r.asset, mime: mimeOf(r.asset), name: file(ads.length > 1 ? `ad-v${r.version}` : 'ad', r.asset), folder: 'ad', which: r.id })
  }
  return out
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
