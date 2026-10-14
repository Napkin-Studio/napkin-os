// The node layer (features/canvas-nodes.clan): the document's nodes on the canvas
// as DOM slot cards (cards.tsx), positioned and scaled with the view, over any
// engine through CanvasAdapter v2. The canvas below does the selecting and moving
// (cards take no pointer except their buttons and ports); this layer seeds the
// nodes once, opens a node on double-click or Open, drags links out of ports, and
// keeps the document's links in step with the link elements.

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { RouterContext, useDoc, useServices } from '../../app/context'
import { scriptRoute } from '../../app/route'
import { updateDoc } from '../../doc/store'
import type { CanvasAdapter, CanvasElement } from '../core/canvasAdapter'
import type { CardKind } from './cardChrome'
import { NodeCard } from './cards'
import { cardOf, linkNodes, reconcileLinks, seedNodes } from './nodes'
import './nodes.css'

type Local = { x: number; y: number }

export function NodeLayer({ canvas, tick }: { canvas: CanvasAdapter; tick: number }) {
  // The engine's host (this layer's parent): where double-clicks land and what positions are local to.
  const root = useRef<HTMLDivElement>(null)
  const doc = useDoc()
  const services = useServices()
  const router = useContext(RouterContext)
  const [drag, setDrag] = useState<{ from: CanvasElement; a: Local; b: Local } | null>(null)
  const [refusal, setRefusal] = useState<{ at: Local; text: string } | null>(null)
  const seen = useRef(new Set<string>())
  void tick

  const open = useCallback((kind: CardKind, id: string) => {
    if (kind === 'script') router?.push(scriptRoute(services.project.id, id))
    else services.ui.update((u) => { u.stage = kind })
  }, [router, services])

  // Seed the nodes once, on a canvas that has none (a system write, nobody's step).
  useEffect(() => {
    const els = seedNodes(canvas, services.doc.get())
    if (els.length) canvas.transact((all) => [...all, ...els], { undoable: false })
  }, [canvas, services])

  // The document's links follow the link elements (a delete, or its undo). A link the document
  // refuses (its integrity check) is offered once a session, never again on every change.
  const offered = useRef(new Set<string>())
  useEffect(() => {
    const found = reconcileLinks(canvas.elements(), doc, seen.current)
    const unlink = found.unlink
    const relink = found.relink.filter((l) => !offered.current.has(l.id))
    for (const l of relink) offered.current.add(l.id)
    if (!unlink.length && !relink.length) return
    void updateDoc(services.doc, (d) => {
      for (const id of unlink) delete d.links[id]
      for (const l of relink) d.links[l.id] = l
    }, unlink.length ? `unlink ${unlink.length} on the canvas` : `link ${relink.length} on the canvas`).catch((e) => console.warn('could not keep the links in step', e))
  }, [canvas, doc, services, tick])

  const view = canvas.view()
  const toLocal = (x: number, y: number): Local => ({ x: (x + view.scrollX) * view.zoom, y: (y + view.scrollY) * view.zoom })
  const fromClient = (cx: number, cy: number) => canvas.viewportToScene({ x: cx, y: cy }, canvas.view())
  const cardAt = (p: { x: number; y: number }) => canvas.elements().filter((e) => cardOf(e) && p.x >= e.x && p.y >= e.y && p.x <= e.x + e.width && p.y <= e.y + e.height).at(-1)

  // Double-click a node to open it (ui-behaviour 3.3, plan 2.5).
  useEffect(() => {
    const host = root.current?.parentElement
    if (!host) return
    const onDbl = (e: MouseEvent) => {
      const el = cardAt(fromClient(e.clientX, e.clientY))
      const c = el && cardOf(el)
      if (!c) return
      e.preventDefault()
      e.stopPropagation()
      open(c.kind, c.id)
    }
    host.addEventListener('dblclick', onDbl, true)
    return () => host.removeEventListener('dblclick', onDbl, true)
  })

  useEffect(() => {
    if (!refusal) return
    const t = setTimeout(() => setRefusal(null), 3000)
    return () => clearTimeout(t)
  }, [refusal])

  const hostLocal = (cx: number, cy: number): Local => {
    const r = root.current?.parentElement?.getBoundingClientRect()
    return { x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) }
  }

  const startLink = (from: CanvasElement, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const a = toLocal(from.x + from.width, from.y + from.height / 2)
    setDrag({ from, a, b: hostLocal(e.clientX, e.clientY) })
  }
  const moveLink = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, b: hostLocal(e.clientX, e.clientY) })
  }
  const endLink = (e: React.PointerEvent) => {
    if (!drag) return
    const from = drag.from
    setDrag(null)
    const to = cardAt(fromClient(e.clientX, e.clientY))
    if (!to) return
    const at = hostLocal(e.clientX, e.clientY)
    void linkNodes(canvas, services.doc.get(), from, to, (link) => updateDoc(services.doc, (d) => { d.links[link.id] = link }, `link ${link.from.kind} to ${link.to.kind}`).then(() => {}))
      .then((r) => { if (!r.ok) setRefusal({ at, text: r.reason }) })
      .catch((err) => setRefusal({ at, text: err instanceof Error ? err.message : 'That link was not made.' }))
  }
  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrag(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag])

  const moving = canvas.dragOffset?.() ?? null
  const selected = new Set(view.selectedIds)
  const nodes = canvas.elements().filter((e) => cardOf(e))
  return (
    <div className="node-layer" ref={root}>
      {nodes.map((e) => {
        const c = cardOf(e)!
        const off = moving?.ids.has(e.id) ? moving : null
        const p = toLocal(e.x + (off?.dx ?? 0), e.y + (off?.dy ?? 0))
        const on = selected.has(e.id)
        return (
          <div key={e.id} className={`bl-cardbox ${on ? 'selected' : ''}`} data-node={c.kind}
            style={{ left: p.x, top: p.y, width: e.width, height: e.height, transform: `scale(${view.zoom})` }}>
            <NodeCard kind={c.kind} onOpen={() => open(c.kind, c.id)} />
            {on && <span className="nl-port" role="button" aria-label={`Link from this ${c.kind}`} title="Drag to link"
              style={{ left: e.width - 16, top: e.height / 2 }}
              onPointerDown={(ev) => startLink(e, ev)} onPointerMove={moveLink} onPointerUp={endLink} />}
          </div>
        )
      })}
      {drag && <svg className="nl-drag" aria-hidden="true"><line x1={drag.a.x} y1={drag.a.y} x2={drag.b.x} y2={drag.b.y} /></svg>}
      {refusal && <span className="nl-refusal" role="status" style={{ left: refusal.at.x, top: refusal.at.y }}>{refusal.text}</span>}
    </div>
  )
}
