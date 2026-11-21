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

import type { Id, JobInputRef, JobShot, NamedRef, ProductionDocument, Sha256, Shot } from '../contracts/types'
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

/** Words that bring in a person of their own: "a flatmate", "the neighbour", "a woman". Unless the shot names a character
 *  too, that person is someone else, never the project's character (UAT round 4, R4-F2: "Behind the thin wall, a flatmate
 *  keeps snoring" drew @maya as the flatmate). Pronouns and body parts ("her hand", "she whispers") are not here: they
 *  carry on with whoever the film is about. */
const PERSON_NOUNS = /\b(?:wom[ae]n|m[ae]n|girls?|boys?|guys?|lad(?:y|ies)|gentlem[ae]n|persons?|people|someone|somebody|anyone|everyone|child(?:ren)?|kids?|bab(?:y|ies)|toddlers?|teens?|teenagers?|adults?|friends?|flatmates?|roommates?|housemates?|neighbou?rs?|couple|family|mum|mom|dad|mother|father|sisters?|brothers?|wife|husband|partner|customers?|shoppers?|workers?|chef|cook|driver|crowd|audience|strangers?|passers?-?by|colleagues?|guests?)\b/i

/** A shot's words, its @mentions as spaces. */
const plainWords = (shot: Shot) => [shot.action ?? '', shot.direction ?? ''].join(' ')

/** Whether a shot's words name or imply a person: a character it names (its refs or an @mention of a character key),
 *  a spoken line or its speaker, a character key's name in plain words, or a person word. A kettle insert or a wall
 *  close names no one (UAT round 3 R3-F1). */
export function namesPerson(d: ProductionDocument, shot: Shot): boolean {
  if (namedCharacters(d, shot).size) return true
  if (beatsOf(d, shot.id).some((b) => b.kind === 'line' || !!b.speaker)) return true
  return PERSON_WORDS.test(plainWords(shot).replace(/@[a-z0-9_-]+/gi, ' '))
}

/** The character keys a shot names: its refs, an @mention of the key or one of its views, a spoken line's speaker who
 *  is that character, or the key's name in plain words ("Maya whispers"). */
export function namedCharacters(d: ProductionDocument, shot: Shot): Set<string> {
  const out = new Set<string>()
  const keyOf = (name: string) => name.toLowerCase().split('_')[0]
  const isCharacter = (name: string) => (keyNamed(d, keyOf(name))?.role ?? refsList(d).find((r) => nameOf(r) === name.toLowerCase())?.role) === 'character'
  for (const n of shotSubjects(d, shot)) if (isCharacter(n)) out.add(keyOf(n))
  for (const m of plainWords(shot).matchAll(/@([a-z0-9][a-z0-9_-]*)/gi)) if (isCharacter(m[1])) out.add(keyOf(m[1]))
  const plain = plainWords(shot).replace(/@[a-z0-9_-]+/gi, ' ')
  for (const k of keysList(d)) {
    if (k.role !== 'character') continue
    const word = k.key.replace(/[^a-z0-9]/gi, '')
    const re = new RegExp(`\\b${word}\\b`, 'i')
    if (re.test(plain) || beatsOf(d, shot.id).some((b) => !!b.speaker && re.test(b.speaker))) out.add(k.key.toLowerCase())
  }
  return out
}

/** The shot brings in a person of its own (a person noun) and names no character: someone else is seen. */
export function unnamedPerson(d: ProductionDocument, shot: Shot): string | undefined {
  if (namedCharacters(d, shot).size) return undefined
  return PERSON_NOUNS.exec(plainWords(shot).replace(/@[a-z0-9_-]+/gi, ' '))?.[0]
}

/** What the Director agent reads about an unnamed person: someone else, not the project's character (R4-F2). Said in
 *  plain names (no @, so the relay never looks for a picture of it). */
export function someoneElseLine(person: string, others: readonly string[]): string {
  const who = others.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(' or ')
  return `Cast: the ${person.toLowerCase()} here is someone else${who ? `, not ${who}` : ''}; draw a different person.`
}

/** A shot's offered character pictures with an unnamed person: they go, so no character is drawn as someone else, and
 *  the keys they were of. Refs as they are otherwise. */
export function withoutOfferedCast(d: ProductionDocument, shot: Shot, refs: readonly JobInputRef[]): { refs: JobInputRef[]; person?: string; dropped: string[] } {
  const person = unnamedPerson(d, shot)
  if (!person) return { refs: [...refs], dropped: [] }
  const gone = refs.filter((r) => r.role === 'character' && r.optional)
  return { refs: refs.filter((r) => !gone.includes(r)), person, dropped: [...new Set(gone.map((r) => (r.name ?? '').split('_')[0]).filter(Boolean))] }
}

/** The shot as a job sends it, told when its person is someone else: the offered characters' names in a Cast line
 *  of its direction (R4-F2: "Dex is told the person is someone else, not @maya"). As it is otherwise. */
export function castShot(d: ProductionDocument, shot: Shot, js: JobShot, offered: readonly JobInputRef[]): JobShot {
  const person = unnamedPerson(d, shot)
  if (!person) return js
  const others = [...new Set(offered.filter((r) => r.role === 'character').map((r) => (r.name ?? '').split('_')[0]).filter(Boolean))]
  if (!others.length) return js
  return { ...js, direction: [js.direction, someoneElseLine(person, others)].filter(Boolean).join('\n').slice(0, 4000) }
}

/** What the Director agent reads about a shot that shows no one (UAT round 5, R5-F3: the kettle insert drew Maya, who
 *  came in through @previous). The relay says it in the frame's prompt too (director.py NO_PEOPLE). */
export const NO_ONE_LINE = 'Cast: no one is seen in this shot; draw no people.'

/** A frame's shot as it goes when it shows no one: the no-one line in its direction (R5-F3). As it is otherwise. */
export function noOneShot(d: ProductionDocument, shot: Shot, js: JobShot): JobShot {
  if (namesPerson(d, shot)) return js
  return { ...js, direction: [js.direction, NO_ONE_LINE].filter(Boolean).join('\n').slice(0, 4000) }
}

/**
 * The character pictures a frame sends (R3-F1, R4-F2): a character only when the shot names it (an @mention, its name,
 * a speaker who is it), and then all its pictures, required. A shot that brings in an unnamed person ("a flatmate")
 * gets no character picture: that person is someone else. A shot that speaks of a person only by pronoun or body part
 * ("her hand") carries on with the one character the storyboard offers, else, for a later frame, the person kept from
 * frame 1. A shot with no person keeps its refs as they are (offered pictures stay Dex's to leave out). Never frame 1
 * as an unnamed person.
 */
export async function castRefs(relay: Relay, d: ProductionDocument, storyboardId: Id | undefined, index: number, shot: Shot, refs: readonly JobInputRef[]): Promise<JobInputRef[]> {
  const offered = refs.filter((r) => r.role === 'character' && r.optional)
  const keyOf = (r: JobInputRef) => (r.name ?? '').split('_')[0].toLowerCase()
  const named = namedCharacters(d, shot)
  if (offered.some((r) => named.has(keyOf(r)))) return refs.map((r) => (offered.includes(r) && named.has(keyOf(r)) ? withoutOptional(r) : r))
  if (named.size && refs.some((r) => r.role === 'character' && !r.optional)) return [...refs]
  if (!namesPerson(d, shot)) return [...refs]
  if (unnamedPerson(d, shot)) return withoutOfferedCast(d, shot, refs).refs
  if (refs.some((r) => r.role === 'character' && !r.optional)) return [...refs]
  const keys = new Set(offered.map(keyOf))
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
