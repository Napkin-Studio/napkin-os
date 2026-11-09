// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A list of documents as cards: title, Needs you / running / Failed, and a
// last line. The tool page and the client page's groups draw the same list.

import type { LibraryItem } from '../../host'
import { needsYou } from './model'
import { lastTouched } from '../when'

interface Props {
  items: LibraryItem[]
  onOpenItem: (path: string) => void
  /** The card's last line before the time, e.g. the tool's name. */
  meta?: (item: LibraryItem) => string | null
  testid?: string
}

export function DocList({ items, onOpenItem, meta, testid = 'work-item' }: Props) {
  return (
    <ul className="lc-cards">
      {items.map(i => {
        const m = meta?.(i)
        return (
          <li key={i.path}>
            <button className="lc-card" data-testid={testid} onClick={() => onOpenItem(i.path)}>
              <span className="lc-card-t">{i.title || 'Untitled'}</span>
              {needsYou(i) && <span className="lc-tag lc-tag-need">Needs you</span>}
              {!needsYou(i) && i.run?.state === 'working' && <span className="lc-tag lc-tag-run">{i.run.label}</span>}
              {!needsYou(i) && i.run?.state === 'failed' && <span className="lc-tag lc-tag-fail">Failed</span>}
              <span className="lc-card-m">{m ? `${m} · ` : ''}{lastTouched(i.updated_at)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
