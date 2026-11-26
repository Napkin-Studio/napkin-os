// RFC 7396 JSON Merge Patch: the same rule the SDK applies to shared/data.yaml
// (objects merge, null deletes, everything else — arrays too — replaces).
export function mergePatch<T>(target: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch) as T
  const base: Record<string, unknown> =
    target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete base[k]
    else base[k] = mergePatch(base[k], v)
  }
  return base as T
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a)
    if (ka.length !== Object.keys(b).length) return false
    return ka.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

/** The smallest merge patch that turns `from` into `to` (undefined: nothing to change).
 * An empty object that is new is written as {} so it exists after the merge. */
export function diffMergePatch(from: unknown, to: unknown): unknown {
  if (deepEqual(from, to)) return undefined
  if (!isObject(from) || !isObject(to)) return to === undefined ? null : structuredClone(to)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(from)) if (!(k in to)) out[k] = null
  for (const [k, v] of Object.entries(to)) {
    if (!(k in from)) {
      out[k] = structuredClone(v)
      continue
    }
    const d = diffMergePatch(from[k], v)
    if (d !== undefined) out[k] = d
  }
  return out
}
