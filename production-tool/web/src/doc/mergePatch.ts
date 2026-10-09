// RFC 7396 JSON merge patch: apply, and make one from two values.

type J = unknown
const isObj = (v: J): v is Record<string, J> => !!v && typeof v === 'object' && !Array.isArray(v)

export function applyMergePatch<T>(target: T, patch: J): T {
  if (!isObj(patch)) return structuredClone(patch) as T
  const out: Record<string, J> = isObj(target) ? { ...(target as Record<string, J>) } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = applyMergePatch(out[k], v)
  }
  return out as T
}

/** The merge patch that turns `a` into `b` (arrays are replaced whole). Undefined when equal. */
export function createMergePatch(a: J, b: J): J | undefined {
  if (isObj(a) && isObj(b)) {
    const p: Record<string, J> = {}
    for (const k of Object.keys(a)) if (!(k in b) || b[k] === undefined) p[k] = null
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue
      const d = createMergePatch(a[k], v)
      if (d !== undefined) p[k] = d
    }
    return Object.keys(p).length ? p : undefined
  }
  if (deepEqual(a, b)) return undefined
  return structuredClone(b)
}

/** Equal as JSON values, whatever the key order (the .clan's YAML does not keep it). */
export function deepEqual(a: J, b: J): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined)
    const kb = Object.keys(b).filter((k) => b[k] !== undefined)
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}
