// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the OS bar's menus hold (components/Toolbar.tsx), apart so the
// inventory test (tests/barInventory.test.tsx) can read every item with no DOM.

import type { ReactNode } from 'react'
import type { AttachTarget, RelatedView, SpinoffTarget, UpstreamView } from '../host/types'
import { overflowButtons, type BarItem, type BarStatus } from '../shell/appBar'
import { ago, clientName } from '../shell/nui/deskData'

/** A tool as the bar names it: its own name, colour and face (its app.home). */
export interface ToolBrand {
  name: string
  colour?: string | null
  font?: string | null
}

/** The document's state as the slot's pill says it. */
export type DocState = Omit<BarStatus, 'kind'>

/** What the bar shows of an open document; absent on the desk. */
export interface DocBar {
  /** The open document's tool: its name in the tool's colour and face. */
  tool?: ToolBrand | null
  title?: string
  /** The state pill: the app's own (`clan:bar` status), else the shell's from the lock. */
  state?: DocState | null
  /** What the app asked the bar to show: its buttons and chips (shell/appBar.ts). */
  bar?: BarItem[]
  /** A button of the app's was pressed: tell the app which. */
  onBarAction?: (id: string) => void
  isTemplate?: boolean
  trusted?: boolean
  validation?: string
  onOpenFile: () => void
  onToggleSidebar: () => void
  sidebarOpen: boolean
  onSave: () => void
  /** Keep a copy on this device for presenting offline. Absent where it makes no sense. */
  onKeepOffline?: () => void
  onExport: (kind: 'html' | 'pdf') => void
  /** "Continue in ▾": the apps that take this document as a spin-off source (host.spinoffTargets()). */
  targets: SpinoffTarget[]
  onSpinoff: (appId: string) => void
  /** Continue in › Start fresh: a new document of the same app for the same client. */
  onStartFresh?: () => void
  /** What it was made from (`GET /upstream`); absent when it was made from nothing the host holds. */
  madeFrom?: MadeFrom | null
  /** Take the newer version of what it was made from (`POST /upstream/update`). Absent on a locked document. */
  onUpdateFromUpstream?: () => void
  /** Edit mode, for every app: its fields become editable, each change a person's pinned decision. */
  editMode?: boolean
  onToggleEdit?: () => void
  /** Client review (OS-layer contract §7.5): only while the document is locked with no part reopened. */
  onClientReview?: () => void
  /** The client has answered this locked version already: the button is quiet ("New client answer"). */
  clientAnswered?: boolean
  /** Client review is on: the bar is tinted and says so; Cancel leaves it. */
  clientMode?: { onCancel: () => void; busy?: boolean }
  loading?: boolean
  /** "Saved", where each change is kept as it is made (SaveStatus); absent on the device. */
  saved?: ReactNode
  /** Share ▾ "Copy link": a link people in the agency open it from (`?open=`); absent where there is no server to open it from. */
  onCopyLink?: () => void
  /** Locked (and nothing reopened): the version a client would see. */
  locked?: boolean
  /** Open another document of the store: the lineage chips' way there. */
  onOpenDocument?: (path: string) => void
  /** What was made from it (`GET /related`, features/spinoff-and-links.clan); absent until the host answers it. */
  madeInto?: { count: number; noun?: string; path?: string } | null
  /** Documents linked with it (os-layer §5.7, `GET /related`): linked into it, and those it is linked into. */
  linked?: LinkedDoc[]
  /** "Continue in ▾ › Link to an existing one": what it could link (`GET /attach-targets`). */
  linkTargets?: AttachTarget[]
  /** The open document's own client (its manifest's), for the Link list's "this client"; null when it has none. */
  client?: { id: string; name: string } | null
  /** "Continue in ▾" is opening: read what it lists again, so a document made since is there. */
  onContinueOpen?: () => void
  /** Link that document into this one (`POST /attach`). */
  onLink?: (documentId: string) => void
  /** Take a linked document's newer version (`POST /upstream/update {document_id}`). */
  onUpdateLinked?: (documentId: string) => void
  /** Let go of a linked document (`POST /attach/detach`). */
  onUnlink?: (documentId: string) => void
  /** Who is in the document: the people, and an agent while one works. */
  crew?: Crew
  /** The tool's key for its icon and face in the bar (brief, research, deck, prod). */
  toolKey?: string | null
  /** Rename it (the name's double-click, and Rename in its menu): `/set-title`. Absent where it cannot be renamed. */
  onRename?: (title: string) => void
  /** "Where it came from": the Decisions drawer, open on its Lineage tab. */
  onLineage: () => void
  /** Its tool's own page for its client (the old trail's last crumb): its other documents, and New. */
  onToolPage?: { label: string; run: () => void } | null
}

