// The node layer (features/canvas-nodes.clan): the document's nodes on the canvas
// as DOM slot cards (cards.tsx), positioned and scaled with the view, over any
// engine through CanvasAdapter v2. The canvas below does the selecting and moving
// (cards take no pointer except their buttons and ports); this layer seeds the
// nodes once, makes new ones (+ Node, through the chrome's actions), opens a node
// on double-click or Open, links nodes (the Link tool L, or a drag from a port;
// ui-behaviour 3.4), and keeps the document's links in step with the link elements.

import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { RouterContext, useDoc, useServices } from '../../app/context'
import { scriptRoute } from '../../app/route'
import { updateDoc } from '../../doc/store'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import { canLink, type LinkKind } from '../core/links'
import { canvasActions, toolLetter } from '../chrome/actions'
import type { CardKind } from './cardChrome'
import { NodeCard } from './cards'
import { cardOf, CARD_KINDS, createNode, linkCheck, linkNodes, reconcileLinks, seedNodes } from './nodes'
import './nodes.css'

type Local = { x: number; y: number }
const WORD: Record<CardKind, string> = { script: 'script', storyboard: 'storyboard', video: 'video' }
/** How long a new node keeps its "New" pill and halo (ui-behaviour 3.3). */
const NEW_MS = 4000

/** A link being made: from a port drag or the Link tool's source; `b` follows the pointer (`at`, in the scene). */
interface Drag { from: CanvasElement; a: Local; b: Local; at: Pt | null; by: 'port' | 'tool' }

