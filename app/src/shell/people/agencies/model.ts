// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Agencies tab's rules, pure (features/agency-looks-admin.clan; mock
// people-agencies-v3). Two kinds of agency: a basic agency made on the page
// (a name, other spellings, a base and an accent, a style for how the two are
// used, one SVG wordmark; every other token derived as for any agency), and an agency in code, whose look is
// read-only here and only its display name can change. Every edit goes to a
// draft that only the editor's previews show, until Publish. The server
// (crates/napkin-web) decides; these say the same thing on the page.

import {
  AGENCY_ALIASES, AGENCY_COLOURS, NEUTRAL_MARK, basicLook, canonicalAgencyId, coloursOf, contrast, inkOn, registerAgencyLooks,
  type AgencyColours, type AgencyLook, type WireStyle,
} from '../../agency/palette'
import { activeContent, sanitiseSvg, type Found } from '../../agency/svgSanitise'

/** A basic agency's draft: the whole look a publish would make (its style fields absent when default). */
export interface BasicDraft extends WireStyle {
  name: string
  aliases: string[]
  base: string
  accent: string
  /** The draft's wordmark, a data: URI; null for none. */
  wordmark: string | null
}

/** An agency as GET /api/admin/agencies (and /api/admin/people `.agencies`) lists it. */
export type AgencyAdminRow = BasicRow | CodeRow

interface RowCommon {
  id: string
  /** The published display name. */
  name: string
  aliases: string[]
  people: number
  rev: number
  changed_by?: string | null
  changed_at?: string | null
  published_by?: string | null
  published_at?: string | null
}

/** A basic agency: the top-level fields are the published look (style fields absent when default); `draft` the whole look a publish would make. */
export interface BasicRow extends RowCommon, WireStyle {
  kind: 'basic'
  base: string
  accent: string
  wordmark: string | null
  /** Whether it was ever published; an unpublished agency always has a draft. */
  published: boolean
  draft: BasicDraft | null
  added_by?: string
  added_at?: string
}

/** An agency in code: its look is palette.ts's; only its display name has a draft. */
export interface CodeRow extends RowCommon {
  kind: 'code'
  /** The name in code (palette.ts), for Reset name. */
  code_name: string
  draft: { name: string } | null
}

/** POST /api/admin/agencies. */
export interface NewBasicAgency { name: string; aliases?: string[]; base: string; accent: string }

/** PATCH /api/admin/agencies/{id}/draft: an agency in code takes `name` only. A style field's null clears it to the default. */
export interface DraftPatch extends WireStyle { name?: string; aliases?: string[]; base?: string; accent?: string; rev: number }

/** PUT /api/admin/agencies/{id}/draft/wordmark, 200 (`rev` for the next PATCH or publish). */
export interface WordmarkTaken { bytes: number; kept_bytes: number; dropped: string[]; warnings: string[]; svg: string; rev: number }

/** DELETE /api/admin/agencies/{id}/draft on a never-published agency: it is gone. */
export interface Removed { id: string; removed: true }

/** GET /api/admin/agencies/{id}/export: a published basic agency as code, for a PR. */
export interface CodeExport { palette_ts: string; svg: string | null; agency_logos_files: string | null; people_rs: string }

/**
 * How a basic look uses its two colours (features/agency-style.clan; palette.ts
 * AgencyColours' pill, accentUse, surface, accentInk), every field set: the
 * defaults are today's look.
 */
export interface LookStyle {
  pill: 'accent' | 'base'
  accentUse: 'fill' | 'line'
  surface: 'warm' | 'mono'
  /** Ink on the accent (#RRGGBB); null works it out. */
  accentInk: string | null
}

export const DEFAULT_STYLE: Readonly<LookStyle> = { pill: 'accent', accentUse: 'fill', surface: 'warm', accentInk: null }

/** A style from the wire (or a look in code): anything absent or not valid is the default. */
export function styleFrom(w: WireStyle | null | undefined): LookStyle {
  return {
    pill: w?.pill === 'base' ? 'base' : 'accent',
    accentUse: w?.accent_use === 'line' ? 'line' : 'fill',
    surface: w?.surface === 'mono' ? 'mono' : 'warm',
    accentInk: typeof w?.accent_ink === 'string' && HEX.test(w.accent_ink) ? w.accent_ink.toUpperCase() : null,
  }
}

/** A look in code's style (palette.ts AGENCY_COLOURS), for its read-only card. */
export function styleOfColours(c: AgencyColours): LookStyle {
  return styleFrom({ pill: c.pill, accent_use: c.accentUse, surface: c.surface, accent_ink: c.accentInk ?? null })
}

