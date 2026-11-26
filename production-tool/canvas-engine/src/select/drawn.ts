// A Drawing's upkeep (features/container-select.clan, phase 4): a drawn frame (a frame
// whose tag is 'drawn') fits its members with a 16-unit pad. Every write that changes
// its members calls refitDrawn inside the same scene.change, so one undo puts back the
// members and the frame together. An empty Drawing stays where it is.

import type { ElementRecord } from '../model/records'
import type { SceneStore, SceneTx } from '../model/store'

/** The pad round a Drawing's members (the same as the controller's wrapDrawing). */
export const DRAWN_PAD = 16

/** Is this record a Drawing: a frame the tool made round loose strokes on Generate? */
export function isDrawn(r: ElementRecord | undefined): r is ElementRecord {
  return !!r && r.kind === 'frame' && r.customData?.kind === 'drawn'
}

/** The topmost Drawing that holds both points (a pen stroke's start and end), or null. */
export function drawnAt(scene: SceneStore, a: { x: number; y: number }, b: { x: number; y: number }): ElementRecord | null {
  const inside = (r: ElementRecord, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
  let top: ElementRecord | null = null
  for (const r of scene.all()) {
    if (!isDrawn(r) || !inside(r, a) || !inside(r, b)) continue
    if (!top || r.z > top.z) top = r
  }
  return top
}

/** Fit a Drawing round its members (pad 16), inside the caller's change. No members: it stays. */
export function refitDrawn(scene: SceneStore, tx: SceneTx, frameId: string) {
  const f = tx.get(frameId)
  if (!isDrawn(f)) return
  const kids = scene.all().filter((r) => r.parentId === frameId)
  if (!kids.length) return
  const x0 = Math.min(...kids.map((r) => r.x)) - DRAWN_PAD
  const y0 = Math.min(...kids.map((r) => r.y)) - DRAWN_PAD
  const x1 = Math.max(...kids.map((r) => r.x + r.w)) + DRAWN_PAD
  const y1 = Math.max(...kids.map((r) => r.y + r.h)) + DRAWN_PAD
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  if (box.x === f.x && box.y === f.y && box.w === f.w && box.h === f.h) return
  tx.put([{ ...f, ...box }])
}