/** The account menu on the person's avatar, at the bar's right (owner, 2026-11-11). */
export interface Account {
  /** The person's name, and their initials on the avatar. */
  name: string
  initials: string
  /** "Strategy lead · TBWA\Dublin": role (when known) and the agency's name. */
  line: string
  onOffline?: () => void
  /** How many offline copies are on this device, when known. */
  offlineCount?: number | null
  /** Open the People page: who can sign in (features/people-admin.clan). Present for an admin only. */
  onPeople?: () => void
}

/** Where the bar is when no document is open but a tool's home is: its icon and its plural ("Briefs"). */
export interface BarPlace { tool: string; label: string }

/** The client chip in the bar: back to the client, or a switcher between clients. */
export interface ClientChip {
  name: string
  mono: string
  look: { cl: string; ink: string }
  onOpen?: () => void
  switcher?: { id: string; name: string; sub?: string }[]
  onSwitch?: (id: string) => void
  /** This client's page is the one on screen. */
  current?: boolean
}

/** The crew in the open document, beside Decisions. */
export interface Crew {
  people: { name: string; initials: string; you?: boolean }[]
  /** What the agent working on it is doing, in words; null when none works. The status dot shows only then. */
  working?: string | null
  /** The agent at work (a role key from the one lookup, agents/engine.ts), drawn as its sphere while `working`. */
  agent?: string | null
  /** The step being worked and all, 1-based (landing/model jobOf), when the run says. */
  progress?: readonly [number, number] | null
  /** The run stopped to ask the person something (a question in the document). It needs them, though nothing blocks the lock. */
  waiting?: boolean
}

/** A document linked with the open one, as the lineage chips and the menu say it. */
export interface LinkedDoc {
  documentId: string
  title: string
  path?: string
  /** `in`: linked into this one (it carries a frozen copy); `out`: this one is linked into it. */
  dir: 'in' | 'out'
  /** It changed since this one took it (`in` only). */
  changed?: boolean
  /** Which version of it this one holds: 1 on link, one more on each update. */
  taken?: number | null
  noun?: string | null
}

/** What `GET /related` says, as the bar shows it: links both ways, and what was made from it. */
export function linksOf(view: RelatedView | null): { linked: LinkedDoc[]; madeInto: DocBar['madeInto'] } {
  if (!view) return { linked: [], madeInto: null }
  const linked: LinkedDoc[] = [
    ...view.upstream.filter(u => u.how === 'linked').map(u => ({
      documentId: u.document_id,
      title: u.title || 'a linked document',
      ...(u.path ? { path: u.path } : {}),
      dir: 'in' as const,
      changed: u.status === 'changed',
      taken: u.taken ?? null,
      noun: u.noun ?? null,
    })),
    ...view.downstream.filter(d => d.how === 'linked_in').map(d => ({
      documentId: d.document_id,
      title: d.title || 'a document',
      ...(d.path ? { path: d.path } : {}),
      dir: 'out' as const,
      noun: d.noun ?? null,
    })),
  ]
  const into = view.downstream.filter(d => d.how === 'made_into')
  const nouns = new Set(into.map(d => d.noun ?? 'document'))
  const madeInto = into.length
    ? {
        count: into.length,
        noun: nouns.size === 1 ? [...nouns][0] : 'document',
        ...(into[0].path ? { path: into[0].path } : {}),
      }
    : null
  return { linked, madeInto }
}

