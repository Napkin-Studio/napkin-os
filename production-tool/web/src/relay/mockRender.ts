// The mock's pictures and clips, drawn on a canvas in the browser. Every
// output carries a big "MOCK" stamp so it can never pass for a real result.

import type { JobRequest, Ratio, View } from '../contracts/types'
import type { MockRenderer, RenderedOutput } from './mock'

const ACCENT = '#FF4F2E'
const INK = '#14161B'

type Input = (sha: string) => Promise<Blob | undefined>

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

async function bitmap(input: Input, sha?: string): Promise<ImageBitmap | null> {
  if (!sha) return null
  const blob = await input(sha)
  if (!blob || !blob.type.startsWith('image/')) return null
  try {
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the mock image.'))), 'image/png'))
}

function sizeFor(ratio: Ratio | undefined, long = 1024): { w: number; h: number } {
  switch (ratio) {
    case '1:1': return { w: long, h: long }
    case '4:5': return { w: Math.round(long * 0.8), h: long }
    case '16:9': return { w: long, h: Math.round((long * 9) / 16) }
    case '3:1': return { w: long, h: Math.round(long / 3) }
    case '9:16': return { w: Math.round((long * 9) / 16), h: long }
    default: return { w: 768, h: 1024 }
  }
}

function paper(ctx: CanvasRenderingContext2D, w: number, h: number, seed = 0) {
  const g = ctx.createLinearGradient(0, 0, w, h)
  const hue = (seed * 47) % 360
  g.addColorStop(0, `hsl(${hue} 30% 94%)`)
  g.addColorStop(1, `hsl(${(hue + 40) % 360} 35% 86%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function contain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, opts: { mirror?: boolean; scale?: number } = {}) {
  const s = Math.min(w / img.width, h / img.height) * (opts.scale ?? 1)
  const dw = img.width * s
  const dh = img.height * s
  const dx = x + (w - dw) / 2
  const dy = y + (h - dh) / 2
  ctx.save()
  if (opts.mirror) {
    ctx.translate(dx + dw / 2, 0)
    ctx.scale(-1, 1)
    ctx.translate(-(dx + dw / 2), 0)
  }
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()
}

function stamp(ctx: CanvasRenderingContext2D, w: number, h: number, label: string) {
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate(-0.35)
  ctx.font = `900 ${Math.round(Math.min(w, h) * 0.2)}px Geist, Helvetica, Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(4, Math.min(w, h) * 0.012)
  ctx.strokeStyle = 'rgba(255,79,46,0.9)'
  ctx.fillStyle = 'rgba(255,79,46,0.18)'
  ctx.fillText('MOCK', 0, 0)
  ctx.strokeText('MOCK', 0, 0)
  ctx.restore()
  // Caption strip
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.032))
  ctx.fillStyle = 'rgba(20,22,27,0.82)'
  ctx.fillRect(0, h - fs * 2.2, w, fs * 2.2)
  ctx.fillStyle = '#fff'
  ctx.font = `600 ${fs}px Geist, Helvetica, Arial, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.slice(0, 80), fs * 0.8, h - fs * 1.1)
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 4) {
  const words = text.split(/\s+/)
  let line = ''
  let n = 0
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lineH)
      line = word
      if (++n >= maxLines) return
    } else line = test
  }
  if (line) ctx.fillText(line, x, y + n * lineH)
}

const VIEW_LABEL: Record<View, string> = { front: 'front', three_quarter: '3/4', side: 'side', back: 'back', side_2: 'side 2' }

async function renderImage(req: JobRequest, input: Input): Promise<RenderedOutput> {
  const inp = req.input
  const n = req.jobId.charCodeAt(req.jobId.length - 1)
  if (req.op === 'combine') {
    const { c, ctx } = canvas(768, 1024)
    paper(ctx, 768, 1024, n)
    const refs = inp.refs ?? []
    const imgs = (await Promise.all(refs.map((r) => bitmap(input, r.asset.sha256)))).filter(Boolean) as ImageBitmap[]
    imgs.forEach((img, i) => {
      ctx.globalAlpha = i === 0 ? 1 : 0.55
      contain(ctx, img, 40, 40, 688, 900, { scale: 1 - i * 0.12 })
    })
    ctx.globalAlpha = 1
    stamp(ctx, 768, 1024, `combine · ${inp.text ?? ''}`)
    return { blob: await toBlob(c), mime: 'image/png', w: 768, h: 1024 }
  }
  if (req.op === 'region_edit') {
    const img = await bitmap(input, inp.image?.sha256)
    const w = img?.width ?? 768
    const h = img?.height ?? 1024
    const { c, ctx } = canvas(w, h)
    paper(ctx, w, h, n)
    if (img) ctx.drawImage(img, 0, 0)
    if (inp.region) {
      const r = inp.region
      ctx.fillStyle = 'rgba(255,79,46,0.28)'
      ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h)
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 4
      ctx.setLineDash([12, 8])
      ctx.strokeRect(r.x * w, r.y * h, r.w * w, r.h * h)
      ctx.setLineDash([])
    }
    stamp(ctx, w, h, `edit · ${inp.text ?? ''}`)
    return { blob: await toBlob(c), mime: 'image/png', w, h }
  }
  if (req.op === 'frame') {
    const { w, h } = sizeFor(inp.ratio ?? '9:16')
    const { c, ctx } = canvas(w, h)
    paper(ctx, w, h, (inp.shot?.order ?? 1) * 3 + n)
    const lead = inp.shot?.lead_view ?? 'front'
    const img = (await bitmap(input, inp.character?.[lead]?.sha256)) ?? (await bitmap(input, inp.character?.front.sha256))
    const scale = { wide: 0.45, medium: 0.7, close: 1.05, extreme_close: 1.6, over_shoulder: 0.8, insert: 0.6 }[inp.shot?.composition ?? 'medium'] ?? 0.7
    if (img) contain(ctx, img, 0, h * 0.08, w, h * 0.84, { scale })
    ctx.fillStyle = INK
    ctx.font = `600 ${Math.round(w * 0.04)}px Geist, Helvetica, Arial, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    wrapText(ctx, inp.text || inp.shot?.action || '', w * 0.06, h * 0.04, w * 0.88, w * 0.05, 3)
    stamp(ctx, w, h, `shot ${inp.shot?.order ?? ''} · ${inp.shot?.composition ?? ''} · ${inp.shot?.camera_move ?? ''}`)
    return { blob: await toBlob(c), mime: 'image/png', w, h }
  }
  // generate, view
  const { c, ctx } = canvas(768, 1024)
  paper(ctx, 768, 1024, n)
  const source = req.op === 'view' ? inp.character?.front.sha256 : inp.sketch?.sha256 ?? inp.refs?.[0]?.asset.sha256
  const img = await bitmap(input, source)
  const view = inp.view
  if (img) {
    if (view === 'back') ctx.filter = 'grayscale(1) brightness(0.8)'
    contain(ctx, img, 60, 60, 648, 860, { mirror: view === 'side' || view === 'side_2', scale: view === 'three_quarter' ? 0.92 : 1 })
    ctx.filter = 'none'
  }
  if (req.op === 'generate') {
    const refs = (await Promise.all((inp.refs ?? []).slice(0, 4).map((r) => bitmap(input, r.asset.sha256)))).filter(Boolean) as ImageBitmap[]
    refs.forEach((r, i) => {
      ctx.fillStyle = '#fff'
      ctx.fillRect(16 + i * 92, 16, 84, 84)
      contain(ctx, r, 18 + i * 92, 18, 80, 80)
    })
  }
  stamp(ctx, 768, 1024, req.op === 'view' ? `view · ${VIEW_LABEL[view ?? 'front']}` : `front view · ${inp.text ?? ''}`)
  return { blob: await toBlob(c), mime: 'image/png', w: 768, h: 1024 }
}

