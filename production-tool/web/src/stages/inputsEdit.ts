// Editing a node's inputs from its strip (ui-behaviour 3.16): what "+ Link input" offers, and the
// question a chip's × asks first when shots use what it brings in. Pure: read from the document as the
// canvas has it alive (model/live.ts), so a deleted picture is never offered.

import type { Id, LinkEndpoint, ProductionDocument, Sha256 } from '../contracts/types'
import { isKeyGroup, keyViews } from '../lib/names'
import { linkInputCheck } from '../canvas/nodes/nodes'
import { nodeKindOf, type ScopeItem } from '../model/scope'
import { refName, refsList, shotNumber } from '../model/selectors'

type Doc = ProductionDocument

/** One thing "+ Link input" can link: a board, a key's group of views, or a single reference. */
export interface LinkChoice {
  from: LinkEndpoint
  /** "Locations · board", "@home · 3 views", "@home_closeup". */
  label: string
  /** What it is: "board", "group", or the reference's role. */
  what: string
  asset?: Sha256
  /** Already linked into this node. */
  linked: boolean
  /** Why it cannot be linked here, when it cannot (and is not linked already). */
  reason?: string
}

/** The node a strip belongs to, as a link end. */
export function nodeEnd(d: Doc, nodeId: Id): LinkEndpoint | null {
  const kind = nodeKindOf(d, nodeId)
  return kind ? { kind, id: nodeId } : null
}

/** What "+ Link input" offers for a node: its boards, then the keys with two or more views, then each reference. */
export function linkChoices(d: Doc, nodeId: Id): LinkChoice[] {
  const to = nodeEnd(d, nodeId)
  if (!to) return []
  const into = Object.values(d.links ?? {}).filter((l) => l.to.id === nodeId)
  const choice = (from: LinkEndpoint, label: string, what: string, asset?: Sha256): LinkChoice => {
    const linked = into.some((l) => l.from.id === from.id)
    const check = linked ? null : linkInputCheck(d, from, to)
    return { from, label, what, ...(asset ? { asset } : {}), linked, ...(check && !check.ok ? { reason: check.reason } : {}) }
  }
  const out: LinkChoice[] = []
  for (const b of Object.values(d.boards ?? {}).sort((a, z) => (a.rank < z.rank ? -1 : a.rank > z.rank ? 1 : 0))) {
    out.push(choice({ kind: 'board', id: b.id }, b.title || 'Board', 'board'))
  }
  for (const k of Object.values(d.keys ?? {}).sort((a, z) => (a.key < z.key ? -1 : 1))) {
    if (!isKeyGroup(d, k.key)) continue
    const { views, sent } = keyViews(d, k.key)
    out.push(choice({ kind: 'key', id: k.id }, `@${k.key} · ${views.length} views`, 'group', sent[0]?.asset ?? views[0]?.asset))
  }
  for (const r of refsList(d).sort((a, z) => (refName(a) < refName(z) ? -1 : 1))) {
    out.push(choice({ kind: 'ref', id: r.id }, r.label ? `${r.label} · @${refName(r)}` : `@${refName(r)}`, r.role, r.asset))
  }
  return out
}

/** The choices whose words match what was typed (every word, anywhere in the label or what it is). */
export function searchChoices(choices: readonly LinkChoice[], typed: string): LinkChoice[] {
  const words = typed.toLowerCase().replace(/@/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) return [...choices]
  return choices.filter((c) => {
    const hay = `${c.label} ${c.what}`.toLowerCase().replace(/@/g, '')
    return words.every((w) => hay.includes(w))
  })
}

/** The shots (by number) that use what a chip brings in: its own, or, for a board or group, any of its references'. */
export function chipShots(d: Doc, items: readonly ScopeItem[], chip: ScopeItem): number[] {
  const ids = new Set(chip.usedBy)
  for (const it of items) if (it.linkId === chip.linkId && it !== chip) for (const s of it.usedBy) ids.add(s)
  return [...ids].map((s) => shotNumber(d, s)).filter((n) => n > 0).sort((a, b) => a - b)
}

const list = (ns: number[]) => (ns.length === 1 ? `${ns[0]}` : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`)

/** The question a chip's × asks before it unlinks (3.16), or null when no shot uses it. */
export function unlinkQuestion(d: Doc, items: readonly ScopeItem[], chip: ScopeItem): string | null {
  const shots = chipShots(d, items, chip)
  if (!shots.length) return null
  const name = chip.kind === 'ref' || chip.kind === 'key' ? `@${chip.name}` : chip.label
  return `${shots.length === 1 ? 'Shot' : 'Shots'} ${list(shots)} ${shots.length === 1 ? 'uses' : 'use'} ${name}. Unlink anyway?`
}
