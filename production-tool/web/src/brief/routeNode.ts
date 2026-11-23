// The Territories node (features/territories-spinoff-out-production.clan; owner 2026-11-23: "Territories is just another node"):
// Continue in › Production from a Territories document makes ONE project with ONE node per route sent, no tabs. Each is a frozen
// copy of its route, the way the Brief node is a frozen copy of a brief: a briefs[id] entity with a `route`, so linking, scope,
// removal and "only when linked, carries downstream" are the Brief node's own. It carries everything before it: the brief that
// came with the document is its spine (rules, legal, no-faces travel with every job from it) and the research is named, not
// copied. No separate Brief node is placed for a project born this way.
//
// Pictures are links by hash ('sha256:<hex>', the Production form; Territories writes the bare hex) with the rights the document stated, never bytes; unstated rights read "Rights to supply".

import type { ChainEntry, SpunOffFrom } from '../../../clan-store/src'
import type { BriefNode, Id, RouteCopy, RoutePicture, Sha256 } from '../contracts/types'
import type { NodeEnv } from '../canvas/nodes/nodes'
import { fitClear } from '../canvas/boards/boards'
import { newId } from '../lib/ulid'
import { systemUpdate } from '../doc/store'
import { placeBrief } from './canvas'
import { carriedRoutes, isTerritories, picturesLine, TERRITORIES_APP_ID, type CarriedRoute } from './routes'
import { projectSpine } from './spine'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string => {
  if (isRec(v) && 'value' in v) return text(v.value)
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim()
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('\n')
  return ''
}

/** The card's box on the canvas: full (every row), or compact (line, palette, pictures) when the node is sized down. */
export const ROUTE_CARD = { w: 410, h: 306, compactH: 214 } as const
const GAP = 40

/** Territories' own names for a brief's fields (its carried.js BRIEF_KEYS), as Brief Maker names them for the spine. */
const BRIEF_KEYS: Record<string, string> = {
  insight: 'insight', smp: 'single_minded_proposition', audience: 'audience', tone_world_assets: 'tone_and_world', mandatories: 'mandatories',
}
const KNOWN = ['background', 'objectives', 'audience', 'competitor_context', 'insight', 'smp', 'reasons_to_believe', 'desired_response', 'tone_world_assets', 'budget_scope', 'mandatories', 'single_minded_proposition', 'tone_and_world']
const isBriefData = (s: unknown): boolean => isRec(s) && KNOWN.some((k) => !!text(s[k]))

/** The brief and research the document carried, by what the document holds beside it (never the OS). */
export function carriedBeside(upstream: Record<string, Record<string, unknown>> | undefined, territoriesId: string): { brief?: { id: string; data: Rec }; research?: { id: string; title: string } } {
  let brief: { id: string; data: Rec } | undefined
  let research: { id: string; title: string } | undefined
  for (const [id, entry] of Object.entries(upstream ?? {})) {
    const s = entry as Rec
    if (id === territoriesId || !isRec(s) || !Object.keys(s).length || (isTerritories as (v: unknown) => boolean)(s)) continue
    if (!brief && isBriefData(s)) brief = { id, data: s }
    else if (!research && !isBriefData(s)) research = { id, title: text(s.title) || text(s.project_name) || (isRec(s.campaign) ? text(s.campaign.name) : '') || 'Research' }
  }
  return { ...(brief ? { brief } : {}), ...(research ? { research } : {}) }
}

/** A carried brief as the spine's declaration reads it: Territories' field names to Brief Maker's, one mandatory per line. */
function briefAsBriefMaker(d: Rec): Rec {
  const out: Rec = { ...d }
  for (const [from, to] of Object.entries(BRIEF_KEYS)) if (text(d[from]) && !text(d[to])) out[to] = d[from]
  const mand = text(out.mandatories)
  out.mandatories = mand ? mand.split(/\n+|(?<=[.;])\s+/).map((x) => x.trim()).filter(Boolean) : []
  const feel = text(d.desired_response)
  if (feel && !isRec(d.desired_response)) out.desired_response = { feel }
  return out
}

const rightsKey = (label: string): RoutePicture['rights'] => (label === 'Generated' ? 'generated' : label === 'Own' ? 'own' : label === 'Licensed' ? 'licensed' : undefined)
const HEX64 = /^[0-9a-f]{64}$/

function routeCopy(r: CarriedRoute, version: number): RouteCopy {
  const pictures = r.pictures.frames.filter((f) => HEX64.test(f.sha256)).slice(0, 12)
    .map((f): RoutePicture => ({ sha256: `sha256:${f.sha256}` as Sha256, ...(f.caption ? { caption: f.caption.slice(0, 120) } : {}), ...(rightsKey(f.rights) ? { rights: rightsKey(f.rights) } : {}), ...(f.final ? { final: true } : {}) }))
  return {
    id: r.id.slice(0, 128), version, name: r.name.slice(0, 200), thought: r.thought.slice(0, 600),
    ...(r.why ? { why: r.why.slice(0, 600) } : {}), ...(r.words.length ? { words: r.words.map((w) => w.slice(0, 200)) } : {}),
    ...(r.palette.length ? { palette: r.palette.slice(0, 8) } : {}), ...(r.risks.length ? { not: r.risks.map((w) => w.slice(0, 300)) } : {}),
    ...(pictures.length ? { pictures } : {}), ...(r.pictures.mockups ? { mockups: r.pictures.mockups } : {}), ...(r.pictures.gaps ? { gaps: r.pictures.gaps } : {}),
  }
}

