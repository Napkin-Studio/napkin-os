// The Territories node's card on the canvas (features/territories-spinoff-out-production.clan; mock territories-node-mock t1-t3, owner
// 2026-11-23: "Territories node mock looks good"). Territories' own sage identity, as the Brief node has Brief Maker's manila, so
// it reads as a document from another tool. Header "Territories · <route> · v<n>" and "frozen copy"; the line, palette, why, words,
// must-not-be, the route's pictures with rights chips; "Carries: Brief v1 · Research" and Open in Territories. Compact (the
// node sized down, as when it is linked to its Script) keeps the line, palette and pictures.

import { useState } from 'react'
import type { BriefNode, RoutePicture } from '../contracts/types'
import { carriesWords } from './routeNode'
import { rightsWords } from './routes'
import { useRoutePicture } from './useRoutePicture'

const chipClass = (r: RoutePicture['rights']) => (!r ? 'q' : r === 'licensed' ? 'l' : '')

function Tile({ p }: { p: RoutePicture }) {
  // The picture is a link by hash: this browser's copy, else the media base's (by sha256). The quiet tile is only for while it
  // loads, or a picture that truly cannot be found (never bytes in the document).
  const { url, state } = useRoutePicture(p)
  const [broken, setBroken] = useState(false)
  return (
    <div className="tn-pic" data-picture={url && !broken ? 'found' : state === 'loading' ? 'loading' : 'missing'}>
      {url && !broken ? <img src={url} alt="" draggable={false} onError={() => setBroken(true)} /> : <span className="tn-img" aria-hidden="true" />}
      <small title={p.caption}>{p.caption || 'Picture'}</small>
      <span className={`tn-ch ${chipClass(p.rights)}`}>{rightsWords(p.rights)}</span>
    </div>
  )
}

export function RouteCard({ node, openUrl, needs = false, compact = false }: { node: BriefNode; openUrl?: string; needs?: boolean; compact?: boolean }) {
  const r = node.route
  if (!r) return null
  const v = r.version ?? 1
  const pics = r.pictures ?? []
  return (
    <div className="tn-card" data-brief={node.id} data-route={r.id}>
      <span className="tn-tab" aria-hidden="true">TERRITORIES</span>
      {needs && <span className="bn-needs">Needs your call</span>}
      <div className="tn-head"><b>Territories · {r.name} · v{v}</b><span title="A copy of this route as it was at this version: it does not change when the Territories document does">frozen copy</span></div>
      <div className="tn-body">
        {r.thought && <div className="tn-ln">{r.thought}</div>}
        {r.palette?.length ? <div className="tn-r"><span>Palette</span><span className="tn-sw">{r.palette.map((c) => <i key={c} style={{ background: c }} title={c} />)}</span></div> : null}
        {!compact && r.why ? <div className="tn-r"><span>Why</span><span>{r.why}</span></div> : null}
        {!compact && r.words?.length ? <div className="tn-r"><span>Words</span><span className="tn-wd">{r.words.map((w) => <i key={w}>{w}</i>)}</span></div> : null}
        {!compact && r.not?.length ? <div className="tn-r"><span>Must not be</span><span>{r.not.join(' · ')}</span></div> : null}
        {pics.length ? <div className="tn-pics">{pics.slice(0, 4).map((p) => <Tile key={p.sha256} p={p} />)}</div> : null}
      </div>
      <div className="tn-foot">
        <span>{carriesWords(node)}</span>
        {openUrl && <a className="tn-link" href={openUrl} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()}>Open in Territories ↗</a>}
      </div>
    </div>
  )
}
