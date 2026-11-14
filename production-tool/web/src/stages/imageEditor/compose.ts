// How the edits make a picture (features/image-editor.clan): what Apply saves, what Before / After
// shows and what an action is sent. plan() is pure (the tests read it); compose() draws it in a canvas.
//
//   base     the frame, or the latest Change whole frame / Upscale result, which replaces what came
//            before (it was made from it)
//   fill     a Fill area or Remove result, kept inside its mask (the mask as it was sent, carried in the
//            step, so the stage and Apply cut it the same) only when "Keep everything outside the blue"
//   text     text layers, in front
//   crop     the kept area, scaled back to the full size (the frame's ratio is kept)
// A hidden layer is left out; hiding Frame leaves out only the original picture (fills and Change /
// Upscale results stay unless their own eye is off). What is sent and what Apply saves both come from
// sendPlan: exactly what is visible (features/image-editor-masks-layers.clan, owner answer IM1).

import { editLabel, hiddenCount, type Edit, type EditSession, type MaskOp } from './edits'
import { bounds, rasterize } from './mask'

export interface Pic { sha: string; w: number; h: number }
export type ResultOf = (e: Edit) => Pic | undefined

export type Step =
  | { kind: 'base'; pic: Pic }
  /** `key`: the fill's id, for a raster cache; `ops`: its mask as it was sent. */
  | { kind: 'fill'; pic: Pic; key: string; ops: MaskOp[]; keepOutside: boolean }
  | { kind: 'text'; text: string; x: number; y: number; size: number }

export interface Plan { w: number; h: number; steps: Step[]; crop?: { x: number; y: number; w: number; h: number } }

export function plan(s: EditSession, frame: Pic, resultOf: ResultOf, opts: { text?: boolean; crop?: boolean; before?: boolean } = {}): Plan {
  if (opts.before) return { w: frame.w, h: frame.h, steps: [{ kind: 'base', pic: frame }] }
  let w = frame.w, h = frame.h
  let steps: Step[] = [{ kind: 'base', pic: frame }]
  let crop: Plan['crop']
  for (const e of s.edits) {
    if (s.hidden.includes(e.id)) continue
    const pic = resultOf(e)
    if ((e.kind === 'whole' || e.kind === 'upscale') && pic) {
      if (e.kind === 'upscale') ({ w, h } = pic)
      steps = [...steps.filter((x) => x.kind !== 'base' && x.kind !== 'fill'), { kind: 'base', pic }]
    } else if (e.kind === 'fill' && pic) steps.push({ kind: 'fill', pic, key: e.id, ops: e.ops ?? [], keepOutside: e.keepOutside })
    else if (e.kind === 'text' && opts.text !== false && e.text.trim()) steps.push({ kind: 'text', text: e.text, x: e.x, y: e.y, size: e.size })
    else if (e.kind === 'crop' && opts.crop !== false) crop = { x: e.x, y: e.y, w: e.w, h: e.h }
  }
  // Frame hidden: the original picture goes; a Change or Upscale result that replaced it stays.
  if (s.hidden.includes('frame')) steps = steps.filter((x) => !(x.kind === 'base' && x.pic.sha === frame.sha))
  // Bases first (only the last stands), then fills and text in their order.
  const order = { base: 0, fill: 1, text: 2 } as const
  steps = steps.map((x, i) => ({ x, i })).sort((a, b) => order[a.x.kind] - order[b.x.kind] || a.i - b.i).map(({ x }) => x)
  return { w, h, steps, ...(crop ? { crop } : {}) }
}

/**
 * What an action is sent ('action': the picture without text, masks or crop) or what Apply saves
 * ('apply': with text and crop): the visible layers only, and how many hidden layers that leaves out,
 * for the pill, the Apply line and the send tray ("1 hidden layer is left out").
 */
export function sendPlan(s: EditSession, frame: Pic, resultOf: ResultOf, purpose: 'action' | 'apply'): { plan: Plan; leftOut: number } {
  const p = purpose === 'apply' ? plan(s, frame, resultOf) : plan(s, frame, resultOf, { text: false, crop: false })
  return { plan: p, leftOut: hiddenCount(s, purpose === 'action' ? ['text', 'crop', 'mask'] : ['mask']) }
}

/** The plan is the frame as it was: nothing to send but the frame itself. */
export function untouched(p: Plan, frame: Pic): boolean {
  return !p.crop && p.steps.length === 1 && p.steps[0].kind === 'base' && p.steps[0].pic.sha === frame.sha && p.w === frame.w
}

