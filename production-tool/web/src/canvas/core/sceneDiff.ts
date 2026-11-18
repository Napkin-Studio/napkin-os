// The field changes between two versions of a scene (features/engine-adapter.clan):
// what an undoable transact reports as its SceneStep. Pure, engine-free.
// Fields compare by value (JSON) so a re-made array or object that holds the same
// thing is no change; `ignore` drops an engine's own bookkeeping (Excalidraw's
// version, versionNonce, updated and seed change on every write).

import type { CanvasElement, FieldChange } from './canvasAdapter'

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

export function sceneDiff(before: readonly CanvasElement[], after: readonly CanvasElement[], ignore: ReadonlySet<string> = new Set()): FieldChange[] {
  const was = new Map(before.map((e) => [e.id, e as unknown as Record<string, unknown>]))
  const out: FieldChange[] = []
  const seen = new Set<string>()
  for (const e of after) {
    seen.add(e.id)
    const a = e as unknown as Record<string, unknown>
    const b = was.get(e.id)
    if (b === a) continue
    const keys = new Set([...Object.keys(a), ...(b ? Object.keys(b) : [])])
    for (const field of keys) {
      if (ignore.has(field)) continue
      const old = b ? b[field] : undefined
      if (!b || !same(old, a[field])) out.push({ id: e.id, field, before: b ? old : undefined, after: a[field] })
    }
  }
  // An element left out of the new scene is gone: say so as isDeleted, the one field every engine has.
  for (const [id, b] of was) if (!seen.has(id) && !b.isDeleted) out.push({ id, field: 'isDeleted', before: b.isDeleted ?? false, after: true })
  return out
}
