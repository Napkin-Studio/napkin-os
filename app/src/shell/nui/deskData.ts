// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The desk's data, as the approved mock draws it (design/new-ui
// napkin-app-v1.html, phase 33; gaps.md §1): one typed function per section,
// fed from what the studio serves today. Where nothing serves a value yet
// (gaps.md §12) the fallback is deterministic and named here, so the owner can
// decide on a backend without hunting for it:
//
//   client colour   the admin's client registry (agency/clients.ts), else hashed
//                   from the client id onto the mock's palette (CLIENT_LOOKS)
//   client sector   kept in this browser only (sectorOf / setSector)
//   last editor     the library's last_editor (the signed-in account that last
//                   wrote it); an entry without it is not "Me". The chain's newest
//                   decision names someone else's edit in the row's second line
//   worth a look    finished research from the library's run state, plus thin
//                   findings and upstream changes of recent documents (DocFacts);
//                   knowledge-layer updates wait for the layers service (decided scope)
//   desk calls      per-document /decisions of recent documents (DocFacts.calls)

import type { AttentionItem, ClientRecord, LibraryItem } from '../../host'
import { initialsOf, needsYou, ordered, summarise, type ClientSummary } from '../landing/model'
import { toolOfApp } from '../landing/tools'
import type { ToolId } from '../route'
import { clientBrand } from '../agency/clients'

/** A client's colour on the desk: the disc's fill and the ink of its monogram. */
export interface ClientLook { cl: string; ink: string }

/**
 * The mock's client colours (McDonald's, Ballymaloe, Guinness, Bord Bia), then
 * four more in the same register. No backend holds a client's colour yet
 * (ClientRecord has none; the Brand Clan kit is unmerged): a client takes one
 * by its id, so it keeps it on every screen and every visit.
 */
export const CLIENT_LOOKS: readonly ClientLook[] = [
  { cl: '#DA291C', ink: '#FFC72C' },
  { cl: '#7A1E1E', ink: '#F3D9A4' },
  { cl: '#111111', ink: '#C9A86A' },
  { cl: '#1F6B3A', ink: '#CDE8B5' },
  { cl: '#1E3A8A', ink: '#FDE68A' },
  { cl: '#5B2A86', ink: '#F5D0FE' },
  { cl: '#0F6B5C', ink: '#BFF3E6' },
  { cl: '#9A3412', ink: '#FED7AA' },
]

/** A client's colours: the admin's registry entry, else the hashed palette colour (hashLook). */
export function clientLook(id: string, name = ''): ClientLook {
  const b = clientBrand({ id, name })
  return b ? { cl: b.base, ink: b.accent } : hashLook(id)
}

/** The name a client shows under: the registry's display name, else its stored name. */
export const clientName = (c: { id: string; name: string }): string => clientBrand(c)?.name || c.name

/** FNV-1a over the id: the same id, the same colour, everywhere. */
export function hashLook(id: string): ClientLook {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return CLIENT_LOOKS[h % CLIENT_LOOKS.length]
}

/** The monogram on a client's disc: the registry's initials, else the host's rule. */
export const monogramOf = (c: Pick<ClientRecord, 'name' | 'initials'>): string => c.initials || initialsOf(c.name)

const SECTOR_KEY = 'napkin.clientSector:'

/** The sector typed when the client was added. Kept in this browser only: ClientRecord has no sector yet. */
export function sectorOf(id: string): string | null {
  try { return window.localStorage.getItem(SECTOR_KEY + id) } catch { return null }
}
export function setSector(id: string, sector: string): void {
  try {
    if (sector.trim()) window.localStorage.setItem(SECTOR_KEY + id, sector.trim())
  } catch { /* storage blocked: the sector is not kept */ }
}

/** What the desk read of one recent document's chain (useDeskFacts). */
export interface DocFacts {
  /** Who made its newest decision; null when nobody has yet. */
  editor: { name: string; you: boolean; at: string } | null
  /** What blocks its lock, one per place (needsOf). */
  calls: AttentionItem[]
  /** Its findings resting on thin evidence (low certainty, unverified). */
  thin: { text: string }[]
  /** What it was made from changed since. */
  upstreamChanged: { title: string; path?: string } | null
  locked: boolean
  canLock: boolean
  /** How many decisions are on its record. */
  decisions: number
}

export type Facts = Readonly<Record<string, DocFacts>>

// ── the circle row ───────────────────────────────────────────────────────────

