// CanvasChrome on Excalidraw: the bar's tools are Excalidraw's own (the sketch area is drawn as a
// frame, which Generate turns into a ratio-locked area: features/frame-aspect.clan), zoom keeps the
// middle of the view still, and fit is Excalidraw's scrollToContent.

import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { fitView, nextZoom, scrollForZoom, type CanvasChrome, type ChromeTool } from '../../chrome/controls'
import { LIGHT_INK, resolveInk } from '../../../../../canvas-engine/src/ink/palette'

const TO_ENGINE: Record<ChromeTool, string> = {
  select: 'selection', hand: 'hand', pen: 'freedraw', text: 'text', sketch: 'frame', image: 'image', eraser: 'eraser',
}
const FROM_ENGINE: Record<string, ChromeTool> = Object.fromEntries(Object.entries(TO_ENGINE).map(([k, v]) => [v, k as ChromeTool]))

export function excalidrawChrome(api: ExcalidrawImperativeAPI): CanvasChrome {
  return {
    tool: () => FROM_ENGINE[api.getAppState().activeTool.type] ?? null,
    setTool: (t) => api.setActiveTool({ type: TO_ENGINE[t] as never }),
    // Excalidraw keeps literal colours and draws dark mode through its own invert filter, so the
    // pen's ink names go in as their light values (its own default ink works the same way).
    setPen: (p) => {
      const look = p[p.mode]
      api.updateScene({
        appState: {
          currentItemStrokeColor: resolveInk(look.color, LIGHT_INK),
          currentItemStrokeWidth: look.width / 2,
          currentItemOpacity: p.mode === 'highlighter' ? 35 : 100,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      })
    },
    zoom: () => api.getAppState().zoom.value,
    zoomBy: (step) => {
      const st = api.getAppState()
      const from = st.zoom.value
      const to = nextZoom(from, step)
      api.updateScene({
        appState: {
          zoom: { value: to as never },
          scrollX: scrollForZoom(st.scrollX, st.width, from, to),
          scrollY: scrollForZoom(st.scrollY, st.height, from, to),
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      })
    },
    fitAll: () => {
      const els = api.getSceneElements()
      if (els.length) api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.9, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
    },
    fitRect: (r) => {
      const st = api.getAppState()
      const v = fitView(r, st.width, st.height)
      api.updateScene({ appState: { zoom: { value: v.zoom as never }, scrollX: v.scrollX, scrollY: v.scrollY }, captureUpdate: CaptureUpdateAction.NEVER })
    },
    onChange: (cb) => {
      let last = ''
      return api.onChange((_els, st) => {
        const sig = `${st.activeTool.type}|${st.zoom.value}`
        if (sig !== last) {
          last = sig
          cb()
        }
      })
    },
  }
}
