// The @ mention module (ui-behaviour 3.6, review item 9): what a person can name in a text,
// grouped and matched; the closest name to one that matches nothing; and the link a mention
// of an unlinked reference makes. Pure, with no editor in it, so every editor (script,
// storyboard, video notes) uses the same rules. Built here by features/script-editor.clan in
// the place mention-input names (web/src/text/mention/), for mention-input to adopt.

import type { Id, Link, LinkEndpointKind, ProductionDocument, RefRole } from '../../contracts/types'
import { isKeyGroup, keyViews } from '../../lib/names'

type Doc = ProductionDocument

export type MentionGroup = 'Characters' | 'Locations' | 'Products' | 'References' | 'Other'
export const GROUP_ORDER: MentionGroup[] = ['Characters', 'Locations', 'Products', 'References', 'Other']

export interface MentionItem {
  /** What the mention stores: a ref's id (one look) or a key's id (the whole character). */
  id: Id
  /** The name typed after @: key_variant, or the key alone. */
  name: string
  /** The person's own words for it ("Maya's beach outfit"), matched too. */
  label?: string
  role: RefRole
  group: MentionGroup
  /** A picture for the row. */
  asset?: string
  kind: 'ref' | 'key'
  /** Linked to this text's node (a ref→script link): in scope. */
  linked: boolean
}

/** Roles with pictures that are not characters, places or products. */
const PICTURE_ROLES: RefRole[] = ['lighting', 'composition', 'style', 'wardrobe', 'pose', 'prop', 'texture', 'colour', 'layout', 'logo']

export function groupOf(role: RefRole): MentionGroup {
  if (role === 'character') return 'Characters'
  if (role === 'location') return 'Locations'
  if (role === 'product') return 'Products'
  if (PICTURE_ROLES.includes(role)) return 'References'
  return 'Other'
}

const linksInto = (d: Doc, kind: 'ref' | 'key', id: Id, node: { kind: LinkEndpointKind; id: Id }) =>
  Object.values(d.links ?? {}).some((l) => l.from.kind === kind && l.from.id === id && l.to.kind === node.kind && l.to.id === node.id)

/** The key entry of a key name. */
const keyEntry = (d: Doc, key: string) => Object.values(d.keys ?? {}).find((k) => k.key === key)

/** Whether a whole key is linked to the node (a key→node link; owner 2026-10-15). */
export function isKeyLinked(d: Doc, keyId: Id, node: { kind: LinkEndpointKind; id: Id }): boolean {
  return linksInto(d, 'key', keyId, node)
}

/** Whether a ref is linked to the node: its own ref→node link of any role, or its key's. */
export function isLinked(d: Doc, refId: Id, node: { kind: LinkEndpointKind; id: Id }): boolean {
  if (linksInto(d, 'ref', refId, node)) return true
  const k = d.refs?.[refId] ? keyEntry(d, d.refs[refId].key) : undefined
  return !!k && isKeyLinked(d, k.id, node)
}

/**
 * Everything that can be named, in the popover's order: Characters, Locations, Products, References,
 * then the rest, each A–Z. A key with two or more views (one character, owner 2026-10-15), or with a
 * front, is offered as the whole group, "@samurai · 3 views", right above its views.
 */
export function mentionSource(d: Doc, node: { kind: LinkEndpointKind; id: Id }): MentionItem[] {
  const out: MentionItem[] = []
  const refs = Object.values(d.refs ?? {})
  for (const k of Object.values(d.keys ?? {})) {
    const { views, sent } = keyViews(d, k.key)
    if (views.length < 2 && !views.some((r) => r.variant === 'front')) continue
    const lead = sent[0] ?? views[0]
    out.push({
      id: k.id, name: k.key, label: `${views.length} ${views.length === 1 ? 'view' : 'views'}`, role: k.role, group: groupOf(k.role), ...(lead?.asset ? { asset: lead.asset } : {}),
      kind: 'key', linked: isKeyLinked(d, k.id, node) || views.some((r) => isLinked(d, r.id, node)),
    })
  }
  for (const r of refs) {
    out.push({ id: r.id, name: `${r.key}_${r.variant}`, ...(r.label ? { label: r.label } : {}), role: r.role, group: groupOf(r.role), asset: r.asset, kind: 'ref', linked: isLinked(d, r.id, node) })
  }
  return out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** The items a query after @ finds: by name (start, then anywhere) or by the words of its label. Order kept. */
export function matchMentions(items: MentionItem[], query: string): MentionItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return items
  const words = q.split(/\s+/)
  return items.filter((i) => {
    if (i.name.includes(q.replace(/\s+/g, '_'))) return true
    const label = (i.label ?? '').toLowerCase()
    return !!label && words.every((w) => label.includes(w))
  }).sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)))
}

/** Damerau–Levenshtein distance (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** The known name closest to an unknown one, within 2 edits, or null ('Did you mean @maya_laughing?'). */
export function closestName(name: string, names: string[]): string | null {
  let best: { n: string; d: number } | null = null
  for (const n of names) {
    const dist = editDistance(name, n)
    if (dist <= 2 && (!best || dist < best.d)) best = { n, d: dist }
  }
  return best?.n ?? null
}

/**
 * The link a mention of something unlinked makes (3.6 "Insert a reference that isn't linked": the
 * group it sits in is linked), or null when none is needed: a key, or a view of a key with two or
 * more views, links the whole key once (owner 2026-10-15), in the key's role; a lone ref links itself.
 */
export function linkForMention(d: Doc, item: Pick<MentionItem, 'id' | 'kind'>, node: { kind: LinkEndpointKind; id: Id }, newId: () => Id): Link | null {
  const ref = item.kind === 'ref' ? d.refs?.[item.id] : undefined
  const key = item.kind === 'key' ? d.keys?.[item.id] : ref && isKeyGroup(d, ref.key) ? keyEntry(d, ref.key) : undefined
  if (key) {
    if (isKeyLinked(d, key.id, node) || (ref && isLinked(d, ref.id, node))) return null
    return { id: newId(), v: 1, field_v: {}, from: { kind: 'key', id: key.id }, to: node, role: key.role }
  }
  if (!ref || isLinked(d, ref.id, node)) return null
  return { id: newId(), v: 1, field_v: {}, from: { kind: 'ref', id: ref.id }, to: node, role: ref.role }
}

/** What a link made for a mention brings in, in the toast's words: "@samurai · 3 views", or "@maya_side". */
export function linkWords(d: Doc, link: Pick<Link, 'from'>): string {
  if (link.from.kind === 'key') {
    const k = d.keys?.[link.from.id]
    const n = k ? keyViews(d, k.key).views.length : 0
    return k ? `@${k.key} · ${n} ${n === 1 ? 'view' : 'views'}` : 'the character'
  }
  const r = d.refs?.[link.from.id]
  return r ? `@${r.key}_${r.variant}` : 'the reference'
}
