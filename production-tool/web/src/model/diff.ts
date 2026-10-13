// A panel's change, as the buses carry it (contracts/collab.md §7).
//
// Today's panels change a draft of the document; this turns before → after
// into field patches (creates, deletes, one set per leaf) and the live-text
// writes for the fields text owns (a shot's action and direction, a beat's,
// scene's or note's words), which go through TextBus, never a patch.

import { TEXT_OWNED, type Patch, type PMNode, type Prose } from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { MAP_NAMES } from '../contracts/types'

type Doc = ProductionDocument
type Obj = Record<string, unknown>

export type TextKind = 'shot' | 'scene' | 'beat' | 'review'
export const KIND_OF_MAP: Record<string, TextKind> = { shots: 'shot', scenes: 'scene', beats: 'beat', reviews: 'review' }

export interface TextWrite { kind: TextKind; id: string; prose: Prose }

export interface Change {
  patches: Patch[]
  text: TextWrite[]
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
/** A value as the document keeps it: the store writes RFC 7396 merge patches, where a null inside an
 * object means "remove", so an object's null fields never survive a write. Compared and written without
 * them; otherwise a draft holding one (a director's `question: null`) differs from the store for ever and
 * every later change writes that field again (a job's director re-set by another job's start). */
export function stored(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stored)
  if (isObj(v)) {
    const out: Obj = {}
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) out[k] = stored(x)
    return out
  }
  return v
}
const same = (a: unknown, b: unknown) => JSON.stringify(stored(a)) === JSON.stringify(stored(b))
const BUS_OWNED = new Set(['id', 'v', 'field_v'])
const COMPOSITE = new Set(['camera', 'pick'])

/** The leaf patches that turn entity `a` into `b` (both whole entities of map `entity`). */
function leafSets(entity: string, id: string, a: Obj, b: Obj, base: number, out: Patch[]) {
  const owned = TEXT_OWNED[entity as keyof typeof TEXT_OWNED] ?? []
  const set = (path: string, value: unknown) => out.push({ op: 'set', entity: entity as Patch['entity'], id, path, value: value === undefined || value === null ? null : stored(value), base_version: base })
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (BUS_OWNED.has(f) || owned.includes(f) || same(a[f], b[f])) continue
    if (COMPOSITE.has(f)) {
      // Part by part, whether the whole was there before or not (a first pick, a pick taken away).
      const x = (isObj(a[f]) ? a[f] : {}) as Obj
      const y = (isObj(b[f]) ? b[f] : {}) as Obj
      for (const p of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[p], y[p])) set(`${f}/${p}`, y[p])
      continue
    }
    if (f === 'edl' && entity === 'videos' && isObj(a[f]) && isObj(b[f])) {
      const x = a[f] as Record<string, Obj>
      const y = b[f] as Record<string, Obj>
      for (const item of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (same(x[item], y[item])) continue
        if (!x[item] || !y[item]) { set(`edl/${item}`, y[item]); continue }
        for (const g of new Set([...Object.keys(x[item]), ...Object.keys(y[item])])) {
          if (same(x[item][g], y[item][g])) continue
          if (g === 'pick' && isObj(x[item][g]) && isObj(y[item][g])) {
            for (const p of ['current', 'alternates']) if (!same((x[item][g] as Obj)[p], (y[item][g] as Obj)[p])) set(`edl/${item}/pick/${p}`, (y[item][g] as Obj)[p])
          } else if (g === 'pick') set(`edl/${item}`, y[item]) // a pick added or taken away: the item whole
          else set(`edl/${item}/${g}`, y[item][g])
        }
      }
      continue
    }
    set(f, b[f])
  }
}

/** Prose from plain words: one block per line; @names that match a ref (key_variant) or a key
 * (the whole character) become mentions, so a rename follows them and the shot's refs are known. */