/** The document this one was made from, as the Continue in ▾ menu says it. */
export interface MadeFrom {
  title: string
  /** Where the shell opens it; absent when the store cannot say. */
  path?: string
  /** The parent moved on since this was made from it (`GET /upstream` status). */
  changed: boolean
  /** How many of its decisions are new here; null when the host cannot say. */
  decisionsSince?: number | null
}

/** The direct parent of `view`, if the host holds it. */
export function madeFromOf(view: UpstreamView | null): MadeFrom | null {
  const direct = view?.upstream.find(u => u.direct && u.in_store)
  if (!direct) return null
  return {
    title: direct.title || 'what it was made from',
    ...(direct.path ? { path: direct.path } : {}),
    changed: direct.status === 'changed',
    decisionsSince: direct.decisions_since ?? null,
  }
}

/** One thing a bar menu can do. */
export interface MenuItem {
  label: string
  hint?: string
  run: () => void
  /** A rule above this item. */
  apart?: boolean
  /** Shown, but it cannot run yet; the hint says why. */
  disabled?: boolean
}

/** What the links hook holds: one document's link targets and what is linked now. */
export interface LinksRead { docPath: string; targets: AttachTarget[]; related: RelatedView | null }

/**
 * The next read of a document's links. A read that failed (null: a blip, a
 * token being renewed) keeps what that document listed before rather than
 * saying there is nothing to link; another document starts from nothing.
 */
export function linksRead(prev: LinksRead | null, docPath: string, targets: AttachTarget[] | null, related: RelatedView | null): LinksRead {
  const same = prev?.docPath === docPath ? prev : null
  return { docPath, targets: targets ?? same?.targets ?? [], related: related ?? same?.related ?? null }
}

/**
 * "Continue in ▾" was pressed. Opening it reads what it lists again (another
 * tab or person may have made or finished a document since this one opened);
 * closing it asks nothing.
 */
export function pressContinue(doc: Pick<DocBar, 'onContinueOpen'>, open: boolean, toggle: () => void) {
  if (!open) doc.onContinueOpen?.()
  toggle()
}

/** "Continue in ▾": turn it into another app's document, link it, and take what it was made from again. */
export function continueItems(
  doc: Pick<DocBar, 'targets' | 'onSpinoff' | 'madeFrom' | 'onUpdateFromUpstream' | 'linkTargets' | 'onLink' | 'linked' | 'onUpdateLinked' | 'onUnlink'> & Partial<Pick<DocBar, 'tool' | 'onStartFresh'>>,
  /** Open the Link list (the client's documents, a search, all clients); Toolbar passes it. */
  openLinkList?: () => void,
): { spin: MenuItem[]; link: MenuItem[]; update: MenuItem[]; fresh: MenuItem[] } {
  const from = doc.madeFrom
  const since = from?.decisionsSince
  const noun = nounOfTool(doc.tool?.name)
  return {
    // The mock's words (gaps.md §7 L1): the tool, and what it makes from this one.
    spin: doc.targets.map(t => ({
      label: shortTool(t.name),
      hint: spinHint(t, noun),
      run: () => doc.onSpinoff(t.app_id),
    })),
    link: linkItems(doc, openLinkList),
    // Start fresh (gaps.md §7 L2): the same app, the same client, new notes.
    fresh: doc.onStartFresh
      ? [{ label: `New ${noun === 'one' ? 'document' : noun} for this client`, hint: 'From new notes; this one stays as it is', run: doc.onStartFresh }]
      : [],
    // A spin-off may take its parent's newer version (owner, 2026-11-09).
    update: from?.changed && doc.onUpdateFromUpstream
      ? [{
          label: `Update from ${from.title}`,
          hint: `It changed since this was made from it${since ? ` (${since} new decision${since === 1 ? '' : 's'})` : ''}. Takes the newer version; your own work here stays.`,
          run: doc.onUpdateFromUpstream,
        }]
      : [],
  }
}

