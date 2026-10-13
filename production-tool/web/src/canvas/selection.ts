// What a selection on the canvas means for Generate. Any mix of nodes goes in:
// pictures, drawings, notes and earlier results. No Excalidraw import, so it
// runs (and is tested) on plain elements.
//
// planSelection is the v2 projection of core/plan.ts's planGraph, which holds
// the rules (features/canvas-core.clan):
// - an image node (pic, drawn, gen) with a picture is an image input;
// - a stroke or shape inside a drawn frame stands for that frame;
// - loose strokes and shapes become one new drawing (the controller wraps them);
// - text is words for the instruction, and a node so it gets an arrow;
// - a generated image still being made can't be used yet.

import { clipText } from '../lib/guard'
import type { ElementLike } from './core/canvasAdapter'
import { planGraph, type SelectionPlan } from './core/plan'

export type { ImageInput, SelectionPlan } from './core/plan'

/** The fields planSelection reads. */
export type PlainEl = ElementLike

export function planSelection(all: readonly PlainEl[], selectedIds: readonly string[]): SelectionPlan {
  const { images, strokes, notes, pending } = planGraph({ elements: all, selectedIds })
  return { images, strokes, notes, pending }
}

/** The instruction: what was typed, then the selected notes' words. At most 1000 characters (the contract). */
export function instruction(typed: string, notes: readonly { text: string }[]): string {
  return clipText([typed.trim(), ...notes.map((n) => n.text)].filter(Boolean).join('\n'), 1000)
}