/** A style for the wire: only what is not the default (absent is the default, so a default look is stored as today's). */
export function wireOf(st: LookStyle): WireStyle {
  const out: WireStyle = {}
  if (st.pill !== 'accent') out.pill = st.pill
  if (st.accentUse !== 'fill') out.accent_use = st.accentUse
  if (st.surface !== 'warm') out.surface = st.surface
  if (st.accentInk && HEX.test(st.accentInk)) out.accent_ink = st.accentInk.toUpperCase()
  return out
}

/** Whether a style is the default (today's look). */
export function isDefaultStyle(st: LookStyle): boolean {
  return Object.keys(wireOf(st)).length === 0
}

/** The ink "Choose a colour" starts from: the base where it reads on the accent (Pluto's navy on lime), else the worked-out ink. */
export function startInk(look: Pick<EditLook, 'base' | 'accent'>): string {
  const acc = HEX.test(look.accent) ? look.accent.toUpperCase() : null
  const base = HEX.test(look.base) ? look.base.toUpperCase() : null
  if (acc && base && contrast(acc, base) >= 4.5) return base
  return acc ? inkOn(acc) : '#101114'
}

/** The look the editor is working on: the draft over the published look (or a new agency's fields). */
export interface EditLook extends LookStyle {
  /** The agency id; null for a new agency (its id is made from the name when it is made). */
  id: string | null
  kind: 'code' | 'basic'
  name: string
  aliases: string[]
  base: string
  accent: string
  /** The wordmark as an SVG data: URI; null for none. */
  wordmark: string | null
  /** The file it came from, when known. */
  file: string | null
}

export const HEX = /^#[0-9A-Fa-f]{6}$/

/** The spellings an agency in code has (palette.ts AGENCY_ALIASES). */
export function codeAliases(id: string): string[] {
  return Object.entries(AGENCY_ALIASES).filter(([, to]) => to === id).map(([a]) => a)
}

/** Whether a row has a draft nobody sees yet. */
export function hasDraft(row: AgencyAdminRow): boolean {
  return row.draft != null
}

/** Whether a basic agency has been published (a code agency always is). */
export function isPublished(row: AgencyAdminRow): boolean {
  return row.kind === 'code' || row.published
}

/** The look people see now. */
export function liveLook(row: AgencyAdminRow): EditLook {
  if (row.kind === 'code') {
    const c = AGENCY_COLOURS[row.id]
    return { id: row.id, kind: 'code', name: row.name, aliases: [...(row.aliases ?? codeAliases(row.id))], base: c?.base ?? '', accent: c?.accent ?? '', wordmark: null, file: null, ...(c ? styleOfColours(c) : DEFAULT_STYLE) }
  }
  return { id: row.id, kind: 'basic', name: row.name, aliases: [...(row.aliases ?? [])], base: row.base ?? '', accent: row.accent ?? '', wordmark: row.wordmark ?? null, file: null, ...styleFrom(row) }
}

/** The look the editor opens on: the draft over what people see now. */
export function currentLook(row: AgencyAdminRow): EditLook {
  const live = liveLook(row)
  if (!row.draft) return live
  if (row.kind === 'code') return { ...live, name: row.draft.name }
  const d = row.draft
  return { ...live, name: d.name, aliases: [...d.aliases], base: d.base, accent: d.accent, wordmark: d.wordmark, ...styleFrom(d) }
}

/** A new basic agency, before its first edit. */
export const NEW_LOOK: EditLook = { id: null, kind: 'basic', name: '', aliases: [], base: '', accent: '', wordmark: null, file: null, ...DEFAULT_STYLE }

/** An agency id made from a display name, as the server makes it (people.rs agency_slug). */
export function slugOf(name: string): string {
  return name.trim().toLowerCase().replace(/[+&]/g, 'and').replace(/[^a-z0-9]/g, '').slice(0, 40)
}

/** Whether both colours are #rrggbb. */
export function hasColours(l: EditLook): boolean {
  return HEX.test(l.base) && HEX.test(l.accent)
}

/**
 * The colours the shell takes for a look: an agency in code is its code entry
 * with the display name; a basic one goes through palette.ts basicLook (its
 * wordmark recoloured white for dark grounds). Until both colours are picked,
 * the neutral mark's stand in (the previews' placeholder).
 */
export function coloursForLook(l: EditLook): AgencyColours {
  if (l.kind === 'code' && l.id && AGENCY_COLOURS[l.id]) return { ...AGENCY_COLOURS[l.id], name: l.name || AGENCY_COLOURS[l.id].name }
  const ok = hasColours(l)
  return basicLook({ name: l.name.trim() || 'New agency', base: ok ? l.base : NEUTRAL_MARK.base, accent: ok ? l.accent : NEUTRAL_MARK.accent, logo: l.wordmark, ...wireOf(l) })!
}

