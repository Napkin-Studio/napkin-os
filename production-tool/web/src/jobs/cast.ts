// Who a storyboard's frames show (features/pt-canvas-r2.clan; UAT round 2 R2-4: frames 2-4 copied frame 3, doubled Mia
// and the puppy and changed her hair, because a frame got only @anchor and @previous, as objects).
//
// - A frame sends a character picture only when its shot's words name or imply a person (namesPerson): a named
//   character, an @mention, a spoken line's speaker, or a person word ("a woman", "her hand"). UAT round 3 R3-F1:
//   frame 1 went as "the person from shot 1" into every later frame, so a kettle insert and a wall close were
//   drawn with Maya. That round-2 decision is reversed (features/pt-film-r3.clan).
// - Then: the shot's own named character when it has one; else the project's character the storyboard offers,
//   when it is the only one (promoted from optional to required); else a character the person kept from frame 1
//   ("Keep a person from this frame"). Frame 1 itself never goes as an unnamed person: it is the anchor already.
// - "Keep a person from this frame" names frame 1's picture as <name>_front, a character, so every later frame (and
//   the canvas) has it by name.

import type { Id, JobInputRef, NamedRef, ProductionDocument, Sha256, Shot } from '../contracts/types'
import type { DocumentStore } from '../doc/types'
import { updateDoc } from '../doc/store'
import { cleanKey, nameOf, nameProblem } from '../lib/names'
import { newId } from '../lib/ulid'
import { beatsOf, currentFrame, keyNamed, keysList, refsList, shotSubjects, shotsOf } from '../model/selectors'
import type { Relay } from '../relay'
import { namedInput } from './select'

/** The character kept from a storyboard's first frame (a character ref on that picture), if any. */
export function keptFromFirst(d: ProductionDocument, storyboardId: Id | undefined): NamedRef | undefined {
  const first = shotsOf(d, storyboardId)[0]
  const frame = first ? currentFrame(d, first.id) : undefined
  if (!frame) return undefined
  return refsList(d).find((r) => r.asset === frame.asset && (keyNamed(d, r.key)?.role ?? r.role) === 'character')
}

/** Words that mean a person is seen (or heard in the shot): a person word, a body part of one, or a pronoun. */
const PERSON_WORDS = /\b(?:wom[ae]n|m[ae]n|girls?|boys?|guys?|lad(?:y|ies)|gentlem[ae]n|persons?|people|someone|somebody|anyone|everyone|child(?:ren)?|kids?|bab(?:y|ies)|toddlers?|teens?|teenagers?|adults?|friends?|flatmates?|roommates?|housemates?|neighbou?rs?|couple|family|mum|mom|dad|mother|father|sisters?|brothers?|wife|husband|partner|customers?|shoppers?|workers?|chef|cook|driver|crowd|audience|hero(?:ine)?|she|he|her|his|him|hers|they|them|their|hands?|fingers?|faces?|eyes|lips|mouth|arms?|feet|legs)\b/i

/** Whether a shot's words name or imply a person: a character it names (its refs or an @mention of a character key),
 *  a spoken line or its speaker, a character key's name in plain words, or a person word. A kettle insert or a wall
 *  close names no one (UAT round 3 R3-F1). */
export function namesPerson(d: ProductionDocument, shot: Shot): boolean {
  const role = (name: string) => keyNamed(d, name.split('_')[0])?.role ?? refsList(d).find((r) => nameOf(r) === name)?.role
  if (shotSubjects(d, shot).some((n) => role(n) === 'character')) return true
  const words = [shot.action ?? '', shot.direction ?? ''].join(' ')
  for (const m of words.matchAll(/@([a-z0-9][a-z0-9_-]*)/gi)) {
    const r = role(m[1].toLowerCase())
    if (r === 'character') return true
  }
  if (beatsOf(d, shot.id).some((b) => b.kind === 'line' || !!b.speaker)) return true
  const plain = words.replace(/@[a-z0-9_-]+/gi, ' ')
  if (PERSON_WORDS.test(plain)) return true
  return keysList(d).some((k) => k.role === 'character' && new RegExp(`\\b${k.key.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(plain))
}

/**
 * The character pictures a frame sends (R3-F1): `refs` as they are when the shot names no person, or already
 * carries a required character. Else the one character the storyboard offers (all its pictures) becomes required;
 * else, for a later frame, the person kept from frame 1, by name. Never frame 1 as an unnamed person.
 */
export async function castRefs(relay: Relay, d: ProductionDocument, storyboardId: Id | undefined, index: number, shot: Shot, refs: readonly JobInputRef[]): Promise<JobInputRef[]> {
  if (!namesPerson(d, shot) || refs.some((r) => r.role === 'character' && !r.optional)) return [...refs]
  const offered = refs.filter((r) => r.role === 'character' && r.optional)
  const keys = new Set(offered.map((r) => (r.name ?? '').split('_')[0]))
  if (offered.length && keys.size === 1) return refs.map((r) => (offered.includes(r) ? withoutOptional(r) : r))
  if (index <= 0) return [...refs]
  const kept = keptFromFirst(d, storyboardId)
  if (!kept || refs.some((r) => r.id === kept.id)) return [...refs]
  return [await namedInput(relay, d, kept), ...refs]
}

function withoutOptional(r: JobInputRef): JobInputRef {
  const { optional: _o, ...rest } = r
  return rest
}

/** A name to offer for the person in frame 1: the first capitalised word of the shot's action that is not a stop word. */
export function suggestKey(action: string | undefined): string {
  const stop = new Set(['A', 'An', 'The', 'In', 'On', 'At', 'Close', 'Wide', 'Shot', 'Int', 'Ext', 'We', 'She', 'He', 'They', 'It'])
  const word = (action ?? '').match(/\b[A-Z][a-z]{1,23}\b/g)?.find((w) => !stop.has(w))
  return word ? cleanKey(word) : ''
}

/** Name frame 1's picture as `<key>_front`, a character. A name in use elsewhere is refused, in words. */
export async function keepCharacter(store: DocumentStore, asset: Sha256, typed: string): Promise<string> {
  const key = cleanKey(typed)
  const problem = nameProblem(key, 'front')
  if (problem) throw new Error(problem)
  const d = store.get()
  const name = `${key}_front`
  const taken = refsList(d).find((r) => nameOf(r) === name)
  if (taken && taken.asset !== asset) throw new Error(`@${name} is another picture. Pick another name.`)
  const k = keyNamed(d, key)
  if (k && k.role !== 'character') throw new Error(`@${key} is a ${k.role}, not a character. Pick another name.`)
  await updateDoc(store, (x) => {
    if (!keyNamed(x, key)) {
      const id = newId('key')
      x.keys[id] = { id, v: 1, field_v: {}, key, role: 'character' }
    }
    if (refsList(x).some((r) => nameOf(r) === name)) return
    const id = newId('ref')
    x.refs[id] = { id, v: 1, field_v: {}, key, variant: 'front', role: 'character', asset, named_at: new Date().toISOString() }
  }, `name ${name}`)
  return name
}
