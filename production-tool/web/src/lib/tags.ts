// Reference tags are stored once in the strictest form any provider accepts
// (common.schema.json#/$defs/tag): ^[a-z][a-z0-9_]{2,15}$. Whatever the user
// types on a chip is kept as the label and sanitised into the tag.

export const TAG_PATTERN = /^[a-z][a-z0-9_]{2,15}$/

export function isValidTag(tag: string): boolean {
  return TAG_PATTERN.test(tag)
}

/** Turn anything the user typed into a valid tag, or '' when nothing usable is left. */
export function sanitizeTag(input: string): string {
  let t = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
  t = t.slice(0, 16).replace(/_+$/, '')
  if (!t) return ''
  if (t.length < 3) t = (t + '___').slice(0, 3).replace(/_+$/, (m) => 'x'.repeat(m.length))
  return t
}

/** A tag unique among `taken`: sanitised, then suffixed _2, _3… if needed. */
export function uniqueTag(input: string, taken: Iterable<string>, fallback = 'ref'): string {
  const used = new Set(taken)
  const base = sanitizeTag(input) || sanitizeTag(fallback) || 'ref'
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`
    const candidate = base.slice(0, 16 - suffix.length).replace(/_+$/, '') + suffix
    if (!used.has(candidate)) return candidate
  }
  return base
}

/** Display badges: A…Z, then AA, AB… (customdata badge ^[A-Z]{1,2}$). */
export function badgeFor(index: number): string {
  const A = 65
  if (index < 26) return String.fromCharCode(A + index)
  const i = index - 26
  return String.fromCharCode(A + (Math.floor(i / 26) % 26)) + String.fromCharCode(A + (i % 26))
}