/** The published looks the rows carry, as /api/agency-looks would serve them (never drafts). */
export function publishedLooks(rows: readonly AgencyAdminRow[]): AgencyLook[] {
  return rows.filter(isPublished).map(r => r.kind === 'code'
    ? { id: r.id, name: r.name, rev: r.rev }
    : { id: r.id, name: r.name, base: r.base, accent: r.accent, aliases: r.aliases, logo: r.wordmark, rev: r.rev, ...wireOf(styleFrom(r)) })
}

/** Take the rows' published looks into the registry, so the People list's pills wear them. */
export function registerRows(rows: readonly AgencyAdminRow[]): void {
  registerAgencyLooks(publishedLooks(rows))
}

/** The agency id a person's agency part means: an id, or another spelling of a listed agency or the code registry. */
export function agencyOfPerson(part: string, rows: readonly AgencyAdminRow[]): string | null {
  const t = part.trim().toLowerCase()
  const hit = rows.find(r => r.id === t || (r.aliases ?? []).some(a => a.toLowerCase() === t))
  return hit?.id ?? null
}

/** The pill a person's agency wears in the People list: its published look (the registry's), or none for one not published. */
export function personLook(part: string, agencies: readonly AgencyAdminRow[]): AgencyColours | null {
  const id = agencyOfPerson(part, agencies) ?? canonicalAgencyId(part)
  if (!id) return null
  const row = agencies.find(a => a.id === id)
  if (row && !isPublished(row)) return null
  if (row?.kind === 'code') return AGENCY_COLOURS[id] ? { ...AGENCY_COLOURS[id], name: row.name } : null
  if (row?.kind === 'basic') return basicLook({ name: row.name, base: row.base, accent: row.accent, logo: row.wordmark, ...wireOf(styleFrom(row)) })
  return coloursOf(id)
}

/** The list's order: agencies in code as the registry has them, B+G, Catapult, Pluto and Napkin first (the mock's), then the basic ones. */
export function listOrder(rows: readonly AgencyAdminRow[]): AgencyAdminRow[] {
  const first = ['boysandgirls', 'catapult', 'pluto', 'napkin']
  const rank = (r: AgencyAdminRow) => r.kind === 'basic' ? 1000 : first.includes(r.id) ? first.indexOf(r.id) : 10 + Object.keys(AGENCY_COLOURS).indexOf(r.id)
  return [...rows].sort((a, b) => rank(a) - rank(b))
}

