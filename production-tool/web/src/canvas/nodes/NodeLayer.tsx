// The node layer (features/canvas-nodes.clan): the document's nodes on the canvas
// as DOM slot cards (cards.tsx), positioned and scaled with the view, over any
// engine through CanvasAdapter v2. The canvas below does the selecting and moving
// (cards take no pointer except their buttons and ports); this layer seeds the
// nodes once, makes new ones (+ Node, through the chrome's actions), opens a node
// on double-click or Open, links nodes (the Link tool L, or a drag from a port;
// ui-behaviour 3.4), and keeps the document's links in step with the link elements.
// Pictures that share a key are one group (keyGroups.ts; owner 2026-10-15): kept in step with the
// document, labelled "Samurai · 3 views", linked as the whole key (⌥ links one view), stacked or
// spread (stack.ts); a click on a stack opens it, a click on empty canvas folds back what a click
// opened, and a double-click picks one view out of its group.

import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { RouterContext, useDoc, useServices } from '../../app/context'
import { scriptRoute } from '../../app/route'
import { updateDoc } from '../../doc/store'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import type { LinkEndpoint } from '../../contracts/types'
import { canLink, type LinkKind } from '../core/links'
import { canvasActions, toolLetter } from '../chrome/actions'
import type { CardKind } from './cardChrome'
import { NodeCard } from './cards'
import { cardOf, CARD_KINDS, createNode, elementOfEnd, endOf, linkCheck, linkMemory, linkNodes, reconcileLinks, seedNodes } from './nodes'
import { imageFiles, pickPictureFiles, placePictures } from './pictures'
import { groupLabel, keyGroupFields, keyGroupOf, keyGroupsOn, type KeyGroup } from './keyGroups'
import { setStacked } from './stack'
import './nodes.css'

type Local = { x: number; y: number }
const WORD: Record<CardKind, string> = { script: 'script', storyboard: 'storyboard', video: 'video' }
/** How long a new node keeps its "New" pill and halo (ui-behaviour 3.3). */
const NEW_MS = 4000

/** A link being made: from a port drag or the Link tool's source; `b` follows the pointer (`at`, in the scene).
 *  `single`: ⌥ was held, so a key's view links as itself, not as its whole key. */
interface Drag { from: CanvasElement; a: Local; b: Local; at: Pt | null; by: 'port' | 'tool'; single?: boolean }

/** Motion unless the person asked for less (a stack then opens and folds at once). */
const motion = () => !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

