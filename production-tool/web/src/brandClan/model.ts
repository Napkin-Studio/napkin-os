// The Brand Clan node (Brand Clan phase 2; DESIGN 4a, owner 2026-11-23; mocks d1, d2, d3).
//
// - A Brand Clan node is one of the client's Brand Clans, its published Brand Bible frozen at the version taken
//   (document brand_clans[id]); read-only here. Until Production is a CLAN app (Stage 2/3) the copy lives in the project,
//   as a Brief node's does; it becomes an OS attach then.
// - It is placed for the client's default, not linked: it powers jobs only when linked (the same rule as references and
//   the Brief). The picker swaps it for another of the client's Brand Clans; a second node beside it compares two looks.
// - A link carries downstream (Script, then Storyboard, then Film; a Film's sizes), and for each step the nearest link up
//   the canvas wins: a Storyboard linked to Summer 26 uses Summer 26 while the Script and its other Storyboard keep Original.
// - What it feeds: tone, rules and words to avoid feed the words; colours, type and imagery feed the pictures. Jobs read it
//   through jobs/context.ts (brandClanRows), as brand rules, a palette and typography.

import type { BrandBible, BrandClanNode, Id, Link, LinkEndpoint, ProductionDocument } from '../contracts/types'
import { newId } from '../lib/ulid'
import { systemUpdate, updateDoc, type DocumentStore } from '../doc/store'
import { putBlob } from '../lib/blobs'
import { scriptOfStoryboard, storyboardOfVideo } from '../model/selectors'
import type { BrandClanSource, OsBrandClanItem, OsBrandClanRead } from './os'

type Doc = ProductionDocument

export const BRAND_APP_ID = 'ie.napkin.brand' as const

/** The Brand Bible parts a node keeps: visual, voice and imagery (contract section 8), nothing of the draft or history. */
export function bibleOf(data: Record<string, unknown>): BrandBible {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
  const out: BrandBible = {}
  const visual = obj(data.visual)
  const voice = obj(data.voice)
  const imagery = obj(data.imagery)
  if (visual) out.visual = structuredClone(visual) as BrandBible['visual']
  if (voice) out.voice = structuredClone(voice) as BrandBible['voice']
  if (imagery) out.imagery = { ...(typeof imagery.style === 'string' ? { style: imagery.style } : {}), ...(Array.isArray(imagery.bans) ? { bans: (imagery.bans as unknown[]).filter((b): b is string => typeof b === 'string') } : {}) }
  return out
}

/** A new Brand Clan node from a Brand Clan as read from the OS (not yet in the document). */
export function newBrandClan(read: OsBrandClanRead, how: 'default' | 'pick', now = new Date()): BrandClanNode {
  return {
    id: newId('bclan'), v: 1, field_v: {},
    title: read.name.slice(0, 200) || 'Brand Clan',
    ...(read.client ? { client: read.client } : {}),
    source: { document_id: read.documentId, path: read.path, app_id: BRAND_APP_ID, version: read.version, at: now.toISOString(), how },
    bible: bibleOf(read.data),
  }
}

// ── Its logo, as a project picture (owner 2026-11-24, "Go with your recommendations") ─────────────────────────────
// When a node is placed, swapped or updated, the Brand Clan's logo comes in as a picture of the project, so the end card and
// the sizes can use it (brandKit in campaign/layout.ts) when the node is linked and the project has no Brand board logo.

/** A logo ready to go into the document: its bytes kept in this browser under its hash, and its size. */
export interface LogoIn { sha256: string; w: number; h: number; mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number }

const LOGO_ORDER = ['dark', 'mark', 'light', 'other'] as const
const RASTER = /^image\/(png|jpeg|webp)$/

/** The logo a node takes: the one for a dark ground (the end card's), else the mark, else any. */
export function logoAssetOf(b: BrandBible): string | undefined {
  const logos = ((b.visual as { logos?: { variant?: string; asset?: string }[] } | undefined)?.logos ?? []).filter((l) => l.asset)
  for (const v of LOGO_ORDER) {
    const hit = logos.find((l) => l.variant === v)
    if (hit) return hit.asset
  }
  return logos[0]?.asset
}

/** Fetch a Brand Clan's logo into this browser. Undefined when it has none, Napkin does not have it, or it is not a
 *  picture the tools take (a PNG, JPEG or WebP: the client window turns an SVG into a PNG at upload). Never throws. */
