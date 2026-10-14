// The own engine module (features/engine-adapter.clan): mount() puts a canvas in
// the host, keeps it at the host's size (device pixel ratio capped at 2, the
// canvas-engine memory cap), pans on wheel and zooms on ctrl+wheel, probes the
// pointer capabilities and feeds the adapter's pointer stream. Ink, selection
// and the real renderer come with engine-ink and engine-select.

import type { CanvasEngine, InputCapabilities, MountOptions, PointerSample } from '../../core/canvasAdapter'
import { OwnAdapter } from './adapter'
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

export const ownEngine: CanvasEngine = {
  id: 'own',
  async mount(host: HTMLElement, opts: MountOptions) {
    const adapter = new OwnAdapter(opts.initial)
    adapter.setTheme(opts.theme)
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block'
    host.appendChild(canvas)
    const ctx = canvas.getContext('2d') as unknown as Ctx2D
    const caps = probeCapabilities()
    let frame = 0
    const draw = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        adapter.drawTo(ctx, Math.min(2, devicePixelRatio || 1))
      })
    }
    const measure = () => {
      const r = host.getBoundingClientRect()
      const dpr = Math.min(2, devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(r.width * dpr))
      canvas.height = Math.max(1, Math.round(r.height * dpr))
      adapter.resize(r.width, r.height, r.left, r.top)
    }
    const offChange = adapter.onChange(() => {
      draw()
      opts.onChange()
    })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(host)
    measure()

    const toSample = (phase: PointerSample['phase'], e: PointerEvent): PointerSample => {
      const v = adapter.view()
      const at = (x: number, y: number) => adapter.viewportToScene({ x, y }, v)
      const p = at(e.clientX, e.clientY)
      const pointerType = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse'
      const pressure = pointerType === 'mouse' ? 0.5 : e.pressure || 0.5
      const s: PointerSample = { phase, x: p.x, y: p.y, pointerType, pressure }
      if (caps.coalesced && phase === 'move') s.coalesced = e.getCoalescedEvents().map((c) => ({ ...at(c.clientX, c.clientY), pressure: c.pressure || pressure }))
      if (caps.predicted && phase === 'move') s.predicted = e.getPredictedEvents().map((c) => ({ ...at(c.clientX, c.clientY), pressure: c.pressure || pressure }))
      if (caps.tilt && pointerType === 'pen') {
        s.tiltX = e.tiltX
        s.tiltY = e.tiltY
      }
      return s
    }
    let down = false
    const onDown = (e: PointerEvent) => {
      down = true
      canvas.setPointerCapture?.(e.pointerId)
      adapter.pointer(toSample('down', e))
    }
    const onMove = (e: PointerEvent) => {
      if (down) adapter.pointer(toSample('move', e))
    }
    const onUp = (e: PointerEvent) => {
      if (!down) return
      down = false
      adapter.pointer(toSample('up', e))
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = adapter.view()
      if (e.ctrlKey || e.metaKey) {
        const at = adapter.viewportToScene({ x: e.clientX, y: e.clientY }, v)
        const zoom = Math.min(30, Math.max(0.1, v.zoom * Math.exp(-e.deltaY * 0.01)))
        // Keep the point under the cursor where it is.
        adapter.setViewport({ zoom, scrollX: (e.clientX - v.offsetLeft) / zoom - at.x, scrollY: (e.clientY - v.offsetTop) / zoom - at.y })
      } else {
        adapter.setViewport({ scrollX: v.scrollX - e.deltaX / v.zoom, scrollY: v.scrollY - e.deltaY / v.zoom })
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    adapter.attach(() => {
      offChange()
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.remove()
    }, caps)
    if (opts.initial?.elements?.length) adapter.fit(adapter.elements(), { zoomFactor: 0.9, animate: false })
    draw()
    return adapter
  },
}
