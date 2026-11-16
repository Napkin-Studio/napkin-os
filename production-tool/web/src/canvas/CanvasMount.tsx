// Where the canvas engine goes on the page (features/engine-adapter.clan): picks
// the engine (engineChoice, engineToMount), loads it by dynamic import, mounts it
// into a host div and hands the adapter up through onReady. The stage never
// imports an engine; only this component reaches src/canvas/adapter/.

import { useEffect, useRef, useState } from 'react'
import { useServices } from '../app/context'
import { askedOwnAtLoad, converting, engineChoice, engineToMount, loadEngine } from './adapter'
import { idbPut } from '../lib/idb'
import type { CanvasChrome } from './chrome/controls'
import type { CanvasAdapter, CanvasSnapshot } from './core/canvasAdapter'
import { BoardLayer } from './boards/BoardLayer'
import { NodeLayer } from './nodes/NodeLayer'
import { CampaignLayer } from '../campaign/CampaignLayer'

export function CanvasMount({ initial, onReady, onChrome, onChange, theme, railInset = 0 }: {
  /** The saved scene to open with (read once, on mount). */
  initial: CanvasSnapshot | null
  onReady: (adapter: CanvasAdapter) => void
  /** The tool bar's and zoom pill's controls on the mounted engine (canvas/chrome/controls.ts). */
  onChrome?: (chrome: CanvasChrome) => void
  onChange: () => void
  theme: 'light' | 'dark'
  /** Screen pixels on the left the chrome covers (the board rail): board jumps keep them clear. */
  railInset?: number
}) {
  const host = useRef<HTMLDivElement>(null)
  const adapter = useRef<CanvasAdapter | null>(null)
  const { remoteConfig, clan, project } = useServices()
  // The store Worker's scene channel (features/engine-store.clan), when the project's store is one.
  const store = clan?.clan as { openScene?: (doc: never) => Promise<{ readOnly: string | null }> } | undefined
  const openScene = store?.openScene ? (doc: unknown) => store.openScene!(doc as never) : undefined
  // The own engine's adapter, for the node layer, and a tick that redraws it once a frame on change.
  const [own, setOwn] = useState<CanvasAdapter | null>(null)
  const [tick, setTick] = useState(0)
  const frame = useRef(0)
  const bump = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setTick((t) => t + 1)
    })
  }
  // The latest callbacks, without remounting the engine when they change.
  const cbs = useRef({ onReady, onChrome, onChange })
  useEffect(() => {
    cbs.current = { onReady, onChrome, onChange }
  }, [onReady, onChrome, onChange])

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
    const id = engineToMount(choice, initial, askedOwnAtLoad())
    // An Excalidraw scene opened on the own engine: its original is kept beside it, untouched.
    const kept = converting(id, initial) && project?.canvasKey
      ? idbPut('kv', `${project.canvasKey}.excalidraw`, initial).catch((e) => console.warn('the Excalidraw original was not kept', e))
      : Promise.resolve()
    void kept.then(() => loadEngine(id))
      .then((engine) => engine.mount(slot, { initial, onChange: () => { cbs.current.onChange(); bump() }, theme, openScene }))
      .then((a) => {
        mine = a
        if (gone) {
          a.destroy()
          slot.remove()
          return
        }
        adapter.current = a
        cbs.current.onReady(a)
        const chrome = a.chrome?.()
        if (chrome) cbs.current.onChrome?.(chrome)
        // The document's nodes are real elements on our own engine (features/canvas-nodes.clan).
        if (a.engine === 'own') setOwn(a)
      })
      .catch((e) => console.warn('the canvas engine did not load', e))
    return () => {
      gone = true
      if (mine) {
        mine.destroy()
        slot.remove()
      }
      if (adapter.current === mine) adapter.current = null
      setOwn(null)
    }
    // The engine mounts once per stage; theme changes go through setTheme below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    adapter.current?.setTheme(theme)
  }, [theme])

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0 }}>
      {own && <CampaignLayer canvas={own} tick={tick} />}
      {own && <NodeLayer canvas={own} tick={tick} />}
      {own && <BoardLayer canvas={own} inset={railInset} tick={tick} />}
    </div>
  )
}
