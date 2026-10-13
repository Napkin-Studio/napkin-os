// The linking rules of ui-behaviour.md 3.4, as data (features/canvas-core.clan).
// LINK_TABLE keeps the spec's words column by column, with the machine columns
// beside them. canLink says whether one kind may feed another and in which
// roles; checkLink applies the limits on a graph. Pure, engine-free.
// contract-v3 publishes linkRole/linkRule and checks them against this file.

import { GENERATING_KINDS, nodeEntry, type NodeKind, type OffCanvasKind } from './nodes'

export type LinkKind = NodeKind | OffCanvasKind

/** A link's role. A reference link's label is the reference's own role (character, location, …). */
export type LinkRole =
  | 'drives' | 'renders' | 'reference' | 'input' | 'note' | 'context' | 'brand'
  | 'master' | 'frame' | 'layout' | 'made_from' | 'note_on_shot'

/** One end of a link: a kind, a board's purpose ('brand'), or a reference's role ('product', 'key_visual'). */
export interface LinkEnd {
  kind: LinkKind
  purpose?: string
  role?: string
}

type Match = LinkEnd

/**
 * How many links a target takes:
 * - 'many': no limit;
 * - 'one-per-target': one link in this role per target (an input port's general rule);
 * - 'one-per-source': one link per source and target (a board or group).
 */
export type LinkLimit = 'many' | 'one-per-target' | 'one-per-source'

export interface LinkRow {
  // The spec's columns, as written.
  fromTo: string
  roleLabel: string
  allowed: string
  effect: string
  // The machine columns.
  sources: readonly Match[]
  /** 'generating' stands for every generating node. */
  targets: readonly (Match | 'generating')[]
  /** The roles, per source kind where they differ. */
  roles: readonly LinkRole[]
  rolesBySource?: Partial<Record<LinkKind, readonly LinkRole[]>>
  limit: LinkLimit
  /** Made by the system only; a person cannot drag it. */
  system?: boolean
}

const GENERATING = 'generating' as const

export const LINK_TABLE: readonly LinkRow[] = [
  {
    fromTo: 'Script → Storyboard', roleLabel: '`drives`', allowed: 'One script per storyboard',
    effect: 'Plan shots reads this script. Re-planning merges by shotId and never wipes.',
    sources: [{ kind: 'script' }], targets: [{ kind: 'storyboard' }], roles: ['drives'], limit: 'one-per-target',
  },
  {
    fromTo: 'Storyboard → Video', roleLabel: '`renders`', allowed: 'One storyboard per video; a storyboard can render many videos (cutdowns)',
    effect: 'One clip per shot, from each shot\'s selected frame.',
    sources: [{ kind: 'storyboard' }], targets: [{ kind: 'video' }], roles: ['renders'], limit: 'one-per-target',
  },
  {
    fromTo: 'Reference → any generating node, or a Shot', roleLabel: 'its role (`character`, `location`, `lighting`, …)', allowed: 'Many',
    effect: 'The reference joins that node\'s `@` vocabulary and gets its own link with a "<name> · <role>" chip in the inputs strip. Dex words its role ("lighting reference: match its light only").',
    sources: [{ kind: 'picture' }], targets: [GENERATING, { kind: 'shot' }], roles: ['reference'], limit: 'many',
  },
  {
    fromTo: 'Board or group → any generating node', roleLabel: '`input`', allowed: 'One link per board or group',
    effect: 'Everything on the board or in the group joins the node\'s scope. The strip shows "Loc1 · Coast · 3".',
    sources: [{ kind: 'board' }, { kind: 'group' }], targets: [GENERATING], roles: ['input'], limit: 'one-per-source',
  },
  {
    fromTo: 'Note, ink group or Document → any generating node', roleLabel: '`note` or `context`', allowed: 'Many',
    effect: 'The text joins the node\'s instructions (a note) or its background (a document). A document is used only once linked.',
    sources: [{ kind: 'note' }, { kind: 'ink_group' }, { kind: 'document' }], targets: [GENERATING], roles: ['note', 'context'],
    rolesBySource: { note: ['note'], ink_group: ['note'], document: ['context'] }, limit: 'many',
  },
  {
    fromTo: 'Brand board → any generating node', roleLabel: '`brand`', allowed: 'One',
    effect: 'Dex writes the brand rules into every prompt; Jude checks results against them (3.18).',
    sources: [{ kind: 'board', purpose: 'brand' }], targets: [GENERATING], roles: ['brand'], limit: 'one-per-target',
  },
  {
    fromTo: 'Frame, key visual or Video → Format set', roleLabel: '`master`', allowed: 'One master per set',
    effect: 'Make all sizes adapts the master (3.19). Created by Make all sizes.',
    sources: [{ kind: 'generated' }, { kind: 'picture', role: 'key_visual' }, { kind: 'video' }], targets: [{ kind: 'format_set' }],
    roles: ['master'], limit: 'one-per-target', system: true,
  },
  {
    fromTo: 'Image, frame or generated picture → Shot', roleLabel: '`frame` or `layout` (asks which on drop)', allowed: 'One `frame`, one `layout` per shot',
    effect: 'Used as the shot\'s frame, or as a layout guide.',
    sources: [{ kind: 'picture' }, { kind: 'drawing' }, { kind: 'generated' }], targets: [{ kind: 'shot' }], roles: ['frame', 'layout'], limit: 'one-per-target',
  },
  {
    fromTo: 'Sketch area → Frame', roleLabel: '`made from`', allowed: 'Created by the system only',
    effect: 'Records where a frame came from.',
    sources: [{ kind: 'sketch' }], targets: [{ kind: 'generated' }], roles: ['made_from'], limit: 'one-per-target', system: true,
  },
  {
    fromTo: 'Ink group → Shot', roleLabel: '`note on shot N`', allowed: 'Many',
    effect: 'Attaches the ink as a note on that shot (artboard 5).',
    sources: [{ kind: 'ink_group' }], targets: [{ kind: 'shot' }], roles: ['note_on_shot'], limit: 'many',
  },
]