export interface DeskClient {
  id: string
  name: string
  mono: string
  look: ClientLook
  /** The needs badge: what needs this person across the client's work; 0 hides it. */
  badge: number
  /** The line under the name, naming the work: "Summer McFlurry · 3 need you". */
  line: string
  summary: ClientSummary
}

/** How many calls one document holds for a person: its needs, or 1 for a run waiting on them. */
export const callsIn = (item: LibraryItem): number =>
  !needsYou(item) ? 0 : item.run?.state === 'waiting' ? Math.max(1, item.state?.needs_you ?? 0) : item.state?.needs_you ?? 0

/** The work a client's line names: what needs them first, then what runs, then the newest. */
function leadOf(mine: readonly LibraryItem[]): LibraryItem | null {
  return mine.find(needsYou) ?? mine.find(i => i.run?.state === 'working') ?? mine.find(i => i.run?.state === 'failed') ?? mine[0] ?? null
}

/** "Summer McFlurry · 3 need you", "Midweek pint · agents working", "Better With Ballymaloe · done". */
export function clientLine(mine: readonly LibraryItem[]): string {
  const lead = leadOf(mine)
  if (!lead) return 'No work yet'
  const title = lead.title || 'Untitled'
  const calls = mine.reduce((n, i) => n + callsIn(i), 0)
  if (calls) return `${title} · ${calls} need${calls === 1 ? 's' : ''} you`
  if (mine.some(i => i.run?.state === 'working')) return `${title} · agents working`
  if (lead.run?.state === 'failed') return `${title} · failed`
  if (lead.state?.locked || lead.run?.state === 'done') return `${title} · done`
  return `${title} · draft`
}

/** The row of client circles, most urgent first (needs you, failed, running), then in the order they were made. */
export function deskClients(clients: readonly ClientRecord[], items: readonly LibraryItem[]): DeskClient[] {
  return ordered(clients, items).map(s => s.client).map(c => {
    const mine = items.filter(i => i.client?.id === c.id)
    return {
      id: c.id,
      name: clientName(c),
      mono: monogramOf(c),
      look: clientLook(c.id, c.name),
      badge: mine.reduce((n, i) => n + callsIn(i), 0),
      line: clientLine(mine),
      summary: summarise(c, items),
    }
  })
}

// ── Pick up where you left off ───────────────────────────────────────────────

export type PickIcon = ToolId | 'other'

export interface PickRow {
  path: string
  title: string
  icon: PickIcon
  /** "McDonald's Ireland · edited by you 2 days ago". */
  sub: string
  /** "2 CALLS", "AGENTS WORKING", "DONE", "DRAFT" (upper-cased by the CSS). */
  state: string
  needs: boolean
}

