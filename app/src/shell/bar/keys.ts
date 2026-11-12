// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Which key is the bar's (features/one-bar-search.clan). Cmd K, or Ctrl K, opens it from anywhere, in a text
// field too, and takes no other key. ? opens the shortcuts sheet, but only where no text field owns the key:
// the rule is the undo's (keepsItsOwnUndo), so a person typing a question mark in a brief is not interrupted.

import { keepsItsOwnUndo } from '../versions/undoStack'

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: EventTarget | null
}

export type BarKey = 'open' | 'shortcuts' | null

export function barKeyOf(e: KeyLike): BarKey {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') return 'open'
  if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !keepsItsOwnUndo(e.target)) return 'shortcuts'
  return null
}
