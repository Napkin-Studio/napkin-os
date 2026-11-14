// A node's scope (ui-behaviour 3.16, 3.4, 3.6): everything linked into a node, read from the
// document alone. The node card's inputs strip, the editors' references lists and "What Dex will
// send" all read this one function, so they always agree, and each re-reads it on every document
// change, so a link added or taken away shows everywhere at once.
//
// What is in a node's scope, in the order the strip shows it:
// - upstream: the script that drives it, the storyboard that renders it (their links);
// - each other link into it: a board or group (and the references on it), a whole key (and each of
//   its views: owner 2026-10-15), a single reference with its role, a sketch area or drawing, a note or ink group, a document, the brand board,
//   a frame (a shot's frame or layout, a format set's master);
// - what upstream nodes have linked in (a storyboard sees its script's references), once;
// - @-mentions in its own text that nothing above brings in (not yet linked: the auto-link of
//   3.6 links them on pick), and @words that name no reference at all (3.6 unknown names).
//
// Board membership is the canvas's (what sits in the board's frame), which the document does not
// hold: pass `members` to resolve it. Without it, a board holds the references whose key is its
// name prefix (3.6: a picture dropped on a board is named with the board's prefix), else, for a
// picture board, those whose role is its purpose.

import type {
  Board, BoardPurpose, Id, Link, LinkEndpoint, LinkEndpointKind, LinkRole, NamedRef, ProductionDocument, RefRole, Sha256, Shot,
} from '../contracts/types'
import { beatsOf, refName, scenesOf, shotsOf } from './selectors'
import { keyViews } from '../lib/names'

type Doc = ProductionDocument

/** Where an item comes from: its own link, a board or group linked in, a node upstream, or only a mention in the text. */
export type ScopeVia = 'link' | 'board' | 'upstream' | 'mention'

export type ScopeKind = LinkEndpointKind | 'key' | 'unknown'

export interface ScopeItem {
  /** What it is: a link endpoint's kind, a key (a bare @key: the whole character), or an @word naming nothing. */
  kind: ScopeKind
  /** The entity id (ref_…, board_…), the scene id of a group, note or ink, or the @word for an unknown name. */
  id: Id
  via: ScopeVia
  /** The link into this node that brings it in: its own, its board's or group's, or the upstream node's. Absent for a mention only. */
  linkId?: Id
  /** The link's role (character, lighting, drives, input, note, …); a reference's own role when only mentioned. */
  role: LinkRole
  /** @name without the @ (maya_front, or maya for a key), for references and unknown names. */
  name?: string
  /** The chip's words: "@maya_front", "golden hour · lighting", "Locations · 2", "Script · First Light". */
  label: string
  /** A picture for the row. */
  asset?: Sha256
  /** A drawing: a sketch area, an ink group, or a picture drawn on the canvas. */
  drawn?: boolean
  /** Ids of the node's shots whose text names it ("@maya · character · 1 2 4 5"). */
  usedBy: Id[]
  /** For a board or group: how many references it brings in; for a key: how many views. */
  count?: number
  /** For a linked key: the views one job sends (at most 4; lib/names keyViews), by ref id. */
  sends?: Id[]
  /** A view of a linked key that stays out of a send (past the key's 4). */
  held?: boolean
  /** The board or group item this one came in through (via 'board'), or the upstream node (via 'upstream'). */
  through?: Id
  /** A linked text's words (features/canvas-text.clan): the node's input words. */
  words?: string
}

