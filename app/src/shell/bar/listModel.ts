// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the results list says and how it is addressed: the pieces the listbox, the field and the panel share.

import type { BarGroup, BarResult } from './providers'
import { KIND_WORD } from './providers'

export const LIST_ID = 'bar-list'
export const optionId = (i: number) => `bar-opt-${i}`

/** What a screen reader says for a result: its kind first, then the title, then the line under it. */
export const optionName = (r: BarResult): string => `${KIND_WORD[r.kind] ?? r.kind}: ${r.title}${r.line ? `, ${r.line}` : ''}`

export const flatten = (groups: readonly BarGroup[]): BarResult[] => groups.flatMap(g => g.items)
