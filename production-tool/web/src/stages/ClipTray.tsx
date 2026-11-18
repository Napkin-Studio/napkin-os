// The send tray for Make clips (ui-behaviour 3.16, 5.4; features/production-ui.clan): "What Dex will
// send", anchored to the Video editor's Make clips, signed by Dex. One row per shot that has no clip,
// each ticked, saying what its clip is made from: its frame, or (a video made straight from the script,
// 3.5) its words alone. A shot with neither is listed and cannot be ticked, with why. A batch opens
// expanded (5.4). No price (costs live in the decision tree). Nothing is sent until Make clips; Cancel
// or Esc sends nothing.
//
// Under each shot, its references (owner 2026-10-15, features/canvas-nodes.clan): what its words name and
// what is linked into it, always sent; then "Added by Dex: @x · why" for each reference Dex added to its
// newest frame or clip, which the person can untick (it is then not offered to Dex on this shot again).

import { Fragment, useState, type RefObject } from 'react'
import { useConfig, useDoc, useServices, useUi } from '../app/context'
import { choiceToSend, modelChoicesFor, modelWhere, qualityLabel, resolveQuality } from '../capabilities'
import type { ClipQuality, ModelChoice, Shot } from '../contracts/types'
import { QualityPick } from '../ui/QualityPick'
import { clipSource, traySummary } from '../jobs/clips'
import { lastWorkedModel } from '../jobs/follow'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { Float } from '../ui/Float'
import { shotRefRows } from './trayScope'

export interface TrayShot { shot: Shot; n: number }

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s)

export function ClipTray({ anchor, open, onClose, shots, fromWords, ratio, quality: start, onMake, makeLabel }: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  /** The shots with no clip yet, numbered as in the cut. */
  shots: TrayShot[]
  /** The video makes clips straight from the script: a shot with no frame goes from its words. */
  fromWords: boolean
  ratio: string
  /** The video's default quality (features/clip-quality.clan); the tray may pick another for this batch. */
  quality: ClipQuality
  onMake: (shotIds: string[], modelChoice?: ModelChoice, quality?: ClipQuality) => void
  /** The send's name when it makes one take of these shots (features/connected-video.clan). */
  makeLabel?: string
}) {
  const doc = useDoc()
  const ui = useUi()
  const services = useServices()
  const { config } = useConfig()
  const declined = (shotId: string) => ui.declinedAdds?.[shotId] ?? []
  const decline = (shotId: string, refId: string) => services.ui.update((u) => {
    const now = u.declinedAdds?.[shotId] ?? []
    const next = now.includes(refId) ? now.filter((x) => x !== refId) : [...now, refId]
    u.declinedAdds = { ...u.declinedAdds, [shotId]: next }
  }, 'decline addition')
  const rows = shots.map((s) => ({ ...s, source: clipSource(doc, s.shot.id, fromWords) }))
  const makeable = rows.filter((r) => r.source)
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const isOpen = expanded ?? (rows.length > 1 || !makeable.length)
  const picked = makeable.filter((r) => !off.has(r.shot.id))
  const choice = lastWorkedModel(doc, 'clip', config)
  const shown = choice ?? modelChoicesFor('clip', config)[0]
  const [quality, setQuality] = useState<ClipQuality>(start)
  // What each clip will be: the level and the size the model makes at it (the family's member for Kling).
  const sized = shown ? resolveQuality('clip', shown.provider, shown.model, quality) : undefined
  const model = shown ? modelWhere(shown.provider, sized?.model ?? shown.model) : undefined
  const level = qualityLabel(sized?.level, sized?.tier)
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
            <Fragment key={r.shot.id}>
            <label className={`tray-row ${r.source ? '' : 'cannot'}`}>
              <input type="checkbox" checked={!!r.source && !off.has(r.shot.id)} disabled={!r.source} onChange={() => flip(r.shot.id)} />
              <span>
                <b>Shot {r.n}</b>{' '}
                {r.source === 'frame' && <span className="faint">· from its frame</span>}
                {r.source === 'words' && <><span className="faint">· from its words, no frame:</span> {short(r.shot.action ?? '', 70)}</>}
                {!r.source && <span className="faint">· no frame yet. Draw it in the storyboard{fromWords ? ', or write the shot' : ', or make clips straight from the script'}.</span>}
              </span>
            </label>
            {r.source && <RefRows doc={doc} shotId={r.shot.id} fromFrame={r.source === 'frame'} declined={declined(r.shot.id)} onFlip={(id) => decline(r.shot.id, id)} />}
            </Fragment>
          ))}
        </div>
      )}
      <div className="tray-quality row" style={{ gap: 8, padding: '6px 12px 0' }}>
        <span className="faint" style={{ fontSize: 12 }}>Quality</span>
        <QualityPick op="clip" choice={shown} value={quality} onChange={setQuality} />
      </div>
      <div className="tray-foot nowrap" title="Nothing is sent until you press Make clips.">
        <span className="pt-mono tray-model">{model ?? 'The default model'} · {level ? `${level} · ` : ''}{ratio}</span>
        <button type="button" className="btn sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn sm primary" disabled={!picked.length}
          onClick={() => onMake(picked.map((r) => r.shot.id), choiceToSend('clip', config, choice), quality)}>
          {makeLabel ?? (picked.length > 1 ? `Make ${picked.length} clips` : 'Make clips')}
        </button>
      </div>
    </Float>
  )
}

/** A shot's references in the tray: what it asks for (no tick: they always go), then Dex's additions. */
function RefRows({ doc, shotId, fromFrame, declined, onFlip }: {
  doc: ReturnType<typeof useDoc>
  shotId: string
  fromFrame: boolean
  declined: readonly string[]
  onFlip: (refId: string) => void
}) {
  const rows = shotRefRows(doc, shotId, declined)
  if (!rows.length) return null
  return (
    <div className="tray-refs" role="group" aria-label="References">
      {rows.map((row) => row.kind === 'asked'
        ? (
          <div key={row.key} className="tray-ref" title={fromFrame ? 'Its frame already shows them' : undefined}>
            <span className="pt-ref">{row.label}</span> <span className="faint">· {row.detail}{fromFrame ? ' · in its frame' : ''}</span>
          </div>
        )
        : (
          <label key={row.key} className="tray-ref added">
            <input type="checkbox" checked={row.on} onChange={() => onFlip(row.refIds[0])} />
            <span><span className="pt-ref">{row.label}</span> <span className="faint">· {row.detail}</span></span>
          </label>
        ))}
    </div>
  )
}