/** What the open document is called, from its tool's name: a brief, a report, else "one". */
function nounOfTool(name?: string | null): string {
  const n = String(name ?? '')
  return /brief/i.test(n) ? 'brief' : /research|report/i.test(n) ? 'report' : 'one'
}

/** A tool's short name, as the menu says it: "Deck Maker" is Deck, "Research Tool" is Research. */
function shortTool(name: string): string {
  const n = name.replace(/\s+(Maker|Tool|Studio)$/i, '').trim()
  return /advertising/i.test(name) ? 'Production' : n || name
}

/** What the target makes from this one, in the mock's words. */
function spinHint(t: { app_id: string; name: string; map?: string | null }, noun: string): string {
  const id = `${t.app_id} ${t.name}`
  if (/deck/i.test(id)) return `A board deck from this ${noun}`
  if (/advertising|film|production/i.test(id)) return noun === 'report' ? 'A film treatment from the findings' : `Films and stills from this ${noun}`
  if (/research/i.test(id)) return noun === 'brief' ? 'A follow-up question from its open questions' : `Research from this ${noun}`
  if (/brief/i.test(id)) return noun === 'report' ? 'A brief with these pinned facts' : `A brief from this ${noun}`
  return t.map ? `Takes this along, into ${t.map}` : 'Takes its data and decisions along'
}

/** "More ▾" in the slot: the rarer actions of an open document, in plain words. */
export function moreItems(doc: DocBar, user?: string | null, onSignOut?: () => void): MenuItem[] {
  return [
    // The app's own buttons past the two the bar has room for, at the top, in the app's order.
    ...overflowButtons(doc.bar ?? []).map(b => ({ label: b.label, hint: b.title || undefined, run: () => doc.onBarAction?.(b.id) })),
    ...(doc.onToggleEdit && !doc.editMode
      ? [{ label: 'Edit', hint: 'Change it yourself. Every change is kept as yours.', run: doc.onToggleEdit }]
      : []),
    { label: 'Open…', hint: 'Open another .clan file', run: doc.onOpenFile },
    { label: 'Save as…', hint: 'Keep a copy of this file', run: doc.onSave },
    ...(doc.onKeepOffline
      ? [{ label: 'Present offline', hint: 'Keep it on this device, to show with no internet', run: doc.onKeepOffline }]
      : []),
    { label: 'Export', hint: 'Make a PDF of it', run: () => doc.onExport('pdf') },
    { label: 'Where it came from', hint: 'Its app, what it was made from, what it fed', run: doc.onLineage },
    {
      label: doc.sidebarOpen ? 'Hide the file’s details' : 'Show the file’s details',
      run: doc.onToggleSidebar,
      apart: true,
    },
    ...signOutItem(user, onSignOut),
  ]
}

/**
 * The document menu on its name (mock phase 33): every action the old More ▾
 * held but Sign out (which is the account's now), in the mock's order, with
 * the app's own buttons past the two the bar shows at the top.
 */
