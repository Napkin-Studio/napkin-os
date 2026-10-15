// What a sketch area's links add to "What Dex will send" (ui-behaviour 3.16, item 1): the send tray
// lists the selection, and, from scopeOf, everything linked into the sketch area. A linked reference
// whose picture is on the canvas is sent with the sketch (its element joins the Generate); notes, ink
// and documents linked to it are listed, but a sketch Generate does not read them yet, so they say so.
// Names typed in the words that match no reference are a row too ("1 name isn't a reference").
// A linked key is one row naming the views that go ("@samurai · 3 views · character (linked) · sends
// front, side, back").

import type { DirectorAddition, ProductionDocument } from '../contracts/types'
import { shotRefSet, type ShotRefFrom } from '../jobs/select'
import { byOwnId, cd } from '../canvas/sceneRead'
import type { ElementLike } from '../canvas/core/canvasAdapter'
import { refName } from '../model/selectors'
import { scopeOf, type ScopeItem } from '../model/scope'

export interface LinkedRow {
  /** The row's key for its tick. */
  key: string
  item: ScopeItem
  /** "@ref_golden-hour · lighting (linked)". */
  label: string
  /** The canvas elements a tick adds to the Generate; none when it cannot be sent from here. */
  elIds: string[]
  /** Why it is not sent, when it is not. */
  off?: string
}

/** The sketch area a selection generates from, if one. */
export function sketchOf(els: readonly ElementLike[], ids: readonly string[]): string | undefined {
  for (const id of ids) {
    const c = cd(els.find((e) => e.id === id))
    if (c?.kind === 'sketch') return c.id
  }
  return undefined
}

/** The rows a sketch area's links add, leaving out what the selection already sends. */
export function linkedRows(doc: ProductionDocument, sketchId: string | undefined, els: readonly ElementLike[], selected: readonly string[]): LinkedRow[] {
  if (!sketchId) return []
  const chosen = new Set(selected.flatMap((id) => {
    const c = cd(els.find((e) => e.id === id))
    return c && 'id' in c ? [c.id] : []
  }))
  const rows: LinkedRow[] = []
  for (const it of scopeOf(doc, sketchId)) {
    if (it.via === 'mention' || it.kind === 'unknown' || it.kind === 'board' || it.kind === 'group') continue
    const key = `${it.kind}:${it.id}`
    // A linked key (owner 2026-10-15) is one row that says which of its views go: at most 4, the front first.
    if (it.kind === 'key' && it.sends) {
      const sends = it.sends.map((id) => doc.refs[id]).filter((r) => !!r)
      const on = sends.flatMap((r) => (r.node && !chosen.has(r.node) ? [byOwnId(els, r.node)?.id] : [])).filter((x): x is string => !!x)
      const held = (it.count ?? 0) - sends.length
      const which = `sends ${sends.map((r) => r.variant).join(', ') || 'no picture'}${held > 0 ? ` (${held} more ${held === 1 ? 'stays' : 'stay'} out: 4 views at most)` : ''}`
      rows.push({ key, item: it, label: `${it.label} · ${it.role} (linked) · ${which}`, elIds: on, ...(on.length ? {} : { off: 'its pictures are not on the canvas' }) })
      continue
    }
    if (it.kind === 'ref' && it.through && doc.keys?.[it.through]) continue // in its key's row
    if (it.kind === 'ref') {
      const r = doc.refs[it.id]
      const el = r?.node ? byOwnId(els, r.node) : undefined
      if (r?.node && chosen.has(r.node)) continue // selected: it is a row already
      const how = it.via === 'board' ? `on ${doc.boards[it.through ?? '']?.title ?? 'a linked board'}` : 'linked'
      rows.push({ key, item: it, label: `@${r ? refName(r) : it.name} · ${it.role} (${how})`, elIds: el ? [el.id] : [], ...(el ? {} : { off: 'its picture is not on the canvas' }) })
      continue
    }
    rows.push({ key, item: it, label: `${it.label} · ${it.role} (linked)`, elIds: [], off: 'not sent with a sketch yet' })
  }
  return rows
}

const TYPED = /(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)/g

