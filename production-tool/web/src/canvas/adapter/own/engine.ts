// The own engine module (features/engine-adapter.clan, features/engine-ink.clan):
// mount() opens the scene's Y.Doc through the store Worker, puts the main canvas
// (canvas-engine's Renderer) and a live-ink canvas on top of it into the host,
// keeps them at the host's size (device pixel ratio capped at 2), and runs every
// pointer through canvas-engine's InputRouter: ink, highlighter and eraser go to
// the Ink tools, pans and pinches move the view, a palm landing just before the
// pen is reverted, pen hover draws an 18 px ring, and everything else (press,
// drag, tap, undo, redo, long press) is handed on for engine-select.

import * as Y from 'yjs'
import { drawDpr, INK_COLOURS, LIGHT_INK, liveOutline, Renderer, resolveInk, type Bitmap, type InkPalette, type Intent, type RawPointer } from '../../../../../canvas-engine/src'
import { aspectLabel } from '../../core/sketch'
import { RATIOS, type Ratio } from '../../../contracts/types'
import type { CanvasEngine, InputCapabilities, MountOptions, PointerSample } from '../../core/canvasAdapter'
import { OwnAdapter, type Surface } from './adapter'
import type { Ctx2D } from './draw'

/** What this browser's pointer events can carry (ui-behaviour 8; fallbacks are raw events and pressure only). */
export function probeCapabilities(): InputCapabilities {
  const pe = typeof PointerEvent !== 'undefined' ? PointerEvent.prototype : undefined
  return {
    coalesced: !!pe && 'getCoalescedEvents' in pe,
    predicted: !!pe && 'getPredictedEvents' in pe,
    tilt: !!pe && 'tiltX' in pe,
    pressure: !!pe && 'pressure' in pe,
  }
}

/** Single-key tools on the canvas until the toolbar offers them (ui-behaviour 7). */
const TOOL_KEYS: Record<string, string> = { v: 'selection', p: 'freedraw', e: 'eraser', h: 'hand', m: 'highlighter', s: 'sketch' }

/**
 * The canvas's surface from the chrome's tokens on the host (styles.css: --line, --tool, --ink2,
 * --canvas-bg, --r-board): transparent over the chrome's grid, boards as production-ui drew them.
 * Without the tokens (a bare host) it keeps the plain canvas.
 */
export function surfaceOf(host: HTMLElement, theme: 'light' | 'dark'): Surface {
  const css = typeof getComputedStyle === 'function' ? getComputedStyle(host) : null
  const v = (name: string) => css?.getPropertyValue(name).trim() ?? ''
  if (!v('--line')) return { background: theme === 'dark' ? '#121212' : '#ffffff', board: null, link: null }
  // The ink names' values in this theme: --pen-ink, --pen-orange… (styles.css), the light ones when a token is missing.
  const ink = Object.fromEntries(INK_COLOURS.map((c) => [c, v(`--pen-${c}`) || LIGHT_INK[c]])) as InkPalette
  return {
    background: 'transparent',
    ink,
    board: {
      fill: theme === 'dark' ? 'rgba(22, 26, 31, 0.45)' : 'rgba(255, 255, 255, 0.55)',
      stroke: v('--line'),
      current: v('--tool') || '#2F64F5',
      radius: parseFloat(v('--r-board')) || 16,
      title: v('--ink2') || '#4A4F5C',
      titleBg: v('--canvas-bg') || (theme === 'dark' ? '#121417' : '#FAFAFB'),
    },
    link: {
      stroke: v('--ink') || '#16181D',
      lit: v('--tool') || '#2F64F5',
      label: v('--ink2') || '#4A4F5C',
      labelBg: v('--card') || '#FFFFFF',
      labelLine: v('--line'),
      roles: ['drives'],
    },
  }
}

