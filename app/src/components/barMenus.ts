// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the OS bar's menus hold (components/Toolbar.tsx), apart so the
// inventory test (tests/barInventory.test.tsx) can read every item with no DOM.

import type { ReactNode } from 'react'
import type { AttachTarget, RelatedView, SpinoffTarget, UpstreamView } from '../host/types'
import { overflowButtons, type BarItem, type BarStatus } from '../shell/appBar'

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
  onWorkspace: () => void
  onSave: () => void
  /** Keep a copy on this device for presenting offline. Absent where it makes no sense. */
  onKeepOffline?: () => void
  onExport: (kind: 'html' | 'pdf') => void
  /** "Continue in ▾": the apps that take this document as a spin-off source (host.spinoffTargets()). */
  targets: SpinoffTarget[]
  onSpinoff: (appId: string) => void
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
  /** Link that document into this one (`POST /attach`). */
  onLink?: (documentId: string) => void
  /** Take a linked document's newer version (`POST /upstream/update {document_id}`). */
  onUpdateLinked?: (documentId: string) => void
  /** Let go of a linked document (`POST /attach/detach`). */
  onUnlink?: (documentId: string) => void
  /** Who is in the document: the people, and an agent while one works. */
  crew?: Crew
}

/** The crew in the open document, beside Decisions. */
export interface Crew {
  people: { name: string; initials: string; you?: boolean }[]
  /** What the agent working on it is doing, in words; null when none works. The status dot shows only then. */
  working?: string | null
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

/** "Continue in ▾": turn it into another app's document, link it, and take what it was made from again. */
export function continueItems(
  doc: Pick<DocBar, 'targets' | 'onSpinoff' | 'madeFrom' | 'onUpdateFromUpstream' | 'linkTargets' | 'onLink' | 'linked' | 'onUpdateLinked' | 'onUnlink'> & Partial<Pick<DocBar, 'tool'>>,
): { spin: MenuItem[]; link: MenuItem[]; update: MenuItem[] } {
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
    link: linkItems(doc),
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
    { label: 'Where it came from', hint: 'What it was made from, step by step', run: doc.onWorkspace },
    {
      label: doc.sidebarOpen ? 'Hide the file’s details' : 'Show the file’s details',
      run: doc.onToggleSidebar,
      apart: true,
    },
    ...signOutItem(user, onSignOut),
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


/**
 * "Link to an existing one": each document it could link, then, apart, the
 * ones linked into it now: Update when one changed, and Unlink. A locked
 * document shows what it could link, disabled, saying why (the host refuses
 * it too).
 */
function linkItems(
  doc: Pick<DocBar, 'linkTargets' | 'onLink' | 'linked' | 'onUpdateLinked' | 'onUnlink'>,
): MenuItem[] {
  const out: MenuItem[] = []
  for (const t of doc.linkTargets ?? []) {
    if (t.attached) continue
    const locked = t.locked || !doc.onLink
    out.push({
      label: `↔ ${t.title}`,
      hint: locked
        ? 'It is locked: a locked version keeps what it holds. Reopen it to link.'
        : `${shortTool(t.app_name)} · each keeps its own version; changes show as updates.`,
      run: () => doc.onLink?.(t.document_id),
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
