// The Excalidraw mount: the engine's component, its stylesheet, the tool's
// UIOptions and the first scene. It hands its adapter back through onReady.
// Only the component is exported here (react-refresh); the functions live in .ts files.

import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useCallback, useMemo } from 'react'
import { ExcalidrawAdapter } from './adapter'
import { excalidrawChrome } from './chrome'
import type { CanvasChrome } from '../../chrome/controls'
import type { FileMap, SceneElement } from './types'

export function CanvasView({ initial, onReady, onChrome, onChange, theme }: {
  /** The saved scene to open with (read once, on mount). */
  initial: { elements: SceneElement[]; files: FileMap } | null
  onReady: (adapter: ExcalidrawAdapter) => void
  /** The tool bar's and zoom pill's controls (canvas/chrome/controls.ts). */
  onChrome?: (chrome: CanvasChrome) => void
  onChange: () => void
  theme: 'light' | 'dark'
}) {
  const initialData = useMemo(() => {
    if (initial?.elements?.length) return { elements: initial.elements, files: initial.files, scrollToContent: true, appState: { viewBackgroundColor: 'transparent' } }
    return { elements: [], appState: { currentItemStrokeWidth: 2, viewBackgroundColor: 'transparent' } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Excalidraw calls this once, from its constructor, as it called setApi before.
  const onApi = useCallback((api: ExcalidrawImperativeAPI) => {
    onReady(new ExcalidrawAdapter(api))
    onChrome?.(excalidrawChrome(api))
  }, [onReady, onChrome])

  return (
    <Excalidraw
      excalidrawAPI={onApi}
      initialData={initialData}
      onChange={onChange}
      theme={theme}
      name="napkin-canvas"
      UIOptions={{
        canvasActions: { loadScene: false, export: false, saveToActiveFile: false, saveAsImage: false, toggleTheme: false, clearCanvas: true, changeViewBackgroundColor: true },
        tools: { image: true },
      }}
    />
  )
}
