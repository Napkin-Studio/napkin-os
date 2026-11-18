// "Make a 9:16 copy" (features/art-boards.clan, owner decision 2026-10-14; ui-behaviour 3.7): a drawn
// sketch area never changes its ratio. With one selected, the shape picker instead copies it into
// another shape: a new area of the picked ratio beside the original (clear of the others, on the same
// board), with the original's strokes copied and scaled uniformly to fit inside it, centred, never
// cropped or stretched. Engine-neutral and pure: the adapter writes the result as one undo step.

import type { CanvasElement } from './canvasAdapter'
import { boxOf, intersects, membersOf, type Rect } from './sketch'

/** Space between the original and its copy, and the step when nudging clear of others. */
export const COPY_GAP = 40

/** The ratio ("16:9") as width over height, or null. */
export function ratioOf(ratio: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio)
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null
}

/** A sketch area element (the tool's tag), with its ratio. */
export function isSketchArea(e: CanvasElement): boolean {
  const c = e.customData as { kind?: unknown } | undefined
  return !e.isDeleted && c?.kind === 'sketch'
}

export function areaRatio(e: CanvasElement): string | null {
  const r = (e as CanvasElement & { ratio?: unknown }).ratio
  return typeof r === 'string' ? r : null
}

/** The copy's label in the picker: "Make a 9:16 copy". */
export const copyLabel = (ratio: string) => `Make a ${ratio} copy`

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export interface SketchCopy {
  area: CanvasElement
  strokes: CanvasElement[]
}

/**
 * The copy of `area` at `ratio`: the same surface as the original, placed to its right (nudged right
 * until clear of every other live element but its own board), with every stroke that belongs to the
 * original (membersOf) copied, its group structure kept under new ids, and scaled by one factor so the
 * original's drawing (the area and anything crossing its edge) fits centred inside the copy.
 * Returns null for a ratio it cannot read or the area's own.
 */
export function sketchCopy(els: readonly CanvasElement[], area: CanvasElement, ratio: string, newId: (prefix: string) => string): SketchCopy | null {
  const r = ratioOf(ratio)
  if (!r || areaRatio(area) === ratio) return null
  const a = boxOf(area)
  // Same surface, the new shape.
  const surface = Math.max(1, a.w * a.h)
  const w = Math.sqrt(surface * r)
  const h = w / r
  const others = els.filter((e) => !e.isDeleted && e.id !== area.id && e.id !== area.frameId && e.type !== 'arrow').map(boxOf)
  let box: Rect = { x: a.x + a.w + COPY_GAP, y: a.y, w, h }
  for (let i = 0; i < 200 && others.some((o) => intersects(o, box)); i++) box = { ...box, x: box.x + COPY_GAP }

  const members = membersOf(els, a)
  const source = members.reduce((u, m) => union(u, boxOf(m)), a)
  const s = Math.min(box.w / source.w, box.h / source.h)
  // The source, scaled, centred in the copy.
  const ox = box.x + (box.w - source.w * s) / 2
  const oy = box.y + (box.h - source.h * s) / 2
  const map = (x: number, y: number) => ({ x: ox + (x - source.x) * s, y: oy + (y - source.y) * s })

  const areaId = newId('area')
  const sketchId = newId('sketch')
  const tag = (area.customData ?? {}) as Record<string, unknown>
  const copy = {
    ...area, id: areaId, x: box.x, y: box.y, width: box.w, height: box.h, groupIds: [], ratio,
    customData: { ...tag, kind: 'sketch', id: sketchId },
  } as CanvasElement

  const groups = new Map<string, string>()
  const regroup = (ids: readonly string[] | undefined) => (ids ?? []).map((g) => {
    if (!groups.has(g)) groups.set(g, newId('group'))
    return groups.get(g)!
  })
  const strokes = members.map((m) => {
    const at = map(m.x, m.y)
    const e = m as CanvasElement & { points?: readonly (readonly [number, number])[]; strokeWidth?: number }
    const pts = e.points
    return {
      ...m, id: newId('el'), x: at.x, y: at.y, width: m.width * s, height: m.height * s, frameId: area.frameId ?? null,
      groupIds: regroup(m.groupIds),
      ...(pts ? { points: pts.map(([px, py]) => [px * s, py * s]) } : {}),
      ...(typeof e.strokeWidth === 'number' ? { strokeWidth: e.strokeWidth * s } : {}),
    } as CanvasElement
  })
  return { area: copy, strokes }
}