/**
 * Why Apply cannot save what the person sees, or undefined when it can. Apply never saves a copy that
 * is silently missing an edit (fix/editor-apply-keeps-edits): a visible result that has not arrived or
 * did not work, a fill whose mask is empty, or nothing that changes the picture at all.
 */
export function applyProblem(s: EditSession, frame: Pic, resultOf: ResultOf): string | undefined {
  for (const e of s.edits) {
    if (s.hidden.includes(e.id) || (e.kind !== 'fill' && e.kind !== 'whole' && e.kind !== 'upscale')) continue
    const label = editLabel(e, s)
    if (!resultOf(e)) return `${label} has no result yet. Wait for it, or undo or hide it, then Apply.`
    if (e.kind === 'fill' && e.keepOutside) {
      const w = 256, h = Math.max(1, Math.round((256 * frame.h) / frame.w))
      if (!bounds(rasterize(e.ops ?? [], w, h), w, h)) return `${label} has no area left to keep. Undo it and paint the area again.`
    }
  }
  if (untouched(sendPlan(s, frame, resultOf, 'apply').plan, frame)) {
    const m = s.edits.find((e) => e.kind === 'mask' && e.ops.length && !s.hidden.includes(e.id))
    return m && m.kind === 'mask'
      ? `Nothing would change yet: ${m.name} is painted but not filled or removed. Fill or remove it first.`
      : 'Nothing would change yet: make an edit first.'
  }
  return undefined
}

export const TEXT_FONT = '600 {px}px Geist, "Helvetica Neue", Arial, sans-serif'

/** A fill's mask at w x h (the stage passes its cache). */
export type Raster = (key: string, ops: readonly MaskOp[], w: number, h: number) => Uint8Array

/** The plan drawn on a canvas at its size. `image` loads a picture; `raster` draws a fill's mask at w x h. */
export async function compose(p: Plan, image: (sha: string) => Promise<CanvasImageSource>,
  raster: Raster = (_key, ops, w, h) => rasterize(ops, w, h)): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  c.width = p.w
  c.height = p.h
  const ctx = c.getContext('2d')!
  for (const st of p.steps) {
    if (st.kind === 'base') ctx.drawImage(await image(st.pic.sha), 0, 0, p.w, p.h)
    else if (st.kind === 'fill') {
      const img = await image(st.pic.sha)
      if (!st.keepOutside) {
        ctx.drawImage(img, 0, 0, p.w, p.h)
        continue
      }
      // Only the blue area changes: the result, cut by the mask's own (soft) edge, over what is there.
      const layer = document.createElement('canvas')
      layer.width = p.w
      layer.height = p.h
      const lc = layer.getContext('2d')!
      const m = raster(st.key, st.ops, p.w, p.h)
      const data = new ImageData(p.w, p.h)
      for (let i = 0; i < m.length; i++) data.data[i * 4 + 3] = m[i]
      lc.putImageData(data, 0, 0)
      lc.globalCompositeOperation = 'source-in'
      lc.drawImage(img, 0, 0, p.w, p.h)
      ctx.drawImage(layer, 0, 0)
    } else {
      const px = Math.max(8, Math.round(st.size * p.h))
      ctx.font = TEXT_FONT.replace('{px}', String(px))
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#FFFFFF'
      ctx.shadowColor = 'rgba(20,22,27,0.35)'
      ctx.shadowBlur = px * 0.25
      ctx.fillText(st.text, st.x * p.w, st.y * p.h)
      ctx.shadowBlur = 0
    }
  }
  if (!p.crop) return c
  const out = document.createElement('canvas')
  out.width = p.w
  out.height = p.h
  out.getContext('2d')!.drawImage(c, p.crop.x * p.w, p.crop.y * p.h, p.crop.w * p.w, p.crop.h * p.h, 0, 0, p.w, p.h)
  return out
}

export function toPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture.'))), 'image/png'))
}

/** A mask (0 keep, 255 change) as our white = change PNG, the frame's size. */
export function maskToPng(m: Uint8Array, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const data = new ImageData(w, h)
  for (let i = 0; i < m.length; i++) {
    const v = m[i] >= 128 ? 255 : 0
    data.data[i * 4] = v
    data.data[i * 4 + 1] = v
    data.data[i * 4 + 2] = v
    data.data[i * 4 + 3] = 255
  }
  c.getContext('2d')!.putImageData(data, 0, 0)
  return toPng(c)
}
