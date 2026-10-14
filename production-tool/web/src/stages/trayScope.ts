// What a sketch area's links add to "What Dex will send" (ui-behaviour 3.16, item 1): the send tray
// lists the selection, and, from scopeOf, everything linked into the sketch area. A linked reference
// whose picture is on the canvas is sent with the sketch (its element joins the Generate); notes, ink
// and documents linked to it are listed, but a sketch Generate does not read them yet, so they say so.
// Names typed in the words that match no reference are a row too ("1 name isn't a reference").

import type { ProductionDocument } from '../contracts/types'
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
