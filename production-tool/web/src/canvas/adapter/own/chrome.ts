// CanvasChrome on our own engine (features/production-ui.clan): the bar's tools
// map onto the engine's (select, hand, pen and eraser; text, sketch areas and
// pictures are not on the own engine yet, so those buttons do nothing here), zoom
// keeps the middle of the view still, and fit uses the adapter's own fit.

import { fitView, nextZoom, scrollForZoom, type CanvasChrome, type ChromeTool } from '../../chrome/controls'
import type { OwnAdapter } from './adapter'

const TO_ENGINE: Partial<Record<ChromeTool, string>> = { select: 'selection', hand: 'hand', pen: 'freedraw', eraser: 'eraser' }
// The highlighter is the pen's other mode (the pen's options), so the pen stays lit.
const FROM_ENGINE: Record<string, ChromeTool> = { selection: 'select', hand: 'hand', freedraw: 'pen', pen: 'pen', highlighter: 'pen', eraser: 'eraser' }

export function ownChrome(a: OwnAdapter): CanvasChrome {
  const size = () => {
    const b = a.visibleBounds()
    const z = a.view().zoom
    return { w: (b.maxX - b.minX) * z, h: (b.maxY - b.minY) * z }
  }
  return {
    tool: () => {
      const t = a.activeTool()
      return t.type === 'native' ? FROM_ENGINE[t.id] ?? null : null
    },
    setTool: (t) => {
      const id = TO_ENGINE[t]
      if (id) a.setActiveTool({ type: 'native', id })
    },
    setPen: (p) => a.setPen(p),
    zoom: () => a.view().zoom,
    zoomBy: (step) => {
      const v = a.view()
      const to = nextZoom(v.zoom, step)
      const { w, h } = size()
      a.setViewport({ zoom: to, scrollX: scrollForZoom(v.scrollX, w, v.zoom, to), scrollY: scrollForZoom(v.scrollY, h, v.zoom, to) })
    },
    fitAll: () => {
      const els = a.elements()
      if (els.length) a.fit(els, { zoomFactor: 0.9, animate: false })
    },
    fitRect: (r) => {
      const { w, h } = size()
      a.setViewport(fitView(r, w, h))
    },
    onChange: (cb) => {
      let last = ''
      return a.onChange(() => {
        const t = a.activeTool()
        const sig = `${t.type}:${t.id}|${a.view().zoom}`
        if (sig !== last) {
          last = sig
          cb()
        }
      })
    },
  }
}