export async function fetchLogo(src: Pick<BrandClanSource, 'assetFile'>, read: OsBrandClanRead,
  measure: (b: Blob) => Promise<{ w: number; h: number }> = async (b) => { const m = await createImageBitmap(b); const out = { w: m.width, h: m.height }; m.close(); return out },
  keep: (b: Blob) => Promise<string> = putBlob): Promise<LogoIn | undefined> {
  const asset = logoAssetOf(bibleOf(read.data))
  if (!asset) return undefined
  try {
    const blob = await src.assetFile(read.path, asset)
    if (!blob || !RASTER.test(blob.type)) return undefined
    const { w, h } = await measure(blob)
    if (!(w >= 1 && h >= 1)) return undefined
    return { sha256: await keep(blob), w, h, mime: blob.type as LogoIn['mime'], bytes: blob.size }
  } catch {
    return undefined
  }
}

/** Put a logo into the document as a picture and onto the node (inside a document write). */
function setLogo(d: Doc, n: BrandClanNode, logo: LogoIn | undefined) {
  if (!logo) { delete n.logo; return }
  d.assets[logo.sha256] ??= { sha256: logo.sha256, kind: 'image', mime: logo.mime, bytes: logo.bytes, w: logo.w, h: logo.h, origin: 'uploaded', rights: 'unknown' }
  n.logo = { sha256: logo.sha256, w: logo.w, h: logo.h }
}

/** The Brand Clan's colour for an end card's ground: its ink, else its darkest colour, when dark enough for the card's light
 *  words (the stitch sets them light); undefined otherwise. */
