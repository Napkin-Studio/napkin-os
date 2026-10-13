// The NodeRegistry (features/canvas-core.clan): every kind of thing on the
// canvas, from ui-behaviour.md 3.3 (nodes) and 3.4 (link endpoints), with the
// customData tag that identifies it. Node identity is the tag; the element
// column is only a hint each adapter maps. Pure, engine-free.
//
// Tag status: 'v2' tags are in the scene today (contracts/customdata.schema.json);
// 'v3' tags come with contract-v3; 'unassigned' kinds have no tag yet, and
// contract-v3 decides whether they need one. Nothing here writes a tag.

import type { ElementLike } from './canvasAdapter'

export type NodeKind =
  | 'script' | 'storyboard' | 'video'
  | 'board' | 'sketch'
  | 'picture' | 'drawing' | 'generated'
  | 'note' | 'ink_group' | 'group'
  | 'document' | 'format_set'
/** Not nodes: the tool's own marks. */
export type SystemKind = 'pin' | 'provenance'
/** Linkable, but not an element on the canvas. */
export type OffCanvasKind = 'shot'
export type RegistryKind = NodeKind | SystemKind | OffCanvasKind

export type TagStatus = 'v2' | 'v3' | 'unassigned'
export type ElementHint = 'frame' | 'rectangle' | 'image' | 'text' | 'arrow' | 'group'

export interface NodeEntry {
  kind: RegistryKind
  label: string
  /** The customData kind that marks it, or null when it is found another way (groups) or has no tag yet. */
  tag: string | null
  tagStatus: TagStatus
  element: ElementHint | null
  /** Sends work to an agent; has an inputs strip and a send tray (3.3). */
  generates: boolean
  /** Has an Open (an editor route). */
  opensEditor: boolean
  /** Its port colour (3.4); null where the spec gives none yet. */
  port: 'coral' | 'blue' | 'ink' | 'grey' | null
  /** A system entry, not a node (pin, provenance). */
  system: boolean
  onCanvas: boolean
}

const entry = (e: Omit<NodeEntry, 'system' | 'onCanvas'> & Partial<Pick<NodeEntry, 'system' | 'onCanvas'>>): NodeEntry =>
  ({ system: false, onCanvas: true, ...e })

/** The registry, in the order of 3.3, then the 3.4 endpoints, then the system entries. */
export const NODE_REGISTRY: readonly NodeEntry[] = [
  entry({ kind: 'script', label: 'Script', tag: 'script', tagStatus: 'v3', element: 'rectangle', generates: true, opensEditor: true, port: 'coral' }),
  entry({ kind: 'storyboard', label: 'Storyboard', tag: 'storyboard', tagStatus: 'v3', element: 'rectangle', generates: true, opensEditor: true, port: 'blue' }),
  entry({ kind: 'video', label: 'Video', tag: 'video', tagStatus: 'v3', element: 'rectangle', generates: true, opensEditor: true, port: 'ink' }),
  // A reference; product and key visual are reference roles, not kinds.
  entry({ kind: 'picture', label: 'Reference', tag: 'pic', tagStatus: 'v2', element: 'image', generates: false, opensEditor: false, port: 'grey' }),
  // "Frame (made from a sketch)" and "generated picture".
  entry({ kind: 'generated', label: 'Frame', tag: 'gen', tagStatus: 'v2', element: 'image', generates: false, opensEditor: true, port: 'grey' }),
  entry({ kind: 'sketch', label: 'Sketch area', tag: 'sketch', tagStatus: 'v3', element: 'rectangle', generates: true, opensEditor: false, port: null }),
  entry({ kind: 'ink_group', label: 'Ink group', tag: null, tagStatus: 'unassigned', element: 'group', generates: false, opensEditor: false, port: null }),
  entry({ kind: 'document', label: 'Document', tag: 'document', tagStatus: 'unassigned', element: 'rectangle', generates: false, opensEditor: false, port: null }),
  entry({ kind: 'format_set', label: 'Format set', tag: 'format_set', tagStatus: 'unassigned', element: 'rectangle', generates: true, opensEditor: true, port: null }),
  // A brand board is a board with purpose 'brand'.
  entry({ kind: 'board', label: 'Board', tag: 'board', tagStatus: 'v3', element: 'frame', generates: false, opensEditor: false, port: null }),
  entry({ kind: 'drawing', label: 'Drawing', tag: 'drawn', tagStatus: 'v2', element: 'frame', generates: false, opensEditor: false, port: 'grey' }),
  // A note, and loose text.
  entry({ kind: 'note', label: 'Note', tag: 'note', tagStatus: 'v2', element: 'text', generates: false, opensEditor: false, port: null }),
  // 3.4's "Board or group": any other group of elements (Ctrl+G).
  entry({ kind: 'group', label: 'Group', tag: null, tagStatus: 'unassigned', element: 'group', generates: false, opensEditor: false, port: null }),
  entry({ kind: 'shot', label: 'Shot', tag: null, tagStatus: 'v3', element: null, generates: false, opensEditor: false, port: null, onCanvas: false }),
  entry({ kind: 'pin', label: 'Pin', tag: 'pin', tagStatus: 'v2', element: 'rectangle', generates: false, opensEditor: false, port: null, system: true }),
  entry({ kind: 'provenance', label: 'Provenance arrow', tag: 'provenance', tagStatus: 'v2', element: 'arrow', generates: false, opensEditor: false, port: null, system: true }),
]

