// The Edit room's Program viewer (board Edit room): a browser compositor that plays the compiled plan, the same
// one Render ad sends (rooms/timeline.ts compileFor). Each clip has a pooled video element; at every frame the
// viewer asks frameAt(plan, t) what shows (the clip, the outgoing clip's footage inside a dissolve or dip, the
// text, the end card) and draws it onto one canvas. It is always labelled Preview; a render plays labelled
// Rendered. Nothing here spends anything.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDoc } from '../app/context'
import { remoteUrl } from '../jobs/assets'
import { blobUrl, cachedBlobUrl } from '../lib/blobs'
import { frameAt, type Plan, type PlanText } from './timeline'

/** A file's URL: this browser's copy, else the relay's. */
async function urlOf(doc: { assets: Record<string, { locations?: string[] } | undefined> }, sha: string): Promise<string | undefined> {
  return cachedBlobUrl(sha) ?? (await blobUrl(sha).catch(() => undefined)) ?? remoteUrl(doc as never, sha)
}

const TEXT_FONT = "600 {px}px 'Geist', system-ui, sans-serif"

/** Text as stitch lays it out (relay/typeset.py): caption a bottom band, title centred, super a lower third. */
function drawText(ctx: CanvasRenderingContext2D, t: PlanText, alpha: number, w: number, h: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  const px = Math.round(h * (t.style === 'title' ? 0.085 : t.style === 'super' ? 0.055 : 0.05))
  ctx.font = TEXT_FONT.replace('{px}', String(px))
  ctx.textBaseline = 'middle'
  const words = t.words
  const width = Math.min(ctx.measureText(words).width, w * 0.86)
  if (t.style === 'caption') {
    const y = h * 0.86
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect((w - width) / 2 - px * 0.6, y - px * 0.85, width + px * 1.2, px * 1.7)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(words, w / 2, y, w * 0.86)
  } else if (t.style === 'title') {
    ctx.fillStyle = '#fff'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = px * 0.4
    ctx.textAlign = 'center'
    ctx.fillText(words, w / 2, h / 2, w * 0.86)
  } else {
    const x = w * 0.07
    const y = h * 0.78
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(x - px * 0.5, y - px * 0.85, width + px, px * 1.7)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    ctx.fillText(words, x, y, w * 0.86)
  }
  ctx.restore()
}

/** The end card as the relay draws it: its colour, the headline, the line and the call to action. */
function drawCard(ctx: CanvasRenderingContext2D, card: NonNullable<Plan['endCard']>, alpha: number, w: number, h: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = card.bg
  ctx.fillRect(0, 0, w, h)
  const light = parseInt(card.bg.slice(1, 3), 16) * 0.299 + parseInt(card.bg.slice(3, 5), 16) * 0.587 + parseInt(card.bg.slice(5, 7), 16) * 0.114 > 150
  ctx.fillStyle = light ? '#14161B' : '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const head = Math.round(h * 0.1)
  if (card.headline) {
    ctx.font = TEXT_FONT.replace('{px}', String(head)).replace('600', '700')
    ctx.fillText(card.headline, w / 2, h * 0.42, w * 0.86)
  }
  ctx.font = TEXT_FONT.replace('{px}', String(Math.round(h * 0.05))).replace('600', '500')
  ctx.fillText(card.line, w / 2, card.headline ? h * 0.56 : h / 2, w * 0.86)
  if (card.cta) {
    ctx.font = TEXT_FONT.replace('{px}', String(Math.round(h * 0.04)))
    ctx.fillText(card.cta, w / 2, h * 0.68, w * 0.86)
  }
  ctx.restore()
}

/** Draw a picture so it fills the canvas, keeping its shape (letterboxed). */
function drawFit(ctx: CanvasRenderingContext2D, el: CanvasImageSource & { videoWidth?: number; naturalWidth?: number; videoHeight?: number; naturalHeight?: number }, alpha: number, w: number, h: number) {
  const iw = el.videoWidth || el.naturalWidth || w
  const ih = el.videoHeight || el.naturalHeight || h
  const k = Math.min(w / iw, h / ih)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(el, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k)
  ctx.restore()
}