export function docMenuItems(doc: DocBar, startRename?: () => void): MenuItem[] {
  return [
    ...overflowButtons(doc.bar ?? []).map(b => ({ label: b.label, hint: b.title || undefined, run: () => doc.onBarAction?.(b.id) })),
    ...(doc.onRename && startRename ? [{ label: 'Rename', hint: 'Or double-click the name', run: startRename }] : []),
    ...(doc.onToolPage ? [{ label: doc.onToolPage.label, hint: 'Its other documents for this client, and New', run: doc.onToolPage.run }] : []),
    { label: 'Open…', hint: 'A .clan, PDF or HTML file', run: doc.onOpenFile },
    { label: 'Save as…', hint: 'A copy with a new name', run: doc.onSave },
    {
      label: doc.sidebarOpen ? 'Hide the file details' : 'File details',
      hint: 'Manifest, signature, what uses it',
      run: doc.onToggleSidebar,
    },
    ...(doc.onToggleEdit && !doc.editMode
      ? [{ label: 'Edit', hint: 'What you can change here', run: doc.onToggleEdit }]
      : []),
    ...(doc.onKeepOffline
      ? [{ label: 'Present offline', hint: 'Keeps a copy that works without a connection', run: doc.onKeepOffline }]
      : []),
    { label: 'Export', hint: 'Make a PDF of it', run: () => doc.onExport('pdf') },
    { label: 'Where it came from', hint: 'Its parent, what it was made from, what it fed', run: doc.onLineage, apart: true },
  ]
}


/**
 * The account menu on the avatar (owner, 2026-11-11): Offline copies, then
 * About this beta (a recording build only; owner, 2026-11-13), then Sign out,
 * last. The agency pill only goes to the desk.
 */
export function accountItems(account: Account | undefined, user?: string | null, onSignOut?: () => void, onBetaNotice?: () => void): MenuItem[] {
  const n = account?.offlineCount
  return [
    ...(account?.onPeople ? [{ label: 'People', hint: 'Who can sign in, by agency', run: account.onPeople }] : []),
    ...(account?.onOffline ? [{ label: 'Offline copies', hint: `${n != null ? `${n} on this device · ` : ''}present without a connection`, run: account.onOffline }] : []),
    ...(onBetaNotice ? [{ label: 'About this beta', hint: 'What this beta records, and why', run: onBetaNotice }] : []),
    ...(user && onSignOut ? [{ label: 'Sign out', hint: `Signed in as ${user}`, run: onSignOut, apart: !!(account?.onOffline || account?.onPeople || onBetaNotice) }] : []),
  ]
}

/**
 * "Share ▾" in the slot (owner, 9 Nov 2026): a link for the agency, the
 * client's copy, and the crew; with the download that was the bar's Share.
 * What the studio cannot do yet is shown and says so, never faked.
 */
export function shareItems(doc: Pick<DocBar, 'onCopyLink' | 'onSave' | 'locked'>): MenuItem[] {
  return [
    ...(doc.onCopyLink
      ? [{ label: 'Copy link', hint: 'People in your agency open it in Napkin Studio', run: doc.onCopyLink }]
      : []),
    { label: 'Download a copy', hint: 'A .clan to send. It opens in Napkin with everything in it.', run: doc.onSave },
    doc.locked
      ? { label: 'Send the client copy', hint: 'Leaving the confidential parts out is not built yet', run: () => {}, disabled: true, apart: true }
      : { label: 'Send the client copy', hint: 'Lock it first: the client sees the version you lock', run: () => {}, disabled: true, apart: true },
    { label: 'Invite to the crew', hint: 'Not built yet: the crew needs accounts that can be invited', run: () => {}, disabled: true },
  ]
}

/** "More ▾" on the desk: open a file from this computer, and the account. */
export function deskItems(user?: string | null, onSignOut?: () => void, onOpenFile?: () => void): MenuItem[] {
  return [
    ...(onOpenFile ? [{ label: 'Open…', hint: 'Open a .clan file from this computer', run: onOpenFile }] : []),
    ...signOutItem(user, onSignOut),
  ]
}

function signOutItem(user?: string | null, onSignOut?: () => void): MenuItem[] {
  return user && onSignOut ? [{ label: 'Sign out', hint: `Signed in as ${user}`, run: onSignOut, apart: true }] : []
}


/** What a locked document says where it would link. */
const LOCKED_HINT = 'It is locked: a locked version keeps what it holds. Reopen it to link.'

/**
 * "Link to an existing one": one way into the Link list (the client's
 * documents, a search, all clients: {@link linkList}), then, apart, the ones
 * linked into it now: Update when one changed, and Unlink (the same as the
 * linked chip's list). A locked document says why it cannot link (the host
 * refuses it too).
 */
