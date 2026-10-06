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