// ── Clips: a canvas animation recorded with MediaRecorder ───────────────────

const CLIP_MAX_S = 4

function recorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return null
}

async function record(w: number, h: number, seconds: number, draw: (ctx: CanvasRenderingContext2D, t: number) => void | Promise<void>): Promise<RenderedOutput> {
  const mime = recorderMime()
  if (!mime) throw new Error('This browser cannot record mock clips.')
  const { c, ctx } = canvas(w, h)
  const stream = c.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()))
  await draw(ctx, 0)
  rec.start(250)
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const tick = async () => {
      const t = (performance.now() - start) / 1000
      if (t >= seconds) return resolve()
      await draw(ctx, t)
      // rAF stops in background tabs; fall back to a timer.
      setTimeout(tick, 33)
    }
    tick()
  })
  rec.stop()
  await stopped
  stream.getTracks().forEach((t) => t.stop())
  const type = mime.split(';')[0]
  return { blob: new Blob(chunks, { type }), mime: type, w, h, durationS: seconds }
}

function timecode(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, label: string) {
  ctx.fillStyle = 'rgba(20,22,27,0.8)'
  ctx.fillRect(0, h - 34, w, 34)
  ctx.fillStyle = '#fff'
  ctx.font = '600 15px Geist Mono, monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(`MOCK · ${label}`, 12, h - 17)
  ctx.textAlign = 'right'
  ctx.fillText(`${t.toFixed(1)}s`, w - 12, h - 17)
  ctx.save()
  ctx.font = `900 ${Math.round(Math.min(w, h) * 0.16)}px Geist, Helvetica, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,79,46,0.22)'
  ctx.fillText('MOCK', w / 2, h / 2)
  ctx.restore()
}

async function loadVideo(blob: Blob): Promise<HTMLVideoElement> {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.src = URL.createObjectURL(blob)
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve()
    v.onerror = () => reject(new Error('Could not read the clip.'))
  })
  return v
}

async function renderClip(req: JobRequest, input: Input): Promise<RenderedOutput> {
  const inp = req.input
  const { w, h } = sizeFor(inp.ratio ?? '9:16', 640)
  const seconds = Math.min(CLIP_MAX_S, inp.shot?.duration_s ?? CLIP_MAX_S)
  if (req.op === 'clip_edit' && inp.video) {
    const blob = await input(inp.video.sha256)
    if (blob && blob.type.startsWith('video/')) {
      const v = await loadVideo(blob)
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration, CLIP_MAX_S) : seconds
      await v.play().catch(() => undefined)
      const strength = inp.feel?.strength
      const out = await record(w, h, dur, (ctx, t) => {
        ctx.filter = strength === 'reimagine' ? 'hue-rotate(150deg) saturate(1.6)' : strength === 'flex' ? 'hue-rotate(60deg)' : 'sepia(0.5)'
        contain(ctx, v, 0, 0, w, h)
        ctx.filter = 'none'
        if (inp.region) {
          const r = inp.region
          ctx.strokeStyle = ACCENT
          ctx.lineWidth = 3
          ctx.strokeRect(r.x * w, r.y * h, r.w * w, r.h * h)
        }
        ctx.fillStyle = INK
        ctx.font = '600 18px Geist, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillStyle = '#fff'
        wrapText(ctx, `edit: ${inp.text ?? ''}`, 14, 14, w - 28, 22, 2)
        timecode(ctx, w, h, t, 'edited clip')
      })
      v.pause()
      URL.revokeObjectURL(v.src)
      return out
    }
  }
  const img = (await bitmap(input, inp.image?.sha256)) ?? (await bitmap(input, inp.character?.front.sha256))
  const move = inp.shot?.camera_move ?? 'push_in'
  return record(w, h, seconds, (ctx, t) => {
    const p = t / seconds
    ctx.fillStyle = '#0F1114'
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    let zoom = 1
    let dx = 0
    let dy = 0
    if (move === 'push_in') zoom = 1 + 0.25 * p
    else if (move === 'pull_out') zoom = 1.25 - 0.25 * p
    else if (move === 'pan' || move === 'track') dx = (p - 0.5) * w * 0.2
    else if (move === 'tilt') dy = (p - 0.5) * h * 0.2
    else if (move === 'orbit') zoom = 1.1 + 0.05 * Math.sin(p * Math.PI * 2)
    else if (move === 'handheld') { dx = Math.sin(t * 9) * 6; dy = Math.cos(t * 7) * 6 }
    ctx.translate(w / 2 + dx, h / 2 + dy)
    ctx.scale(zoom, zoom)
    ctx.translate(-w / 2, -h / 2)
    if (img) contain(ctx, img, 0, 0, w, h, { scale: 1.02 })
    ctx.restore()
    timecode(ctx, w, h, t, `shot ${inp.shot?.order ?? ''} · ${move}`)
  })
}

async function renderStitch(req: JobRequest, input: Input): Promise<RenderedOutput> {
  const { w, h } = sizeFor(req.input.ratio ?? '9:16', 640)
  const clips: { v: HTMLVideoElement; dur: number }[] = []
  for (const c of req.input.clips ?? []) {
    const blob = await input(c.asset.sha256)
    if (!blob) continue
    const v = await loadVideo(blob)
    clips.push({ v, dur: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : CLIP_MAX_S })
  }
  const total = clips.reduce((s, c) => s + c.dur, 0) + 1
  let current = -1
  const out = await record(w, h, total, async (ctx, t) => {
    let acc = 0
    let idx = -1
    for (let i = 0; i < clips.length; i++) {
      if (t < acc + clips[i].dur) { idx = i; break }
      acc += clips[i].dur
    }
    if (idx >= 0) {
      if (idx !== current) {
        clips[current]?.v.pause()
        current = idx
        clips[idx].v.currentTime = 0
        await clips[idx].v.play().catch(() => undefined)
      }
      contain(ctx, clips[idx].v, 0, 0, w, h)
    } else {
      clips[current]?.v.pause()
      // The end card.
      ctx.fillStyle = '#14161B'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = ACCENT
      ctx.beginPath()
      ctx.arc(w / 2, h / 2 - 40, 26, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '700 22px Geist, sans-serif'
      ctx.fillText('Made with Napkin Studio OS', w / 2, h / 2 + 16)
      ctx.font = '500 15px Geist, sans-serif'
      ctx.fillText('MOCK render', w / 2, h / 2 + 46)
    }
  })
  clips.forEach((c) => URL.revokeObjectURL(c.v.src))
  return out
}

export const browserRenderer: MockRenderer = {
  async render(req, input) {
    switch (req.op) {
      case 'clip':
      case 'clip_edit':
        return [await renderClip(req, input)]
      case 'stitch':
        return [await renderStitch(req, input)]
      default:
        return [await renderImage(req, input)]
    }
  },
}
