// The routes a project was born with (features/territories-spinoff-out-production.clan): Continue in › Production from a
// Territories document is the same plain spin-off as from a brief. The OS writes the project with the Territories document
// carried whole under data.upstream.<its id> (what that document had carried, its brief and research, sits beside it), and
// the page shows what came through the way it shows a carried brief: on the blank canvas, nothing asked, nothing selected.
// A route is a Text on the canvas (its words are the node's input words once linked), one per greenlit route; no new screen.
//
// Pictures are links: the document holds a sha256 and the stated rights, and these words say so. Unknown or unstated
// rights read "Rights to supply", never a guess; a Final with none says it needs them (LESSONS 8, 10).

import type { NodeEnv } from '../canvas/nodes/nodes'
import type { SpunOffFrom } from '../../../clan-store/src'
import { fitClear } from '../canvas/boards/boards'
import { newId } from '../lib/ulid'
import { systemUpdate } from '../doc/store'

export const TERRITORIES_APP_ID = 'ie.napkin.territories' as const
export const PRODUCTION_DESTINATION = 'production-tool'
const RIGHTS: Record<string, string> = { generated: 'Generated', own: 'Own', licensed: 'Licensed' }
export const RIGHTS_TO_SUPPLY = 'Rights to supply'
const WRAP = 34
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
  frames: { sha256: string; rights: string; final: boolean }[]
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
    if (p.kind === 'frame') out.frames.push({ sha256: str(p.sha256), rights: RIGHTS[str(p.rights)] ?? RIGHTS_TO_SUPPLY, final: p.final === true })
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
    words: [...new Set(words.filter(Boolean))].slice(0, MAX_WORDS),
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
  return { documentId: from.document_id, title: from.title.trim() || 'Territories', routes: live.map(routeOf), notChosen, ...(by ? { by } : {}) }
}

const wrap = (s: string, width = WRAP): string[] => {
  const out: string[] = []
  let line = ''
  for (const w of s.split(' ')) {
    if (line && line.length + 1 + w.length > width) { out.push(line); line = w } else line = line ? `${line} ${w}` : w
  }
  if (line) out.push(line)
  return out
}

/** What a route says in plain words on the canvas: name, line, why, their words, palette, checks, risks, pictures and rights. */
export function routeWords(r: CarriedRoute): string {
  const lines: string[] = [r.name.toUpperCase(), ...wrap(r.thought)]
  if (r.why && r.why !== r.thought) lines.push('', ...wrap(`Why it is a route: ${r.why}`))
  if (r.words.length) lines.push('', 'Their words:', ...r.words.flatMap((w) => wrap(`· ${w}`)))
  if (r.palette.length) lines.push('', `Palette: ${r.palette.join(' ')}`)
  if (r.checked.length) lines.push('', 'Checked:', ...r.checked.flatMap((w) => wrap(`· ${w}`)))
  if (r.toCheck.length) lines.push('', 'To check:', ...r.toCheck.flatMap((w) => wrap(`· ${w}`)))
  if (r.risks.length) lines.push('', 'Not this:', ...r.risks.flatMap((w) => wrap(`· ${w}`)))
  lines.push('', picturesLine(r.pictures))
  return lines.join('\n')
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

/** The routes this project already brought in, from the spin-in it recorded (the record is how "once" survives a reload). */
const broughtIn = (env: NodeEnv, documentId: string): boolean =>
  Object.values(env.doc.get().spin_ins ?? {}).some((s) => s.source.document_id === documentId && s.state === 'brought_in')

/**
 * Bring the routes this project was born with: one Text per route in a row, in view and nothing selected (no Script, no link,
 * nothing asked), and a spin-in record saying what came and from where. Once per source: a project that recorded it is left alone.
 * Null when there is nothing to bring: no Territories parent, no greenlit route, already brought, or an engine that makes no text.
 */
export async function bringCarriedRoutes(env: NodeEnv, from: SpunOffFrom | null): Promise<{ made: number; ids: string[] } | null> {
  if (!from || !env.canvas.addText) return null
  const doc = env.doc.get()
  if (broughtIn(env, from.document_id)) return null
  const got = carriedRoutes(from, doc.upstream)
  if (!got || !got.routes.length) return null
  const v = env.canvas.visibleBounds()
  const colW = 600
  const total = got.routes.length * colW
  const x0 = Math.round((v.minX + v.maxX) / 2 - total / 2 + colW / 2)
  const y0 = Math.round(v.minY + 80)
  const ids = got.routes.map((r, i) => env.canvas.addText!({ x: x0 + i * colW, y: y0 }, routeWords(r))).filter((i): i is string => !!i)
  await systemUpdate(env.doc, (d) => {
    d.spin_ins ??= {}
    const id = newId('spin')
    d.spin_ins[id] = {
      id, v: 1, field_v: {},
      source: { document_id: got.documentId, app: TERRITORIES_APP_ID, title: got.title.slice(0, 200) },
      plan: got.routes.slice(0, 32).map((r) => ({ kind: 'document' as const, title: r.name.slice(0, 200), note: picturesLine(r.pictures).slice(0, 300) })),
      state: 'brought_in',
    }
  }, 'bring in the routes')
  env.canvas.select([])
  const els = env.canvas.elements().filter((e) => ids.includes(e.id))
  if (els.length) fitClear(env.canvas, els, { zoomFactor: 0.8 })
  return { made: ids.length, ids }
}