/**
 * A carried brief's version as Brief Maker says it ("v2"): the approve decisions in the project's chain aimed at that document
 * (its address is `<id>#…`), at least 1. The same count the Brief node's spin-off makes (store.ts approvalsCarried), kept here so
 * the two do not depend on one another's branch.
 */
export function briefApprovals(chain: ChainEntry[], documentId: string): number {
  const mine = `${documentId}#`
  return Math.max(1, chain.filter((d) => d.kind === 'approve' && (d.targets ?? []).some((t) => typeof t === 'string' && t.startsWith(mine))).length)
}

/** One Territories node: the route frozen at the document's version, the brief it carries (at its version) as its spine. Not yet in the document. */
export function newRouteNode(from: SpunOffFrom, r: CarriedRoute, upstream: Record<string, Record<string, unknown>> | undefined, version: number, chain: ChainEntry[] = [], now = new Date()): BriefNode {
  const beside = carriedBeside(upstream, from.document_id)
  const { spine, confidential } = projectSpine(beside.brief ? briefAsBriefMaker(beside.brief.data) : {})
  return {
    id: newId('brief'), v: 1, field_v: {},
    title: from.title.trim().slice(0, 200) || 'Territories',
    source: { document_id: from.document_id, app_id: TERRITORIES_APP_ID, data_sha256: from.data_sha256 as BriefNode['source']['data_sha256'], taken: 1, at: now.toISOString(), how: 'spinoff' },
    spine, ...(confidential.length ? { confidential } : {}),
    route: routeCopy(r, version),
    carries: {
      ...(beside.brief ? { brief: { title: text(beside.brief.data.title) || text(isRec(beside.brief.data.campaign) ? beside.brief.data.campaign.name : '') || 'Brief', v: briefApprovals(chain, beside.brief.id) } } : {}),
      ...(beside.research ? { research: { title: beside.research.title } } : {}),
    },
  }
}

/** The Territories node already made for this route of this document, if one is. */
export const routeNodeFor = (d: { briefs?: Record<Id, BriefNode> }, documentId: string, routeId: string): BriefNode | undefined =>
  Object.values(d.briefs ?? {}).find((b) => b.route && b.source.document_id === documentId && b.route.id === routeId)

/** The footer's words: "Carries: Brief v1 · Research". */
export function carriesWords(b: BriefNode): string {
  const c = b.carries
  const bits = [c?.brief ? `Brief v${c.brief.v}` : '', c?.research ? 'Research' : ''].filter(Boolean)
  return `Carries: ${bits.join(' · ') || 'nothing before it'}`
}

/** The routes this project already brought in, from the spin-in it recorded (the record is how "once" survives a reload). */
const broughtIn = (env: NodeEnv, documentId: string): boolean =>
  Object.values(env.doc.get().spin_ins ?? {}).some((s) => s.source.document_id === documentId && s.state === 'brought_in')

/**
 * Bring the routes this project was born with: one Territories node per route sent, side by side in view, nothing selected (no
 * Script, no link, nothing asked), and a spin-in record saying what came and from where. Once per source: a project that recorded
 * it is left alone. Null when there is nothing to bring: no Territories parent, no route sent or greenlit and live, already brought.
 */
export async function bringCarriedRoutes(env: NodeEnv, from: SpunOffFrom | null, chain: ChainEntry[] = []): Promise<{ made: number; ids: Id[]; els: string[] } | null> {
  if (!from) return null
  const doc = env.doc.get()
  if (broughtIn(env, from.document_id)) return null
  const got = carriedRoutes(from, doc.upstream)
  if (!got || !got.routes.length) return null
  const nodes = got.routes.filter((r) => !routeNodeFor(doc, from.document_id, r.id)).map((r) => newRouteNode(from, r, doc.upstream, got.version, chain))
  await systemUpdate(env.doc, (d) => {
    d.briefs ??= {}
    for (const n of nodes) d.briefs[n.id] = n
    d.spin_ins ??= {}
    const id = newId('spin')
    d.spin_ins[id] = {
      id, v: 1, field_v: {},
      source: { document_id: got.documentId, app: TERRITORIES_APP_ID, title: got.title.slice(0, 200) },
      plan: got.routes.slice(0, 32).map((r) => ({ kind: 'document' as const, title: r.name.slice(0, 200), note: picturesLine(r.pictures).slice(0, 300) })),
      state: 'brought_in',
    }
  }, `bring in ${nodes.length === 1 ? 'the route' : 'the routes'} from Territories`, `${nodes.map((n) => n.route!.name).join(', ')}: one Territories node each, frozen copies carrying the brief and research`)
  const v = env.canvas.visibleBounds()
  const total = nodes.length * ROUTE_CARD.w + (nodes.length - 1) * GAP
  const x0 = (v.minX + v.maxX) / 2 - total / 2 + ROUTE_CARD.w / 2
  const cy = v.minY + 80 + ROUTE_CARD.h / 2
  const els = nodes.map((n, i) => placeBrief(env, n.id, { x: x0 + i * (ROUTE_CARD.w + GAP), y: cy }, ROUTE_CARD).id)
  env.canvas.select([])
  const placed = env.canvas.elements().filter((e) => els.includes(e.id))
  if (placed.length) fitClear(env.canvas, placed, { zoomFactor: 0.8 })
  return { made: nodes.length, ids: nodes.map((n) => n.id), els }
}
