// Reading the tool's customData off scene elements. Pure and engine-free: typed
// over the structural ElementLike, so vitest loads it in node and any engine's
// elements fit (features/canvas-core.clan). canvas/scene.ts re-exports these.

import type { CustomData, Sha256 } from '../contracts/types'
import type { ElementLike } from './core/canvasAdapter'

export function cd(el: ElementLike | undefined): CustomData | undefined {
  const c = el?.customData as CustomData | undefined
  return c && typeof c === 'object' && 'kind' in c ? c : undefined
}

export function idOf(el: ElementLike): string | undefined {
  const c = cd(el)
  if (!c || c.kind === 'provenance') return undefined
  return c.id
}

export const alive = <T extends ElementLike>(els: readonly T[]): T[] => els.filter((e) => !e.isDeleted)

export function byOwnId<T extends ElementLike>(els: readonly T[], id: string): T | undefined {
  return els.find((e) => !e.isDeleted && (e.id === id || idOf(e) === id))
}

/** An image node (picture, drawing frame or generated image) and its picture, when it has one yet. */
export function imageOf(el: ElementLike | undefined): { id: string; asset?: Sha256; kind: 'pic' | 'drawn' | 'gen' } | undefined {
  const c = cd(el)
  if (c?.kind === 'pic' || c?.kind === 'drawn') return { id: c.id, asset: c.asset, kind: c.kind }
  if (c?.kind === 'gen') return { id: c.id, asset: c.asset, kind: 'gen' }
  return undefined
}

export function childrenOf<T extends ElementLike>(els: readonly T[], frameId: string): T[] {
  return els.filter((e) => !e.isDeleted && e.frameId === frameId)
}

/** The user's own marks (not the tool's, not text): strokes and shapes. */
export function isUserDrawing(e: ElementLike): boolean {
  return !e.isDeleted && !cd(e) && e.type !== 'image' && e.type !== 'frame' && e.type !== 'magicframe' && e.type !== 'text' && e.type !== 'arrow'
}

/** Words on the canvas: a text element, loose or used as a note. */
export function isText(e: ElementLike): boolean {
  return !e.isDeleted && e.type === 'text' && (!cd(e) || cd(e)?.kind === 'note')
}

export function textOf(e: ElementLike): string {
  return (e.originalText ?? e.text ?? '').trim()
}
