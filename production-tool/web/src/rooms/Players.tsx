// The take players of the rooms: one take with its scrub bar (the Make room's player, the Change drawer's
// parent), and Compare: two takes side by side, or a wipe, on one linked scrub bar (boards Make room and
// Change a take; the Image editor's Compare pattern).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDoc } from '../app/context'
import { isStill, tc, useAssetUrl } from './media'

/** One take: its file between `span` (default the whole of it), a play button, a scrub bar, the time. */
export function TakePlayer({ sha, label, span, beats, onTime, seekTo, children, className = '', overlay }: {
  sha?: string
  /** "Box 1 · v2": said before the time. */
  label: string
  span?: { inS: number; outS: number }
  /** Ticks on the scrub bar (each shot's cut). */
  beats?: { atS: number; label: string }[]
  onTime?: (s: number) => void
  /** Seek here when it changes. */
  seekTo?: number
  children?: ReactNode
  className?: string
  /** Drawn over the picture (a box being drawn). */
  overlay?: ReactNode
}) {
  const doc = useDoc()
  const url = useAssetUrl(sha)
  const still = isStill(doc, sha)
  const ref = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(span?.inS ?? 0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const lo = span?.inS ?? 0
  const hi = span?.outS ?? dur
  useEffect(() => {
    if (seekTo === undefined || !ref.current) return
    ref.current.currentTime = seekTo
    setT(seekTo)
  }, [seekTo])
  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime >= hi - 0.05) v.currentTime = lo
      void v.play()
    } else v.pause()
  }
  const seek = (s: number) => {
    const v = ref.current
    if (v) v.currentTime = s
    setT(s)
    onTime?.(s)
  }
  return (
    <div className={`rm-player ${className}`}>
      <div className="rm-stage">
        {url && still ? <img src={url} alt={label} />
          : url ? (
            <video ref={ref} src={url} playsInline preload="auto"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration
                setDur(Number.isFinite(d) ? d : 0)
                e.currentTarget.currentTime = seekTo ?? lo
              }}
              onTimeUpdate={(e) => {
                const now = e.currentTarget.currentTime
                setT(now)
                onTime?.(now)
                if (span && now >= span.outS) e.currentTarget.pause()
              }}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          ) : <div className="rm-stage-empty">{label ? 'No picture yet' : 'Pick a take to play it'}</div>}
        {overlay}
      </div>
      <div className="rm-transport">
        <button type="button" className="rm-iconbtn" aria-label={playing ? 'Pause' : 'Play'} disabled={!url || still} onClick={toggle}>
          {playing ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2 L12 7 L3.5 12 Z" fill="currentColor" /></svg>}
        </button>
        <div className="rm-scrub">
          <input type="range" aria-label="Scrub" min={lo} max={Math.max(lo + 0.01, hi)} step={0.01} value={Math.min(Math.max(t, lo), hi || lo)} disabled={!url || still || !hi}
            onChange={(e) => seek(Number(e.target.value))} />
          {beats?.map((b) => hi > lo && (
            <span key={b.atS} className="rm-beat" style={{ left: `${((b.atS - lo) / (hi - lo)) * 100}%` }} title={b.label} aria-hidden="true" />
          ))}
        </div>
        <span className="rm-tc pt-mono" title={label}>{label ? <span className="rm-tclabel">{label} · </span> : null}{tc(t - lo)} / {tc(Math.max(0, hi - lo))}</span>
        {children}
      </div>
    </div>
  )
}