function linkItems(
  doc: Pick<DocBar, 'linkTargets' | 'onLink' | 'linked' | 'onUpdateLinked' | 'onUnlink'>,
  openLinkList?: () => void,
): MenuItem[] {
  const out: MenuItem[] = []
  const targets = doc.linkTargets ?? []
  if (targets.length) {
    const noun = linkNoun(targets)
    const locked = targets.some(t => t.locked) || !doc.onLink || !openLinkList
    out.push({
      label: `↔ Link ${noun}…`,
      hint: locked ? LOCKED_HINT : `This client’s ${plural(noun)}, newest first; search finds any client’s.`,
      run: () => openLinkList?.(),
      ...(locked ? { disabled: true } : {}),
    })
  }
  let first = true
  for (const l of (doc.linked ?? []).filter(l => l.dir === 'in')) {
    if (l.changed && doc.onUpdateLinked) {
      out.push({
        label: `Update ${l.title}`,
        hint: `It changed since this took it${l.taken ? ` (v${l.taken})` : ''}. Takes the newer version; your own work here stays.`,
        run: () => doc.onUpdateLinked!(l.documentId),
        ...(first ? { apart: true } : {}),
      })
      first = false
    }
    if (doc.onUnlink) {
      out.push({
        label: `Unlink ${l.title}`,
        hint: 'Lets go of it here. What this took from it stays as this one’s own.',
        run: () => doc.onUnlink!(l.documentId),
        ...(first ? { apart: true } : {}),
      })
      first = false
    }
  }
  return out
}

/** What the targets are, as the Link list says it: "research", "brief"; "document" when they are of several apps. */
export function linkNoun(targets: Pick<AttachTarget, 'app_name'>[]): string {
  const names = new Set(targets.map(t => shortTool(t.app_name).toLowerCase()))
  return names.size === 1 ? [...names][0] : 'document'
}

