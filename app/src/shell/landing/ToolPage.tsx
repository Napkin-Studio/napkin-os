// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One tool, for one client: its home, as the approved mock draws it ("Tool
// homes", phase 2 and 33). Each tool in its own identity: Brief Maker's
// dog-eared sheets with a manila tab and serif titles, Research's ink band and
// lens dots on sans titles, Deck and the rest as plain cards; then the card
// that starts a new one, already the client's. Given its data; the lens dots
// are read from each research's own selection.

import type { ClientRecord, LibraryItem } from '../../host'
import type { Tool } from './tools'
import { initialsOf } from './model'
import { clientName, ago, stateWords } from '../nui/deskData'
import { ToolIcon } from '../nui/icons'
import type { Cov } from '../nui/lenses'

interface Props {
  client: ClientRecord
  tool: Tool
  /** This client's documents of this tool, newest first. */
  items: LibraryItem[]
  /** Start a document of this tool that is already the client's. */
  onNew: () => void
  onOpenItem: (path: string) => void
  onBack: () => void
  /** Each research's lens dots, read from its own selection (useLensDots). */
  lenses?: Readonly<Record<string, Cov[]>>
}

/** What each tool says under its name (the mock's tool headers). */
const LINE: Record<string, string> = {
  brief: 'Turn client notes, call transcripts, and verified research into a structured creative brief on a single sheet of paper.',
  research: 'Ask one sharp question. Napkin searches the open web, reads your files, pins every fact with a source, and puts every call on the record.',
  deck: 'A board deck from a brief and its facts.',
}

const STATE_CLASS = (s: ReturnType<typeof stateWords>) => (s.needs ? 'needs' : s.working ? 'working' : s.text === 'Done' ? 'done' : 'draft')

export function ToolPage({ client, tool, items, onNew, onOpenItem, onBack, lenses = {} }: Props) {
  const [one, many] = tool.noun
  const name = clientName(client)
  const kind = tool.id === 'brief' ? 'brief' : tool.id === 'research' ? 'research' : 'other'
  const card = (i: LibraryItem) => {
    const st = stateWords(i)
    const words = st.needs && st.text !== 'Failed' ? 'Needs your call' : st.text
    const updated = `${ago(i.updated_at)}${i.last_editor ? ` · ${i.last_editor.split('@')[0].replace(/^./, c => c.toUpperCase())}` : ''}`
    const title = i.title || 'Untitled'
    if (kind === 'brief') {
      return (
        <button key={i.path} type="button" className="home-card bm-card" data-testid="work-item" onClick={() => onOpenItem(i.path)}>
          <span className="bm-tab">{initialsOf(title)}</span><span className="bm-peek" aria-hidden />
          <b>{title}</b>
          <span className={`home-st ${STATE_CLASS(st)}`}>{words}</span>
          <dl className="bm-meta"><div><dt>Updated</dt><dd>{updated}</dd></div></dl>
        </button>
      )
    }
    if (kind === 'research') {
      const d = lenses[i.path] ?? []
      return (
        <button key={i.path} type="button" className="home-card rs-card" data-testid="work-item" onClick={() => onOpenItem(i.path)}>
          <span className="rs-band"><ToolIcon tool="research" />{initialsOf(title)}</span>
          <b>{title}</b>
          {d.length > 0 && <span className="lens" aria-label={`${d.filter(x => x === 'filled').length} lenses run, ${d.filter(x => x === 'none').length} skipped`}>{d.map((c, k) => <i key={k} className={`cov ${c}`} />)}</span>}
          <span className={`home-st ${STATE_CLASS(st)}`}>{words} · {updated}</span>
        </button>
      )
    }
    return (
      <button key={i.path} type="button" className="home-card" data-testid="work-item" onClick={() => onOpenItem(i.path)}>
        <small>{initialsOf(title)}</small><b>{title}</b><span className={`home-st ${STATE_CLASS(st)}`}>{words} · {updated}</span>
      </button>
    )
  }
  return (
    <div className="nui nui-page" data-testid="tool-page" data-client={client.id} data-tool={tool.id}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow" id="hero-eyebrow">{name} · {many.charAt(0).toUpperCase() + many.slice(1)}</div>
            <h1 className="hero-title" id="hero-title" tabIndex={-1}>{tool.id === 'research' ? tool.name : tool.full}<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub" id="hero-sub">{LINE[tool.id] ?? ''}</p>
          </div>
        </section>
        <section className="section-block"
          aria-label={`${tool.full} documents for ${name}`}>
          <div className="sec-num lc-sr">Client: {name} · {items.length === 0 ? `No ${many} for ${name} yet.` : `${items.length} ${items.length === 1 ? one : many} for ${name}.`}</div>
          <h2 className="sec-title">Pick one to open, or start a new {one === 'research' ? 'research question' : one}</h2>
          <div className={`home-grid ${kind === 'brief' ? 'bm-homes' : kind === 'research' ? 'rs-homes' : ''}`}>
            {items.map(card)}
            <button type="button" className="home-card home-new" data-testid="new-doc" onClick={onNew} aria-description={`New ${one} for ${name}`}>
              <small>NEW</small><b>+ New {one === 'research' ? 'research question' : one}</b>
              <span>{kind === 'brief' ? 'From notes, calls and decks' : kind === 'research' ? 'Sources pinned to every fact' : `For ${name}, theirs from the start`}</span>
            </button>
          </div>
          {items.length === 0 && <p className="nui-empty">Nothing yet. Start the first {one} for {name}; it is theirs from the start.</p>}
          <p className="nui-more"><button type="button" className="side-link" onClick={onBack}>Back to {name}</button></p>
        </section>
      </div>
    </div>
  )
}