/** The refusals of 3.4, as written. */
export const REFUSALS = [
  { fromTo: 'Anything → Reference, Product, Document or Brand board', allowed: 'Refused', effect: 'These are inputs only.' },
  { fromTo: 'Video → anything but a Format set', allowed: 'Refused', effect: 'Video is an output; it can only be the master of a cut-down set.' },
  { fromTo: 'A link that would form a loop', allowed: 'Refused', effect: '"That would make a loop."' },
] as const

export const LOOP = 'That would make a loop.'

// ── words ──

/** How the refusals name an end: "a script", "a product", "a brand board", "an ink group". */
export function endName(end: LinkEnd): string {
  let name: string
  if (end.kind === 'board' && end.purpose === 'brand') name = 'brand board'
  else if (end.kind === 'picture' && end.role) name = end.role.replace(/_/g, ' ')
  else name = nodeEntry(end.kind).label.toLowerCase()
  return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`
}

const matches = (m: Match | 'generating', e: LinkEnd) =>
  m === GENERATING
    ? (GENERATING_KINDS as readonly string[]).includes(e.kind)
    : m.kind === e.kind && (m.purpose === undefined || m.purpose === e.purpose) && (m.role === undefined || m.role === e.role)

/** Inputs only: nothing links into a reference, a product, a document or a brand board. */
const inputOnly = (e: LinkEnd) => e.kind === 'picture' || e.kind === 'document' || (e.kind === 'board' && e.purpose === 'brand')

const SYSTEM_REASON: Partial<Record<LinkRole, string>> = {
  master: 'Made only by Make all sizes.',
  made_from: 'Made only when a sketch area makes a frame.',
}

export type CanLink = { ok: true; roles: LinkRole[] } | { ok: false; reason: string }

const toEnd = (e: LinkKind | LinkEnd): LinkEnd => (typeof e === 'string' ? { kind: e } : e)

/** The rows that link these two ends, most specific first (a brand board's brand row before a board's input row). */
function rowsFor(from: LinkEnd, to: LinkEnd): LinkRow[] {
  return LINK_TABLE.filter((r) => r.sources.some((m) => matches(m, from)) && r.targets.some((m) => matches(m, to)))
    // A brand board feeds as a brand board, not as a plain board.
    .filter((r) => !(from.kind === 'board' && from.purpose === 'brand' && r.roles.includes('input')))
}

/**
 * May `from` feed `to`, and in which roles? System-only roles (made_from, master)
 * count only with {system: true}.
 */
export function canLink(fromIn: LinkKind | LinkEnd, toIn: LinkKind | LinkEnd, opts: { system?: boolean } = {}): CanLink {
  const from = toEnd(fromIn)
  const to = toEnd(toIn)
  if (inputOnly(to)) return { ok: false, reason: `${cap(endName(from))} cannot feed ${endName(to)}` }
  if (from.kind === 'video' && to.kind !== 'format_set') return { ok: false, reason: `${cap(endName(from))} cannot feed ${endName(to)}` }
  const rows = rowsFor(from, to)
  if (!rows.length) return { ok: false, reason: `Not a target for ${endName(from)}` }
  const people = opts.system ? rows : rows.filter((r) => !r.system)
  if (!people.length) return { ok: false, reason: SYSTEM_REASON[rows[0].roles[0]] ?? 'Made only by the system.' }
  const roles = [...new Set(people.flatMap((r) => r.rolesBySource?.[from.kind] ?? r.roles))]
  return { ok: true, roles }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── a graph, and the limits on it ──

export interface GraphNode {
  id: string
  kind: LinkKind
  purpose?: string
  role?: string
}

export interface GraphLink {
  from: string
  to: string
  role: LinkRole
}

export interface LinkGraph {
  nodes: readonly GraphNode[]
  links: readonly GraphLink[]
}

/** The words for a limit that is already used, by role. */
const LIMIT_REASON: Partial<Record<LinkRole, string>> = {
  drives: 'This storyboard already has a script.',
  renders: 'This video already has a storyboard.',
  master: 'This set already has a master.',
  frame: 'This shot already has a frame.',
  layout: 'This shot already has a layout.',
  brand: 'This already has a brand board.',
}

function reaches(graph: LinkGraph, start: string, goal: string): boolean {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()!
    if (id === goal) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const l of graph.links) if (l.from === id) stack.push(l.to)
  }
  return false
}

/**
 * May this link be made on this graph? Applies canLink, then:
 * - a loop is refused ("That would make a loop.");
 * - a target with a running job is refused with the job's line (`busy` gives it,
 *   e.g. "Wren is still making clip 4."), then "Link it when that's done.";
 * - each limit of 3.4: one script per storyboard, one storyboard per video, one
 *   master per set, one frame and one layout per shot, one brand link, one input
 *   link per board or group, and otherwise one link per role on an input port
 *   unless the table says Many.
 */
export function checkLink(
  graph: LinkGraph, fromId: string, toId: string, role: LinkRole,
  opts: { busy?: (nodeId: string) => string | undefined; system?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const from = graph.nodes.find((n) => n.id === fromId)
  const to = graph.nodes.find((n) => n.id === toId)
  if (!from || !to) return { ok: false, reason: 'That is no longer on the canvas.' }
  if (fromId === toId) return { ok: false, reason: LOOP }
  const can = canLink(from, to, { system: opts.system })
  if (!can.ok) return can
  if (!can.roles.includes(role)) return { ok: false, reason: `${cap(endName(from))} feeds ${endName(to)} as ${can.roles.join(' or ')}.` }
  if (reaches(graph, toId, fromId)) return { ok: false, reason: LOOP }
  const running = opts.busy?.(toId)
  if (running) return { ok: false, reason: `${running} Link it when that's done.` }
  if (graph.links.some((l) => l.from === fromId && l.to === toId && l.role === role)) return { ok: false, reason: 'These are already linked.' }
  const row = rowsFor(from, to).find((r) => (r.rolesBySource?.[from.kind] ?? r.roles).includes(role))!
  if (row.limit === 'one-per-target' && graph.links.some((l) => l.to === toId && l.role === role)) {
    return { ok: false, reason: LIMIT_REASON[role] ?? `This already has a ${role.replace(/_/g, ' ')} link.` }
  }
  if (row.limit === 'one-per-source' && graph.links.some((l) => l.from === fromId && l.to === toId)) {
    return { ok: false, reason: `This ${from.kind === 'board' ? 'board' : 'group'} is already linked here.` }
  }
  return { ok: true }
}