const layer = (host: HTMLElement, z: number) => {
  const c = document.createElement('canvas')
  c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block;z-index:${z}`
  host.appendChild(c)
  return c
}

export const ownEngine: CanvasEngine = {
  id: 'own',
  async mount(host: HTMLElement, opts: MountOptions) {
    const doc = new Y.Doc()
    const opened = opts.openScene ? await opts.openScene(doc).catch((e) => {
      console.warn('the scene did not open from the store', e)
      return { readOnly: null }
    }) : { readOnly: null }
    const adapter = new OwnAdapter(opts.initial, { doc })
    adapter.setTheme(opts.theme)
    // Select first, as Excalidraw opens: the tool bar's pen (P) draws.
    adapter.setActiveTool({ type: 'native', id: 'selection' })
    adapter.surfaceFor = (theme) => surfaceOf(host, theme)
    adapter.focusCanvas = () => host.focus({ preventScroll: true })
    const main = layer(host, 0)
    const live = layer(host, 1)
    live.style.pointerEvents = 'auto'
    main.style.pointerEvents = 'none'
    // Transparent, so the chrome's dot grid under the canvas shows through (mock Main).
    const ctx = main.getContext('2d') as unknown as Ctx2D
    const lctx = live.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D
    const renderer = new Renderer(adapter.scene, {
      newPath: () => new Path2D(),
      bitmap: (sha) => adapter.imageFor(sha) as unknown as Bitmap | undefined,
    })
    adapter.useRenderer(renderer)
    const caps = probeCapabilities()
    let frame = 0
    let hover: { x: number; y: number; r: number } | null = null
    let shift = false
    // The canvas keeps its own undo and Delete (ui/undoKeys.ts reads this), as Excalidraw's does.
    host.dataset.ownCanvas = ''
    host.tabIndex = 0
    host.style.outline = 'none'

    const drawLive = () => {
      const dpr = drawDpr(devicePixelRatio)
      const v = adapter.view()
      lctx.setTransform(1, 0, 0, 1, 0, 0)
      lctx.clearRect(0, 0, live.width, live.height)
      const s = adapter.ink.live()
      if (s && s.tool !== 'eraser' && s.points.length) {
        lctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.zoom * v.scrollX, dpr * v.zoom * v.scrollY)
        const outline = liveOutline(s.points, s.style.width)
        if (outline.length) {
          const p = new Path2D()
          p.moveTo(outline[0][0], outline[0][1])
          for (const q of outline.slice(1)) p.lineTo(q[0], q[1])
          p.closePath()
          lctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1
          lctx.fillStyle = resolveInk(s.style.color, adapter.inkPalette())
          lctx.fill(p)
          lctx.globalAlpha = 1
        }
      }
      const sel = adapter.selector
      if (sel.marquee || sel.lasso) {
        lctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.zoom * v.scrollX, dpr * v.zoom * v.scrollY)
        lctx.strokeStyle = '#4a7fd4'
        lctx.fillStyle = 'rgba(74, 127, 212, 0.08)'
        lctx.lineWidth = 1 / v.zoom
        lctx.beginPath()
        if (sel.marquee) lctx.rect(sel.marquee.x0, sel.marquee.y0, sel.marquee.x1 - sel.marquee.x0, sel.marquee.y1 - sel.marquee.y0)
        else if (sel.lasso?.length) {
          lctx.moveTo(sel.lasso[0].x, sel.lasso[0].y)
          for (const p of sel.lasso.slice(1)) lctx.lineTo(p.x, p.y)
          lctx.closePath()
        }
        lctx.fill()
        lctx.stroke()
      }
      // The sketch area ghost: dashed, locked to its ratio, its size label above and the hint under it (ui-behaviour 3.7).
      const g = adapter.sketch.ghost
      if (g && g.w > 0) {
        lctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.zoom * v.scrollX, dpr * v.zoom * v.scrollY)
        lctx.strokeStyle = '#2F64F5'
        lctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
        lctx.lineWidth = 1.5 / v.zoom
        lctx.setLineDash([6 / v.zoom, 4 / v.zoom])
        lctx.fillRect(g.x, g.y, g.w, g.h)
        lctx.strokeRect(g.x, g.y, g.w, g.h)
        lctx.setLineDash([])
        const [w, h] = g.ratio.split(':').map(Number)
        const label = (RATIOS as readonly string[]).includes(g.ratio) ? aspectLabel({ w, h }) : g.ratio
        lctx.font = `${11 / v.zoom}px 'Geist Mono', monospace`
        lctx.fillStyle = '#1E4ED8'
        lctx.fillText(label, g.x, g.y - 6 / v.zoom)
        lctx.font = `${12 / v.zoom}px Geist, sans-serif`
        lctx.fillStyle = '#6B7180'
        lctx.fillText(`Drag to draw · keeps ${g.ratio as Ratio}`, g.x, g.y + g.h + 16 / v.zoom)
      }
      if (hover) {
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        lctx.strokeStyle = '#4a7fd4'
        lctx.lineWidth = 1.5
        lctx.beginPath()
        lctx.arc(hover.x, hover.y, hover.r, 0, Math.PI * 2)
        lctx.stroke()
      }
    }
    const draw = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        adapter.drawTo(ctx, drawDpr(devicePixelRatio))
        drawLive()
      })
    }
    const measure = () => {
      const r = host.getBoundingClientRect()
      const dpr = drawDpr(devicePixelRatio)
      for (const c of [main, live]) {
        c.width = Math.max(1, Math.round(r.width * dpr))
        c.height = Math.max(1, Math.round(r.height * dpr))
      }
      adapter.resize(r.width, r.height, r.left, r.top)
    }
    const offChange = adapter.onChange(() => {
      draw()
      opts.onChange()
    })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(host)
    measure()

    const toScene = (x: number, y: number) => adapter.viewportToScene({ x, y }, adapter.view())
    const local = (x: number, y: number) => {
      const r = host.getBoundingClientRect()
      return { x: x - r.left, y: y - r.top }
    }
    const act = (i: Intent) => {
      switch (i.kind) {
        case 'ink-start':
          adapter.ink.begin(adapter.inkTool, { ...toScene(i.at.x, i.at.y), pressure: i.at.pressure }, adapter.inkStyle)
          break
        case 'ink-move':
          adapter.ink.add(i.points.map((p) => ({ ...toScene(p.x, p.y), pressure: p.pressure })))
          break
        case 'ink-end':
          try {
            adapter.ink.end()
          } catch (e) {
            console.warn('the stroke was not kept', e)
          }
          break
        case 'ink-cancel':
          adapter.ink.cancel()
          break
        case 'pan':
        case 'palm-revert': {
          const v = adapter.view()
          adapter.setViewport({ scrollX: v.scrollX + i.dx / v.zoom, scrollY: v.scrollY + i.dy / v.zoom })
          if (i.kind === 'palm-revert') adapter.emitIntent(i)
          break
        }
        case 'pinch': {
          const v = adapter.view()
          const at = toScene(i.cx - i.dx, i.cy - i.dy)
          const zoom = Math.min(30, Math.max(0.1, v.zoom * i.scale))
          const c = local(i.cx, i.cy)
          adapter.setViewport({ zoom, scrollX: c.x / zoom - at.x, scrollY: c.y / zoom - at.y })
          break
        }
        case 'hover': {
          const c = local(i.x, i.y)
          hover = { x: c.x, y: c.y, r: i.radius }
          break
        }
        case 'hover-end':
          hover = null
          break
        case 'press':
          adapter.press(toScene(i.x, i.y), { shift, by: i.by })
          break
        case 'drag':
          adapter.drag(toScene(i.x, i.y))
          break
        case 'release':
          try {
            adapter.release(toScene(i.x, i.y))
          } catch (e) {
            console.warn('the move was not kept', e)
          }
          break
        case 'undo':
        case 'redo':
          adapter.undoScene(i.kind)
          adapter.emitIntent(i)
          break
        default:
          adapter.emitIntent(i)
      }
      draw()
    }

    const raw = (phase: RawPointer['phase'], e: PointerEvent): RawPointer => {
      const pointerType = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse'
      const p: RawPointer = { phase, id: e.pointerId, type: pointerType, x: e.clientX, y: e.clientY, pressure: e.pressure || 0.5, buttons: e.buttons, t: e.timeStamp }
      if (phase === 'move' && caps.coalesced) p.coalesced = e.getCoalescedEvents().map((c) => ({ x: c.clientX, y: c.clientY, pressure: c.pressure || p.pressure }))
      if (phase === 'move' && caps.predicted) p.predicted = e.getPredictedEvents().map((c) => ({ x: c.clientX, y: c.clientY, pressure: c.pressure || p.pressure }))
      return p
    }
    // The CanvasAdapter pointer stream (overlays and the tool read it), in scene coordinates.
    const sample = (phase: PointerSample['phase'], e: PointerEvent) => {
      const p = toScene(e.clientX, e.clientY)
      const pointerType = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse'
      const s: PointerSample = { phase, x: p.x, y: p.y, pointerType, pressure: pointerType === 'mouse' ? 0.5 : e.pressure || 0.5 }
      if (caps.tilt && pointerType === 'pen') {
        s.tiltX = e.tiltX
        s.tiltY = e.tiltY
      }
      adapter.pointer(s)
    }
    const feed = (phase: RawPointer['phase']) => (e: PointerEvent) => {
      shift = e.shiftKey
      if (phase === 'down') host.focus({ preventScroll: true })
      if (phase === 'down') live.setPointerCapture?.(e.pointerId)
      if (phase === 'down' || phase === 'up') sample(phase, e)
      else if (phase === 'move' && e.buttons) sample('move', e)
      for (const i of adapter.router.handle(raw(phase, e))) act(i)
    }
    const handlers: [string, (e: PointerEvent) => void][] = [
      ['pointerdown', feed('down')], ['pointermove', feed('move')], ['pointerup', feed('up')], ['pointercancel', feed('cancel')], ['pointerleave', feed('leave')],
    ]
    for (const [name, fn] of handlers) live.addEventListener(name, fn as EventListener)
    let ticking = 0
    const tick = (t: number) => {
      for (const i of adapter.router.tick(t)) act(i)
      ticking = requestAnimationFrame(tick)
    }
    ticking = requestAnimationFrame(tick)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = adapter.view()
      if (e.ctrlKey || e.metaKey) {
        const at = toScene(e.clientX, e.clientY)
        const zoom = Math.min(30, Math.max(0.1, v.zoom * Math.exp(-e.deltaY * 0.01)))
        adapter.setViewport({ zoom, scrollX: (e.clientX - v.offsetLeft) / zoom - at.x, scrollY: (e.clientY - v.offsetTop) / zoom - at.y })
      } else {
        adapter.setViewport({ scrollX: v.scrollX - e.deltaX / v.zoom, scrollY: v.scrollY - e.deltaY / v.zoom })
      }
    }
    live.addEventListener('wheel', onWheel, { passive: false })
    // Keys on the canvas: this person's undo and redo, and Delete. Never while an IME is composing.
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        adapter.undoScene(e.shiftKey ? 'redo' : 'undo')
      } else if (mod && key === 'y') {
        e.preventDefault()
        adapter.undoScene('redo')
      } else if (mod && key === 'g') {
        // Group / ungroup (ui-behaviour 7), each one step of this person's.
        e.preventDefault()
        if (e.shiftKey) adapter.ungroup()
        else adapter.group()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && adapter.selector.selected.size) {
        e.preventDefault()
        adapter.selector.deleteSelected()
      } else if (e.key === 'Escape') {
        adapter.selector.cancel()
        adapter.sketch.cancel()
      }
      else if (!mod && !e.altKey && TOOL_KEYS[key]) adapter.setActiveTool({ type: 'native', id: TOOL_KEYS[key] })
      else return
      draw()
    }
    host.addEventListener('keydown', onKey)
    adapter.attach(() => {
      offChange()
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      cancelAnimationFrame(ticking)
      for (const [name, fn] of handlers) live.removeEventListener(name, fn as EventListener)
      live.removeEventListener('wheel', onWheel)
      host.removeEventListener('keydown', onKey)
      renderer.destroy()
      adapter.useRenderer(null)
      main.remove()
      live.remove()
    }, caps)
    if (opened.readOnly) console.warn(opened.readOnly)
    if (adapter.elements().length) adapter.fit(adapter.elements(), { zoomFactor: 0.9, animate: false })
    draw()
    return adapter
  },
}
