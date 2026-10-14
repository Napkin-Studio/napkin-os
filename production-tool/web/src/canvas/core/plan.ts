// planGraph (features/canvas-core.clan; plan §2.3): what a selection on the
// canvas means, classified through the NodeRegistry. It generalises today's
// planSelection, which is now its projection (canvas/selection.ts), and gives
// the selected nodes by kind and what it refused, with reasons. Pure.
//
// v2 only: the v3 actions (Make video, Plan shots, scope focus and the Ask
// flags) come with canvas-nodes, once contract-v3 fixes the link and Ask model.
//
// Today's rules, unchanged:
// - an image node (pic, drawn, gen) with a picture is an image input;
// - a stroke or shape inside a drawn frame stands for that frame;
// - loose strokes and shapes become one new drawing (the controller wraps them);
// - text is words for the instruction, and a node so it gets an arrow;
// - a generated image still being made can't be used yet.

import type { CustomData, Sha256 } from '../../contracts/types'
import type { ElementLike } from './canvasAdapter'
import type { LinkGraph } from './links'
import { classify, type Classified } from './nodes'

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

export interface GraphPlan extends SelectionPlan {
  /** The selected nodes' element ids by kind, in selection order (a stroke in a drawing counts as its drawing). */
  nodes: Partial<Record<Classified, string[]>>
  /** What cannot be used, and why. */
  refused: { elId: string; reason: string }[]
}

export const STILL_BEING_MADE = 'This is still being made. Wait for it, or leave it out.'

const EMPTY: LinkGraph = { nodes: [], links: [] }

function cdOf(e: ElementLike | undefined): CustomData | undefined {
  const c = e?.customData as CustomData | undefined
  return c && typeof c === 'object' && 'kind' in c ? c : undefined
}

/**
 * `_graph`: the link graph. The v2 plan does not read it; the v3 actions will.
 */
export function planGraph(selection: { elements: readonly ElementLike[]; selectedIds: readonly string[] }, _graph: LinkGraph = EMPTY): GraphPlan {
  const live = new Map(selection.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  const plan: GraphPlan = { images: [], strokes: [], notes: [], pending: [], nodes: {}, refused: [] }
  const counted = new Set<string>()
  const node = (kind: Classified, elId: string) => {
    if (counted.has(elId)) return
    counted.add(elId)
    ;(plan.nodes[kind] ??= []).push(elId)
  }
  const seen = new Set<string>()
  const addImage = (e: ElementLike) => {
    const c = cdOf(e)
    if (seen.has(e.id)) return
    seen.add(e.id)
    if (c?.kind === 'gen') {
      if (c.asset && c.state === 'completed') plan.images.push({ elId: e.id, nodeId: c.id, asset: c.asset, kind: 'gen' })
      else {
        plan.pending.push(e.id)
        plan.refused.push({ elId: e.id, reason: STILL_BEING_MADE })
      }
    } else if (c?.kind === 'pic' || c?.kind === 'drawn') {
      plan.images.push({ elId: e.id, nodeId: c.id, asset: c.asset, kind: c.kind })
    }
  }
  for (const id of selection.selectedIds) {
    const e = live.get(id)
    if (!e) continue
    const kind = classify(e)
    if (kind === 'provenance' || kind === 'pin') continue
    if (kind === 'picture' || kind === 'drawing' || kind === 'generated') {
      node(kind, e.id)
      addImage(e)
      continue
    }
    if (e.type === 'text') {
      // Text with a tag it does not know is still words (classify calls it 'unknown').
      const text = (e.originalText ?? e.text ?? '').trim()
      if (text) {
        const c = cdOf(e)
        node(kind, e.id)
        plan.notes.push({ elId: e.id, nodeId: c?.kind === 'note' ? c.id : undefined, text })
      }
      continue
    }
    if (e.type === 'arrow' || e.type === 'frame' || e.type === 'magicframe' || e.type === 'image') continue
    // A stroke or shape: part of a drawing node, or loose.
    const frame = e.frameId ? live.get(e.frameId) : undefined
    if (frame && cdOf(frame)?.kind === 'drawn') {
      node('drawing', frame.id)
      addImage(frame)
    } else {
      node(kind, e.id)
      plan.strokes.push(e.id)
    }
  }
  return plan
}
