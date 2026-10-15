// Generation arrows are bound (owner, Shrey 2026-10-15; features/canvas-nodes.clan): the arrow from a
// sketch, picture or text to what was made from it is attached to both ends' elements, so our engine
// draws it from where they are now (canvas-engine linkRoute), under content, and it goes with either
// end. A scene can still hold arrows that lost an end's binding (made before, or converted with the end
// missing): each is bound again to the elements its provenance names, found by element or node id; one
// whose ends cannot be found is a fragment and goes. Engine-neutral and pure: elements in, changes out.

import type { CanvasElement } from '../core/canvasAdapter'
import { provenanceOf } from '../arrowHit'
import { byOwnId } from '../sceneRead'

type Bound = CanvasElement & { startBinding?: { elementId?: string } | null; endBinding?: { elementId?: string } | null }

/** What to change so every generation arrow is bound to live ends: new bindings, or a delete. */
export function provenanceFixes(els: readonly CanvasElement[]): Map<string, Partial<CanvasElement> | 'delete'> {
  const out = new Map<string, Partial<CanvasElement> | 'delete'>()
  const live = new Set(els.filter((e) => !e.isDeleted).map((e) => e.id))
  for (const e of els as readonly Bound[]) {
    if (e.isDeleted) continue
    const p = provenanceOf(e)
    if (!p) continue
    const a = e.startBinding?.elementId
    const b = e.endBinding?.elementId
    if (a && b && live.has(a) && live.has(b)) continue
    const from = byOwnId(els, p.from)
    const to = byOwnId(els, p.to)
    if (from && to && from.id !== e.id && to.id !== e.id) out.set(e.id, { startBinding: { elementId: from.id }, endBinding: { elementId: to.id } } as Partial<CanvasElement>)
    else out.set(e.id, 'delete')
  }
  return out
}
