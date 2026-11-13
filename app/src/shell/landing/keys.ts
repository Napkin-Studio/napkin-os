// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The keyboard on a client's tools, and what the live region says. Pure, so the
// keys and the words are table-tested without a browser.
//
// The six tools are one tab stop (roving tabindex). Arrows, Home and End move
// along them round the hexagon, the number keys 1 to 6 pick one, and Enter or
// Space on the focused one opens it (the button's own behaviour, not ours).

import type { Route } from '../route'

export type WheelMove = { kind: 'move'; to: number } | { kind: 'pick'; index: number } | null

/** What a key does on a wheel of `n` tools with the focus on `at`; null when it is none of ours. */
export function wheelKey(key: string, at: number, n: number): WheelMove {
  if (n <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown': return { kind: 'move', to: (at + 1) % n }
    case 'ArrowLeft':
    case 'ArrowUp': return { kind: 'move', to: (at - 1 + n) % n }
    case 'Home': return { kind: 'move', to: 0 }
    case 'End': return { kind: 'move', to: n - 1 }
  }
  if (/^[1-9]$/.test(key) && Number(key) <= n) return { kind: 'pick', index: Number(key) - 1 }
  return null
}

/** A key typed into a field or a menu is not ours: Escape and the numbers stay with it. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true || el.closest?.('[role="menu"], [role="dialog"]') != null
}

/** What the live region says on arriving at a level, so a screen reader knows where it is. */
export function arrival(route: Route, names: { agency: string; client?: string; tool?: string; tools: number; open?: number }): string {
  switch (route.level) {
    case 'agency':
    case 'clients':
      return `${names.agency}: your desk. Arrow keys move between clients, Enter opens one's dial, 1 to ${names.tools} pick a tool on it, Escape closes it.`
    case 'client':
      return `${names.client ?? 'Client'} opened with ${names.tools} tools. 1 to ${names.tools} open a tool, Escape goes back to the desk.`
    case 'door':
      return `${names.tool ?? 'A door'}. Escape goes back to the desk.`
    case 'timesheet':
      return `${names.agency}: your timesheet. Escape goes back to the desk.`
    case 'setup':
      return `${names.agency}: setting up. Escape goes back to the desk.`
    case 'people':
      return `${names.agency}: your people. Escape goes back to the desk.`
    case 'audit':
      return `${names.agency}: the audit view. Escape goes back to the desk.`
    case 'job':
      return `Job ${route.number}. Escape goes back to the desk.`
    case 'tool': {
      const n = names.open ?? 0
      return `${names.tool ?? 'Tool'} for ${names.client ?? 'the client'}. ${n === 0 ? 'Nothing open yet.' : `${n} open.`} Escape goes back to ${names.client ?? 'the client'}.`
    }
  }
}