export function NodeLayer({ canvas, tick }: { canvas: CanvasAdapter; tick: number }) {
  // The engine's host (this layer's parent): where double-clicks land and what positions are local to.
  const root = useRef<HTMLDivElement>(null)
  const doc = useDoc()
  const services = useServices()
  const router = useContext(RouterContext)
  const mode = useSyncExternalStore(canvasActions.subscribe, () => canvasActions.mode())
  const [drag, setDrag] = useState<Drag | null>(null)
  // "+ Link input" (3.16): the Link tool with a fixed target; the person clicks what feeds it. `at`: the pointer.
  const [into, setInto] = useState<{ el: CanvasElement; at: Pt | null } | null>(null)
  const intoNext = useRef<CanvasElement | null>(null)
  const [refusal, setRefusal] = useState<{ at: Local; text: string } | null>(null)
  // Dropped on empty canvas: the kinds that can take this link (ui-behaviour 3.4 Dropping a link).
  const [picker, setPicker] = useState<{ from: CanvasElement; at: Local; scene: Pt; kinds: CardKind[] } | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const seen = useRef(linkMemory())
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

  // Pictures (ui-behaviour 3.6, 3.18): the Picture tool's file picker, a dropped file, a pasted image.
  useEffect(() => {
    const place = (files: Blob[], at?: Pt) => {
      if (!files.length) return
      void placePictures(canvas, services.doc, files, at).catch((e) => console.warn('the pictures were not placed', e))
    }
    const off = canvasActions.register({ picture: () => void pickPictureFiles().then((f) => place(imageFiles(f))) })
    const host = root.current?.parentElement
    const onOver = (e: DragEvent) => {
      if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      const files = imageFiles(e.dataTransfer?.files)
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      place(files, canvas.viewportToScene({ x: e.clientX, y: e.clientY }, canvas.view()))
    }
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as { closest?: (s: string) => unknown } | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return
      if (host && e.target instanceof Node && e.target !== document.body && !host.contains(e.target)) return
      const files = imageFiles([...(e.clipboardData?.items ?? [])].flatMap((i) => (i.kind === 'file' ? [i.getAsFile()].filter((f): f is File => !!f) : [])))
      if (!files.length) return
      e.preventDefault()
      place(files)
    }
    host?.addEventListener('dragover', onOver)
    host?.addEventListener('drop', onDrop, true)
    window.addEventListener('paste', onPaste)
    return () => {
      off()
      host?.removeEventListener('dragover', onOver)
      host?.removeEventListener('drop', onDrop, true)
      window.removeEventListener('paste', onPaste)
    }
  }, [canvas, services])

  // Seed the nodes once, on a canvas that has none (a system write, nobody's step).
  useEffect(() => {
    const els = seedNodes(canvas, services.doc.get())
    if (els.length) canvas.transact((all) => [...all, ...els], { undoable: false })
  }, [canvas, services])

  // The document's links and the link elements follow each other, whoever wrote either: a delete or
  // its undo on the canvas, a link written elsewhere (an ask, another person), an inputs chip's ×.
  // A link the document refuses (its integrity check) is offered once a session, never again.
  const offered = useRef(new Set<string>())
  useEffect(() => {
    const found = reconcileLinks(canvas.elements(), doc, seen.current)
    const { unlink, draw, erase } = found
    const relink = found.relink.filter((l) => !offered.current.has(l.id))
    for (const l of relink) offered.current.add(l.id)
    if (draw.length || erase.length) {
      const gone = new Set(erase)
      canvas.transact((els) => {
        let all = els.map((e) => (gone.has(e.id) ? canvas.patch(e, { isDeleted: true }) : e))
        for (const d of draw) {
          const el = canvas.link({ fromElId: d.from.id, toElId: d.to.id, role: d.link.role, linkId: d.link.id })
          all = canvas.bindArrow([...all, el], el)
        }
        return all
      }, { undoable: false })
    }
    if (!unlink.length && !relink.length) return
    void updateDoc(services.doc, (d) => {
      for (const id of unlink) delete d.links[id]
      for (const l of relink) d.links[l.id] = l
    }, unlink.length ? `unlink ${unlink.length} on the canvas` : `link ${relink.length} on the canvas`).catch((e) => console.warn('could not keep the links in step', e))
  }, [canvas, doc, services, tick])

  // Key groups follow the document (a system write): naming or renaming a picture joins or leaves its
  // key's group at once, and a newly named view goes beside the others.
  useEffect(() => {
    const fields = keyGroupFields(canvas.elements(), doc)
    if (!fields.size) return
    canvas.transact((all) => all.map((e) => (fields.has(e.id) ? canvas.patch(e, fields.get(e.id)!) : e)), { undoable: false })
  }, [canvas, doc, tick])

  // A click (or tap) on a stack opens it; a click on empty canvas folds back what a click opened.
  const opened = useRef(new Set<string>())
  useEffect(() => {
    let down: { x: number; y: number; group: string | null; empty: boolean } | null = null
    const at = (p: Pt) => canvas.elements().filter((e) => !e.isDeleted && (e.customData as { kind?: string } | undefined)?.kind !== 'board' && e.type !== 'frame'
      && p.x >= e.x && p.y >= e.y && p.x <= e.x + e.width && p.y <= e.y + e.height).at(-1)
    return canvas.onPointer((p) => {
      if (canvasActions.mode() === 'link') return
      if (p.phase === 'down') {
        const hit = at(p)
        down = { x: p.x, y: p.y, group: keyGroupOf(hit), empty: !hit }
        return
      }
      if (p.phase !== 'up' || !down) return
      const was = down
      down = null
      if (Math.hypot(p.x - was.x, p.y - was.y) * canvas.view().zoom > 4) return
      const groups = keyGroupsOn(canvas.elements(), services.doc.get())
      if (was.group) {
        const g = groups.find((x) => x.key === was.group)
        if (g?.stacked && setStacked(canvas, g.members, false, { animate: motion() })) opened.current.add(g.key)
        return
      }
      if (!was.empty) return
      for (const key of opened.current) {
        const g = groups.find((x) => x.key === key)
        if (g && !g.stacked) setStacked(canvas, g.members, true, { animate: motion() })
      }
      opened.current.clear()
    })
  }, [canvas, services])

  const view = canvas.view()
  const toLocal = (x: number, y: number): Local => ({ x: (x + view.scrollX) * view.zoom, y: (y + view.scrollY) * view.zoom })
  const fromClient = (cx: number, cy: number) => canvas.viewportToScene({ x: cx, y: cy }, canvas.view())
  const inside = (e: CanvasElement, p: Pt) => p.x >= e.x && p.y >= e.y && p.x <= e.x + e.width && p.y <= e.y + e.height
  const cardAt = (p: Pt) => canvas.elements().filter((e) => cardOf(e) && inside(e, p)).at(-1)
  /** The link end at a point: a node card (they sit on top), else a picture or a sketch area. */
  const endAt = (p: Pt) => cardAt(p) ?? canvas.elements().filter((e) => !cardOf(e) && endOf(e, services.doc.get()) && inside(e, p)).at(-1)
  /** What an end is called in the hint and the picker. */
  const word = (e: CanvasElement) => {
    const c = cardOf(e)
    return c ? WORD[c.kind] : e.type === 'image' ? 'picture' : 'sketch area'
  }

  // Double-click a node to open it (ui-behaviour 3.3, plan 2.5).
  useEffect(() => {
    const host = root.current?.parentElement
    if (!host) return
    const onDbl = (e: MouseEvent) => {
      const p = fromClient(e.clientX, e.clientY)
      const el = cardAt(p)
      const c = el && cardOf(el)
      // A double-click on a picture in a group picks that one view (our own engine; Excalidraw does it itself).
      if (!c) {
        const own = canvas as CanvasAdapter & { pickOne?: (p: Pt) => string | null }
        if (own.pickOne && canvas.elements().some((x) => !x.isDeleted && (x.groupIds ?? []).length > 0 && inside(x, p))) own.pickOne(p)
        return
      }
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

  /** The key group the selection is, whole, if it is one. */
  function selectedKeyGroup(): KeyGroup | null {
    const ids = new Set(canvas.view().selectedIds)
    if (ids.size < 2) return null
    return keyGroupsOn(canvas.elements(), services.doc.get()).find((g) => g.members.length === ids.size && g.members.every((m) => ids.has(m.id))) ?? null
  }
  const boxOfAll = (es: readonly CanvasElement[]) => {
    const x0 = Math.min(...es.map((e) => e.x))
    const y0 = Math.min(...es.map((e) => e.y))
    return { x: x0, y: y0, w: Math.max(...es.map((e) => e.x + e.width)) - x0, h: Math.max(...es.map((e) => e.y + e.height)) - y0 }
  }

  const cancel = useCallback(() => {
    setDrag(null)
    setInto(null)
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
        setInto(null)
        return
      }
      const fixed = intoNext.current
      intoNext.current = null
      if (fixed) {
        setDrag(null)
        setInto({ el: fixed, at: null })
        return
      }
      const sel = canvas.view().selectedIds.map((id) => canvas.elements().find((e) => e.id === id)).filter((e): e is CanvasElement => !!e && !!endOf(e, services.doc.get()))
      // A key group selected links from its lead view: the whole key.
      const group = selectedKeyGroup()
      const from = group ? group.members[0] : sel.length === 1 ? sel[0] : undefined
      if (from && takers(from).length) setDrag({ from, a: portOf(from), b: portOf(from), at: null, by: 'tool' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas])

  // "+ Link input" from a node's inputs strip or its button here: the Link tool, into that node.
  const linkInto = useCallback((el: CanvasElement) => {
    intoNext.current = el
    setPicker(null)
    if (canvasActions.mode() === 'link') canvasActions.setMode(null)
    canvasActions.setMode('link')
  }, [])
  useEffect(() => canvasActions.register({
    linkInto: (node) => {
      const el = elementOfEnd(canvas.elements(), services.doc.get(), node as LinkEndpoint)
      if (el) linkInto(el)
    },
  }), [canvas, services, linkInto])

  // L turns the Link tool on and off; Esc stops a link drag, the Link tool and the picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drag || into || picker || canvasActions.mode() === 'link') {
          e.preventDefault()
          cancel()
        }
        return
      }
      const k = toolLetter(e)
      if (k === 'l') {
        e.preventDefault()
        canvasActions.toggle('link')
      } else if (k === 'i' && root.current?.parentElement?.contains(e.target as Node)) {
        // I: the Picture tool (ui-behaviour 7), from the canvas only.
        e.preventDefault()
        canvasActions.picture()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag, into, picker, cancel])

  const writeLink = (from: CanvasElement, to: CanvasElement, at: Local, single = false) =>
    linkNodes(canvas, services.doc.get(), from, to, (link) => updateDoc(services.doc, (d) => { d.links[link.id] = link }, `link ${link.from.kind} to ${link.to.kind}`).then(() => {}), { single })
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
    const a = endOf(from, services.doc.get())
    return a && !('refuse' in a) ? CARD_KINDS.filter((k) => canLink(a.core, k as LinkKind).ok) : []
  }

  /** A link released or clicked at a point: on a node, made or refused; on empty canvas, the picker. */
  const finish = (from: CanvasElement, cx: number, cy: number, single = false) => {
    const at = hostLocal(cx, cy)
    const scene = fromClient(cx, cy)
    const to = endAt(scene)
    if (to) {
      if (to.id === from.id) return
      void writeLink(from, to, at, single).then((ok) => { if (ok) cancel() })
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
    setDrag({ from, a: portOf(from), b: hostLocal(e.clientX, e.clientY), at: fromClient(e.clientX, e.clientY), by: 'port', single: e.altKey })
  }
  const follow = (e: React.PointerEvent) => {
    if (into) setInto({ ...into, at: fromClient(e.clientX, e.clientY) })
    if (drag) setDrag({ ...drag, b: hostLocal(e.clientX, e.clientY), at: fromClient(e.clientX, e.clientY) })
  }
  const endLink = (e: React.PointerEvent) => {
    if (!drag) return
    const from = drag.from
    setDrag(null)
    finish(from, e.clientX, e.clientY, drag.single || e.altKey)
  }

  // The Link tool's surface: click the source, then the target (ui-behaviour 3.4).
  const toolDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (picker) return setPicker(null)
    const el = endAt(fromClient(e.clientX, e.clientY))
    if (into) {
      // Linking into a fixed node: the click picks what feeds it.
      if (!el || el.id === into.el.id) return
      void writeLink(el, into.el, hostLocal(e.clientX, e.clientY), e.altKey).then((ok) => { if (ok) cancel() })
      return
    }
    if (!drag) {
      if (!el) return
      const end = endOf(el, services.doc.get())
      if (end && 'refuse' in end) {
        setRefusal({ at: hostLocal(e.clientX, e.clientY), text: end.refuse })
        return
      }
      if (!takers(el).length) {
        setRefusal({ at: hostLocal(e.clientX, e.clientY), text: `A ${word(el)} feeds nothing on the canvas.` })
        return
      }
      canvas.select([el.id])
      setDrag({ from: el, a: portOf(el), b: hostLocal(e.clientX, e.clientY), at: fromClient(e.clientX, e.clientY), by: 'tool', single: e.altKey })
      return
    }
    finish(drag.from, e.clientX, e.clientY, drag.single || e.altKey)
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
  // While a link is being made, compatible targets glow and the others dim (pictures and sketch areas
  // under a box drawn over them), the one under the pointer with its reason.
  // The fixed end: the source being linked from, or the node being linked into ("+ Link input").
  const source = drag?.from ?? into?.el ?? null
  const ends = source ? els.filter((e) => e.id !== source.id && endOf(e, doc)) : []
  const checks = new Map(ends.map((n) => [n.id, into && !drag ? linkCheck(els, doc, n, into.el) : linkCheck(els, doc, source!, n, { single: drag?.single })] as const))
  const pointerAt = drag?.at ?? into?.at ?? null
  const hover = pointerAt ? endAt(pointerAt) : undefined
  // A selected picture or sketch area gets a port too (single selection).
  const lone = view.selectedIds.length === 1 ? els.find((e) => e.id === view.selectedIds[0] && !cardOf(e)) : undefined
  const lonePort = lone && mode !== 'link' && endOf(lone, doc) ? lone : undefined
  // The key groups, labelled; one selected whole gets a port at its right edge (it links the key).
  const groups = keyGroupsOn(els, doc)
  const groupSel = mode !== 'link' ? selectedKeyGroup() : null
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
            {on && !linking && <button type="button" className="nl-linkin" style={{ top: e.height + 10 }} title="Link something into this node (a picture, a script…)"
              onPointerDown={(ev) => ev.stopPropagation()} onClick={() => linkInto(e)}>+ Link input</button>}
            {on && !linking && <span className="nl-port" role="button" aria-label={`Link from this ${c.kind}`} title="Drag to link (L)"
              style={{ left: e.width - 16, top: e.height / 2 }}
              onPointerDown={(ev) => startLink(e, ev)} onPointerMove={follow} onPointerUp={endLink} />}
          </div>
        )
      })}
      {source && ends.filter((e) => !cardOf(e)).map((e) => {
        const p = toLocal(e.x, e.y)
        const state = checks.get(e.id)?.ok ? 'target' : 'dim'
        return <span key={e.id} className={`nl-endbox ${state}`} style={{ left: p.x, top: p.y, width: e.width * view.zoom, height: e.height * view.zoom }} />
      })}
      {source && !cardOf(source) && (() => {
        const p = toLocal(source.x, source.y)
        return <span className="nl-endbox source" style={{ left: p.x, top: p.y, width: source.width * view.zoom, height: source.height * view.zoom }} />
      })()}
      {lonePort && (() => {
        const p = toLocal(lonePort.x + lonePort.width, lonePort.y + lonePort.height / 2)
        return <span className="nl-port" role="button" aria-label={`Link from this ${word(lonePort)}`} title="Drag to link (L)"
          style={{ left: p.x, top: p.y }} onPointerDown={(ev) => startLink(lonePort, ev)} onPointerMove={follow} onPointerUp={endLink} />
      })()}
      {groups.map((g) => {
        const off = g.members.some((m) => moving?.ids.has(m.id)) ? moving : null
        const b = boxOfAll(g.members)
        const p = toLocal(b.x + (off?.dx ?? 0), b.y + (off?.dy ?? 0))
        return (
          <button key={g.groupId} type="button" className={`nl-keychip ${g.stacked ? 'stacked' : ''}`} data-key={g.key} style={{ left: p.x, top: p.y }}
            title={g.stacked ? 'Click the stack to open it' : 'One character: its views move and link together'}
            onPointerDown={(ev) => ev.stopPropagation()} onClick={() => canvas.select(g.members.map((m) => m.id))}>
            {groupLabel(g)}
          </button>
        )
      })}
      {groupSel && (() => {
        const b = boxOfAll(groupSel.members)
        const p = toLocal(b.x + b.w, b.y + b.h / 2)
        const lead = groupSel.members[0]
        return <span className="nl-port" role="button" aria-label={`Link from ${groupLabel(groupSel)}`} title="Drag to link the whole character (L); ⌥ links one view"
          style={{ left: p.x, top: p.y }} onPointerDown={(ev) => startLink(lead, ev)} onPointerMove={follow} onPointerUp={endLink} />
      })()}
      {linking && (
        <div className="nl-linkmode" role="application" aria-label="Link tool: click the node to link from, then the node it feeds"
          onPointerDown={toolDown} onPointerMove={follow} />
      )}
      {drag && drag.at && (() => {
        // From the source's port as the view is now (the source may have been picked under another view).
        const a = portOf(drag.from)
        return <svg className="nl-drag" aria-hidden="true"><line x1={a.x} y1={a.y} x2={drag.b.x} y2={drag.b.y} /></svg>
      })()}
      {pointerAt && hover && hoverCheck && (() => {
        const p = toLocal(pointerAt.x, pointerAt.y)
        return (
          <span className={`nl-tip ${hoverCheck.ok ? 'ok' : ''}`} role="status" style={{ left: p.x, top: p.y }}>
            {hoverCheck.ok ? `${drag?.by === 'port' ? 'Drop' : 'Click'} to link · ${hoverCheck.docRole}` : hoverCheck.reason}
          </span>
        )
      })()}
      {linking && (
        <div className="nl-hint" role="status">
          <b>Link</b>
          <span>{into && !drag ? `Click what feeds this ${word(into.el)}: a named picture, a script, a storyboard` : source ? `Click what this ${word(source)} feeds, or empty canvas for a new node` : 'Click the node or named picture to link from'}</span>
          <span className="nl-key">⌥ one view · Esc cancels</span>
        </div>
      )}
      {picker && (
        <div className="nl-picker pt-panel" role="menu" aria-label="New node for this link" style={{ left: picker.at.x, top: picker.at.y }}>
          {picker.kinds.map((k) => (
            <button key={k} type="button" role="menuitem" className="pt-menurow" onClick={() => pick(k)}>
              New {WORD[k]} from this {word(picker.from)}
            </button>
          ))}
          <button type="button" role="menuitem" className="pt-menurow" onClick={cancel}>Cancel</button>
        </div>
      )}
      {refusal && <span className="nl-refusal" role="status" style={{ left: refusal.at.x, top: refusal.at.y }}>{refusal.text}</span>}
    </div>
  )
}