export function cardGroundOf(b: BrandBible): string | undefined {
  const cols = ((b.visual as { colours?: { hex?: string; role?: string }[] } | undefined)?.colours ?? [])
    .map((c) => ({ hex: (c.hex ?? '').replace(/^#?/, '#').toUpperCase(), role: c.role })).filter((c) => /^#[0-9A-F]{6}$/.test(c.hex))
  const lum = (hex: string) => { const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * bl }
  const pick = cols.find((c) => c.role === 'ink') ?? [...cols].sort((a, b) => lum(a.hex) - lum(b.hex))[0]
  return pick && lum(pick.hex) < 0.3 ? pick.hex : undefined
}

/** The Brand Clan nodes, oldest first. */
export const brandClansList = (d: Doc): BrandClanNode[] => Object.values(d.brand_clans ?? {}).sort((a, b) => (a.id < b.id ? -1 : 1))

const named = (n: Pick<BrandClanNode, 'title' | 'source'>) => `“${n.title}” v${n.source.version}`

/** Put a Brand Clan node in the document (a system write: the person's undo step is its card on the canvas). One decision. */
export async function addBrandClan(store: DocumentStore, node: BrandClanNode, logo?: LogoIn): Promise<BrandClanNode> {
  await systemUpdate(store, (d) => {
    d.brand_clans ??= {}
    d.brand_clans[node.id] = node
    setLogo(d, d.brand_clans[node.id], logo)
  }, `${node.source.how === 'default' ? 'place' : 'add'} the Brand Clan ${named(node)}`,
  node.source.how === 'default' ? 'the client’s default Brand Clan, placed for you and not linked: jobs do not use it until it is linked' : `picked from the client’s Brand Clans (${node.source.document_id})`)
  return node
}

/** The link from a Brand Clan node into a node (not yet in the document). */
export const brandClanLink = (id: Id, to: LinkEndpoint): Link => ({ id: newId('link'), v: 1, field_v: {}, from: { kind: 'brand_clan', id }, to, role: 'brand' })

// ── Which Brand Clan a node reads: its own link, else the nearest one up the canvas ─────────────────────────────

/** The nodes upstream of `id`, one step: what drives, renders or masters it by link, and what it hangs off without one, as
 *  the rest of the tool reads it (model/selectors): a Film's storyboard (its own shot list, or the main storyboard for the
 *  main Film), a storyboard's script (the main script for the main storyboard), a Film's own shot list's Film, a set of
 *  sizes' Film. A55: a Film made from a storyboard has no `renders` link, so a Brand Clan linked to the Script reached the
 *  frames and clips but not the end card. */
function upstream(d: Doc, id: Id): Id[] {
  const out = Object.values(d.links ?? {}).filter((l) => l.to.id === id && (l.role === 'drives' || l.role === 'renders' || l.role === 'master')).map((l) => l.from.id)
  if (d.videos?.[id]) { const sb = storyboardOfVideo(d, id); if (sb) out.push(sb.id) }
  const sb = d.storyboards?.[id]
  if (sb) {
    if (sb.implicit && sb.video_id) out.push(sb.video_id)
    const sc = scriptOfStoryboard(d, id)
    if (sc) out.push(sc.id)
  }
  const m = d.format_sets?.[id]?.master
  if (m?.kind === 'video') out.push(m.id)
  else if (m?.kind === 'render') { const v = d.renders?.[m.id]?.video_id; if (v) out.push(v) }
  return out
}

/** The Brand Clan linked straight into `id`, if any. */
function linkedInto(d: Doc, id: Id): { node: BrandClanNode; linkId: Id } | undefined {
  for (const l of Object.values(d.links ?? {})) {
    if (l.role === 'brand' && l.from.kind === 'brand_clan' && l.to.id === id) {
      const node = d.brand_clans?.[l.from.id]
      if (node) return { node, linkId: l.id }
    }
  }
  return undefined
}

export interface BrandClanInScope {
  node: BrandClanNode
  /** 'link': linked into this node; 'upstream': carried from a node that drives it. */
  via: 'link' | 'upstream'
  /** The node whose link brings it in (this node for 'link'). */
  at: Id
  linkId: Id
}

/** The Brand Clan in a node's scope: its own link, else the nearest up the canvas (DESIGN 4a). Undefined: none. */
export function brandClanOf(d: Doc, nodeId: Id): BrandClanInScope | undefined {
  const seen = new Set<Id>()
  let level: Id[] = [nodeId]
  while (level.length) {
    const next: Id[] = []
    for (const id of level) {
      if (seen.has(id)) continue
      seen.add(id)
      const hit = linkedInto(d, id)
      if (hit) return { node: hit.node, via: id === nodeId ? 'link' : 'upstream', at: id, linkId: hit.linkId }
      next.push(...upstream(d, id))
    }
    level = next
  }
  return undefined
}

/** The Brand Clan a job on `node` reads: a shot reads its storyboard, then the films it renders; any other node itself. */
export function brandClanForJob(d: Doc, node: LinkEndpoint): BrandClanInScope | undefined {
  if (node.kind !== 'shot') return brandClanOf(d, node.id)
  const sb = d.shots?.[node.id]?.storyboard_id
  return sb ? brandClanOf(d, sb) : undefined
}

/** What the node's card says about its links: "Linked to the Script", "Linked to Storyboard B", or not linked. */
export function linkedLabel(d: Doc, id: Id): string {
  const seen = new Set<string>()
  const to = Object.values(d.links ?? {})
    .filter((l) => l.role === 'brand' && l.from.kind === 'brand_clan' && l.from.id === id)
    .map((l) => l.to)
    .filter((e) => (seen.has(`${e.kind}:${e.id}`) ? false : (seen.add(`${e.kind}:${e.id}`), true)))
  if (!to.length) return ''
  // A node named only by its kind reads "the Script"; one with a name of its own reads "Script · Main" (A48: two Scripts
  // read "the Script, the Script").
  const KIND: Partial<Record<LinkEndpoint['kind'], string>> = { script: 'Script', storyboard: 'Storyboard', video: 'Film', format_set: 'sizes' }
  const titleOf = (e: LinkEndpoint) => (e.kind === 'script' ? d.scripts?.[e.id]?.title : e.kind === 'storyboard' ? d.storyboards?.[e.id]?.title : e.kind === 'video' ? d.videos?.[e.id]?.title : undefined)?.trim()
  const name = (e: LinkEndpoint) => {
    const kind = KIND[e.kind] ?? e.kind
    const t = titleOf(e)
    return t && t.toLowerCase() !== kind.toLowerCase() ? `${kind} · ${t}` : `the ${kind}`
  }
  const names = to.map(name)
  // Two with the same name are told apart by their place among their kind (Script 1, Script 2).
  const out = names.map((n, i) => {
    if (names.indexOf(n) === names.lastIndexOf(n)) return n
    const kind = KIND[to[i].kind] ?? to[i].kind
    const same = to.filter((_e, j) => names[j] === n).findIndex((e) => e === to[i]) + 1
    return `${kind} ${same}${n.startsWith('the ') ? '' : n.slice(kind.length)}`
  })
  return `Linked to ${out.join(', ')}`
}

// ── The person's choices: take a newer version, keep this one, swap for another Brand Clan ────────────────────

export type BrandClanFreshness = 'same' | 'newer' | 'kept'

/** Whether the OS has a newer published version than the node holds (and whether the person kept this one). */
export function freshness(n: BrandClanNode, now: Pick<OsBrandClanItem, 'version'>): BrandClanFreshness {
  if (now.version <= n.source.version) return 'same'
  return n.source.kept === now.version ? 'kept' : 'newer'
}

/** Take the newer version, or swap for another of the client's Brand Clans (the person's decision): one decision, the bible replaced. */
export async function takeBrandClan(store: DocumentStore, id: Id, read: OsBrandClanRead, at = new Date(), logo?: LogoIn): Promise<BrandClanNode | undefined> {
  const before = store.get().brand_clans?.[id]
  if (!before) return undefined
  const swap = before.source.document_id !== read.documentId
  if (!swap && read.version <= before.source.version) return before
  await updateDoc(store, (d) => {
    const n = d.brand_clans?.[id]
    if (!n) return
    n.title = read.name.slice(0, 200) || n.title
    n.bible = bibleOf(read.data)
    n.source = { document_id: read.documentId, path: read.path, app_id: BRAND_APP_ID, version: read.version, at: at.toISOString(), how: swap ? 'pick' : n.source.how }
    setLogo(d, n, logo)
  }, swap ? `swap_brand_clan ${named(before)} → “${read.name}” v${read.version}` : `update_from_brand_clan “${read.name}” v${before.source.version} → v${read.version}`,
  swap ? 'the person picked another of the client’s Brand Clans for this node; what it is linked to reads the new one on its next job' : 'took the newer published version; what it is linked to reads it on its next job')
  return store.get().brand_clans?.[id]
}

/** Keep this version (the person's decision): the newer one is not taken, and its notice goes until another is published. */
export async function keepBrandClan(store: DocumentStore, id: Id, version: number): Promise<void> {
  await updateDoc(store, (d) => {
    const n = d.brand_clans?.[id]
    if (n) n.source = { ...n.source, kept: version }
  }, `keep_brand_clan v${store.get().brand_clans?.[id]?.source.version ?? '?'}`, `kept this version; v${version} not taken`)
}

// ── What a job reads from it ───────────────────────────────────────────────────────────────────────────────────

const RULE_WORD: Record<string, string> = { do: 'Do', dont: "Don't", tone: 'Tone' }
const hex = (x: string) => (x.startsWith('#') ? x : `#${x}`).toUpperCase()

/** The Brand Clan's words and look as job context items: tone and rules (and imagery bans as don'ts), its palette, its type. */
export function brandClanWords(n: BrandClanNode): { kind: 'brand_rule' | 'palette' | 'typography'; key: string; text: string }[] {
  const b = n.bible
  const out: { kind: 'brand_rule' | 'palette' | 'typography'; key: string; text: string }[] = []
  if (b.voice?.tone?.trim()) out.push({ kind: 'brand_rule', key: 'tone', text: `Tone: ${b.voice.tone.trim()}` })
  for (const r of b.voice?.rules ?? []) if (r.text?.trim()) out.push({ kind: 'brand_rule', key: `rule:${r.id}`, text: `${RULE_WORD[r.kind ?? ''] ?? 'Rule'}: ${r.text.trim()}` })
  for (const ban of b.imagery?.bans ?? []) if (ban.trim()) out.push({ kind: 'brand_rule', key: `ban:${ban.trim().toLowerCase()}`, text: `Don't: ${ban.trim()}` })
  if (b.imagery?.style?.trim()) out.push({ kind: 'brand_rule', key: 'imagery', text: `Imagery: ${b.imagery.style.trim()}` })
  const cols = (b.visual?.colours ?? []).filter((c) => /^#?[0-9a-fA-F]{6}$/.test(c.hex))
  if (cols.length) out.push({ kind: 'palette', key: 'palette', text: cols.map((c) => (c.name?.trim() ? `${c.name.trim()} ${hex(c.hex)}` : hex(c.hex))).join(', ') })
  const type = (b.visual?.typography ?? []).filter((t) => t.family?.trim())
  if (type.length) out.push({ kind: 'typography', key: 'type', text: type.map((t) => `${t.family.trim()}${t.use?.trim() ? ` (${t.use.trim()})` : ''}`).join(', ') })
  return out
}

/** The project's client, for the picker and the default (Production's project record). */
export const clientOf = (d: Doc): string | undefined => d.project?.client_id || undefined