/** Two takes on one scrub bar: side by side, or a wipe with a divider to drag. */
export function Compare({ a, b, onClose, actions }: {
  a: { sha?: string; label: string; span?: { inS: number; outS: number } }
  b: { sha?: string; label: string; span?: { inS: number; outS: number } }
  onClose: () => void
  actions?: ReactNode
}) {
  const ua = useAssetUrl(a.sha)
  const ub = useAssetUrl(b.sha)
  const ra = useRef<HTMLVideoElement>(null)
  const rb = useRef<HTMLVideoElement>(null)
  const [k, setK] = useState(0) // 0..1 through each take's span
  const [wipe, setWipe] = useState(false)
  const [split, setSplit] = useState(0.5)
  const [playing, setPlaying] = useState(false)
  const [durs, setDurs] = useState<{ a: number; b: number }>({ a: 0, b: 0 })
  const lenA = (a.span ? a.span.outS - a.span.inS : durs.a) || 0
  const lenB = (b.span ? b.span.outS - b.span.inS : durs.b) || 0
  const len = Math.max(lenA, lenB)
  const place = (v: HTMLVideoElement | null, span: { inS: number; outS: number } | undefined, x: number) => {
    if (!v) return
    const lo = span?.inS ?? 0
    const hi = span?.outS ?? (Number.isFinite(v.duration) ? v.duration : 0)
    v.currentTime = lo + x * Math.max(0, hi - lo)
  }
  const seek = (x: number) => {
    setK(x)
    place(ra.current, a.span, x)
    place(rb.current, b.span, x)
  }
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const start = performance.now()
    const from = k
    const tick = () => {
      const x = Math.min(1, from + (performance.now() - start) / 1000 / Math.max(0.1, len))
      seek(x)
      if (x >= 1) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])
  const vid = (url: string | undefined, ref: React.RefObject<HTMLVideoElement | null>, span: { inS: number; outS: number } | undefined, label: string) => url
    ? <video ref={ref} src={url} muted playsInline preload="auto" aria-label={label} onLoadedMetadata={(e) => {
      const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0
      setDurs((x) => (ref === ra ? { ...x, a: d } : { ...x, b: d }))
      place(e.currentTarget, span, k)
    }} />
    : <div className="rm-stage-empty">No picture yet</div>
  return (
    <div className="rm-compare" role="group" aria-label="Compare two takes">
      {wipe ? (
        <div className="rm-wipe">
          <div className="rm-stage">{vid(ua, ra, a.span, a.label)}</div>
          <div className="rm-stage rm-wipe-b" style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}>{vid(ub, rb, b.span, b.label)}</div>
          <input className="rm-wipe-handle" type="range" min={0} max={1} step={0.001} value={split} aria-label="Wipe divider" onChange={(e) => setSplit(Number(e.target.value))} />
          <span className="rm-wipe-line" style={{ left: `${split * 100}%` }} aria-hidden="true" />
        </div>
      ) : (
        <div className="rm-sidebyside">
          <figure><div className="rm-stage">{vid(ua, ra, a.span, a.label)}</div><figcaption className="rm-clamp2" title={a.label}>{a.label}</figcaption></figure>
          <figure><div className="rm-stage">{vid(ub, rb, b.span, b.label)}</div><figcaption className="rm-clamp2" title={b.label}>{b.label}</figcaption></figure>
        </div>
      )}
      {wipe && <div className="rm-wipelabels"><span className="rm-clamp1" title={a.label}>{a.label}</span><span className="rm-clamp1" title={b.label}>{b.label}</span></div>}
      <div className="rm-transport">
        <button type="button" className="rm-iconbtn" aria-label={playing ? 'Pause both' : 'Play both'} onClick={() => { if (k >= 1) seek(0); setPlaying(!playing) }}>
          {playing ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2 L12 7 L3.5 12 Z" fill="currentColor" /></svg>}
        </button>
        <div className="rm-scrub"><input type="range" min={0} max={1} step={0.001} value={k} aria-label="Scrub both" onChange={(e) => { setPlaying(false); seek(Number(e.target.value)) }} /></div>
        <span className="rm-tc pt-mono">{tc(k * len)}</span>
        <button type="button" className={`btn ${wipe ? 'on' : ''}`} aria-pressed={wipe} onClick={() => setWipe(!wipe)}>Wipe</button>
        {actions}
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
