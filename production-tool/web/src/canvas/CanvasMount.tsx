// Where the canvas engine goes on the page (features/engine-adapter.clan): picks
// the engine (engineChoice, engineToMount), loads it by dynamic import, mounts it
// into a host div and hands the adapter up through onReady. The stage never
// imports an engine; only this component reaches src/canvas/adapter/.

import { useEffect, useRef } from 'react'
import { useServices } from '../app/context'
import { engineChoice, engineToMount, loadEngine } from './adapter'
import type { CanvasAdapter, CanvasSnapshot } from './core/canvasAdapter'

export function CanvasMount({ initial, onReady, onChange, theme }: {
  /** The saved scene to open with (read once, on mount). */
  initial: CanvasSnapshot | null
  onReady: (adapter: CanvasAdapter) => void
  onChange: () => void
  theme: 'light' | 'dark'
}) {
  const host = useRef<HTMLDivElement>(null)
  const adapter = useRef<CanvasAdapter | null>(null)
  const { remoteConfig } = useServices()
  // The latest callbacks, without remounting the engine when they change.
  const cbs = useRef({ onReady, onChange })
  useEffect(() => {
    cbs.current = { onReady, onChange }
  }, [onReady, onChange])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let gone = false
    const choice = engineChoice(globalThis.location?.search ?? '', remoteConfig?.flags)
    void loadEngine(engineToMount(choice, initial))
      .then((engine) => engine.mount(el, { initial, onChange: () => cbs.current.onChange(), theme }))
      .then((a) => {
        if (gone) return a.destroy()
        adapter.current = a
        cbs.current.onReady(a)
      })
      .catch((e) => console.warn('the canvas engine did not load', e))
    return () => {
      gone = true
      adapter.current?.destroy()
      adapter.current = null
    }
    // The engine mounts once per stage; theme changes go through setTheme below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    adapter.current?.setTheme(theme)
  }, [theme])

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />
}