/** The @names typed in the words that name no reference or key ("1 name isn't a reference: @jogger"). */
export function unknownTyped(doc: ProductionDocument, text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(TYPED)) {
    const n = m[1]
    const known = Object.values(doc.refs ?? {}).some((r) => refName(r) === n) || (!n.includes('_') && Object.values(doc.keys ?? {}).some((k) => k.key === n))
    if (!known && !out.includes(n)) out.push(n)
  }
  return out
}

// ── a shot's references (owner 2026-10-15, features/canvas-nodes.clan) ─────────────────────────────

/** One reference row of a shot in "What Dex will send": what the shot asks for (its words, its links), or
 *  what Dex added last time, with why, which the person can untick. */
export interface ShotRefRow {
  key: string
  kind: 'asked' | 'added'
  /** "@samurai" (a key whose views all go), "@samurai_front", or "Added by Dex: @hall_wide". */
  label: string
  /** "front, three-quarter, side, back · from its words", "linked", or Dex's why. */
  detail: string
  /** The refs the row stands for. */
  refIds: string[]
  /** Ticked: it goes (asked rows always do). */
  on: boolean
}

const FROM_WORDS: Record<Exclude<ShotRefFrom, 'offered'>, string> = { words: 'from its words', linked: 'linked to the shot' }

/** What Dex added to this shot's newest frame or clip, by reference (the providerJob's ref with that tag,
 *  matched to the reference whose picture it is). */
export function lastAdditions(doc: ProductionDocument, shotId: string): { refId: string; name: string; why: string }[] {
  const jobs = Object.values(doc.jobs ?? {})
    .filter((j) => (j.op === 'frame' || j.op === 'clip') && j.node?.id === shotId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  for (const j of jobs) {
    const out = (j.director?.output ?? {}) as { added?: DirectorAddition[]; providerJob?: { refs?: { name: string; sha256: string }[] } }
    if (!out.added?.length) continue
    return out.added.flatMap((a) => {
      const sha = out.providerJob?.refs?.find((r) => r.name === a.name)?.sha256
      const ref = sha ? Object.values(doc.refs ?? {}).find((r) => r.asset === sha) : undefined
      return ref ? [{ refId: ref.id, name: refName(ref), why: a.why }] : []
    })
  }
  return []
}

/**
 * A shot's reference rows: first what its words name and what is linked into it, a key whose views all go
 * as one row ("@samurai · front, three-quarter, side, back · from its words"); then each reference Dex added
 * to the shot's newest frame or clip, "Added by Dex: @x · why", ticked unless the person unticked it
 * (`declined`). Unticking keeps it out of what is offered to Dex for this shot (jobs/select.ts shotRefSet).
 */
export function shotRefRows(doc: ProductionDocument, shotId: string, declined: readonly string[] = []): ShotRefRow[] {
  const shot = doc.shots[shotId]
  if (!shot) return []
  let set: ReturnType<typeof shotRefSet>
  try { set = shotRefSet(doc, shot, '', declined) } catch { set = [] } // a name with no picture: the shot says so itself
  const rows: ShotRefRow[] = []
  const asked = set.filter((x) => x.from !== 'offered')
  const groups = new Map<string, typeof asked>()
  for (const x of asked) {
    const k = `${x.from}:${x.ref.key}`
    groups.set(k, [...(groups.get(k) ?? []), x])
  }
  for (const [k, xs] of groups) {
    const from = FROM_WORDS[xs[0].from as Exclude<ShotRefFrom, 'offered'>]
    const one = xs.length === 1
    rows.push({
      key: `asked:${k}`, kind: 'asked', on: true, refIds: xs.map((x) => x.ref.id),
      label: one ? `@${refName(xs[0].ref)}` : `@${xs[0].ref.key}`,
      detail: one ? from : `${xs.map((x) => x.ref.variant).join(', ')} · ${from}`,
    })
  }
  for (const a of lastAdditions(doc, shotId)) {
    if (rows.some((r) => r.kind === 'asked' && r.refIds.includes(a.refId))) continue // the words name it now
    rows.push({ key: `added:${a.refId}`, kind: 'added', label: `Added by Dex: @${a.name}`, detail: a.why, refIds: [a.refId], on: !declined.includes(a.refId) })
  }
  return rows
}
