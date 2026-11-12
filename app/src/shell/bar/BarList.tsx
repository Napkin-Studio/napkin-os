// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The bar's results as a combobox's listbox (WCAG 2.2 AA, ARIA authoring practices): the field keeps focus, the
// arrow keys move an active descendant, Enter opens it, and each result is announced with its kind. Pure: the list
// is drawn from what it is given, so a test draws it with no browser.

import type { BarGroup } from './providers'
import { KIND_WORD } from './providers'
import { LIST_ID, optionId } from './listModel'

export interface ListProps {
  groups: readonly BarGroup[]
  active: number
  onPick: (i: number) => void
  onHover: (i: number) => void
  /** The second Enter's warning, shown under the active command. */
  confirm?: string | null
}

export function BarList({ groups, active, onPick, onHover, confirm }: ListProps) {
  let n = 0
  return (
    <div role="listbox" id={LIST_ID} aria-label="Results" className="bar-list" data-testid="bar-list">
      {groups.map(g => (
        <div key={g.id} role="group" aria-labelledby={`bar-gh-${g.id}`} className="bar-group" data-kind={g.id}>
          <div className="bar-gh" id={`bar-gh-${g.id}`}>{g.label}</div>
          {g.items.map(r => {
            const i = n++
            const on = i === active
            return (
              <div
                key={r.key}
                id={optionId(i)}
                role="option"
                aria-selected={on}
                className="bar-opt"
                data-active={on || undefined}
                data-kind={r.kind}
                data-testid="bar-result"
                // The field keeps focus: a press on a result must not take it.
                onMouseDown={e => e.preventDefault()}
                onClick={() => onPick(i)}
                onMouseMove={() => { if (!on) onHover(i) }}
              >
                {/* The kind is said first, in the option's own text, so its name is what it shows (WCAG 2.5.3) with the kind before it. */}
                <span className="bar-sr">{KIND_WORD[r.kind] ?? r.kind}: </span>
                <span className="bar-o-main"><b>{r.title}</b>{r.line && <small>{r.line}</small>}</span>
                {r.kind === 'command' ? (r.hint ? <kbd className="bar-hint" aria-hidden>{r.hint}</kbd> : null)
                  : r.kind === 'recent' ? null
                  : <span className="bar-kind" aria-hidden>{KIND_WORD[r.kind] ?? r.kind}</span>}
                {on && confirm && r.act.type === 'command' && <small className="bar-warn" data-testid="bar-confirm">{confirm} Press Enter again to do it.</small>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