export function proseFromText(d: Doc, lines: { type: string; text: string }[]): Prose {
  const refs = Object.values(d.refs ?? {})
  const keys = Object.values(d.keys ?? {})
  const content: PMNode[] = []
  for (const { type, text } of lines) {
    for (const line of text.split('\n')) {
      const inline: PMNode[] = []
      const re = /@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)/g
      let last = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line))) {
        const name = m[1]
        const ref = refs.find((r) => `${r.key}_${r.variant}` === name)
        const key = !ref && !name.includes('_') ? keys.find((k) => k.key === name) : undefined
        const target = ref ?? key
        if (!target) continue
        if (m.index > last) inline.push({ type: 'text', text: line.slice(last, m.index) })
        inline.push({ type: 'mention', attrs: { id: target.id, label: name } })
        last = m.index + m[0].length
      }
      const rest = line.slice(last)
      if (rest) inline.push({ type: 'text', text: rest })
      content.push(inline.length ? { type, content: inline } : { type })
    }
  }
  return { type: 'doc', content }
}

/** The prose an entity's flat text fields stand for, when a panel changed them as words. */
export function proseOfFields(d: Doc, kind: TextKind, e: Obj): Prose {
  if (kind === 'shot') {
    const lines = [{ type: 'action', text: String(e.action ?? '') }]
    if (e.direction) lines.push({ type: 'direction', text: String(e.direction).replace(/\n/g, ' ') })
    return proseFromText(d, lines)
  }
  if (kind === 'beat') return proseFromText(d, [{ type: e.kind === 'line' ? 'dialogue' : 'action', text: String(e.text ?? '').replace(/\n/g, ' ') }])
  return proseFromText(d, [{ type: 'action', text: String(e.text ?? '') }])
}

/** before → after as patches and text writes. */
export function changeOf(before: Doc, after: Doc): Change {
  const patches: Patch[] = []
  const text: TextWrite[] = []
  const maps = [...MAP_NAMES, 'assets'] as const
  for (const map of maps) {
    const a = ((before as unknown as Record<string, Record<string, Obj>>)[map]) ?? {}
    const b = ((after as unknown as Record<string, Record<string, Obj>>)[map]) ?? {}
    const textKind = KIND_OF_MAP[map]
    const owned = TEXT_OWNED[map as keyof typeof TEXT_OWNED] ?? []
    for (const id of Object.keys(a)) if (!(id in b)) patches.push({ op: 'delete', entity: map as Patch['entity'], id, base_version: Number(a[id].v ?? 0) })
    for (const [id, e] of Object.entries(b)) {
      if (!(id in a)) {
        const value: Obj = {}
        for (const [k, v] of Object.entries(e)) if (!BUS_OWNED.has(k) && !owned.includes(k)) value[k] = stored(v)
        patches.push({ op: 'create', entity: map as Patch['entity'], id, value: map === 'assets' ? stored(e) : value, base_version: 0 })
        if (textKind && owned.some((f) => f !== 'last_writer' && e[f] !== undefined && f !== 'refs' && f !== 'text_problem')) {
          text.push({ kind: textKind, id, prose: (e.prose as Prose | undefined) ?? proseOfFields(after, textKind, e) })
        }
        continue
      }
      if (same(a[id], e)) continue
      if (map === 'assets') {
        patches.push({ op: 'delete', entity: 'assets', id, base_version: 0 }, { op: 'create', entity: 'assets', id, value: stored(e), base_version: 0 })
        continue
      }
      leafSets(map, id, a[id], e, Number(a[id].v ?? 0), patches)
      if (textKind) {
        // Today's panels change words, never prose: the words, as prose, go to the fragment. (prose,
        // refs and last_writer are checkpoint()'s; a draft made before a checkpoint may hold older ones.)
        const changed = ['action', 'direction', 'text'].some((f) => owned.includes(f) && (a[id][f] ?? '') !== (e[f] ?? ''))
        if (changed) text.push({ kind: textKind, id, prose: proseOfFields(after, textKind, e) })
      }
    }
  }
  if (!same(before.project, after.project)) {
    const a = before.project as unknown as Obj
    const b = after.project as unknown as Obj
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (f !== 'id' && !same(a[f], b[f])) patches.push({ op: 'set', entity: 'project', id: before.project.id, path: f, value: b[f] === undefined || b[f] === null ? null : stored(b[f]), base_version: 0 })
    }
  }
  return { patches, text }
}
