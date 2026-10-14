// Z-order keys (features/engine-ink.clan): fractional indices (fractional-indexing,
// CC0), so putting an element between two others writes only its own z. Keys
// that came from elsewhere and are not valid fractional indices still sort as
// strings; a key next to one of them is made by extending it.

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/** A key strictly between a and b (null: an end). */
export function zBetween(a: string | null, b: string | null): string {
  try {
    return generateKeyBetween(a, b)
  } catch {
    // An invalid neighbour: extend the lower one, which sorts after it and before anything after it.
    if (a !== null && (b === null || `${a}V` < b)) return `${a}V`
    if (b !== null) return `${b.slice(0, -1)}${String.fromCharCode(b.charCodeAt(b.length - 1) - 1)}V`
    return 'a0'
  }
}

/** n keys in order between a and b. */
export function zKeys(n: number, a: string | null = null, b: string | null = null): string[] {
  try {
    return generateNKeysBetween(a, b, n)
  } catch {
    const out: string[] = []
    let prev = a
    for (let i = 0; i < n; i++) out.push((prev = zBetween(prev, b)))
    return out
  }
}

/** A key above every key in `keys`. */
export function zTop(keys: Iterable<string>): string {
  let max: string | null = null
  for (const k of keys) if (max === null || k > max) max = k
  return zBetween(max, null)
}
