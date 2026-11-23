// The routes a project was born with (features/territories-spinoff-out-production.clan): Continue in › Production from a
// Territories document is the same plain spin-off as from a brief. The OS writes the project with the Territories document
// carried whole under data.upstream.<its id> (what that document had carried, its brief and research, sits beside it), and
// the page shows what came through the way it shows a carried brief: on the blank canvas, nothing asked, nothing selected.
// A route is a Territories node on the canvas (owner 2026-11-23: Territories is just another node): one per route sent, each a
// frozen copy like the Brief node, carrying the brief and research that came with it (brief/routeNode.ts); no tabs, no new screen.
//
// Pictures are links: the document holds a sha256 and the stated rights, and these words say so. Unknown or unstated
// rights read "Rights to supply", never a guess; a Final with none says it needs them (LESSONS 8, 10).

import type { SpunOffFrom } from '../../../clan-store/src'
import type { JobRoute, RouteCopy, RoutePicture } from '../contracts/types'

export const TERRITORIES_APP_ID = 'ie.napkin.territories' as const
export const PRODUCTION_DESTINATION = 'production-tool'
const RIGHTS: Record<string, string> = { generated: 'Generated', own: 'Own', licensed: 'Licensed' }
export const RIGHTS_TO_SUPPLY = 'Rights to supply'
const MAX_WORDS = 6

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** Is this carried entry a Territories document (the one test, as engine/deck/inputs.py is_territories makes it)? */
export const isTerritories = (v: unknown): v is Rec => isRec(v) && ['territories', 'greenlit', 'crew'].every((k) => Array.isArray(v[k]))

export interface CarriedPictures {
  /** Sketches: palette drawings, not pictures; no rights needed. */
  mockups: number
  /** Pictures held by link: the hash and the rights the document stated. */
  frames: { sha256: string; rights: string; final: boolean; caption?: string }[]
  gaps: number
}
export interface CarriedRoute {
  id: string
  name: string
  thought: string
  why: string
  words: string[]
  palette: string[]
  checked: string[]
  toCheck: string[]
  risks: string[]
  pictures: CarriedPictures
}
export interface CarriedRoutes {
  documentId: string
  title: string
  routes: CarriedRoute[]
  /** Routes the person did not choose to send. */
  notChosen: number
  by?: string
  /** The Territories document's version at send (territoriesVersion). */
  version: number
}

/**
 * The Territories document's version, the way it versions itself. A pass has two gates, Pick and Greenlight, and the routes that
 * go out are the ones greenlit; so a version is a person's approval at the Greenlight gate (run.decisions, kind approve), and the
 * first send is v1, not v2. Reopened and greenlit again: v2. Counting both gates would call a first send v2. Never below 1.
 * (The Territories page shows no number of its own; this is the Brief's rule, approve decisions, applied to Territories' record.)
 */
export function territoriesVersion(doc: Rec): number {
  const run = isRec(doc.run) ? doc.run : {}
  return Math.max(1, arr(run.decisions).filter(isRec).filter((d) => d.kind === 'approve' && d.gate === 'greenlight').length)
}

/** The routes the person sent to Production, in the order sent; with no send (continued in without sending) the greenlit ones. */
function sentIds(doc: Rec): { ids: string[]; notChosen: number; by?: string } {
  const sends = arr(doc.sends).filter(isRec).filter((s) => s.to === PRODUCTION_DESTINATION && (s.status === 'sent' || s.status === 'asked'))
  const last = sends[sends.length - 1]
  if (last) return { ids: arr(last.territory_ids).filter((i): i is string => typeof i === 'string'), notChosen: arr(last.not_chosen).length, ...(str(last.by) ? { by: str(last.by) } : {}) }
  const green = arr(doc.greenlit).filter(isRec)
  const by = green.map((g) => str(g.by)).find(Boolean)
  return { ids: green.map((g) => g.territory_id).filter((i): i is string => typeof i === 'string'), notChosen: 0, ...(by ? { by } : {}) }
}

function picturesOf(t: Rec): CarriedPictures {
  const out: CarriedPictures = { mockups: 0, frames: [], gaps: 0 }
  for (const p of arr(t.pictures).filter(isRec)) {
    if (p.kind === 'frame') out.frames.push({ sha256: str(p.sha256), rights: RIGHTS[str(p.rights)] ?? RIGHTS_TO_SUPPLY, final: p.final === true, caption: str(p.caption) || str(p.title) || str(p.touchpoint) })
    else if (p.kind === 'gap') out.gaps++
    else out.mockups++
  }
  return out
}

