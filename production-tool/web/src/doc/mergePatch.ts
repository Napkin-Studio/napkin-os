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
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined
  return structuredClone(b)
}
