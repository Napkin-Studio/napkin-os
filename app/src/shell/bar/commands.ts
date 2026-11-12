// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The bar's command table (features/one-bar-search.clan): one list of what the bar can do, which the bar
// searches by name, the shortcuts sheet prints, and (later) voice and Ask Nap read. A command says whether
// it can be undone: one that cannot (sign out) is shown what will happen and waits for a second Enter, so a
// slip of the keyboard, and later a misheard word, does not run it.
//
// Pure: everything it needs comes in as the environment, so a test builds the list for any role.

import type { HomeView } from '../../host/http'
import type { Route } from '../route'

export interface Command {
  id: string
  title: string
  /** Other words that find it. */
  keywords: string[]
  /** The key that does it, as the sheet prints it: `mod` is Cmd on a Mac and Ctrl elsewhere. */
  shortcut?: string
  /** False when it cannot be undone: the bar asks for a second Enter. */
  undoable: boolean
  /** What the second Enter is told it will do. */
  warns?: string
  /** Offered in the bar's list; one that is not (no document to undo in) is still in the sheet. */
  available: boolean
  run: () => void
}

export interface BarEnv {
  /** The person's home (doors, More tools), null where there is none (no roles, no server). */
  home: HomeView | null
  go: (r: Route) => void
  /** The open document's undo and redo, when one is open and has something to undo. */
  undo?: (() => void) | null
  redo?: (() => void) | null
  signOut?: (() => void) | null
  openBar: () => void
  openShortcuts: () => void
  /** A server with accounts: the person has a timesheet and an account to leave. */
  signedIn: boolean
}

/** The page a door opens: the clients door is the clients page, the others their own door page. */
export const doorRoute = (id: string): Route => (id === 'clients' ? { level: 'clients' } : { level: 'door', door: id })

/** The words a command is found by, folded the way the server folds a query. */
export const fold = (s: string): string[] =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Every command, available or not. The bar offers the available ones; the shortcuts sheet prints every one
 * that has a key. A door the person does not have is not here at all (an allow list: only the doors of
 * their own home and its More tools).
 */
export function commandsFor(env: BarEnv): Command[] {
  const out: Command[] = []
  const doors = [...(env.home?.doors ?? []), ...(env.home?.more ?? [])]
  for (const d of doors) {
    const name = d.name.replace(/\s*\(.*\)\s*$/, '')
    out.push({ id: `door-${d.id}`, title: `Open ${d.name}`, keywords: ['open', 'door', 'tool', name, d.id], undoable: true, available: true, run: () => env.go(doorRoute(d.id)) })
  }
  out.push({ id: 'home', title: 'Home', keywords: ['home', 'desk', 'studio', 'back'], undoable: true, available: true, run: () => env.go({ level: 'agency' }) })
  if (env.home?.restricted) out.push({ id: 'map', title: 'The map', keywords: ['map', 'agency', 'departments', 'the o'], undoable: true, available: true, run: () => env.go({ level: 'map' }) })
  if (env.signedIn) out.push({ id: 'timesheet', title: 'Your timesheet', keywords: ['timesheet', 'time', 'hours', 'day'], undoable: true, available: true, run: () => env.go({ level: 'timesheet' }) })
  out.push({ id: 'search', title: 'Search or type a command', keywords: ['bar', 'find'], shortcut: 'mod K', undoable: true, available: false, run: env.openBar })
  out.push({ id: 'undo', title: 'Undo', keywords: ['undo', 'back', 'revert'], shortcut: 'mod Z', undoable: true, available: !!env.undo, run: () => env.undo?.() })
  out.push({ id: 'redo', title: 'Redo', keywords: ['redo'], shortcut: 'shift mod Z', undoable: true, available: !!env.redo, run: () => env.redo?.() })
  out.push({ id: 'shortcuts', title: 'Keyboard shortcuts', keywords: ['keys', 'keyboard', 'help', 'shortcuts'], shortcut: '?', undoable: true, available: true, run: env.openShortcuts })
  if (env.signOut) out.push({ id: 'sign-out', title: 'Sign out', keywords: ['sign', 'out', 'log', 'leave'], undoable: false, warns: 'This signs you out of Napkin Studio.', available: true, run: env.signOut })
  return out
}

/** The commands that answer `query`: every word of it must begin a word of the title or a keyword. */
export function matchCommands(commands: readonly Command[], query: string): Command[] {
  const want = fold(query)
  if (!want.length) return []
  return commands.filter(c => c.available && want.every(w => fold([c.title, ...c.keywords].join(' ')).some(t => t.startsWith(w))))
}

/** The keys as words, for the platform: `mod K` is "⌘K" on a Mac and "Ctrl K" elsewhere. */
export function keysText(shortcut: string, mac: boolean): string {
  const parts = shortcut.split(' ')
  const word = (p: string) => (p === 'mod' ? (mac ? '⌘' : 'Ctrl') : p === 'shift' ? (mac ? '⇧' : 'Shift') : p)
  return mac ? parts.map(word).join('') : parts.map(word).join(' ')
}

/** Every key the shell has, from the command table: what the shortcuts sheet prints. Escape is the bar's own. */
export function shortcutRows(commands: readonly Command[]): { id: string; title: string; shortcut: string }[] {
  const rows = commands.filter(c => c.shortcut).map(c => ({ id: c.id, title: c.title, shortcut: c.shortcut! }))
  rows.push({ id: 'escape', title: 'Close the bar, or a sheet', shortcut: 'Esc' })
  return rows
}

export const isMac = (): boolean => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
