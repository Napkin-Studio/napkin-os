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
  const { remoteConfig, clan } = useServices()
  // The store Worker's scene channel (features/engine-store.clan), when the project's store is one.
  const store = clan?.clan as { openScene?: (doc: never) => Promise<{ readOnly: string | null }> } | undefined
  const openScene = store?.openScene ? (doc: unknown) => store.openScene!(doc as never) : undefined
  // The latest callbacks, without remounting the engine when they change.
  const cbs = useRef({ onReady, onChange })
  useEffect(() => {
    cbs.current = { onReady, onChange }
  }, [onReady, onChange])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let gone = false
    // Each mount gets its own slot: a mount that is cleaned up before its engine has loaded (React's
    // strict double effect) must never share a container with the next one.
    const slot = document.createElement('div')
    slot.style.cssText = 'position:absolute;inset:0'
    el.appendChild(slot)
    let mine: CanvasAdapter | null = null
    const choice = engineChoice(globalThis.location?.search ?? '', remoteConfig?.flags)
    void loadEngine(engineToMount(choice, initial))
      .then((engine) => engine.mount(slot, { initial, onChange: () => cbs.current.onChange(), theme, openScene }))
      .then((a) => {
        mine = a
        if (gone) {
          a.destroy()
          slot.remove()
          return
        }
        adapter.current = a
        cbs.current.onReady(a)
      })
      .catch((e) => console.warn('the canvas engine did not load', e))
    return () => {
      gone = true
      if (mine) {
        mine.destroy()
        slot.remove()
      }
      if (adapter.current === mine) adapter.current = null
    }
    // The engine mounts once per stage; theme changes go through setTheme below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    adapter.current?.setTheme(theme)
  }, [theme])

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />
}