/** The link element's tag (contract-v3); a link is not a node, so it is not in the registry. */
export const LINK_TAG = { tag: 'link', tagStatus: 'v3' as TagStatus }

const BY_KIND = new Map(NODE_REGISTRY.map((e) => [e.kind, e]))

export function nodeEntry(kind: RegistryKind): NodeEntry {
  const e = BY_KIND.get(kind)
  if (!e) throw new Error(`No registry entry for ${kind}`)
  return e
}

/** The kinds that send work to an agent. */
export const GENERATING_KINDS: readonly NodeKind[] = NODE_REGISTRY.filter((e) => e.generates).map((e) => e.kind as NodeKind)

/**
 * What an element is. Only tags that are live in the scene today (v2) are read;
 * any other tag is 'unknown' until its contract lands. An untagged text is a
 * note (loose text); an untagged stroke or shape is a 'stroke' (the person's
 * own marks, not yet a node). Groups are found by groupOf, not here.
 */
export type Classified = 'picture' | 'drawing' | 'generated' | 'note' | SystemKind | 'stroke' | 'unknown'

function tagOf(el: ElementLike): string | undefined {
  const c = el.customData as { kind?: unknown } | undefined
  return c && typeof c === 'object' && 'kind' in c && typeof c.kind === 'string' ? c.kind : undefined
}

const LIVE_TAGS = new Map(NODE_REGISTRY.filter((e) => e.tagStatus === 'v2' && e.tag).map((e) => [e.tag!, e.kind]))

export function classify(el: ElementLike): Classified {
  const c = el.customData as unknown
  const tagged = !!c && typeof c === 'object' && 'kind' in c
  if (tagged) {
    const kind = LIVE_TAGS.get(tagOf(el) ?? '')
    if (!kind) return 'unknown'
    // A note is words: the tag on anything but text is not one (canvas/sceneRead.ts isText).
    if (kind === 'note' && el.type !== 'text') return 'unknown'
    return kind as Classified
  }
  if (el.type === 'text') return 'note'
  if (el.type === 'image' || el.type === 'frame' || el.type === 'magicframe' || el.type === 'arrow') return 'unknown'
  return 'stroke'
}

export interface FoundGroup {
  /** The engine's group id. */
  id: string
  kind: 'ink_group' | 'group'
  memberIds: string[]
}

/**
 * The groups on the canvas, outermost only, from groupIds. A group whose live
 * members are all untagged strokes is an ink group; any other is a group.
 */
export function groupOf(els: readonly ElementLike[]): FoundGroup[] {
  const live = els.filter((e) => !e.isDeleted)
  const members = new Map<string, ElementLike[]>()
  const outer = new Set<string>()
  for (const e of live) {
    const ids = e.groupIds ?? []
    ids.forEach((g, i) => {
      if (!members.has(g)) members.set(g, [])
      members.get(g)!.push(e)
      // groupIds run from the innermost group to the outermost.
      if (i === ids.length - 1) outer.add(g)
    })
  }
  const inner = new Set(live.flatMap((e) => (e.groupIds ?? []).slice(0, -1)))
  return [...members.entries()]
    .filter(([g]) => outer.has(g) && !inner.has(g))
    .map(([id, ms]) => ({
      id,
      kind: ms.every((m) => classify(m) === 'stroke') ? 'ink_group' as const : 'group' as const,
      memberIds: ms.map((m) => m.id),
    }))
}
