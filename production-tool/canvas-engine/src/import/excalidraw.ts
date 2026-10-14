// Excalidraw scenes to napkin/1 (features/engine-import.clan, under
// features/canvas-engine.clan). A pure JSON reader: it imports nothing from
// Excalidraw. Sources: canvas.excalidraw in an export zip, the browser copy under
// canvasKey, or ProjectCanvas from GET /clan/{id}/canvas, all {elements, files?}.
//
// Kept exactly: every id, every customData tag, the z-order (array order) and the
// geometry. frameId becomes parentId and containerId becomes the text's boundTo.
// Rough shapes are drawn clean and fonts become Geist; each kind of loss is one
// notice. Unknown types become a visible dashed placeholder. Deleted elements are
// dropped. The caller writes the records into the live store and the checkpoint;
// this never writes canvas.json, so the original stays as it was.

import { element, type ElementRecord, type Kind, type Plain, type Style, type Tag } from '../model/records'
import { encodePoints } from '../model/points'
import { zKeys } from '../model/z'

/** An Excalidraw element, read loosely: only what the tool ever wrote is used. */
export interface ExcalidrawLike {
  id: string
  type: string
  x: number
  y: number
  width?: number
  height?: number
  angle?: number
  isDeleted?: boolean
  opacity?: number
  locked?: boolean
  groupIds?: readonly string[]
  frameId?: string | null
  customData?: unknown
  strokeColor?: string
  backgroundColor?: string
  strokeWidth?: number
  strokeStyle?: string
  fillStyle?: string
  roughness?: number
  roundness?: unknown
  // linear and freedraw
  points?: readonly (readonly number[])[]
  pressures?: readonly number[]
  startBinding?: { elementId?: string } | null
  endBinding?: { elementId?: string } | null
  startArrowhead?: string | null
  endArrowhead?: string | null
  // text
  text?: string
  originalText?: string
  fontSize?: number
  fontFamily?: number | string
  textAlign?: string
  containerId?: string | null
  // image and frame
  fileId?: string | null
  status?: string
  name?: string | null
}

export interface ConvertedScene {
  records: ElementRecord[]
  /** Stroke points by element id (src/model/points.ts). */
  points: Record<string, Uint8Array>
  /** Images whose sha256 the scene does not say: hash the file's bytes and set props.assetSha. */
  unresolvedImages: { elementId: string; fileId: string }[]
  /** What the person should be told, once each. */
  notices: string[]
}

/** The document's nodes drawn on the canvas as a box with {kind, id} (customdata.schema.json). */
const DOC_NODES = new Set(['script', 'storyboard', 'video', 'document', 'format_set', 'suggestion'])

export const NOTICES = {
  rough: 'Hand-drawn shapes are drawn clean on the new canvas.',
  fonts: 'Text is set in Geist on the new canvas.',
  fills: 'Hatched and cross-hatched fills are drawn solid on the new canvas.',
  unknown: (type: string) => `Some ${type} elements could not be brought over; they are shown as dashed boxes.`,
} as const

const fin = (n: unknown, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : d)
const colour = (c: unknown) => (typeof c === 'string' && c && c !== 'transparent' ? c : undefined)

function tagOf(e: ExcalidrawLike): Tag | null {
  const c = e.customData
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  const t = c as Record<string, unknown>
  if (typeof t.kind !== 'string') return null
  return JSON.parse(JSON.stringify(t)) as Tag
}

function styleOf(e: ExcalidrawLike): Style {
  const s: Style = {}
  const stroke = colour(e.strokeColor)
  const fill = colour(e.backgroundColor)
  if (stroke) s.stroke = stroke
  if (fill) s.fill = fill
  if (typeof e.strokeWidth === 'number') s.width = e.strokeWidth
  if (e.strokeStyle === 'dashed' || e.strokeStyle === 'dotted') s.dash = e.strokeStyle
  if (e.roundness && typeof e.roundness === 'object') s.roundness = 1
  return s
}

