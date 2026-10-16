// The crew sheet (ui-behaviour 5.1; mock Crew.dc.html): who works on your ad, what each does and
// where each shows up, drawn as the house figures, with the three states at 24px. Opened from the
// account menu. What they say is shown where they say it, never invented here.

import type { CSSProperties } from 'react'
import { AgentFigure } from './AgentFigure'
import { CAST, type CastKey } from './cast'
import './crew.css'

const MAKERS: CastKey[] = ['dex', 'skye', 'wren', 'rhea', 'edie']
const HOUSE: CastKey[] = ['ellis', 'jude']
const TILE: Record<CastKey, string> = {
  dex: '#EEF3FF', skye: '#FFEDEA', wren: '#FFF6DE', rhea: '#E7F7EF', edie: '#F1EDFE', ellis: '#F2F3F6', jude: '#F2F3F6',
}
const DOES: Record<CastKey, string> = {
  dex: 'Plans the shots and writes each prompt.',
  skye: 'Drafts the script and rewrites marked lines.',
  wren: 'On screen while Runway makes a frame or clip.',
  rhea: 'Cuts out, fills and upscales in a frame.',
  edie: 'Splices moments and renders the ad.',
  ellis: 'Turns notes and handwriting into text.',
  jude: 'Judges each result against its shot.',
}
const WHERE: Record<CastKey, string> = {
  dex: 'Storyboard node and editor, a shot\'s camera fields, "Insert a shot here"',
  skye: 'Script node and editor, drafts in place, the VO column',
  wren: 'Empty frames and clips, the Video board, the jobs list',
  rhea: 'Image editor: fill or remove an area, change the frame, upscale',
  edie: 'Video editor timeline, patch windows, Make video',
  ellis: 'Sketches on the canvas, notes on a frame or a moment, Convert',
  jude: 'The check mark on frames and clips, retries in the jobs list',
}

export function CrewSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="crew-sheet pt-grid" role="dialog" aria-label="The crew">
      <div className="crew-inner">
        <div className="crew-top">
          <div>
            <div className="pt-label">Crew sheet</div>
            <h2>Who works on your ad</h2>
          </div>
          <span className="crew-lede">Five make the ad. Two house agents note and judge. Every line they say is signed.</span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="crew-heads">
          <span className="pt-label">Makes the ad</span>
          <span className="pt-label">House agents · in every Napkin tool</span>
        </div>
        <div className="crew-cards">
          {[...MAKERS, ...HOUSE].map((k) => (
            <article key={k} className="crew-card">
              <div className="crew-tile" style={{ '--tile': TILE[k] } as CSSProperties}>
                {HOUSE.includes(k) && <span className="crew-house">house agent</span>}
                <AgentFigure agent={k} size={96} />
              </div>
              <div className="crew-name"><b style={k === 'dex' ? { color: 'var(--tool-ink)' } : undefined}>{CAST[k].given}</b><span>· {CAST[k].job}</span></div>
              <p className="crew-does">{DOES[k]}</p>
              <div className="pt-label">Shows up in</div>
              <p className="crew-where">{WHERE[k]}</p>
            </article>
          ))}
        </div>
        <section className="crew-states pt-card">
          <div className="crew-stateshead">
            <span className="pt-label">At 24 px · on nodes, in job cards, next to a signature</span>
            <span><b>Idle</b> · a slow bob, the odd blink</span>
            <span><b>Working</b> · leans in, steps, motion lines</span>
            <span><b>Needs you</b> · a speech bubble with "!"</span>
          </div>
          <div className="crew-staterow">
            {[...MAKERS, ...HOUSE].map((k) => (
              <div key={k} className="crew-state">
                <div className="crew-statename"><b>{CAST[k].given}</b> · {CAST[k].job}{HOUSE.includes(k) ? ' · house' : ''}</div>
                <div className="crew-figs">
                  {(['idle', 'working', 'needs-you'] as const).map((s) => (
                    <span key={s}><AgentFigure agent={k} size={24} state={s} decorative /><small>{s === 'needs-you' ? 'needs you' : s}</small></span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
