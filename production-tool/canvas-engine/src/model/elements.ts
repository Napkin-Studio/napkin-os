// The element view of napkin/1 (features/engine-ink.clan): what the web app's
// adapter/own serves as CanvasElement (the Excalidraw-shaped fields the tool
// reads: type, width, frameId, containerId, points, status…), and the way back.
// The way back is the converter (src/import/excalidraw.ts) element by element,
// keeping each record's z key unless the element moved in the order.

import { convertExcalidraw, type ExcalidrawLike } from '../import/excalidraw'
import { localPoints } from './points'
import type { ElementRecord, Plain } from './records'
import { zBetween } from './z'

/** A record as the element the tool reads (ids, tags and geometry as they are). */
export function elementFromRecord(r: ElementRecord, pts?: Uint8Array): ExcalidrawLike & Record<string, unknown> {
  const base: ExcalidrawLike & Record<string, unknown> = {
    id: r.id, type: 'rectangle', x: r.x, y: r.y, width: r.w, height: r.h, angle: r.rotation, isDeleted: false,
    opacity: Math.round(r.opacity * 100), locked: r.locked, groupIds: [...r.groupIds], frameId: r.parentId,
    customData: r.customData ?? undefined, index: r.z,
    strokeColor: r.style.stroke ?? '#1e1e1e', backgroundColor: r.style.fill ?? 'transparent', strokeWidth: r.style.width ?? 2,
    strokeStyle: r.style.dash ?? 'solid', fillStyle: 'solid', roughness: 0,
  }
  const route = Array.isArray(r.props.route) ? (r.props.route as number[]) : []
  const binding = (b: Plain | undefined) => (b && typeof b === 'object' && !Array.isArray(b) && typeof b.elementId === 'string' ? { elementId: b.elementId } : null)
  switch (r.kind) {
    case 'stroke': {
      const local = pts ? localPoints(pts) : []
      return { ...base, type: 'freedraw', points: local.map((p) => [p.x, p.y]), pressures: local.map((p) => p.pressure), tool: r.props.tool ?? 'pen' }
    }
    case 'shape': {
      const geo = r.props.geo
      if (geo === 'line') return { ...base, type: 'line', points: [[0, 0], [r.w, r.h]] }
      return { ...base, type: geo === 'ellipse' || geo === 'diamond' ? geo : 'rectangle' }
    }
    case 'sketch':
    case 'node':
      return { ...base, type: 'rectangle' }
    case 'board':
    case 'frame':
      return { ...base, type: 'frame', name: typeof r.props.name === 'string' ? r.props.name : '' }
    case 'text': {
      const plain = typeof r.props.plain === 'string' ? r.props.plain : ''
      const boundTo = typeof r.props.boundTo === 'string' ? r.props.boundTo : null
      return { ...base, type: 'text', text: plain, originalText: plain, fontSize: r.style.fontSize ?? 20, textAlign: r.style.align ?? 'left', containerId: boundTo }
    }
    case 'image':
      return { ...base, type: 'image', status: typeof r.props.status === 'string' ? r.props.status : 'saved', assetSha: typeof r.props.assetSha === 'string' ? r.props.assetSha : null }
    case 'arrow':
    case 'link': {
      const points: number[][] = []
      for (let i = 0; i + 1 < route.length; i += 2) points.push([route[i], route[i + 1]])
      return {
        ...base, type: 'arrow', points, startBinding: binding(r.props.start), endBinding: binding(r.props.end),
        startArrowhead: r.style.arrowheadStart ?? null, endArrowhead: r.style.arrowheadEnd ?? null,
      }
    }
  }
}

/**
 * Elements (in paint order) back to records. Each keeps its record's z when it still sorts after
 * the one before it; a new or moved element gets a key between its neighbours, so only it is written.
 */
export function recordsFromElements(els: readonly ExcalidrawLike[], current: (id: string) => ElementRecord | undefined): { records: ElementRecord[]; points: Record<string, Uint8Array> } {
  const out = convertExcalidraw({ elements: els })
  const byId = new Map(els.map((e) => [e.id, e as ExcalidrawLike & { assetSha?: string | null; tool?: string }]))
  const recs = out.records
  // Keep the longest run of existing keys that is still in order; everything else gets a new key.
  const kept = stayingKeys(recs.map((r) => current(r.id)?.z ?? null))
  let last: string | null = null
  for (let i = 0; i < recs.length; i++) {
    const own = kept[i]
    let z: string
    if (own !== null && (last === null || own > last)) z = own
    else {
      let next: string | null = null
      for (let j = i + 1; j < recs.length; j++) {
        const k = kept[j]
        if (k !== null && (last === null || k > last)) {
          next = k
          break
        }
      }
      z = zBetween(last, next)
    }
    last = z
    const e = byId.get(recs[i].id)
    const props = { ...recs[i].props }
    // What the element knows beyond the Excalidraw fields: its picture and its ink tool.
    if (recs[i].kind === 'image' && typeof e?.assetSha === 'string') props.assetSha = e.assetSha
    if (recs[i].kind === 'stroke' && typeof e?.tool === 'string') props.tool = e.tool
    recs[i] = { ...recs[i], z, props }
  }
  return { records: recs, points: out.points }
}

/** The keys of the longest strictly increasing subsequence; the rest become null (they move). */
function stayingKeys(keys: (string | null)[]): (string | null)[] {
  const idx = keys.map((k, i) => (k === null ? -1 : i)).filter((i) => i >= 0)
  const tails: number[] = []
  const prev = new Map<number, number>()
  for (const i of idx) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keys[tails[mid]]! < keys[i]!) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev.set(i, tails[lo - 1])
    tails[lo] = i
  }
  const keep = new Set<number>()
  let at = tails.length ? tails[tails.length - 1] : undefined
  while (at !== undefined) {
    keep.add(at)
    at = prev.get(at)
  }
  return keys.map((k, i) => (keep.has(i) ? k : null))
}