/** The agencies a search finds: by name, id or another spelling. */
export function findAgencies(rows: readonly AgencyAdminRow[], q: string): AgencyAdminRow[] {
  const t = q.trim().toLowerCase()
  if (!t) return [...rows]
  return rows.filter(r => {
    const l = currentLook(r)
    return r.id.includes(t) || l.name.toLowerCase().includes(t) || l.aliases.some(a => a.toLowerCase().includes(t))
  })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "13 Nov 2026 · 14:40", in the browser's time. */
export function whenOf(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** One part of the editor's history line; `draft` parts are in the warning colour. */
export interface HistPart { text: string; draft?: boolean; faint?: boolean }

/** The history line: who published and when, who drafted and when ("not live"), or that a new agency is not saved. */
export function histParts(row: AgencyAdminRow | null, local: { drafted: boolean; by: string; at: string | null; publishable: boolean }): HistPart[] {
  if (!row) {
    if (!local.drafted) return [{ text: 'Not saved yet. Your first edit starts a draft.' }]
    const out: HistPart[] = [{ text: `Draft by ${local.by}${local.at ? `, ${whenOf(local.at)}` : ''}`, draft: true }, { text: ', not live' }]
    if (!local.publishable) out.push({ text: ' · ' }, { text: 'Publish needs a name and both colours.', faint: true })
    return out
  }
  const out: HistPart[] = []
  if (row.published_by && row.published_at) out.push({ text: `Published by ${row.published_by}, ${whenOf(row.published_at)}` })
  else if (row.kind === 'code') out.push({ text: 'As in code' })
  if (hasDraft(row)) {
    if (out.length) out.push({ text: ' · ' })
    out.push({ text: `Draft by ${row.changed_by ?? 'someone'}${row.changed_at ? `, ${whenOf(row.changed_at)}` : ''}`, draft: true }, { text: ', not live' })
  }
  return out
}

/** What the server says about a wordmark it took, or a reason it was refused (with the file's lines, to show where). */
export type UploadReport =
  | { ok: true; name: string; bytes: number; kept: number; dropped: string[]; warnings: string[] }
  | { ok: false; name: string; why: string; found: Found[]; lines: string[] }

const WHAT: Record<string, string> = {
  script: 'a script',
  foreignObject: 'embedded HTML (foreignObject)',
  'javascript: link': 'a javascript: link',
  DOCTYPE: 'a DOCTYPE',
  'ENTITY declaration': 'an XML entity',
}

/** One found thing in words: "a script", "an event handler (onload)", "a link out of the file (https://…)". */
export function foundWords(what: string): string {
  if (WHAT[what]) return WHAT[what]
  if (what.startsWith('event handler ')) return `an event handler (${what.slice(14)})`
  if (what.startsWith('external link ')) return `a link out of the file (${what.slice(14)})`
  return what
}

/** The refusal sentence for active content: "Refused: the file has a script on line 4." */
export function refusalWhy(found: readonly Found[]): string {
  if (!found.length) return 'Refused.'
  const [f] = found
  const more = found.length > 1 ? `, and ${found.length - 1} more thing${found.length > 2 ? 's' : ''} that could run or reach out` : ''
  return `Refused: the file has ${foundWords(f.what)} on line ${f.line}${more}.`
}

/** Sizes as the mock writes them: "640 B", "4.5 KB". */
export function kb(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

export const RAW_MAX = 200 * 1024
export const CLEAN_MAX = 48 * 1024
export const SHAPES_MAX = 2000

const svgUri = (svg: string) => 'data:image/svg+xml,' + encodeURIComponent(svg)
const bytesOf = (s: string) => new TextEncoder().encode(s).length

/**
 * A new agency's wordmark, checked on the page with the server's own rules
 * (svgSanitise.ts activeContent and sanitiseSvg, the same limits), because the
 * agency is not on the server until Publish; the server checks it again then.
 */
export function screenUpload(name: string, text: string): { report: UploadReport; wordmark: string | null } {
  const lines = text.split('\n')
  const raw = bytesOf(text)
  const no = (why: string, found: Found[] = []) => ({ report: { ok: false as const, name, why, found, lines }, wordmark: null })
  if (raw > RAW_MAX) return no(`Refused: the file is ${kb(raw)}; logos up to 200 KB are taken.`)
  const found = activeContent(text)
  if (found.length) return no(refusalWhy(found), found)
  let svg: string
  try { svg = sanitiseSvg(text) } catch (e) {
    const m = e instanceof Error ? e.message : ''
    return no(m === 'svg has no viewBox' ? 'Refused: the SVG has no viewBox, so it cannot be sized.'
      : m === 'svg has no shapes' ? 'Refused: nothing in the file can be drawn as shapes.'
        : 'Refused: this is not an SVG.')
  }
  const kept = bytesOf(svg)
  if (kept > CLEAN_MAX) return no(`Refused: cleaned, the logo is ${kb(kept)}; up to 48 KB is kept.`)
  const shapes = (svg.match(/<(path|rect|circle|ellipse|polygon) /g) ?? []).length
  if (shapes > SHAPES_MAX) return no(`Refused: the logo has ${shapes} shapes; up to ${SHAPES_MAX} are kept.`)
  const dropped = [...new Set([...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([A-Za-z_][A-Za-z0-9_:.-]*)/g)].map(m => m[1]))]
    .filter(n => !['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon'].includes(n))
  return { report: { ok: true, name, bytes: raw, kept, dropped, warnings: [] }, wordmark: svgUri(svg) }
}

/** The lines of a refused file around the first thing found, numbered, the found line marked. */
export function excerpt(r: Extract<UploadReport, { ok: false }>): { n: number; text: string; mark: boolean }[] {
  if (!r.found.length || !r.lines.length) return []
  const mark = r.found[0].line - 1
  const lo = Math.max(0, mark - 2), hi = Math.min(r.lines.length, mark + 2)
  return r.lines.slice(lo, hi).map((l, j) => ({ n: lo + j + 1, text: l.length > 96 ? l.slice(0, 96) + '…' : l, mark: lo + j === mark }))
}

/** Whether Publish can go: a draft, and for a new agency a name and both colours. */
export function canPublish(row: AgencyAdminRow | null, look: EditLook, drafted: boolean): boolean {
  if (!row) return drafted && !!look.name.trim() && hasColours(look)
  return hasDraft(row) && !!look.name.trim() && (look.kind === 'code' || hasColours(look))
}

/** Initials for the brief tile: "Kestrel Lane" is KL. */
export function initialsOf(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'NA'
}