export function Viewer({ plan, t, onTime, ratio, playing, onPlaying, label }: {
  /** Said on the picture: Preview. */
  label: string
  plan: Plan
  t: number
  onTime: (s: number) => void
  ratio: string
  playing: boolean
  onPlaying: (p: boolean) => void
}) {
  const doc = useDoc()
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const pool = useRef(new Map<string, HTMLVideoElement | HTMLImageElement>())
  const hidden = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 640, h: 360 })
  const [rw, rh] = ratio.split(':').map(Number)
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t })

  // The canvas follows its box at the screen's density.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      const w = Math.max(160, Math.min(r.width, (r.height * rw) / rh))
      setSize({ w: Math.round(w), h: Math.round((w * rh) / rw) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rw, rh])

  const draw = (at: number, running: boolean) => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const w = cv.width
    const h = cv.height
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const f = frameAt(plan, at)
    const live = new Set(f.layers.map((l) => l.clip.item_id))
    for (const [k, el] of pool.current) if (!live.has(k) && el instanceof HTMLVideoElement && !el.paused) el.pause()
    for (const l of f.layers) {
      const el = pool.current.get(l.clip.item_id)
      if (!el) continue
      if (el instanceof HTMLVideoElement) {
        el.playbackRate = l.clip.speed ?? 1
        const drift = Math.abs(el.currentTime - l.srcS)
        if (running && l.srcS < l.clip.outS - 0.02) {
          if (el.paused) void el.play().catch(() => {})
          if (drift > 0.25) el.currentTime = l.srcS
        } else {
          if (!el.paused) el.pause()
          if (drift > 0.03) el.currentTime = l.srcS
        }
        if (el.readyState >= 2) drawFit(ctx, el, l.alpha, w, h)
      } else if (el.complete) drawFit(ctx, el, l.alpha, w, h)
    }
    if (f.wash.alpha > 0) {
      ctx.save()
      ctx.globalAlpha = f.wash.alpha
      ctx.fillStyle = f.wash.colour === 'white' ? '#fff' : '#000'
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }
    if (f.endCard) drawCard(ctx, f.endCard.card, f.endCard.alpha, w, h)
    for (const x of f.text) drawText(ctx, x.t, x.alpha, w, h)
  }
  const drawRef = useRef(draw)
  useEffect(() => { drawRef.current = draw })

  // One element per clip, made when its URL is known.
  useEffect(() => {
    let alive = true
    const want = new Set(plan.clips.map((c) => c.item_id))
    for (const [k, el] of pool.current) if (!want.has(k)) { el.remove(); pool.current.delete(k) }
    void (async () => {
      for (const c of plan.clips) {
        if (pool.current.has(c.item_id)) continue
        const url = await urlOf(doc, c.sha256)
        if (!alive || !url) continue
        const still = doc.assets[c.sha256]?.mime.startsWith('image/')
        const el = still ? new Image() : document.createElement('video')
        if (el instanceof HTMLVideoElement) {
          el.muted = true
          el.playsInline = true
          el.preload = 'auto'
        }
        el.src = url
        hidden.current?.appendChild(el)
        pool.current.set(c.item_id, el)
        el.addEventListener(el instanceof HTMLVideoElement ? 'loadeddata' : 'load', () => drawRef.current(tRef.current, false))
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, doc.assets])



  // The clock: while playing, ad time runs on from where it was; it stops at the end of the film.
  useEffect(() => {
    if (!playing) {
      for (const el of pool.current.values()) if (el instanceof HTMLVideoElement) el.pause()
      drawRef.current(t, false)
      return
    }
    let raf = 0
    const from = t >= plan.lengthS - 0.05 ? 0 : t
    const start = performance.now()
    const tick = () => {
      const now = from + (performance.now() - start) / 1000
      if (now >= plan.lengthS) {
        onTime(plan.lengthS)
        onPlaying(false)
        return
      }
      onTime(now)
      drawRef.current(now, true)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, plan])

  // Paused: draw where the playhead is (after a seek lands, the frame is drawn again).
  useEffect(() => {
    if (playing) return
    drawRef.current(t, false)
    const again = () => drawRef.current(tRef.current, false)
    const els = [...pool.current.values()].filter((e): e is HTMLVideoElement => e instanceof HTMLVideoElement)
    for (const el of els) el.addEventListener('seeked', again)
    return () => { for (const el of els) el.removeEventListener('seeked', again) }
  }, [t, playing, size, plan])

  return (
    <div className="rm-viewbox" ref={box}>
      <div className="rm-canvaswrap" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} className="rm-canvas" width={Math.round(size.w * (window.devicePixelRatio || 1))} height={Math.round(size.h * (window.devicePixelRatio || 1))}
          style={{ width: size.w, height: size.h }} aria-label="The cut, as it will render" />
        <span className="rm-viewlabel">{label}</span>
      </div>
      <div ref={hidden} className="rm-pool" aria-hidden="true" />
    </div>
  )
}
