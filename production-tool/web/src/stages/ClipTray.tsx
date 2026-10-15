// The send tray for Make clips (ui-behaviour 3.16, 5.4; features/production-ui.clan): "What Dex will
// send", anchored to the Video editor's Make clips, signed by Dex. One row per shot that has no clip,
// each ticked, saying what its clip is made from: its frame, or (a video made straight from the script,
// 3.5) its words alone. A shot with neither is listed and cannot be ticked, with why. A batch opens
// expanded (5.4). No price (costs live in the decision tree). Nothing is sent until Make clips; Cancel
// or Esc sends nothing.

import { useState, type RefObject } from 'react'
import { useConfig, useDoc } from '../app/context'
import { choiceToSend, modelChoicesFor, modelWhere } from '../capabilities'
import type { ModelChoice, Shot } from '../contracts/types'
import { clipSource, traySummary } from '../jobs/clips'
import { lastWorkedModel } from '../jobs/follow'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { Float } from '../ui/Float'

export interface TrayShot { shot: Shot; n: number }

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s)

export function ClipTray({ anchor, open, onClose, shots, fromWords, ratio, onMake }: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  /** The shots with no clip yet, numbered as in the cut. */
  shots: TrayShot[]
  /** The video makes clips straight from the script: a shot with no frame goes from its words. */
  fromWords: boolean
  ratio: string
  onMake: (shotIds: string[], modelChoice?: ModelChoice) => void
}) {
  const doc = useDoc()
  const { config } = useConfig()
  const rows = shots.map((s) => ({ ...s, source: clipSource(doc, s.shot.id, fromWords) }))
  const makeable = rows.filter((r) => r.source)
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const isOpen = expanded ?? (rows.length > 1 || !makeable.length)
  const picked = makeable.filter((r) => !off.has(r.shot.id))
  const choice = lastWorkedModel(doc, 'clip', config)
  const shown = choice ?? modelChoicesFor('clip', config)[0]
  const model = shown ? modelWhere(shown.provider, shown.model) : undefined
  const flip = (id: string) => setOff((o) => {
    const n = new Set(o)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  return (
    <Float anchor={anchor} open={open} onClose={onClose} role="dialog" label="What Dex will send" align="end" className="clip-tray">
      <div className="tray-head">
        <button type="button" className="tray-fold" aria-label={isOpen ? 'Collapse' : 'Expand'} aria-expanded={isOpen} onClick={() => setExpanded(!isOpen)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d={isOpen ? 'M3 7.5 L6 4.5 L9 7.5' : 'M3 4.5 L6 7.5 L9 4.5'} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <AgentFigure agent="dex" size={22} decorative />
        <div className="tray-title"><b>What Dex will send</b><span>{sayer('dex')}</span></div>
      </div>
      {!isOpen && <button type="button" className="tray-line" onClick={() => setExpanded(true)}>{traySummary(picked.map((r) => r.source))}</button>}
      {isOpen && (
        <div className="tray-rows" role="group" aria-label="Clips to make">
          {rows.map((r) => (
            <label key={r.shot.id} className={`tray-row ${r.source ? '' : 'cannot'}`}>
              <input type="checkbox" checked={!!r.source && !off.has(r.shot.id)} disabled={!r.source} onChange={() => flip(r.shot.id)} />
              <span>
                <b>Shot {r.n}</b>{' '}
                {r.source === 'frame' && <span className="faint">· from its frame</span>}
                {r.source === 'words' && <><span className="faint">· from its words, no frame:</span> {short(r.shot.action ?? '', 70)}</>}
                {!r.source && <span className="faint">· no frame yet. Draw it in the storyboard{fromWords ? ', or write the shot' : ', or make clips straight from the script'}.</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="tray-foot nowrap" title="Nothing is sent until you press Make clips.">
        <span className="pt-mono tray-model">{model ?? 'The default model'} · {ratio}</span>
        <button type="button" className="btn sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn sm primary" disabled={!picked.length}
          onClick={() => onMake(picked.map((r) => r.shot.id), choiceToSend('clip', config, choice))}>
          {picked.length > 1 ? `Make ${picked.length} clips` : 'Make clips'}
        </button>
      </div>
    </Float>
  )
}
