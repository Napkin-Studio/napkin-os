// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One tool, for one client: the client's documents of that tool, newest first,
// and the way to start another. The circle was the door; this is the room
// before the work. Given its data; it fetches nothing.

import type { ClientRecord, LibraryItem } from '../../host'
import { needsYou } from './model'
import { lastTouched } from '../when'
import type { Tool } from './tools'

interface Props {
  client: ClientRecord
  tool: Tool
  /** This client's documents of this tool, newest first. */
  items: LibraryItem[]
  /** Start a document of this tool that is already the client's. */
  onNew: () => void
  onOpenItem: (path: string) => void
  onBack: () => void
}

export function ToolPage({ client, tool, items, onNew, onOpenItem, onBack }: Props) {
  const [one, many] = tool.noun
  return (
    <div className="lc-page" data-testid="tool-page" data-client={client.id} data-tool={tool.id}>
      <header className="lc-phead">
        <div className="lc-phl">
          <p className="eyebrow">{tool.full}</p>
          <h1 className="lc-h1 lc-h1-left" tabIndex={-1}>{tool.full}</h1>
          <p className="lc-lede">
            <span className="lc-chip">Client: {client.name}</span>{' '}
            {items.length === 0 ? `No ${many} for ${client.name} yet.` : `${items.length} ${items.length === 1 ? one : many} for ${client.name}.`}
          </p>
        </div>
        <div className="lc-phr">
          <button className="ch-btn ch-btn-primary" data-testid="new-doc" onClick={onNew}>
            New {one} for {client.name}
          </button>
        </div>
      </header>

      <section className="lc-work" aria-label={`${tool.full} documents for ${client.name}`}>
        <h2 className="lc-strip-h">Open {many}{items.length > 0 && <span className="lc-n">{items.length}</span>}</h2>
        {items.length === 0 ? (
          <p className="lc-nothing">Nothing yet. Start the first {one} for {client.name}; it is attached to them from the start.</p>
        ) : (
          <ul className="lc-cards">
            {items.map(i => (
              <li key={i.path}>
                <button className="lc-card" data-testid="work-item" onClick={() => onOpenItem(i.path)}>
                  <span className="lc-card-t">{i.title || 'Untitled'}</span>
                  {needsYou(i) && <span className="lc-tag lc-tag-need">Needs you</span>}
                  {!needsYou(i) && i.run?.state === 'working' && <span className="lc-tag lc-tag-run">{i.run.label}</span>}
                  {!needsYou(i) && i.run?.state === 'failed' && <span className="lc-tag lc-tag-fail">Failed</span>}
                  <span className="lc-card-m">{lastTouched(i.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="lc-backrow">
        <button className="ch-btn ch-btn-quiet" onClick={onBack}>Back to {client.name}</button>
      </p>
    </div>
  )
}
