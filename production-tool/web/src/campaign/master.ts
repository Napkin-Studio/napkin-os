// What a format set is made from (features/campaign-formats.clan): a picture on the canvas (a key
// visual, a frame drawn there), or the ad (a Video node and its current render). Where its picture is
// now, so a size made from another one is out of date ("Master changed · N out of date").

import type { FormatSet, ProductionDocument, Sha256 } from '../contracts/types'
import type { CanvasElement } from '../canvas/core/canvasAdapter'
import { getBlob } from '../lib/blobs'
import { currentRender, refsList } from '../model/selectors'
import { nameOf } from '../lib/names'

export interface MasterInfo {
  kind: FormatSet['master']['kind']
  id: string
  asset: Sha256
  w: number
  h: number
  media: 'image' | 'video'
  /** A film's length, for the row that is the ad itself. */
  length_s?: number
  /** How the board is titled: "@maya_hero", "Key visual", the video's title. */
  label: string
}

/** A canvas picture element's own id (its customData id) and asset, when it is a picture. */
export function pictureOf(el: CanvasElement | undefined): { id: string; asset: string } | null {
  const c = el?.customData as { kind?: string; id?: string; asset?: string } | undefined
  if (!el || el.isDeleted || !c || !['pic', 'gen', 'drawn'].includes(c.kind ?? '') || !c.id) return null
  const asset = c.asset ?? (el as CanvasElement & { assetSha?: string | null }).assetSha ?? undefined
  return asset ? { id: c.id, asset } : null
}

async function measure(doc: ProductionDocument, sha: string): Promise<{ w: number; h: number } | null> {
  const a = doc.assets[sha]
  if (a?.w && a?.h) return { w: a.w, h: a.h }
  const blob = await getBlob(sha)
  if (!blob || typeof createImageBitmap === 'undefined') return null
  const bmp = await createImageBitmap(blob)
  const out = { w: bmp.width, h: bmp.height }
  bmp.close?.()
  return out
}

/** The master for a selected picture: its asset and pixels, named as the board will be. */
export async function pictureMaster(doc: ProductionDocument, pic: { id: string; asset: string }): Promise<MasterInfo> {
  const dims = await measure(doc, pic.asset)
  if (!dims) throw new Error('This picture is not in this browser. Add it again.')
  const named = refsList(doc).find((r) => r.node === pic.id)
  return { kind: 'picture', id: pic.id, asset: pic.asset, ...dims, media: 'image', label: named ? `@${nameOf(named)}` : 'Key visual' }
}

/** The master for a Video node: its current render (the ad). Null when it has none yet. */
export function videoMaster(doc: ProductionDocument, videoId: string): MasterInfo | null {
  const v = doc.videos[videoId]
  const r = currentRender(doc, videoId)
  if (!v || !r) return null
  const a = doc.assets[r.asset]
  const [rw, rh] = v.ratio.split(':').map(Number)
  return { kind: 'video', id: videoId, asset: r.asset, w: a?.w ?? rw * 120, h: a?.h ?? rh * 120, media: 'video', length_s: a?.duration_s ?? v.target_s, label: v.title || 'The ad' }
}

/** The master's picture now: the element's (a picture), the video's current render, the ref's or the frame's. */
export function currentMasterAsset(doc: ProductionDocument, els: readonly CanvasElement[], set: FormatSet): Sha256 | undefined {
  const m = set.master
  switch (m.kind) {
    case 'picture': {
      const el = els.find((e) => pictureOf(e)?.id === m.id)
      return el ? pictureOf(el)!.asset : m.asset
    }
    case 'video': return currentRender(doc, m.id)?.asset ?? m.asset
    case 'ref': return doc.refs[m.id]?.asset ?? m.asset
    case 'render': return doc.renders[m.id]?.asset ?? m.asset
    case 'frame': {
      const f = doc.frames[m.id]
      const shot = f?.shot_id ? doc.shots[f.shot_id] : undefined
      const picked = shot?.pick?.current ? doc.frames[shot.pick.current] : undefined
      return picked?.asset ?? f?.asset ?? m.asset
    }
  }
}

/** The format sets made from this master, newest first. */
export function setsOf(doc: ProductionDocument, master: { kind: string; id: string }): FormatSet[] {
  return Object.values(doc.format_sets ?? {}).filter((s) => s.master.kind === master.kind && s.master.id === master.id).sort((a, b) => (a.id < b.id ? 1 : -1))
}
