// What a selection on the canvas means for Generate. Any mix of nodes goes in:
// pictures, drawings, notes and earlier results. No Excalidraw import, so it
// runs (and is tested) on plain elements.
//
// - an image node (pic, drawn, gen) with a picture is an image input;
// - a stroke or shape inside a drawn frame stands for that frame;
// - loose strokes and shapes become one new drawing (the controller wraps them);
// - text is words for the instruction, and a node so it gets an arrow;
// - a generated image still being made can't be used yet.

import type { CustomData, Sha256 } from '../contracts/types'

export interface PlainEl {
  id: string
  type: string
  isDeleted?: boolean
  customData?: unknown
  frameId?: string | null
  text?: string
  originalText?: string
}

export interface ImageInput {
  elId: string
  nodeId: string
  asset: Sha256
  kind: 'pic' | 'drawn' | 'gen'
}

export interface SelectionPlan {
  images: ImageInput[]
  /** Loose strokes and shapes, to wrap in one new drawing. */
  strokes: string[]
  /** Text elements, in selection order, with their words. */
  notes: { elId: string; nodeId?: string; text: string }[]
  /** Generated images not finished yet. */
  pending: string[]
}

function cdOf(e: PlainEl | undefined): CustomData | undefined {
  const c = e?.customData as CustomData | undefined
  return c && typeof c === 'object' && 'kind' in c ? c : undefined
}

export function planSelection(all: readonly PlainEl[], selectedIds: readonly string[]): SelectionPlan {
  const live = new Map(all.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  const plan: SelectionPlan = { images: [], strokes: [], notes: [], pending: [] }
  const seen = new Set<string>()
  const addImage = (e: PlainEl) => {
    const c = cdOf(e)
    if (seen.has(e.id)) return
    seen.add(e.id)
    if (c?.kind === 'gen') {
      if (c.asset && c.state === 'completed') plan.images.push({ elId: e.id, nodeId: c.id, asset: c.asset, kind: 'gen' })
      else plan.pending.push(e.id)
    } else if (c?.kind === 'pic' || c?.kind === 'drawn') {
      plan.images.push({ elId: e.id, nodeId: c.id, asset: c.asset, kind: c.kind })
    }
  }
  for (const id of selectedIds) {
    const e = live.get(id)
    if (!e) continue
    const c = cdOf(e)
    if (c?.kind === 'provenance' || c?.kind === 'pin') continue
    if (c?.kind === 'pic' || c?.kind === 'drawn' || c?.kind === 'gen') {
      addImage(e)
      continue
    }
    if (e.type === 'text') {
      const text = (e.originalText ?? e.text ?? '').trim()
      if (text) plan.notes.push({ elId: e.id, nodeId: c?.kind === 'note' ? c.id : undefined, text })
      continue
    }
    if (e.type === 'arrow' || e.type === 'frame' || e.type === 'magicframe' || e.type === 'image') continue
    // A stroke or shape: part of a drawing node, or loose.
    const frame = e.frameId ? live.get(e.frameId) : undefined
    if (frame && cdOf(frame)?.kind === 'drawn') addImage(frame)
    else plan.strokes.push(e.id)
  }
  return plan
}

/** The instruction: what was typed, then the selected notes' words. At most 1000 characters (the contract). */
export function instruction(typed: string, notes: readonly { text: string }[]): string {
  return [typed.trim(), ...notes.map((n) => n.text)].filter(Boolean).join('\n').slice(0, 1000)
}
