// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The bar's field, inside the OS bar (components/Toolbar.tsx takes it as one optional prop): between the place and the
// tool's buttons, reading "Search or type a command" with the key's hint. It follows the bar's own look: the pill of the
// Decisions button, the mono of its count. Above a phone's width it is a combobox input; at or below it one 44 px button
// that opens the sheet. It holds a slot for the microphone (voice) and draws nothing in it until a record fills it: never
// a button that does nothing.

import { useEffect, useRef, type ReactNode } from 'react'
import { SearchIcon } from '../nui/icons'
import { closeBar, getBar, handleFieldKey, openBar, setQuery, useBar } from './barStore'
import { isMac, keysText } from './commands'
import { LIST_ID } from './listModel'
import { usePhone } from './usePhone'

export const FIELD_NAME = 'Search or type a command'

interface InputProps {
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
}

/** The combobox input, shared by the field in the bar (desktop) and the sheet (phone). */
export function BarInput({ autoFocus, inputRef }: InputProps) {
  const bar = useBar()
  return (
    <input
      ref={inputRef}
      className="bar-input"
      data-testid="bar-search-input"
      type="text"
      role="combobox"
      aria-label={FIELD_NAME}
      aria-expanded={bar.open}
      aria-controls={bar.open ? LIST_ID : undefined}
      aria-activedescendant={bar.open && bar.activeId ? bar.activeId : undefined}
      aria-autocomplete="list"
      aria-haspopup="listbox"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      autoFocus={autoFocus}
      placeholder={FIELD_NAME}
      value={bar.query}
      onChange={e => { setQuery(e.target.value); if (!getBar().open) openBar(null) }}
      onFocus={e => { if (!getBar().open) openBar(e.relatedTarget as Element | null) }}
      onBlur={e => {
        // Leaving for somewhere outside the bar closes it; the panel's own buttons (a person's card) are inside it.
        const to = e.relatedTarget as Element | null
        if (getBar().open && !to?.closest?.('[data-bar-panel]')) closeBar(false)
      }}
      onKeyDown={e => { if (e.key !== 'Escape') handleFieldKey(e) }}
    />
  )
}

export function BarField({ slot }: { slot?: ReactNode }) {
  const bar = useBar()
  const phone = usePhone()
  const input = useRef<HTMLInputElement>(null)
  // Cmd K takes focus into the field (or, at a phone's width, into the sheet, which focuses its own input).
  useEffect(() => { if (bar.open && !phone) input.current?.focus({ preventScroll: true }) }, [bar.focusTick, bar.open, phone])

  if (phone) {
    return (
      <button
        type="button"
        className="bar-btn"
        data-testid="bar-search-button"
        aria-label={FIELD_NAME}
        aria-haspopup="dialog"
        aria-expanded={bar.open}
        onClick={e => { if (bar.open) closeBar(); else openBar(e.currentTarget) }}
      >
        <SearchIcon />
      </button>
    )
  }
  return (
    <div className="bar-field" role="search" data-testid="bar-field" data-open={bar.open || undefined}>
      <SearchIcon />
      <BarInput inputRef={input} />
      {slot && <span className="bar-slot" data-slot="field">{slot}</span>}
      <kbd className="bar-hint" aria-hidden>{keysText('mod K', isMac())}</kbd>
    </div>
  )
}