/** "research" stays "research"; a brief is "briefs". */
export function plural(noun: string): string {
  return /research$/i.test(noun) ? noun : `${noun}s`
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The bar's one linked chip ("↔ N linked ▾"): how many, and whether one changed since it was taken. Null with none. */
export function linkedChip(linked?: LinkedDoc[]): { count: number; changed: boolean } | null {
  const all = linked ?? []
  return all.length ? { count: all.length, changed: all.some(l => l.dir === 'in' && !!l.changed) } : null
}

/** One linked document in the chip's list: its line under the title, and what can be done with it. */
export interface LinkedRow { doc: LinkedDoc; sub: string; actions: MenuItem[] }

/**
 * The linked chip's list: what is linked into this one (Update when it
 * changed, Open, Unlink) and what this one is linked into (Open). The same
 * Update and Unlink as Continue in ▾ › Link to an existing one.
 */
export function linkedRows(doc: Pick<DocBar, 'linked' | 'onOpenDocument' | 'onUpdateLinked' | 'onUnlink'>): { into: LinkedRow[]; out: LinkedRow[] } {
  const open = (l: LinkedDoc): MenuItem[] => (l.path && doc.onOpenDocument
    ? [{ label: 'Open', hint: `Open ${l.title}`, run: () => doc.onOpenDocument!(l.path!) }]
    : [])
  const into: LinkedRow[] = []
  const out: LinkedRow[] = []
  for (const l of doc.linked ?? []) {
    const noun = capital(l.noun || 'linked')
    if (l.dir === 'in') {
      into.push({
        doc: l,
        sub: `${noun}${l.taken ? ` · v${l.taken} taken` : ''}${l.changed ? ' · changed since' : ''}`,
        actions: [
          ...(l.changed && doc.onUpdateLinked
            ? [{ label: 'Update', hint: 'Take its newer version; your own work here stays', run: () => doc.onUpdateLinked!(l.documentId) }]
            : []),
          ...open(l),
          ...(doc.onUnlink
            ? [{ label: 'Unlink', hint: 'Let go of it here; what this took from it stays', run: () => doc.onUnlink!(l.documentId) }]
            : []),
        ],
      })
    } else {
      out.push({ doc: l, sub: `${noun} · holds this one`, actions: open(l) })
    }
  }
  return { into, out }
}

/** One document in the Link list. */
export interface LinkRow {
  target: AttachTarget
  /** Its line under the title: "v2 · 3 days ago", or its client's name in a search of other clients. */
  sub: string
  /** `linked`: linked here already (LINKED, no button); `locked`: the open document is locked (Link disabled). */
  state: 'link' | 'linked' | 'locked'
  run: () => void
}

/** A client's documents in the Link list's all-clients view. */
export interface LinkGroup { name: string; here: boolean; rows: LinkRow[] }

/** The Link list, as {@link linkList} lays it out. */
export interface LinkList {
  /** "research", "brief": what the targets are. */
  noun: string
  /** This client's name ("No client" when the open document has none). */
  here: string
  /** Why nothing can be linked now (the open document is locked); null when it can. */
  locked: string | null
  /** This client's documents, newest first. */
  mine: LinkRow[]
  /** Other clients' documents that match the search (empty with no search). */
  others: LinkRow[]
  /** All clients: every document grouped by client, this client first; the search narrows each. */
  groups: LinkGroup[]
}

/** A target's client as the list names it. */
const clientOf = (t: AttachTarget) => (t.client ? clientName(t.client) : 'Unknown client')

/**
 * The Link list (Continue in ▾ › Link, and the linked chip's "Link another…";
 * features/linked-research-bar.clan): this client's documents newest first; a
 * search that finds any client's by title or client name, each naming its
 * client; and all clients, grouped, this client first. Linked ones say so
 * rather than offer Link again.
 */
export function linkList(
  doc: Pick<DocBar, 'linkTargets' | 'onLink' | 'client'>,
  query = '',
  now = new Date(),
): LinkList {
  const targets = [...(doc.linkTargets ?? [])].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
  const hereId = doc.client?.id ?? null
  const isHere = (t: AttachTarget) => (t.client?.id ?? null) === hereId
  const locked = targets.some(t => t.locked) || !doc.onLink ? LOCKED_HINT : null
  const when = (t: AttachTarget) => [t.version ? `v${t.version}` : '', ago(t.updated_at, now)].filter(Boolean).join(' · ')
  const row = (t: AttachTarget, sub: string): LinkRow => ({
    target: t,
    sub,
    state: t.attached ? 'linked' : locked ? 'locked' : 'link',
    run: () => { if (!t.attached && !locked) doc.onLink?.(t.document_id) },
  })
  const q = query.trim().toLowerCase()
  const hit = (t: AttachTarget) => !q || t.title.toLowerCase().includes(q) || clientOf(t).toLowerCase().includes(q)
  const here = doc.client ? clientName(doc.client) : 'No client'

  const byClient = new Map<string, LinkGroup>()
  for (const t of targets.filter(hit)) {
    const mine = isHere(t)
    const key = mine ? '' : t.client?.id ?? '~'
    const g = byClient.get(key) ?? { name: mine ? here : clientOf(t), here: mine, rows: [] }
    g.rows.push(row(t, when(t)))
    byClient.set(key, g)
  }
  const groups = [...byClient.entries()]
    .sort(([a, ga], [b, gb]) => (a === '' ? -1 : b === '' ? 1 : a === '~' ? 1 : b === '~' ? -1 : ga.name.localeCompare(gb.name)))
    .map(([, g]) => g)

  return {
    noun: linkNoun(targets),
    here,
    locked,
    mine: targets.filter(isHere).map(t => row(t, when(t))),
    others: q ? targets.filter(t => !isHere(t) && hit(t)).map(t => row(t, clientOf(t))) : [],
    groups,
  }
}
