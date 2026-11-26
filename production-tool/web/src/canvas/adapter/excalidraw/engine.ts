// The Excalidraw engine module (features/engine-adapter.clan): mount() renders
// CanvasView into the host in its own React root and resolves with the adapter
// once Excalidraw hands over its API. src/canvas/adapter/index.ts loads this
// file by dynamic import, so Excalidraw is only fetched when it is the engine.

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { CanvasEngine, MountOptions } from '../../core/canvasAdapter'
import { ExcalidrawAdapter } from './adapter'
import { CanvasView } from './CanvasView'
import type { FileMap, SceneElement } from './types'

export const excalidrawEngine: CanvasEngine = {
  id: 'excalidraw',
  mount(host: HTMLElement, opts: MountOptions) {
    return new Promise((resolve) => {
      const root = createRoot(host)
      const initial = opts.initial as { elements: SceneElement[]; files: FileMap } | null
      let adapter: ExcalidrawAdapter | null = null
      const render = (theme: 'light' | 'dark') => root.render(createElement(CanvasView, {
        initial,
        onApi: (api) => {
          if (adapter) return
          // Unmounting inside another root's commit (the stage's effect cleanup) is deferred a task.
          adapter = new ExcalidrawAdapter(api, { setTheme: render, destroy: () => void setTimeout(() => root.unmount(), 0) })
          resolve(adapter)
        },
        onChange: opts.onChange,
        theme,
      }))
      render(opts.theme)
    })
  },
}
