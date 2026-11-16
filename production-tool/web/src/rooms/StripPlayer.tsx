// The Make room's player (features/join-or-cut-shots.clan, mock join-or-cut-v1): the selected box's take with
// each shot's window marked on the bar (lit for the shot playing, a playhead), or, before Make, the windows the
// box's shots will get (dashed) over the focused shot's frame ("The frame, until Make"), or its words when
// the box is made from words. Clicking a window plays from that shot.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDoc } from '../app/context'
import type { Id } from '../contracts/types'
import { selectedFrame } from '../jobs/frames'
import { shotNumber } from '../model/selectors'
import { isStill, tc, useAssetUrl } from './media'
import { boxName, type Box, type Gen } from './model'
import { Mentions } from './Mentions'

const s1 = (n: number) => `${Math.round(n * 10) / 10}`

export function StripPlayer({ box, take, shotId, words, children }: {
  box?: Box
  /** The box's take to play (ready), if it has one. */
  take?: Gen
  /** The shot picked in the strip: its frame shows until Make, and a made take starts at its window. */
  shotId?: Id
  /** The box is made from its shots' words (no frames). */
  words: boolean
  children?: ReactNode
}) {
  const doc = useDoc()
  const url = useAssetUrl(take?.asset)
  const still = isStill(doc, take?.asset)
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const ids = box?.shotIds ?? []
  // The windows: the take's segments for these shots, else each shot's length laid end to end (planned).
  const segs = take ? take.segments.filter((s) => ids.includes(s.shotId)) : []
  const made = !!take && (segs.length > 0 || ids.length === 1)
  let at = 0
  const planned = ids.map((id) => { const d = doc.shots[id]?.duration_s ?? 0; const w = { shotId: id, inS: at, outS: at + d }; at += d; return w })
  const wins = made ? (segs.length ? segs : [{ shotId: ids[0], inS: 0, outS: take!.durationS }]) : planned
  const lo = wins[0]?.inS ?? 0
  const hi = wins.at(-1)?.outS ?? 0
  const focusWin = wins.find((w) => w.shotId === shotId)
  const [t, setT] = useState(focusWin?.inS ?? lo)
  // A shot picked in the strip plays from its window (the player is drawn anew for another box or take).
  const [seenShot, setSeenShot] = useState(shotId)
  const to = focusWin?.inS ?? lo
  if (seenShot !== shotId) {
    setSeenShot(shotId)
    setT(to)
  }
  useEffect(() => {
    const v = ref.current
    if (v && v.readyState >= 1) v.currentTime = to + 0.05
  }, [to])
  const cur = wins.find((w) => t >= w.inS - 1e-3 && t < w.outS) ?? wins.at(-1)
  const n = (id: Id | undefined) => (id ? shotNumber(doc, id) : 0)
  const name = box ? boxName(box) : 'Box'
  const seek = (s: number) => {
    const v = ref.current
    if (v) v.currentTime = s + 0.05
    setT(s)
  }
  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) { if (v.currentTime >= hi - 0.05) v.currentTime = lo; void v.play() } else v.pause()
  }
  const frameShot = shotId && ids.includes(shotId) ? shotId : ids[0]
  const frame = selectedFrame(doc, frameShot)
  const frameUrl = useAssetUrl(frame?.asset)
  const tag = made ? `${name} · v${take!.version} · shot ${n(cur?.shotId)}` : `${name} · not made yet · ${words ? `shot ${n(frameShot)}` : `frame of shot ${n(frameShot)}`}`
  const len = Math.max(0, hi - lo)
  const covered = wins.map((w) => `shot ${n(w.shotId)}`)
  const note = !box ? '' : made ? (wins.length < ids.length ? `Take v${take!.version} was made before the join: it has ${covered.join(' and ')} only. Make makes all ${ids.length} as one video.`
    : ids.length > 1 ? `Take v${take!.version} of ${name}: one video, ${ids.length} shot windows.` : `Take v${take!.version} of ${name}: one shot.`)
    : ids.length > 1 ? `${name}’s ${ids.length} shots will be one video; these are the windows each shot gets.` : `${name} is one shot, made on its own.`
  return (
    <div className="jc-player">
      {made && url ? (
        <div className="viewer jc-viewer">
          {still ? <img src={url} alt={tag} /> : (
            <video ref={ref} src={url} playsInline preload="auto" aria-label={tag}
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = t + 0.05 }}
              onTimeUpdate={(e) => { const now = e.currentTarget.currentTime; setT(now); if (now >= hi) e.currentTarget.pause() }}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          )}
          <span className="tag">{tag}</span>
        </div>
      ) : words || !frameUrl ? (
        <div className="viewer jc-viewer jc-empty">
          <div><b>{box ? `${name} is not made yet.` : 'Nothing made yet.'}</b>{frameShot && <span><Mentions text={doc.shots[frameShot]?.action ?? ''} /></span>}</div>
          {box && <span className="tag">{tag}</span>}
        </div>
      ) : (
        <div className="viewer jc-viewer jc-unmade">
          <img src={frameUrl} alt={tag} />
          <span className="tag">{tag}</span>
          <span className="jc-poster">The frame, until Make</span>
        </div>
      )}
      <div className="vctl">
        <button type="button" className="play" aria-label={playing ? 'Pause' : 'Play'} disabled={!made || !url || still} onClick={toggle}>
          {playing ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2" width="2.5" height="8" fill="currentColor" /><rect x="7" y="2" width="2.5" height="8" fill="currentColor" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2 L10 6 L3 10Z" fill="currentColor" /></svg>}
        </button>
        <div className={`jc-scrub ${made ? 'made' : 'plan'}`} role="group" aria-label="Shot windows">
          <div className="jc-track">
            {wins.map((w) => (
              <button key={w.shotId} type="button" className={`jc-win ${made && w.shotId === cur?.shotId ? 'on' : ''}`} style={{ flexGrow: Math.max(0.1, w.outS - w.inS) }}
                disabled={!made} onClick={() => seek(w.inS)} aria-label={`Shot ${n(w.shotId)}: ${s1(w.inS - lo)} to ${s1(w.outS - lo)} s`} />
            ))}
            {made && len > 0 && <span className="jc-head" style={{ left: `${Math.min(100, Math.max(0, ((t - lo) / len) * 100))}%` }} aria-hidden="true" />}
          </div>
          <div className="jc-wlabels" aria-hidden="true">
            {wins.map((w) => <span key={w.shotId} style={{ flexGrow: Math.max(0.1, w.outS - w.inS) }}><b>Shot {n(w.shotId)}</b>{s1(w.inS - lo)}–{s1(w.outS - lo)} s</span>)}
          </div>
        </div>
        <span className="tc">{made ? tc(t - lo) : tc(0)} / {tc(len)}</span>
        {children}
      </div>
      {note && <p className="jc-wnote">{note}</p>}
    </div>
  )
}
