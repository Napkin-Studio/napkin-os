// The scene's Y shape (features/canvas-engine.clan, contracts: collab.md section 2;
// F1's per-element wrapper, split per field):
//
//   doc.getMap('elements'): Y.Map<elementId, Y.Map{
//     el:  Y.Map<field, value>   one key per small field: the common fields,
//                                style as 's:<key>', props as 'p:<key>'
//     pts: Uint8Array            a stroke's points (src/model/points.ts), written once
//   }>
//   doc.getMap('meta'): { schemaVersion: 1, sequence: <migrations applied> }
//
// A write sets only the keys whose value changed, so a move is x and y (about
// 130 B) and two people editing different fields of one element both keep their
// edit (ui-behaviour 4.4: last writer wins per field). The wrapper lets an undo of
// a create remove the whole entry even after someone else changed a field in it.
//
// Origins: LOCAL for a person's own edits, SYSTEM for writes that are nobody's
// step (seeding, migrations, fix-ups). Anything else is remote.

import * as Y from 'yjs'
import { COMMON_FIELDS, type ElementRecord, type Plain } from '../model/records'

export const ELEMENTS = 'elements'
export const META = 'meta'
export const LOCAL = 'local'
export const SYSTEM = 'system'

const STYLE = 's:'
const PROP = 'p:'
const SCALAR = COMMON_FIELDS.filter((f) => f !== 'style' && f !== 'props')

export const elementsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(ELEMENTS)
export const metaMap = (doc: Y.Doc) => doc.getMap<unknown>(META)

/** The flat key/value form of a record, as 'el' holds it. */
export function flatten(r: ElementRecord): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const f of SCALAR) out.set(f, r[f])
  for (const [k, v] of Object.entries(r.style)) if (v !== undefined) out.set(STYLE + k, v)
  for (const [k, v] of Object.entries(r.props)) if (v !== undefined) out.set(PROP + k, v)
  return out
}

/** The record an 'el' map holds, or undefined when it holds none yet. */
export function unflatten(id: string, el: Y.Map<unknown>): ElementRecord | undefined {
  if (!el.has('kind')) return undefined
  const r: Record<string, unknown> = { id, typeName: 'el', style: {}, props: {} }
  el.forEach((v, k) => {
    if (k.startsWith(STYLE)) (r.style as Record<string, unknown>)[k.slice(STYLE.length)] = v
    else if (k.startsWith(PROP)) (r.props as Record<string, unknown>)[k.slice(PROP.length)] = v
    else r[k] = v
  })
  return r as unknown as ElementRecord
}

const same = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && a !== null && JSON.stringify(a) === JSON.stringify(b))

/**
 * Write a record: a new element gets its entry, an existing one only the keys that changed (and
 * loses the keys it no longer has). Call inside a transaction. Returns the keys written.
 */
export function writeElement(map: Y.Map<Y.Map<unknown>>, r: ElementRecord): string[] {
  let entry = map.get(r.id)
  if (!(entry instanceof Y.Map)) {
    entry = new Y.Map<unknown>()
    map.set(r.id, entry)
  }
  let el = entry.get('el') as Y.Map<unknown> | undefined
  if (!(el instanceof Y.Map)) {
    el = new Y.Map<unknown>()
    entry.set('el', el)
  }
  const next = flatten(r)
  const written: string[] = []
  for (const [k, v] of next) {
    if (!same(el.get(k), v)) {
      el.set(k, v as Plain)
      written.push(k)
    }
  }
  for (const k of [...el.keys()]) if (!next.has(k)) {
    el.delete(k)
    written.push(k)
  }
  return written
}

/** Set a stroke's points. They are immutable: a second write throws. Call inside a transaction. */
export function writePoints(map: Y.Map<Y.Map<unknown>>, id: string, pts: Uint8Array) {
  let entry = map.get(id)
  if (!(entry instanceof Y.Map)) {
    entry = new Y.Map<unknown>()
    map.set(id, entry)
  }
  if (entry.has('pts')) throw new Error(`Stroke ${id}'s points are already written; points are never rewritten.`)
  entry.set('pts', pts)
}

export function readElement(map: Y.Map<Y.Map<unknown>>, id: string): ElementRecord | undefined {
  const entry = map.get(id)
  const el = entry instanceof Y.Map ? entry.get('el') : undefined
  return el instanceof Y.Map ? unflatten(id, el) : undefined
}

export function readPoints(map: Y.Map<Y.Map<unknown>>, id: string): Uint8Array | undefined {
  const entry = map.get(id)
  const pts = entry instanceof Y.Map ? entry.get('pts') : undefined
  return pts instanceof Uint8Array ? pts : undefined
}

export function readAll(map: Y.Map<Y.Map<unknown>>): ElementRecord[] {
  const out: ElementRecord[] = []
  map.forEach((_v, id) => {
    const r = readElement(map, id)
    if (r) out.push(r)
  })
  return out
}

/** The element ids a deep-observe batch touched. */
export function changedIds(events: readonly Y.YEvent<Y.AbstractType<unknown>>[], map: object): Set<string> {
  const ids = new Set<string>()
  for (const e of events) {
    if (e.target === map) {
      for (const k of e.changes.keys.keys()) ids.add(k)
      continue
    }
    let t: Y.AbstractType<unknown> | null = e.target
    while (t && t._item && t._item.parent !== map) t = t._item.parent as Y.AbstractType<unknown>
    const key = t?._item?.parentSub
    if (key) ids.add(key)
  }
  return ids
}
