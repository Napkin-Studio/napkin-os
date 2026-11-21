// Who a storyboard's frames show (features/pt-canvas-r2.clan; UAT round 2 R2-4: frames 2-4 copied frame 3, doubled Mia
// and the puppy and changed her hair, because a frame got only @anchor and @previous, as objects).
//
// - A frame after the first sends a character picture: the shot's own named character when it has one, else a
//   character the person kept from frame 1 ("Keep a person from this frame"), else frame 1 itself as the person.
// - "Keep a person from this frame" names frame 1's picture as <name>_front, a character, so every later frame (and
//   the canvas) has it by name.

import type { Id, JobInputRef, NamedRef, ProductionDocument, Sha256 } from '../contracts/types'
import type { DocumentStore } from '../doc/types'
import { updateDoc } from '../doc/store'
import { cleanKey, nameOf, nameProblem } from '../lib/names'
import { newId } from '../lib/ulid'
import { currentFrame, keyNamed, refsList, shotsOf } from '../model/selectors'
import type { Relay } from '../relay'
import { assetRef } from './assets'
import { namedInput, unnamedInput } from './select'

/** The character kept from a storyboard's first frame (a character ref on that picture), if any. */
export function keptFromFirst(d: ProductionDocument, storyboardId: Id | undefined): NamedRef | undefined {
  const first = shotsOf(d, storyboardId)[0]
  const frame = first ? currentFrame(d, first.id) : undefined
  if (!frame) return undefined
  return refsList(d).find((r) => r.asset === frame.asset && (keyNamed(d, r.key)?.role ?? r.role) === 'character')
}

/** The character picture a later frame sends when its own refs have none (undefined for the first shot, or when the
 *  refs carry a character already, or there is no first frame yet). */
export async function castRef(relay: Relay, d: ProductionDocument, storyboardId: Id | undefined, index: number, refs: readonly JobInputRef[]): Promise<JobInputRef | undefined> {
  if (index <= 0 || refs.some((r) => r.role === 'character' && !r.optional)) return undefined
  const kept = keptFromFirst(d, storyboardId)
  if (kept) return namedInput(relay, d, kept)
  const first = shotsOf(d, storyboardId)[0]
  const frame = first ? currentFrame(d, first.id) : undefined
  if (!frame) return undefined
  return { ...unnamedInput(frame.id, 'gen', await assetRef(relay, frame.asset), 'character'), label: 'the person from shot 1' }
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
