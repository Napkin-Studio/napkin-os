// A take's picture: its file at a moment (a paused video element, seeked), or the still the mock makes, or a
// plain panel with its words while there is no file yet. Hover scrubs when `scrub` is on.

import { useEffect, useRef, useState } from 'react'
import { useDoc } from '../app/context'
import { isStill, useAssetUrl } from './media'

export function Poster({ sha, atS = 0, words, scrub = false, className = '', span }: {
  sha?: string
  /** The moment shown, in take seconds. */
  atS?: number
  /** Shown when there is no picture yet. */
  words?: string
  scrub?: boolean
  className?: string
  /** Hover scrubs this window of the take (default: the whole file). */
  span?: { inS: number; outS: number }
}) {
  const doc = useDoc()
  const url = useAssetUrl(sha)
  const ref = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const t = hover ?? atS
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const seek = () => { if (Math.abs(v.currentTime - t) > 0.04) v.currentTime = Math.max(0, t + 0.001) }
    if (v.readyState >= 1) seek()
    else v.addEventListener('loadedmetadata', seek, { once: true })
    return () => v.removeEventListener('loadedmetadata', seek)
  }, [t, url])
  if (!url) return <div className={`rm-poster empty ${className}`} aria-hidden="true">{words && <span className="rm-clamp2">{words}</span>}</div>
  if (isStill(doc, sha)) return <div className={`rm-poster ${className}`}><img src={url} alt="" draggable={false} /></div>
  return (
    <div className={`rm-poster ${className}`}
      onPointerMove={scrub ? (e) => {
        const b = e.currentTarget.getBoundingClientRect()
        const v = ref.current
        const lo = span?.inS ?? 0
        const hi = span?.outS ?? (v && Number.isFinite(v.duration) ? v.duration : 0)
        setHover(lo + Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * Math.max(0, hi - lo))
      } : undefined}
      onPointerLeave={scrub ? () => setHover(null) : undefined}>
      <video ref={ref} src={url} muted playsInline preload="metadata" draggable={false} />
    </div>
  )
}
