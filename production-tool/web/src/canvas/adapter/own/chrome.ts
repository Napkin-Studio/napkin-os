// CanvasChrome on our own engine (features/production-ui.clan): the bar's tools
// map onto the engine's (select, hand, pen and eraser; the Picture tool is the
// node layer's; text and sketch areas are not on the own engine yet), zoom
// keeps the middle of the view still, and fit uses the adapter's own fit.

import { fitView, nextZoom, scrollForZoom, type CanvasChrome, type ChromeTool } from '../../chrome/controls'
import type { OwnAdapter } from './adapter'
import { canvasActions } from '../../chrome/actions'

const TO_ENGINE: Partial<Record<ChromeTool, string>> = { select: 'selection', hand: 'hand', pen: 'freedraw', eraser: 'eraser' }
const FROM_ENGINE: Record<string, ChromeTool> = { selection: 'select', hand: 'hand', freedraw: 'pen', pen: 'pen', eraser: 'eraser' }

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
    // The Picture tool is the node layer's (canvas/nodes/pictures.ts): a file picker, then the pictures in view.
    // The engine's own sketch tool takes the next area's ratio when it has one (features/canvas-edit-tools.clan).
    setSketchRatio: (r) => (a as unknown as { setSketchRatio?: (r: string) => void }).setSketchRatio?.(r),
    supports: (t) => !!TO_ENGINE[t] || (t === 'image' && canvasActions.canPicture()),
    setTool: (t) => {
      if (t === 'image') {
        canvasActions.picture()
        return
      }
      const id = TO_ENGINE[t]
      if (id) a.setActiveTool({ type: 'native', id })
    },
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