export function NodeLayer({ canvas, tick }: { canvas: CanvasAdapter; tick: number }) {
  // The engine's host (this layer's parent): where double-clicks land and what positions are local to.
  const root = useRef<HTMLDivElement>(null)
  const doc = useDoc()
  const services = useServices()
  const router = useContext(RouterContext)
  const mode = useSyncExternalStore(canvasActions.subscribe, () => canvasActions.mode())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [refusal, setRefusal] = useState<{ at: Local; text: string } | null>(null)
  // Dropped on empty canvas: the kinds that can take this link (ui-behaviour 3.4 Dropping a link).
  const [picker, setPicker] = useState<{ from: CanvasElement; at: Local; scene: Pt; kinds: CardKind[] } | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const seen = useRef(new Set<string>())
  void tick

  const open = useCallback((kind: CardKind, id: string) => {
    if (kind === 'script') router?.push(scriptRoute(services.project.id, id))
    else services.ui.update((u) => {
      u.openNode = { ...u.openNode, [kind]: id }
      u.stage = kind
    })
  }, [router, services])

  const markNew = useCallback((id: string) => {
    setFresh((s) => new Set([...s, id]))
    setTimeout(() => setFresh((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    }), NEW_MS)
  }, [])

  // + Node: a new node of that kind (ui-behaviour 3.3), through the chrome's actions while mounted.
  useEffect(() => canvasActions.register({
    node: (kind) => {
      void createNode({ canvas, doc: services.doc }, kind).then((el) => markNew(el.id))
        .catch((e) => console.warn('the node was not made', e))
    },
  }), [canvas, services, markNew])

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
  const portOf = (from: CanvasElement) => toLocal(from.x + from.width, from.y + from.height / 2)

  const cancel = useCallback(() => {
    setDrag(null)
    setPicker(null)
    canvasActions.setMode(null)
  }, [])

  // The Link tool (L): when it comes on, the selected node is the source when there is one (keyboard
  // linking); when it goes off, its link in the making goes too.
  useEffect(() => {
    let was = canvasActions.mode()
    return canvasActions.subscribe(() => {
      const now = canvasActions.mode()
      if (now === was) return
      was = now
      if (now !== 'link') {
        setDrag((d) => (d?.by === 'tool' ? null : d))
        return
      }
      const sel = canvas.view().selectedIds.map((id) => canvas.elements().find((e) => e.id === id)).filter((e): e is CanvasElement => !!e && !!cardOf(e))
      if (sel.length === 1 && takers(sel[0]).length) setDrag({ from: sel[0], a: portOf(sel[0]), b: portOf(sel[0]), at: null, by: 'tool' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas])

  // L turns the Link tool on and off; Esc stops a link drag, the Link tool and the picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drag || picker || canvasActions.mode() === 'link') {
          e.preventDefault()
          cancel()
        }
        return
      }
      if (toolLetter(e) === 'l') {
        e.preventDefault()
        canvasActions.toggle('link')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag, picker, cancel])

  const writeLink = (from: CanvasElement, to: CanvasElement, at: Local) =>
    linkNodes(canvas, services.doc.get(), from, to, (link) => updateDoc(services.doc, (d) => { d.links[link.id] = link }, `link ${link.from.kind} to ${link.to.kind}`).then(() => {}))
      .then((r) => {
        if (!r.ok) setRefusal({ at, text: r.reason })
        return r.ok
      })
      .catch((err) => {
        setRefusal({ at, text: err instanceof Error ? err.message : 'That link was not made.' })
        return false
      })

  /** The kinds a new node could be to take a link from `from` (the picker on empty canvas). */
  function takers(from: CanvasElement): CardKind[] {
    const a = cardOf(from)
    return a ? CARD_KINDS.filter((k) => canLink(a.kind as LinkKind, k as LinkKind).ok) : []
  }

  /** A link released or clicked at a point: on a node, made or refused; on empty canvas, the picker. */
  const finish = (from: CanvasElement, cx: number, cy: number) => {
    const at = hostLocal(cx, cy)
    const scene = fromClient(cx, cy)
    const to = cardAt(scene)
    if (to) {
      if (to.id === from.id) return
      void writeLink(from, to, at).then((ok) => { if (ok) cancel() })
      return
    }
    const kinds = takers(from)
    if (kinds.length) setPicker({ from, at, scene, kinds })
    else cancel()
  }

  const startLink = (from: CanvasElement, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setPicker(null)
    setDrag({ from, a: portOf(from), b: hostLocal(e.clientX, e.clientY), at: fromClient(e.clientX, e.clientY), by: 'port' })
  }
  const follow = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, b: hostLocal(e.clientX, e.clientY), at: fromClient(e.clientX, e.clientY) })
  }
  const endLink = (e: React.PointerEvent) => {
    if (!drag) return
    const from = drag.from
    setDrag(null)
    finish(from, e.clientX, e.clientY)
  }

  // The Link tool's surface: click the source, then the target (ui-behaviour 3.4).
  const toolDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (picker) return setPicker(null)
    const el = cardAt(fromClient(e.clientX, e.clientY))
    if (!drag) {
      if (!el) return
      const c = cardOf(el)!
      if (!takers(el).length) {
        setRefusal({ at: hostLocal(e.clientX, e.clientY), text: `A ${WORD[c.kind]} feeds nothing on the canvas.` })
        return
      }
      canvas.select([el.id])
      setDrag({ from: el, a: portOf(el), b: hostLocal(e.clientX, e.clientY), at: fromClient(e.clientX, e.clientY), by: 'tool' })
      return
    }
    finish(drag.from, e.clientX, e.clientY)
  }

  const pick = (kind: CardKind) => {
    if (!picker) return
    const { from, scene, at } = picker
    setPicker(null)
    void createNode({ canvas, doc: services.doc }, kind, scene)
      .then((el) => {
        markNew(el.id)
        return writeLink(from, el, at)
      })
      .then(() => cancel())
      .catch((e) => console.warn('the node was not made', e))
  }

  const moving = canvas.dragOffset?.() ?? null
  const selected = new Set(view.selectedIds)
  const els = canvas.elements()
  const nodes = els.filter((e) => cardOf(e))
  // While a link is being made, compatible targets glow and the others dim, the one under the pointer with its reason.
  const source = drag?.from ?? null
  const checks = new Map(source ? nodes.filter((n) => n.id !== source.id).map((n) => [n.id, linkCheck(els, doc, source, n)] as const) : [])
  const hover = drag?.at ? cardAt(drag.at) : undefined
  const hoverCheck = hover ? checks.get(hover.id) : undefined
  const linking = mode === 'link'
  return (
    <div className={`node-layer ${source ? 'linking' : ''}`} ref={root}>
      {nodes.map((e) => {
        const c = cardOf(e)!
        const off = moving?.ids.has(e.id) ? moving : null
        const p = toLocal(e.x + (off?.dx ?? 0), e.y + (off?.dy ?? 0))
        const on = selected.has(e.id)
        const check = checks.get(e.id)
        const state = !source ? '' : e.id === source.id ? 'source' : check?.ok ? 'target' : 'dim'
        return (
          <div key={e.id} className={`bl-cardbox ${on ? 'selected' : ''} ${state} ${fresh.has(e.id) ? 'new' : ''}`} data-node={c.kind} data-id={c.id}
            style={{ left: p.x, top: p.y, width: e.width, height: e.height, transform: `scale(${view.zoom})` }}>
            <NodeCard kind={c.kind} id={c.id} onOpen={() => open(c.kind, c.id)} />
            {fresh.has(e.id) && <span className="nl-new">New</span>}
            {on && !linking && <span className="nl-port" role="button" aria-label={`Link from this ${c.kind}`} title="Drag to link (L)"
              style={{ left: e.width - 16, top: e.height / 2 }}
              onPointerDown={(ev) => startLink(e, ev)} onPointerMove={follow} onPointerUp={endLink} />}
          </div>
        )
      })}
      {linking && (
        <div className="nl-linkmode" role="application" aria-label="Link tool: click the node to link from, then the node it feeds"
          onPointerDown={toolDown} onPointerMove={follow} />
      )}
      {drag && drag.at && <svg className="nl-drag" aria-hidden="true"><line x1={drag.a.x} y1={drag.a.y} x2={drag.b.x} y2={drag.b.y} /></svg>}
      {drag && hover && hoverCheck && (
        <span className={`nl-tip ${hoverCheck.ok ? 'ok' : ''}`} role="status" style={{ left: drag.b.x, top: drag.b.y }}>
          {hoverCheck.ok ? `${drag.by === 'port' ? 'Drop' : 'Click'} to link · ${hoverCheck.role}` : hoverCheck.reason}
        </span>
      )}
      {linking && (
        <div className="nl-hint" role="status">
          <b>Link</b>
          <span>{source ? `Click the node this ${WORD[cardOf(source)!.kind]} feeds, or empty canvas for a new one` : 'Click the node to link from'}</span>
          <span className="nl-key">Esc cancels</span>
        </div>
      )}
      {picker && (
        <div className="nl-picker pt-panel" role="menu" aria-label="New node for this link" style={{ left: picker.at.x, top: picker.at.y }}>
          {picker.kinds.map((k) => (
            <button key={k} type="button" role="menuitem" className="pt-menurow" onClick={() => pick(k)}>
              New {WORD[k]} from this {WORD[cardOf(picker.from)!.kind]}
            </button>
          ))}
          <button type="button" role="menuitem" className="pt-menurow" onClick={cancel}>Cancel</button>
        </div>
      )}
      {refusal && <span className="nl-refusal" role="status" style={{ left: refusal.at.x, top: refusal.at.y }}>{refusal.text}</span>}
    </div>
  )
}
