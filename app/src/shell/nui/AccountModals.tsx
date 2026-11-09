// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the account menu opens (mock phase 33): All tools (every tool, live or
// coming, with Idea and Ads, which the dial has no room for, and the app
// library the Launcher shows) and Your crew (the agents, as the figures draw them).

import { TOOLS, type Tool } from '../landing/tools'
import FigureGallery from '../../studio/FigureGallery'
import { Modal } from './Pop'

const WHAT: Record<string, string> = {
  brief: 'A one-page creative brief from notes, calls and research.',
  research: 'One sharp question; every fact pinned with a source.',
  idea: 'Ideas from the brief and the Brand Clan.',
  deck: 'A board deck from a brief and its facts.',
  prod: 'Films and stills; opens the Production Tool.',
  ads: 'Ads and films from a brief, in the Advertising Studio.',
}

export function AllToolsModal({ live, onClose, onSoon, onLibrary }: {
  live: ReadonlySet<string>
  onClose: () => void
  onSoon: (tool: Tool) => void
  /** The app library: every installed app and template (the Launcher). */
  onLibrary?: () => void
}) {
  return (
    <Modal onClose={onClose} label="All tools">
      <h2>All tools</h2>
      <p className="m-sub">The four on the dial are live where their app is installed. The rest are coming.</p>
      <h3>Tools</h3>
      <div className="m-grid" data-testid="all-tools">
        {TOOLS.map(t => {
          const on = live.has(t.id)
          return (
            <div className={`m-card ${on ? '' : 'soon'}`} key={t.id}>
              <span className={`m-tag ${on ? '' : 'soon'}`}>{on ? (['brief', 'research', 'deck', 'prod'].includes(t.id) ? 'On the dial' : 'Live') : 'Coming soon'}</span>
              <b>{t.full}</b>
              <small>{WHAT[t.id] ?? ''}</small>
              {!on && <button type="button" className="sp-btn" onClick={() => onSoon(t)}>Tell me when</button>}
            </div>
          )
        })}
      </div>
      {onLibrary && (
        <>
          <h3>Apps and templates</h3>
          <p className="m-sub">Every app installed here, and the templates to start from.</p>
          <div className="m-acts"><button type="button" className="btn-rect" onClick={() => { onClose(); onLibrary() }}>Open the app library</button></div>
        </>
      )}
    </Modal>
  )
}

export function CrewModal({ agency, onClose }: { agency: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose} label="Your crew">
      <h2>Your crew</h2>
      <p className="m-sub">The agents that work for {agency}. Each one signs what it does on the record.</p>
      <FigureGallery />
    </Modal>
  )
}