/** A chip's few words of a text: its first line, cut at a word near 28 characters. */
export function firstWords(words: string, max = 28): string {
  const line = words.trim().split('\n')[0].trim()
  if (line.length <= max) return line
  const cut = line.slice(0, max + 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > 8 ? cut.slice(0, at) : line.slice(0, max)).trimEnd()}…`
}

/** The words of the texts linked into a node (its own links, and up its chain), for its job's input words. */
export function linkedWords(items: readonly ScopeItem[]): { id: Id; linkId?: Id; words: string }[] {
  return items.filter((it) => it.kind === 'text' && it.via !== 'mention' && it.words?.trim()).map((it) => ({ id: it.id, ...(it.linkId ? { linkId: it.linkId } : {}), words: it.words!.trim() }))
}

export interface ScopeOptions {
  /** The references on a board or in a group, as the canvas places them. */
  members?: (endpoint: LinkEndpoint) => Id[] | undefined
}

/** "Script · First Light", or "Script" while it has only its default name. */
const titled = (kind: string, title: string | undefined) => (title && title.trim().toLowerCase() !== kind.toLowerCase() ? `${kind} · ${title}` : kind)
const values = <T>(m: Record<string, T> | undefined): T[] => Object.values(m ?? {})
const MENTION = /(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)/g
const UPSTREAM: LinkRole[] = ['drives', 'renders']
const ORDER: ScopeKind[] = ['script', 'storyboard', 'video', 'board', 'group', 'ref', 'key', 'sketch', 'ink', 'frame', 'render', 'shot', 'note', 'text', 'document', 'format_set', 'unknown']
const PURPOSE_ROLES: Partial<Record<BoardPurpose, RefRole[]>> = {
  character: ['character'], location: ['location'], product: ['product'],
  reference: ['lighting', 'composition', 'style', 'wardrobe', 'pose', 'prop', 'texture', 'colour', 'layout', 'other'],
  brand: ['logo', 'palette', 'typography', 'brand_rule', 'document'],
}

/** The kind of the entity with this id, among the nodes a link can point at. */
export function nodeKindOf(d: Doc, id: Id): LinkEndpointKind | null {
  const maps: [LinkEndpointKind, Record<string, unknown> | undefined][] = [
    ['script', d.scripts], ['storyboard', d.storyboards], ['video', d.videos], ['sketch', d.sketches], ['format_set', d.format_sets],
    ['shot', d.shots], ['board', d.boards], ['ref', d.refs], ['frame', d.frames], ['render', d.renders], ['document', d.documents],
  ]
  for (const [k, m] of maps) if (m?.[id]) return k
  return null
}

/** The shots whose text belongs to a node: a script's (through its scenes), a storyboard's, a video's storyboard's, a shot itself. */
function shotsFor(d: Doc, kind: LinkEndpointKind | null, id: Id): Shot[] {
  if (kind === 'shot') return d.shots[id] ? [d.shots[id]] : []
  if (kind === 'storyboard') return shotsOf(d, id)
  if (kind === 'script') {
    // Its scenes' shots, and the shots of the storyboards it drives (what the Script editor shows).
    const scenes = new Set(scenesOf(d, id).map((s) => s.id))
    const boards = new Set(values(d.links).filter((l) => l.role === 'drives' && l.from.id === id && l.to.kind === 'storyboard').map((l) => l.to.id))
    return values(d.shots).filter((s) => (s.scene_id && scenes.has(s.scene_id)) || boards.has(s.storyboard_id))
      .sort((a, b) => (a.storyboard_id < b.storyboard_id ? -1 : a.storyboard_id > b.storyboard_id ? 1 : a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
  }
  if (kind === 'video') {
    const sb = values(d.links).find((l) => l.role === 'renders' && l.to.kind === 'video' && l.to.id === id)
    return sb ? shotsOf(d, sb.from.id) : []
  }
  return []
}

/** What a fragment names: its mention nodes' ids (with the label each was inserted with), and the
 *  @words typed in its text and in the flat fields. */
function mentionsIn(prose: unknown, texts: (string | undefined)[]): { ids: { id: Id; label?: string }[]; words: string[] } {
  const ids: { id: Id; label?: string }[] = []
  const all = [...texts]
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; text?: unknown; attrs?: { id?: unknown; label?: unknown }; content?: unknown[] }
    if (node.type === 'mention' && typeof node.attrs?.id === 'string') ids.push({ id: node.attrs.id, ...(typeof node.attrs.label === 'string' ? { label: node.attrs.label } : {}) })
    if (node.type === 'text' && typeof node.text === 'string') all.push(node.text)
    for (const c of node.content ?? []) walk(c)
  }
  walk(prose)
  const words: string[] = []
  for (const t of all) for (const m of (t ?? '').matchAll(MENTION)) words.push(m[1])
  return { ids, words }
}

/** What a reference id or @name stands for: a ref (one look) or a key (the whole character). */
function resolve(d: Doc, idOrName: { id?: Id; name?: string }): { kind: 'ref' | 'key'; id: Id } | null {
  if (idOrName.id) {
    if (d.refs?.[idOrName.id]) return { kind: 'ref', id: idOrName.id }
    if (d.keys?.[idOrName.id]) return { kind: 'key', id: idOrName.id }
    return null
  }
  const name = idOrName.name ?? ''
  const ref = values(d.refs).find((r) => refName(r) === name)
  if (ref) return { kind: 'ref', id: ref.id }
  const key = !name.includes('_') ? values(d.keys).find((k) => k.key === name) : undefined
  return key ? { kind: 'key', id: key.id } : null
}

function boardMembers(d: Doc, b: Board): Id[] {
  const refs = values(d.refs)
  const byPrefix = b.name_prefix ? refs.filter((r) => r.key === b.name_prefix) : []
  if (byPrefix.length) return byPrefix.map((r) => r.id)
  const roles = PURPOSE_ROLES[b.purpose]
  return roles ? refs.filter((r) => roles.includes(r.role)).map((r) => r.id) : []
}

const isDrawn = (d: Doc, r: NamedRef) => !!r.asset && d.assets?.[r.asset]?.origin === 'drawn'

function refItem(d: Doc, r: NamedRef, via: ScopeVia, role: LinkRole, linkId?: Id, through?: Id, ownLink = false): ScopeItem {
  const name = refName(r)
  const label = ownLink && r.label ? `${r.label} · ${role}` : ownLink && role !== r.role ? `@${name} · ${role}` : `@${name}`
  return { kind: 'ref', id: r.id, via, role, name, label, ...(r.asset ? { asset: r.asset } : {}), ...(isDrawn(d, r) ? { drawn: true } : {}), usedBy: [], ...(linkId ? { linkId } : {}), ...(through ? { through } : {}) }
}

/** One link's items: the thing it brings in, and for a board or group the references on it. */
function linkItems(d: Doc, l: Link, via: ScopeVia, opts: ScopeOptions, through?: Id): ScopeItem[] {
  const e = l.from
  const base = { via, linkId: l.id, role: l.role, usedBy: [] as Id[], ...(through ? { through } : {}) }
  switch (e.kind) {
    case 'ref': {
      const r = d.refs?.[e.id]
      return r ? [refItem(d, r, via, l.role, l.id, through, true)] : []
    }
    case 'key': {
      // The whole character: one chip, "@samurai · 3 views", then each view with its own role.
      const k = d.keys?.[e.id]
      if (!k) return []
      const { views, sent } = keyViews(d, k.key)
      const n = views.length
      const head: ScopeItem = {
        ...base, kind: 'key', id: e.id, name: k.key, label: `@${k.key} · ${n} ${n === 1 ? 'view' : 'views'}`, count: n,
        sends: sent.map((r) => r.id), ...(sent[0]?.asset ? { asset: sent[0].asset } : {}),
      }
      return [head, ...views.map((r) => ({ ...refItem(d, r, via === 'link' ? 'board' : via, r.role, l.id, e.id), ...(sent.includes(r) ? {} : { held: true }) }))]
    }
    case 'board':
    case 'group': {
      const b = e.kind === 'board' ? d.boards?.[e.id] : undefined
      const members = (opts.members?.(e) ?? (b ? boardMembers(d, b) : [])).filter((id) => d.refs?.[id])
      const title = b?.title ?? (l.label || 'Group')
      const head: ScopeItem = { ...base, kind: e.kind, id: e.id, label: members.length ? `${title} · ${members.length}` : title, count: members.length }
      return [head, ...members.map((id) => refItem(d, d.refs[id], via === 'link' ? 'board' : via, d.refs[id].role, l.id, e.id))]
    }
    case 'script': {
      const s = d.scripts?.[e.id]
      return [{ ...base, kind: 'script', id: e.id, label: titled('Script', s?.title) }]
    }
    case 'storyboard': {
      const s = d.storyboards?.[e.id]
      return [{ ...base, kind: 'storyboard', id: e.id, label: titled('Storyboard', s?.title) }]
    }
    case 'video': {
      const v = d.videos?.[e.id]
      return [{ ...base, kind: 'video', id: e.id, label: titled('Video', v?.title) }]
    }
    case 'document': {
      const doc = d.documents?.[e.id]
      return [{ ...base, kind: 'document', id: e.id, label: doc ? `${doc.file_name} · ${doc.pages} ${doc.pages === 1 ? 'page' : 'pages'}` : 'Document' }]
    }
    case 'sketch': {
      const s = d.sketches?.[e.id]
      return [{ ...base, kind: 'sketch', id: e.id, label: `Sketch${s?.ratio ? ` · ${s.ratio}` : ''}`, drawn: true }]
    }
    case 'frame': {
      const f = d.frames?.[e.id]
      return [{ ...base, kind: 'frame', id: e.id, label: `Frame v${f?.version ?? 1} · ${l.role}`, ...(f ? { asset: f.asset } : {}) }]
    }
    case 'render': {
      const r = d.renders?.[e.id]
      return [{ ...base, kind: 'render', id: e.id, label: `Ad v${r?.version ?? 1}`, ...(r ? { asset: r.asset } : {}) }]
    }
    case 'ink':
      return [{ ...base, kind: 'ink', id: e.id, label: l.label || 'Ink', drawn: true }]
    case 'note':
      return [{ ...base, kind: 'note', id: e.id, label: l.label || 'Note' }]
    case 'text': {
      // A text on the canvas (features/canvas-text.clan): its words are the node's input words.
      const t = d.texts?.[e.id]
      return t ? [{ ...base, kind: 'text', id: e.id, label: `Text: ${firstWords(t.words)}`, words: t.words }] : []
    }
    default:
      return [{ ...base, kind: e.kind, id: e.id, label: l.label || e.kind }]
  }
}

/**
 * Everything linked into a node, and what its text names (ui-behaviour 3.16). One item per thing:
 * the first way it comes in wins (its own link, then a board, then upstream, then a mention).
 */
export function scopeOf(d: Doc, nodeId: Id, opts: ScopeOptions = {}): ScopeItem[] {
  const kind = nodeKindOf(d, nodeId)
  const links = values(d.links)
  const into = (id: Id) => links.filter((l) => l.to.id === id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const items: ScopeItem[] = []
  const seen = new Set<string>()
  const add = (it: ScopeItem) => {
    const k = `${it.kind}:${it.id}`
    if (seen.has(k)) return
    seen.add(k)
    items.push(it)
  }
  const own = into(nodeId)
  // A reference's own link before the board it also sits on, so its chip shows.
  const grouped = (l: Link) => Number(l.from.kind === 'board' || l.from.kind === 'group' || l.from.kind === 'key')
  for (const l of [...own].sort((a, b) => grouped(a) - grouped(b))) for (const it of linkItems(d, l, 'link', opts)) add(it)
  // Upstream: what the driving script or rendering storyboard has linked in, up the chain, once.
  const visited = new Set([nodeId])
  const stack = own.filter((l) => UPSTREAM.includes(l.role)).map((l) => l.from.id)
  while (stack.length) {
    const up = stack.shift()!
    if (visited.has(up)) continue
    visited.add(up)
    for (const l of into(up)) {
      if (UPSTREAM.includes(l.role)) { stack.push(l.from.id); add({ ...linkItems(d, l, 'upstream', opts, up)[0], linkId: l.id }); continue }
      for (const it of linkItems(d, l, 'upstream', opts, up)) add(it)
    }
  }
  // The node's own text: its shots (action, direction, beats) and, for a script, its scenes.
  const shots = shotsFor(d, kind, nodeId)
  const named = new Map<string, Id[]>() // kind:id → shots naming it
  const unknown = new Map<string, Id[]>()
  const note = (k: string, shot: Id | null, into: Map<string, Id[]>) => {
    const list = into.get(k) ?? []
    if (shot && !list.includes(shot)) list.push(shot)
    into.set(k, list)
  }
  const take = (prose: unknown, texts: (string | undefined)[], shot: Id | null, extra: Id[] = []) => {
    const m = mentionsIn(prose, texts)
    for (const { id, label } of [...m.ids, ...extra.map((id) => ({ id, label: undefined }))]) {
      const r = resolve(d, { id })
      if (r) note(`${r.kind}:${r.id}`, shot, named)
      else if (label) note(label, shot, unknown) // a mention whose reference is gone
    }
    for (const w of m.words) {
      const r = resolve(d, { name: w })
      if (r) note(`${r.kind}:${r.id}`, shot, named)
      else note(w, shot, unknown)
    }
  }
  if (kind === 'script') for (const sc of scenesOf(d, nodeId)) take(sc.prose, [sc.text], null)
  for (const s of shots) {
    take(s.prose, [s.action, s.direction], s.id, s.refs ?? [])
    for (const b of beatsOf(d, s.id)) take(b.prose, [b.text], s.id)
  }
  // A key mention (@maya) is used by every look of that key in scope.
  const keyOf = (refId: Id) => {
    const r = d.refs?.[refId]
    return r ? values(d.keys).find((k) => k.key === r.key)?.id : undefined
  }
  for (const it of items) {
    if (it.kind !== 'ref') continue
    const direct = named.get(`ref:${it.id}`) ?? []
    const viaKey = (keyOf(it.id) && named.get(`key:${keyOf(it.id)}`)) || []
    it.usedBy = shots.map((s) => s.id).filter((id) => direct.includes(id) || viaKey.includes(id))
  }
  // A linked key is used wherever the key or any of its views is named.
  for (const it of items) {
    if (it.kind !== 'key') continue
    const views = items.filter((x) => x.kind === 'ref' && x.through === it.id)
    const used = new Set([...(named.get(`key:${it.id}`) ?? []), ...views.flatMap((v) => v.usedBy)])
    it.usedBy = shots.map((s) => s.id).filter((id) => used.has(id))
  }
  for (const [k, used] of named) {
    const [kk, id] = k.split(/:(.*)/s) as ['ref' | 'key', Id]
    if (seen.has(k)) continue
    if (kk === 'key' && items.some((it) => it.kind === 'ref' && d.refs[it.id]?.key === d.keys[id]?.key)) continue // a look of it is in scope
    if (kk === 'ref') add({ ...refItem(d, d.refs[id], 'mention', d.refs[id].role), usedBy: used })
    else add({ kind: 'key', id, via: 'mention', role: d.keys[id].role, name: d.keys[id].key, label: `@${d.keys[id].key}`, usedBy: used })
  }
  for (const [w, used] of unknown) add({ kind: 'unknown', id: w, via: 'mention', role: 'other', name: w, label: `@${w}`, usedBy: used })
  const rank = (it: ScopeItem) => (it.via === 'mention' ? 100 : 0) + (it.via === 'upstream' ? 50 : 0) + ORDER.indexOf(it.kind)
  return items.map((it, i) => ({ it, i })).sort((a, b) => {
    // A board's references stay right after their board.
    const ra = a.it.through && a.it.via === 'board' ? rank(items.find((x) => x.id === a.it.through) ?? a.it) : rank(a.it)
    const rb = b.it.through && b.it.via === 'board' ? rank(items.find((x) => x.id === b.it.through) ?? b.it) : rank(b.it)
    return ra - rb || a.i - b.i
  }).map((x) => x.it)
}

/** The items a node's inputs strip shows: one chip per link into it (3.16), upstream nodes first. */
export function inputChips(items: ScopeItem[]): ScopeItem[] {
  return items.filter((it) => it.via === 'link')
}

/** The references (and keys, and unknown names) in scope, for an editor's references list. */
export function scopeRefs(items: ScopeItem[]): ScopeItem[] {
  return items.filter((it) => it.kind === 'ref' || it.kind === 'key' || it.kind === 'unknown')
}