/** "just now", "4m ago", "2 hours ago", "2 days ago", "3 weeks ago". */
export function ago(iso: string, now = new Date()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (now.getTime() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`
  const w = Math.round(d / 7)
  return `${w} week${w === 1 ? '' : 's'} ago`
}

/** A document's state as the pick-up row and the client page say it. */
export function stateWords(item: LibraryItem): { text: string; needs: boolean; working: boolean } {
  const calls = callsIn(item)
  if (calls) return { text: item.run?.state === 'waiting' && !item.state?.needs_you ? 'Your answer' : `${calls} call${calls === 1 ? '' : 's'}`, needs: true, working: false }
  if (item.run?.state === 'working') return { text: 'Agents working', needs: false, working: true }
  if (item.run?.state === 'failed') return { text: 'Failed', needs: true, working: false }
  if (item.state?.locked) return { text: 'Done', needs: false, working: false }
  if (item.run?.state === 'done') return { text: 'Done', needs: false, working: false }
  return { text: 'Draft', needs: false, working: false }
}

/** The second line: whose it is, and who last touched it, as far as the desk knows. */
function pickSub(item: LibraryItem, facts: DocFacts | undefined, me: string | null, now: Date): string {
  const client = item.client ? clientName(item.client) : 'No client'
  const e = facts?.editor
  // A run in progress, failed or waiting says what it is doing, in its own words (the old Running and Needs you strips).
  if (item.run && (item.run.state === 'working' || item.run.state === 'failed' || item.run.state === 'waiting')) {
    return `${client} · ${item.run.label || (item.run.state === 'failed' ? 'Failed' : item.run.state === 'waiting' ? 'Waiting for you' : 'Running')}`
  }
  if (item.run?.state === 'done' && (!e || e.at <= item.updated_at)) return `${client} · finished ${ago(item.updated_at, now)}`
  if (item.last_editor) {
    if (me && item.last_editor === me) return `${client} · edited by you ${ago(item.updated_at, now)}`
    const who = item.last_editor.split('@')[0]
    return `${client} · ${who.charAt(0).toUpperCase()}${who.slice(1)}, ${ago(item.updated_at, now)}`
  }
  if (e?.you) return `${client} · edited by you ${ago(e.at, now)}`
  if (e) return `${client} · ${e.name.split(/\s+/)[0]}, ${ago(e.at, now)}`
  return `${client} · ${ago(item.updated_at, now)}`
}

/** Whether this person last wrote it: the library's last_editor; an entry without one is not theirs. */
export const isMine = (item: LibraryItem, me: string | null): boolean => !!me && !!item.last_editor && item.last_editor === me

/** The newest work, three at most; "Me" keeps only what this person (`name@agency`) wrote last. */
export function pickRows(items: readonly LibraryItem[], facts: Facts, from: 'all' | 'me', me: string | null = null, now = new Date(), max = 3): PickRow[] {
  const list = from === 'me' ? items.filter(i => isMine(i, me)) : items
  return list.slice(0, max).map(i => {
    const st = stateWords(i)
    return {
      path: i.path,
      title: i.title || 'Untitled',
      icon: toolOfApp(i.app_id)?.id ?? 'other',
      sub: pickSub(i, facts[i.path], me, now),
      state: st.text,
      needs: st.needs,
    }
  })
}

// ── Worth a look ─────────────────────────────────────────────────────────────

export interface WorthItem {
  key: string
  title: string
  sub: string
  /** Opens this document. */
  path: string
}

const RESEARCH = 'ie.napkin.campaign-research'

/** At most `n` characters, cut at a word, with an ellipsis. */
export function clip(text: string, n: number): string {
  if (text.length <= n) return text
  const cut = text.slice(0, n).replace(/\s+\S*$/, '')
  return `${cut || text.slice(0, n)}…`
}

/**
 * What is worth a look across the desk, newest first, three at most: a thin
 * finding waiting, what a document was made from having changed, and research
 * that finished. Knowledge-layer updates (the mock's "Kantar tracker
 * updated") have no source yet (layers-service has no HTTP) and never show.
 */
export function worthItems(items: readonly LibraryItem[], facts: Facts, max = 3): WorthItem[] {
  const out: WorthItem[] = []
  for (const i of items) {
    const f = facts[i.path]
    const title = i.title || 'Untitled'
    if (f?.thin.length) {
      out.push({ key: `thin:${i.path}`, title: f.thin.length === 1 ? 'A thin finding is waiting' : `${f.thin.length} thin findings are waiting`, sub: `${clip(f.thin[0].text.replace(/^(Finding|Fact) · /, ''), 64)} · ${title}`, path: i.path })
    }
    if (f?.upstreamChanged) {
      out.push({ key: `up:${i.path}`, title: `${f.upstreamChanged.title} changed`, sub: `touches ${title}`, path: i.path })
    }
    if (i.app_id === RESEARCH && i.run?.state === 'done' && !needsYou(i)) {
      out.push({ key: `done:${i.path}`, title: `${i.client ? `${clientName(i.client)}: ` : ''}${title} is done`, sub: `Ready to brief from · finished ${ago(i.updated_at)}`, path: i.path })
    }
    if (out.length >= max) break
  }
  return out.slice(0, max)
}

// ── Desk calls (the Decisions drawer on the desk) ────────────────────────────

export interface DeskCallDoc {
  item: LibraryItem
  calls: AttentionItem[]
  canLock: boolean
}

/** The documents with calls the desk has read, most calls first; then those it has not read yet. */
export function deskCallDocs(items: readonly LibraryItem[], facts: Facts): { read: DeskCallDoc[]; unread: LibraryItem[] } {
  const read: DeskCallDoc[] = [], unread: LibraryItem[] = []
  for (const i of items) {
    if (!needsYou(i)) continue
    const f = facts[i.path]
    if (f) { if (f.calls.length) read.push({ item: i, calls: f.calls, canLock: f.canLock }) } else unread.push(i)
  }
  read.sort((a, b) => b.calls.length - a.calls.length || b.item.updated_at.localeCompare(a.item.updated_at))
  return { read, unread }
}
