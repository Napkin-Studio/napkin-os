// The sketch area tool (features/canvas-edit-tools.clan; ui-behaviour 3.7): a drag
// draws a dashed ghost locked to the next area's ratio (16:9 unless the picker
// says otherwise), and the release writes a white sketch area at that ratio, as
// one undoable step. DOM-free: the adapter feeds it the router's press, drag and
// release in scene coordinates and draws the ghost on the live canvas.

import { element, type ElementRecord } from '../model/records'
import type { SceneStore } from '../model/store'
import { zTop } from '../model/z'
import { ratioValue, type Box, type Pt } from './select'

/** An area smaller than this on its long side is a click, not an area. */
export const MIN_AREA_PX = 24

/** The box from `a` toward `b` at `ratio` (w:h), led by whichever way the pointer went further. */
export function lockedRect(a: Pt, b: Pt, ratio: number): Box {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const w = Math.max(Math.abs(dx), Math.abs(dy) * ratio)
  const h = w / ratio
  return { x: dx < 0 ? a.x - w : a.x, y: dy < 0 ? a.y - h : a.y, w, h }
}

export class SketchTool {
  private readonly scene: SceneStore
  private readonly newId: (prefix: string) => string
  /** The ratio of the next area ('16:9', '9:16', '1:1' or '4:5'). */
  ratio = '16:9'
  ghost: (Box & { ratio: string }) | null = null
  private from: Pt | null = null

  constructor(scene: SceneStore, opts: { newId?: (prefix: string) => string } = {}) {
    this.scene = scene
    this.newId = opts.newId ?? ((p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
  }

  press(p: Pt) {
    this.from = p
    this.ghost = { x: p.x, y: p.y, w: 0, h: 0, ratio: this.ratio }
  }

  drag(p: Pt) {
    if (!this.from) return
    this.ghost = { ...lockedRect(this.from, p, ratioValue(this.ratio) ?? 16 / 9), ratio: this.ratio }
  }

  /** Write the area (one step), or nothing for a click. Returns it. */
  release(p: Pt): ElementRecord | null {
    this.drag(p)
    const g = this.ghost
    this.cancel()
    if (!g || Math.max(g.w, g.h) < MIN_AREA_PX) return null
    const rec = element({
      id: this.newId('area'), kind: 'sketch', z: zTop(this.scene.all().map((r) => r.z)), x: g.x, y: g.y, w: g.w, h: g.h,
      style: { fill: '#ffffff' }, props: { ratio: g.ratio }, customData: { kind: 'sketch', id: this.newId('sketch') },
    })
    this.scene.change((tx) => tx.put([rec]))
    return rec
  }

  cancel() {
    this.from = null
    this.ghost = null
  }
}
