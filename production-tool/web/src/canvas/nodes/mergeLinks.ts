// One key, one link (owner, Shrey 2026-10-15; features/canvas-nodes.clan): when pictures form a key
// group, the links their views had into a target before they were one group merge into the key link
// (from the whole key, chip "@samurai · 3 views"), as one undo step said "Linked as @samurai · 3 views".
// A view-only link stays only when it was made on purpose, with ⌥, after the views were a group.
//
// Which is which needs no new field: a link's id is a ULID (it carries when it was made) and each view
// says when it was named (named_at). A view joined its group when the group formed (its second view
// named) or when it was itself named, whichever is later; a link from it made before that was made to
// the view alone and merges. One made after it can only have been made with ⌥, and stays. Pure.

import type { KeyEntry, Link, LinkEndpoint, ProductionDocument } from '../../contracts/types'
import { isKeyGroup, keyViews } from '../../lib/names'
import { newId } from '../../lib/ulid'
import { keysList } from '../../model/selectors'
import { systemUpdate } from '../../doc/store'
import type { DocumentStore } from '../../doc/types'
import type { CanvasAdapter } from '../core/canvasAdapter'
import { elementOfEnd, groupOf, linkIdOf, type LinkMemory } from './nodes'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** When an id was made (ms), from its ULID's time part; NaN when it has none. */
export function idTime(id: string): number {
  const u = id.slice(id.indexOf('_') + 1, id.indexOf('_') + 11)
  if (u.length !== 10) return NaN
  let t = 0
  for (const c of u) {
    const v = CROCKFORD.indexOf(c)
    if (v < 0) return NaN
    t = t * 32 + v
  }
  return t
}

const at = (iso: string | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : NaN
}

export interface KeyMerge {
  key: KeyEntry
  /** How many views the key has ("3 views"). */
  views: number
  /** Per target: the view links that go, and the key link that takes their place (null: it is there already). */
  targets: { to: LinkEndpoint; drop: Link[]; add: Link | null }[]
}

/**
 * The merges due now: for each key that is a group, its views' links made before they were one group,
 * by target. `declined`: link ids already merged once this session (an undo brought them back, and
 * they stay as the person left them).
 */
export function keyLinkMerges(doc: ProductionDocument, declined: ReadonlySet<string> = new Set()): KeyMerge[] {
  const links = Object.values(doc.links ?? {})
  const out: KeyMerge[] = []
  for (const k of keysList(doc)) {
    if (!isKeyGroup(doc, k.key)) continue
    const { views } = keyViews(doc, k.key)
    const named = views.map((v) => at(v.named_at)).sort((a, b) => a - b)
    // The group formed when its second view was named; not known: it counts as now (everything merges).
    const formed = Number.isFinite(named[1]) ? named[1] : Infinity
    const joined = new Map(views.map((v) => {
      const t = at(v.named_at)
      return [v.id, Math.max(formed, Number.isFinite(t) ? t : Infinity)] as const
    }))
    const byTarget = new Map<string, { to: LinkEndpoint; drop: Link[] }>()
    for (const l of links) {
      if (l.from.kind !== 'ref' || !joined.has(l.from.id) || declined.has(l.id)) continue
      const made = idTime(l.id)
      // Made after its view was in the group: only ⌥ makes that, on purpose. It stays.
      if (Number.isFinite(made) && made >= joined.get(l.from.id)!) continue
      const t = `${l.to.kind}:${l.to.id}`
      const row = byTarget.get(t) ?? { to: l.to, drop: [] }
      row.drop.push(l)
      byTarget.set(t, row)
    }
    if (!byTarget.size) continue
    const targets = [...byTarget.values()].map(({ to, drop }) => {
      const there = links.some((l) => l.from.kind === 'key' && l.from.id === k.id && l.to.kind === to.kind && l.to.id === to.id)
      const add: Link | null = there ? null : { id: newId('link'), v: 1, field_v: {}, from: { kind: 'key', id: k.id }, to, role: k.role }
      return { to, drop: drop.sort((a, b) => (a.id < b.id ? -1 : 1)), add }
    })
    out.push({ key: k, views: views.length, targets })
  }
  return out
}

/** "Linked as @samurai · 3 views". */
export const mergeWords = (m: Pick<KeyMerge, 'key' | 'views'>) => `Linked as @${m.key.key} · ${m.views} ${m.views === 1 ? 'view' : 'views'}`

/**
 * Make the merges (the node layer runs this when the document changes): the views' link elements go
 * and the key link's element comes, as the person's one undo step on the canvas; the document follows
 * as a system write. Their old link ids join `declined`, so an undo that brings them back is final.
 * `mem`: the node layer's link memory, told the views' links were taken out here (an undo puts them back).
 * Returns the new key link elements' ids (empty when nothing was due).
 */
export function applyKeyMerges(canvas: CanvasAdapter, store: DocumentStore, merges: readonly KeyMerge[], declined: Set<string>, mem?: LinkMemory): string[] {
  if (!merges.length) return []
  const doc = store.get()
  const els = canvas.elements()
  const drop = new Set(merges.flatMap((m) => m.targets.flatMap((t) => t.drop.map((l) => l.id))))
  for (const id of drop) {
    declined.add(id)
    // Taken out by this canvas (not by someone else), so an undo puts them back in the document.
    mem?.unlinked.add(id)
  }
  const made: string[] = []
  canvas.transact((all) => {
    let out = all.map((e) => (drop.has(linkIdOf(e) ?? '') && !e.isDeleted ? canvas.patch(e, { isDeleted: true }) : e))
    for (const m of merges) for (const t of m.targets) {
      if (!t.add) continue
      const from = elementOfEnd(els, doc, t.add.from)
      const to = elementOfEnd(els, doc, t.add.to)
      if (!from || !to) continue
      const el = canvas.link({ fromElId: from.id, toElId: to.id, role: t.add.role, linkId: t.add.id, ...groupOf(doc, t.add.from) })
      made.push(el.id)
      out = canvas.bindArrow([...out, el], el)
    }
    return out
  }, { undoable: true })
  void systemUpdate(store, (d) => {
    for (const m of merges) for (const t of m.targets) {
      for (const l of t.drop) delete d.links[l.id]
      if (t.add) d.links[t.add.id] = t.add
    }
  }, `link ${merges.map((m) => `@${m.key.key}`).join(', ')} as one`).catch((e) => console.warn('the key links were not merged', e))
  return made
}
