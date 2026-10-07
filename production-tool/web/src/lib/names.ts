// Names for images: key_variant (maya_laughing). The key is one character or
// object and has no underscore; the variant is free text. The relay turns names
// into the short tags providers need (relay/names.py), so here a name only has
// to be valid and unique in the document.

import { KEY_RE, VARIANT_RE, type Key, type NamedRef, type ProductionDocument, type RefName, type Variant } from '../contracts/types'

/** `@maya_laughing` in someone's words (not inside a word or an address). */
export const MENTION = /(?<![\w@])@([a-z][a-z0-9]{1,23}_[a-z0-9][a-z0-9-]{0,31})/g

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

/** The named refs someone's words mention, in order, once each; and the names that match nothing. */
export function mentions(doc: ProductionDocument, text: string): { found: NamedRef[]; unknown: string[] } {
  const found: NamedRef[] = []
  const unknown: string[] = []
  for (const m of text.matchAll(MENTION)) {
    let name = m[1]
    // "@maya_front-on" may be @maya_front followed by "-on": take the longest known name.
    while (!refByName(doc, name) && name.includes('-')) name = name.slice(0, name.lastIndexOf('-'))
    const r = refByName(doc, name)
    if (!r) unknown.push(m[1])
    else if (!found.includes(r)) found.push(r)
  }
  return { found, unknown }
}
