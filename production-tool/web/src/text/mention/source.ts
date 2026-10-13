// The @ mention module (ui-behaviour 3.6, review item 9): what a person can name in a text,
// grouped and matched; the closest name to one that matches nothing; and the link a mention
// of an unlinked reference makes. Pure, with no editor in it, so every editor (script,
// storyboard, video notes) uses the same rules. Built here by features/script-editor.clan in
// the place mention-input names (web/src/text/mention/), for mention-input to adopt.

import type { Id, Link, LinkEndpointKind, ProductionDocument, RefRole } from '../../contracts/types'

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

/** Whether a ref is linked to the node (a ref→node link of any role). */
export function isLinked(d: Doc, refId: Id, node: { kind: LinkEndpointKind; id: Id }): boolean {
  return Object.values(d.links ?? {}).some((l) => l.from.kind === 'ref' && l.from.id === refId && l.to.kind === node.kind && l.to.id === node.id)
}

/** Everything that can be named, in the popover's order: Characters, Locations, Products, References, then the rest, each A–Z. */
export function mentionSource(d: Doc, node: { kind: LinkEndpointKind; id: Id }): MentionItem[] {
  const out: MentionItem[] = []
  const refs = Object.values(d.refs ?? {})
  for (const k of Object.values(d.keys ?? {})) {
    const mine = refs.filter((r) => r.key === k.key)
    const front = mine.find((r) => r.variant === 'front')
    if (!front) continue // a bare @key stands for the whole character, led by its front
    out.push({ id: k.id, name: k.key, role: k.role, group: groupOf(k.role), asset: front.asset, kind: 'key', linked: mine.some((r) => isLinked(d, r.id, node)) })
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

/** The ref→script link a mention of an unlinked ref makes (its role is the ref's), or null when none is needed. */
export function linkForMention(d: Doc, item: Pick<MentionItem, 'id' | 'kind'>, node: { kind: LinkEndpointKind; id: Id }, newId: () => Id): Link | null {
  const refId = item.kind === 'ref' ? item.id : Object.values(d.refs).find((r) => r.key === d.keys[item.id]?.key && r.variant === 'front')?.id
  const ref = refId ? d.refs[refId] : undefined
  if (!ref || isLinked(d, ref.id, node)) return null
  return { id: newId(), v: 1, field_v: {}, from: { kind: 'ref', id: ref.id }, to: node, role: ref.role }
}
