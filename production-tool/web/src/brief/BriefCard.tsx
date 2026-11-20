// The Brief node's card on the canvas (features/brief-node.clan; mock production-new-ui-v2 brief-node, v2.1:
// compact). Brief Maker's manila look, so it reads as a document from another tool, in both themes: the
// title, its version, the proposition and the tone; "Frozen at vN" and Open in Brief Maker. The whole spine
// with its source cards is in the Booth when the node is selected (BriefBooth).

import type { ProductionDocument } from '../contracts/types'
import { spineLines } from './spine'
import './brief.css'

/** The two lines the card shows: the proposition and the tone (what the film must say, and how). */
const CARD_PARTS = ['proposition', 'tone'] as const

export function BriefCard({ doc, id, openUrl, needs = false }: { doc: ProductionDocument; id: string; openUrl?: string; needs?: boolean }) {
  const b = doc.briefs?.[id]
  if (!b) return null
  const v = b.source.taken
  const rows = spineLines(b.spine, b.confidential).filter((l) => (CARD_PARTS as readonly string[]).includes(l.part))
  return (
    <div className="bn-card" data-brief={id}>
      <span className="bn-tab" aria-hidden="true">BRIEF</span>
      {needs && <span className="bn-needs">Needs your call</span>}
      <div className="bn-head"><b>{b.title || 'Brief'}</b><span title="A copy of the brief as it was at this version: it does not change when the brief does">v{v} · frozen copy</span></div>
      <div className="bn-body">
        {rows.map((l) => (
          <div key={l.part} className="bn-row"><span>{l.label}</span><span>{l.confidential ? 'Confidential' : l.text ?? l.items?.join(' · ')}</span></div>
        ))}
        {!rows.length && <div className="bn-row"><span>Spine</span><span>Select it to read the spine.</span></div>}
      </div>
      <div className="bn-foot">
        <span>Frozen at v{v}</span>
        {openUrl && <a className="bn-link" href={openUrl} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()}>Open in Brief Maker ↗</a>}
      </div>
    </div>
  )
}
