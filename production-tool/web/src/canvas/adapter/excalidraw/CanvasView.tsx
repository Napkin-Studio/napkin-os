// The Excalidraw mount: the engine's component, its stylesheet, the tool's
// UIOptions and the first scene. It hands the engine's API back through onApi;
// engine.ts wraps it in the adapter. Only the component is exported here
// (react-refresh); the functions live in .ts files.

import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useMemo } from 'react'
import type { FileMap, SceneElement } from './types'

export function CanvasView({ initial, onApi, onChange, theme }: {
  /** The saved scene to open with (read once, on mount). */
  initial: { elements: SceneElement[]; files: FileMap } | null
  /** Excalidraw calls this once, from its constructor. */
  onApi: (api: ExcalidrawImperativeAPI) => void
  onChange: () => void
  theme: 'light' | 'dark'
}) {
  const initialData = useMemo(() => {
    if (initial?.elements?.length) return { elements: initial.elements, files: initial.files, scrollToContent: true }
    return { elements: [], appState: { currentItemStrokeWidth: 2 } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
