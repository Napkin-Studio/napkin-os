// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the OS bar's menus hold (components/Toolbar.tsx), apart so the
// inventory test (tests/barInventory.test.tsx) can read every item with no DOM.

import type { ReactNode } from 'react'
import type { SpinoffTarget, UpstreamView } from '../host/types'
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
}

/** The document this one was made from, as the Continue in ▾ menu says it. */
export interface MadeFrom {
  title: string
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
}

/** "Continue in ▾": turn it into another app's document, link it, and take what it was made from again. */
export function continueItems(
  doc: Pick<DocBar, 'targets' | 'onSpinoff' | 'madeFrom' | 'onUpdateFromUpstream'>,
): { spin: MenuItem[]; link: MenuItem[]; update: MenuItem[] } {
  const from = doc.madeFrom
  const since = from?.decisionsSince
  return {
    spin: doc.targets.map(t => ({
      label: `Continue in ${t.name}`,
      hint: t.map ? `Takes this along, into ${t.map}` : 'Takes its data and decisions along',
      run: () => doc.onSpinoff(t.app_id),
    })),
    // Linking an existing document needs the general attach (feat/brand-clan,
    // features/spinoff-and-links.clan); the group keeps its place until then.
    link: [],
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

/** "More ▾" on the desk: the account. */
export function deskItems(user?: string | null, onSignOut?: () => void): MenuItem[] {
  return signOutItem(user, onSignOut)
}

function signOutItem(user?: string | null, onSignOut?: () => void): MenuItem[] {
  return user && onSignOut ? [{ label: 'Sign out', hint: `Signed in as ${user}`, run: onSignOut, apart: true }] : []
}