/** A Tiptap doc of plain lines: the text's checkpoint until it is edited (engine-text-edit). */
function tiptapDoc(plain: string): Plain {
  return {
    type: 'doc',
    content: plain.split('\n').map((line): Plain => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  }
}

export function convertExcalidraw(scene: { elements?: readonly unknown[]; files?: unknown } | null | undefined): ConvertedScene {
  const out: ConvertedScene = { records: [], points: {}, unresolvedImages: [], notices: [] }
  const notice = (n: string) => {
    if (!out.notices.includes(n)) out.notices.push(n)
  }
  const els = (scene?.elements ?? []).filter((e): e is ExcalidrawLike => !!e && typeof e === 'object' && typeof (e as ExcalidrawLike).id === 'string' && typeof (e as ExcalidrawLike).type === 'string')
  const live = els.filter((e) => !e.isDeleted)
  const ids = new Set(live.map((e) => e.id))
  // Fractional keys in the array's order, Excalidraw's paint order.
  const zs = zKeys(live.length)
  live.forEach((e, i) => {
    const tag = tagOf(e)
    const base = {
      id: e.id, z: zs[i], x: fin(e.x), y: fin(e.y), w: fin(e.width), h: fin(e.height), rotation: fin(e.angle),
      parentId: e.frameId && ids.has(e.frameId) ? e.frameId : null,
      groupIds: [...(e.groupIds ?? [])].filter((g): g is string => typeof g === 'string'),
      locked: !!e.locked, opacity: Math.min(1, Math.max(0, fin(e.opacity, 100) / 100)),
      customData: tag,
    }
    if (fin(e.roughness) > 0 && e.type !== 'text' && e.type !== 'image' && e.type !== 'frame') notice(NOTICES.rough)
    if (e.fillStyle === 'hachure' || e.fillStyle === 'cross-hatch' || e.fillStyle === 'zigzag') notice(NOTICES.fills)
    const push = (kind: Kind, extra: Partial<ElementRecord>) => out.records.push(element({ ...base, kind, ...extra }))

    switch (e.type) {
      case 'freedraw': {
        const pts = (e.points ?? []).map((p) => [fin(p[0]), fin(p[1])] as const)
        if (!pts.length) return
        const minX = Math.min(...pts.map((p) => p[0]))
        const minY = Math.min(...pts.map((p) => p[1]))
        const maxX = Math.max(...pts.map((p) => p[0]))
        const maxY = Math.max(...pts.map((p) => p[1]))
        const pressures = e.pressures ?? []
        out.points[e.id] = encodePoints(pts.map(([px, py], k) => ({ x: px - minX, y: py - minY, pressure: pressures.length ? fin(pressures[k], 0.5) : 0.5 })), { x: 0, y: 0 })
        push('stroke', { x: base.x + minX, y: base.y + minY, w: maxX - minX, h: maxY - minY, style: styleOf(e), props: { tool: 'pen' } })
        return
      }
      case 'rectangle':
      case 'ellipse':
      case 'diamond': {
        if (tag?.kind === 'sketch') return push('sketch', { style: styleOf(e), props: {} })
        if (tag?.kind === 'board') return push('board', { style: styleOf(e), props: { name: typeof e.name === 'string' ? e.name : '' } })
        if (tag && DOC_NODES.has(tag.kind)) return push('node', { style: styleOf(e), props: { nodeKind: tag.kind } })
        return push('shape', { style: styleOf(e), props: { geo: e.type === 'rectangle' ? 'rect' : e.type } })
      }
      case 'line':
      case 'arrow': {
        const route = (e.points ?? []).flatMap((p) => [fin(p[0]), fin(p[1])])
        const style = styleOf(e)
        if (e.type === 'arrow') {
          if (typeof e.startArrowhead === 'string') style.arrowheadStart = e.startArrowhead
          if (typeof e.endArrowhead === 'string') style.arrowheadEnd = e.endArrowhead
        }
        const end = (b: { elementId?: string } | null | undefined): Plain => (b?.elementId && ids.has(b.elementId) ? { elementId: b.elementId } : null)
        const props = { route, start: end(e.startBinding), end: end(e.endBinding) }
        return push(tag?.kind === 'link' ? 'link' : 'arrow', { style, props })
      }
      case 'text': {
        notice(NOTICES.fonts)
        const plain = (e.originalText ?? e.text ?? '').toString()
        const style: Style = { ...styleOf(e), fontFamily: 'Geist', fontSize: fin(e.fontSize, 20) }
        delete style.fill
        if (e.textAlign === 'left' || e.textAlign === 'center' || e.textAlign === 'right') style.align = e.textAlign
        const boundTo = e.containerId && ids.has(e.containerId) ? e.containerId : null
        return push('text', { style, props: { plain, doc: tiptapDoc(plain), boundTo } })
      }
      case 'image': {
        const asset = tag && typeof tag.asset === 'string' ? tag.asset : null
        if (!asset && e.fileId) out.unresolvedImages.push({ elementId: e.id, fileId: e.fileId })
        const status = e.status === 'pending' || e.status === 'error' ? e.status : 'saved'
        return push('image', { props: { assetSha: asset, status } })
      }
      case 'frame':
      case 'magicframe': {
        const name = typeof e.name === 'string' ? e.name : ''
        if (tag?.kind === 'board') return push('board', { props: { name } })
        return push('frame', { style: styleOf(e), props: { name } })
      }
      default:
        notice(NOTICES.unknown(e.type))
        return push('shape', { style: { stroke: '#8a8579', dash: 'dashed', width: 1 }, props: { geo: 'rect' } })
    }
  })
  return out
}