function routeOf(t: Rec): CarriedRoute {
  const world = isRec(t.world) ? t.world : {}
  const words = [str(world.lead), ...Object.values(isRec(world.headlines) ? world.headlines : {}).map(str), ...arr(world.lines).map(str)]
  const checks = arr(t.checks).filter(isRec)
  const text = (c: Rec) => str(c.text)
  const palette = isRec(world.palette) ? Object.values(world.palette).map(str).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)) : []
  const id = str(t.id)
  return {
    id,
    name: str(t.name) || id,
    thought: str(t.thought) || str(t.sketch),
    why: str(t.why) || str(t.tension),
    words: [...new Set(words.filter(Boolean).map((w) => (w.length > 40 ? `${w.slice(0, 39).replace(/\s+\S*$/, '')}…` : w)))].slice(0, MAX_WORDS),
    palette,
    checked: checks.filter((c) => c.status === 'ok').map(text).filter(Boolean).slice(0, 4),
    toCheck: checks.filter((c) => c.status === 'warn' || c.status === 'fail' || c.status === 'unchecked').map(text).filter(Boolean).slice(0, 3),
    risks: arr(t.risks).map(str).filter(Boolean).slice(0, 3),
    pictures: picturesOf(t),
  }
}

/**
 * The routes a project spun off from a Territories document carries, read from what the project holds (never the OS):
 * the routes sent (else greenlit) that the document still holds live. Null when the parent is not a Territories document
 * (a brief, research: carriedBrief's); `routes` empty when no route is greenlit and live (nothing to bring).
 */
export function carriedRoutes(from: SpunOffFrom, upstream: Record<string, Record<string, unknown>> | undefined): CarriedRoutes | null {
  const doc = upstream?.[from.document_id]
  if (!isTerritories(doc)) return null
  const { ids, notChosen, by } = sentIds(doc)
  const byId = new Map(arr(doc.territories).filter(isRec).map((t) => [str(t.id), t]))
  const live = [...new Set(ids)].map((i) => byId.get(i)).filter((t): t is Rec => !!t && t.status !== 'killed')
  return { documentId: from.document_id, title: from.title.trim() || 'Territories', routes: live.map(routeOf), notChosen, version: territoriesVersion(doc), ...(by ? { by } : {}) }
}

/** Pictures in words, never a finished picture that is not one: sketches are mock-ups; a frame is a link with its stated rights. */
export function picturesLine(p: CarriedPictures): string {
  const bits: string[] = []
  if (p.mockups) bits.push(`${p.mockups} mock-up sketch${p.mockups === 1 ? '' : 'es'}, not finished pictures`)
  if (p.frames.length) {
    const rights = [...new Set(p.frames.map((f) => f.rights))].sort()
    bits.push(`${p.frames.length} picture${p.frames.length === 1 ? '' : 's'} by link (rights: ${rights.join(', ')})`)
    if (p.frames.some((f) => f.final && f.rights === RIGHTS_TO_SUPPLY)) bits.push('a Final needs its rights')
  }
  if (p.gaps) bits.push(`${p.gaps} with no picture yet`)
  return `Pictures: ${bits.join('; ') || 'none yet'}.`
}

/** "Rights to supply" for a picture whose rights the document did not state. */
export const rightsWords = (r: RoutePicture['rights']): string => (r === 'generated' ? 'Generated' : r === 'own' ? 'Own' : r === 'licensed' ? 'Licensed' : RIGHTS_TO_SUPPLY)

/** What a job on a Territories node reads of the route: words and palette, pictures as hash links with their rights. */
export function jobRoute(c: RouteCopy): JobRoute {
  return {
    name: c.name, thought: c.thought, ...(c.why ? { why: c.why } : {}), ...(c.words?.length ? { words: [...c.words] } : {}),
    ...(c.palette?.length ? { palette: [...c.palette] } : {}), ...(c.not?.length ? { not: [...c.not] } : {}),
    ...(c.pictures?.length ? { pictures: c.pictures.map((p) => ({ sha256: p.sha256, rights: rightsWords(p.rights) })) } : {}),
  }
}
