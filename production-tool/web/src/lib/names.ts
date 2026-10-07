// Names for images: key_variant (maya_laughing). The key is one character or
// object and has no underscore; the variant is free text. The relay turns names
// into the short tags providers need (relay/names.py), so here a name only has
// to be valid and unique in the document.

import { KEY_RE, VARIANT_RE, type Key, type NamedRef, type ProductionDocument, type RefName, type Variant } from '../contracts/types'

/** `@maya_laughing` or a bare `@maya` in someone's words (not inside a word or an address). */
export const MENTION = /(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)/g

/** The views a whole character sends after its front, in this order; then its other variants as named. */
const VIEW_ORDER = ['three-quarter', 'side', 'back']
/** A whole character is its front plus up to 3 more pictures (fal's Kling element: 1 + 3). */
export const KEY_EXTRAS = 3

/** Thrown for a bare key with no front: @goremon needs goremon_front (the owner's choice, 2026-10-07). */
export class NoFrontError extends Error {
  readonly key: string
  constructor(key: string) {
    super(`Set a front for ${key} first: @${key} stands for the whole character, led by its front.`)
    this.key = key
  }
}

/** The pictures a bare @key sends: its front, then three-quarter, side, back, then the rest as named. */
export function keyRefs(doc: ProductionDocument, key: Key): NamedRef[] {
  const mine = doc.refs.filter((r) => r.key === key)
  const front = mine.find((r) => r.variant === 'front')
  if (!front) throw new NoFrontError(key)
  const rank = (r: NamedRef) => (VIEW_ORDER.includes(r.variant) ? VIEW_ORDER.indexOf(r.variant) : VIEW_ORDER.length + mine.indexOf(r))
  return [front, ...mine.filter((r) => r !== front).sort((a, b) => rank(a) - rank(b)).slice(0, KEY_EXTRAS)]
}

/** Keys that can be named bare (they have a front). */
export function wholeKeys(doc: ProductionDocument): Key[] {
  return doc.keys.map((k) => k.key).filter((k) => doc.refs.some((r) => r.key === k && r.variant === 'front'))
}

/** The pictures a subject (bare key or key_variant) sends; [] for a name nothing has. */
export function subjectRefs(doc: ProductionDocument, subject: string): NamedRef[] {
  if (!subject.includes('_')) return doc.refs.some((r) => r.key === subject) ? keyRefs(doc, subject) : []
  const r = refByName(doc, subject)
  return r ? [r] : []
}

export const nameOf = (r: { key: Key; variant: Variant }): RefName => `${r.key}_${r.variant}`

export function parseName(name: string): { key: Key; variant: Variant } | null {
  const i = name.indexOf('_')
  if (i < 0) return null
  const key = name.slice(0, i)
  const variant = name.slice(i + 1)
  return KEY_RE.test(key) && VARIANT_RE.test(variant) ? { key, variant } : null
}

/** What someone typed ("Maya", "Red Coat!") as a key: lowercase letters and digits. */
export function cleanKey(typed: string): Key {
  return typed.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 24)
}

/** What someone typed as a variant: lowercase, words joined by hyphens. */
export function cleanVariant(typed: string): Variant {
  return typed.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
}

/** Why a name can't be used, or null when it can. */
export function nameProblem(key: string, variant: string): string | null {
  if (!KEY_RE.test(key)) return 'A name is 2 to 24 letters or digits, starting with a letter.'
  if (!VARIANT_RE.test(variant)) return 'Say what this one shows: front, side, laughing…'
  return null
}

export function refByName(doc: ProductionDocument, name: RefName): NamedRef | undefined {
  return doc.refs.find((r) => nameOf(r) === name)
}

/**
 * The named refs someone's words mention, in order, once each (a bare @key brings its front and
 * up to 3 other pictures), and the names that match nothing. A bare key with no front throws.
 */
export function mentions(doc: ProductionDocument, text: string): { found: NamedRef[]; unknown: string[] } {
  const found: NamedRef[] = []
  const unknown: string[] = []
  const add = (r: NamedRef) => { if (!found.includes(r)) found.push(r) }
  for (const m of text.matchAll(MENTION)) {
    if (!m[1].includes('_')) {
      if (doc.refs.some((r) => r.key === m[1])) keyRefs(doc, m[1]).forEach(add)
      else unknown.push(m[1])
      continue
    }
    let name = m[1]
    // "@maya_front-on" may be @maya_front followed by "-on": take the longest known name.
    while (!refByName(doc, name) && name.includes('-')) name = name.slice(0, name.lastIndexOf('-'))
    const r = refByName(doc, name)
    if (!r) unknown.push(m[1])
    else add(r)
  }
  return { found, unknown }
}
