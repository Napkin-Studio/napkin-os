// The boards on our own canvas (features/art-boards.clan; ui-behaviour 3.2): seeds
// the Ad template's seven boards once (document boards and board frames, with the
// nodes in theirs), takes the rail's ⌥1…⌥9 and ⌥0 jumps onto the real frames, keeps
// the document's boards in step with the frames (a deleted board leaves the rail;
// undo brings it back), makes boards ("+ New board", the Board tool B and a drag)
// with their title open in place and a purpose picker, renames a board on a
// double-click of its title, and asks before deleting a board with things on it.
// Board sizing (owner decision, Shrey 2026-10-15): a selected board's bar has Fit to contents; a
// board that could not grow to take what came to it says "Board is full · Resize" for a while; things
// a resize let go of are said, with Undo. The engine draws the handles and does the sizing.
// The engine draws the frames; the rail is the chrome's.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useDoc, useServices } from '../../app/context'
import { systemUpdate } from '../../doc/store'
import type { Board, BoardPurpose } from '../../contracts/types'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import { canvasActions, toolLetter } from '../chrome/actions'
import { boardIdOf, boardKey, contentsOf, deleteBoards, isBoard, jumpTo, newBoard, NEW_BOARD, PURPOSES, reconcileBoards, seedBoards } from './boards'
import { UndoChip } from '../../ui/Undo'
import { boardNotices } from './fitting'
import { boardTitleRect, TITLE_REACH_PX } from '../../../../canvas-engine/src'
import './boards.css'

type Local = { x: number; y: number }
/** What our engine adds for sized boards (adapter/own): Fit to contents and what boards did. */
type Sized = CanvasAdapter & {
  fitBoard?: (frameId: string) => boolean
  onBoardEvent?: (cb: (e: { kind: 'full' | 'left'; board: string; ids: string[] }) => void) => () => void
  undoScene?: (dir: 'undo' | 'redo') => boolean
}
/** The board bar never goes higher than this (screen pixels in the canvas): the top bar is above it. */
const BAR_TOP = 104
/** How long "Board is full · Resize" and "… left the board · Undo" stay. */
const SAY_MS = 7000
type FrameEl = CanvasElement & { name?: string; purpose?: string }
/** A board frame's title chip in scene units: the engine's (boards/grab), so the rename field, the bar and the press agree. */
const chipOf = (f: FrameEl, zoom: number) => boardTitleRect({ x: f.x, y: f.y, w: f.width, h: f.height, props: { name: f.name ?? '' } }, zoom)
/** A drag smaller than this (screen pixels) makes a board of the default size where it started. */
const MIN_DRAG = 24
const typing = (t: EventTarget | null) => !!(t as { closest?: (s: string) => unknown } | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')

export function BoardLayer({ canvas, inset = 0, tick = 0 }: { canvas: CanvasAdapter; inset?: number; tick?: number }) {
  const keep = useRef(inset)
  useEffect(() => {
    keep.current = inset
  }, [inset])
  const root = useRef<HTMLDivElement>(null)
  const services = useServices()
  const doc = useDoc()
  const mode = useSyncExternalStore(canvasActions.subscribe, () => canvasActions.mode())
  const memory = useRef(new Map<string, Board>())
  // The board whose title is open in place, and whether it was just made (its purpose picker shows).
  const [editing, setEditing] = useState<{ frameId: string; fresh: boolean } | null>(null)
  // A board delete waiting on the question (ui-behaviour 3.2).
  const [asking, setAsking] = useState<{ frames: string[]; also: string[]; count: number } | null>(null)
  const [draw, setDraw] = useState<{ a: Pt; b: Pt } | null>(null)
  // A board that was full (frame id), and what a resize let go of.
  const [full, setFull] = useState<string | null>(null)
  const [left, setLeft] = useState<{ frameId: string; ids: string[] } | null>(null)
  void tick

  useEffect(() => {
    const sized = canvas as Sized
    const offs = [
      boardNotices.subscribe((n) => setFull(n.frameId)),
      sized.onBoardEvent?.((e) => (e.kind === 'full' ? setFull(e.board) : setLeft({ frameId: e.board, ids: e.ids }))) ?? (() => {}),
    ]
    return () => offs.forEach((off) => off())
  }, [canvas])
  useEffect(() => {
    if (!full) return
    const t = setTimeout(() => setFull(null), SAY_MS)
    return () => clearTimeout(t)
  }, [full])
  useEffect(() => {
    if (!left) return
    const t = setTimeout(() => setLeft(null), SAY_MS)
    return () => clearTimeout(t)
  }, [left])

  useEffect(() => {
    const seeded = seedBoards(canvas, services.doc.get())
    if (!seeded) return
    canvas.transact((els) => seeded.apply(els), { undoable: false })
    if (seeded.boards.length) {
      void systemUpdate(services.doc, (d) => {
        for (const b of seeded.boards) d.boards[b.id] = b
      }, 'create the Ad template boards').catch((e) => console.warn('could not write the boards', e))
    }
    jumpTo(canvas, services.doc.get(), 'fit', false, keep.current)
  }, [canvas, services])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const which = boardKey(e)
      if (which === null) return
      if (jumpTo(canvas, services.doc.get(), which, !matchMedia?.('(prefers-reduced-motion: reduce)').matches, keep.current)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canvas, services])

  // The document's boards follow the frames: a delete, its undo, a rename (system writes: the
  // person's step is the frame's).
  useEffect(() => {
    const { remove, restore, retitle } = reconcileBoards(canvas.elements(), doc, memory.current)
    if (!remove.length && !restore.length && !retitle.length) return
    void systemUpdate(services.doc, (d) => {
      for (const id of remove) delete d.boards[id]
      for (const b of restore) d.boards[b.id] = b
      for (const r of retitle) {
        const b = d.boards[r.id]
        if (!b) continue
        b.title = r.title
        if (r.purpose) b.purpose = r.purpose
      }
    }, remove.length ? 'remove a board' : restore.length ? 'restore a board' : 'rename a board').catch((e) => console.warn('could not keep the boards in step', e))
  }, [canvas, doc, services, tick])

  /** Make a board: its document entry first (so the rail never lists a frame without one), then its frame. */
  const create = useCallback(async (rect?: { x: number; y: number; w: number; h: number }, jump = true) => {
    const { board, frame } = newBoard(canvas, services.doc.get(), rect ? { rect } : {})
    await systemUpdate(services.doc, (d) => { d.boards[board.id] = board }, 'add a board')
    memory.current.set(board.id, board)
    canvas.transact((els) => [frame, ...els], { undoable: true })
    canvas.select([])
    if (jump) canvasActions.pickWhenListed(board.id)
    setEditing({ frameId: frame.id, fresh: true })
  }, [canvas, services])

  useEffect(() => canvasActions.register({
    board: () => void create().catch((e) => console.warn('the board was not made', e)),
  }), [create])

  /** Give the keys back to the canvas (its undo, Delete, tool letters) once a question or a field closes. */
  const refocus = () => (root.current?.parentElement?.querySelector(':scope > [tabindex]') as HTMLElement | null)?.focus({ preventScroll: true })
  const view = canvas.view()
  const toLocal = (p: Pt): Local => ({ x: (p.x + view.scrollX) * view.zoom, y: (p.y + view.scrollY) * view.zoom })
  const fromClient = (cx: number, cy: number) => canvas.viewportToScene({ x: cx, y: cy }, canvas.view())
  const frameById = (id: string) => canvas.elements().find((e) => e.id === id && isBoard(e)) as FrameEl | undefined
  const titleAt = (p: Pt) => {
    const z = canvas.view().zoom
    const reach = TITLE_REACH_PX / z
    return canvas.elements().filter((e) => {
      if (!isBoard(e)) return false
      const c = chipOf(e as FrameEl, z)
      return p.x >= c.x - reach && p.x <= c.x + c.w + reach && p.y >= c.y - reach && p.y <= c.y + c.h + reach
    }).at(-1)
  }

  // Keys: B the Board tool; Delete on a selected board asks first when things sit on it; Esc closes.
  // Capture, so the question comes before the engine's own Delete.
  useEffect(() => {
    const host = root.current?.parentElement
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (asking || draw || canvasActions.mode() === 'board') {
          e.preventDefault()
          if (asking) refocus()
          setAsking(null)
          setDraw(null)
          canvasActions.setMode(null)
        }
        return
      }
      if (toolLetter(e) === 'b') {
        e.preventDefault()
        canvasActions.toggle('board')
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // Only where the engine's own Delete would act: a key on the canvas, not in a field.
      if (!host || !(e.target instanceof Node) || !host.contains(e.target) || typing(e.target)) return
      const sel = canvas.view().selectedIds
      const els = canvas.elements()
      const frames = sel.filter((id) => els.some((x) => x.id === id && isBoard(x)))
      if (!frames.length) return
      e.preventDefault()
      e.stopPropagation()
      const also = sel.filter((id) => !frames.includes(id))
      const count = frames.flatMap((f) => contentsOf(els, f)).filter((x) => !sel.includes(x.id)).length
      if (!count) deleteBoards(canvas, frames, false, also)
      else setAsking({ frames, also, count })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [canvas, asking, draw])

  // Double-click a board's title to rename it in place (ui-behaviour 3.2 Rename).
  useEffect(() => {
    const host = root.current?.parentElement
    if (!host) return
    const onDbl = (e: MouseEvent) => {
      const f = titleAt(fromClient(e.clientX, e.clientY))
      if (!f) return
      e.preventDefault()
      e.stopPropagation()
      setEditing({ frameId: f.id, fresh: false })
    }
    host.addEventListener('dblclick', onDbl, true)
    return () => host.removeEventListener('dblclick', onDbl, true)
  })

  const rename = (frameId: string, title: string) => {
    const f = frameById(frameId)
    const t = title.trim()
    if (!f || !t || t === f.name) return
    canvas.transact((els) => els.map((e) => (e.id === frameId ? canvas.patch(e, { name: t } as Partial<CanvasElement>) : e)), { undoable: true })
  }
  const setPurpose = (frameId: string, purpose: BoardPurpose) => {
    const f = frameById(frameId)
    if (!f || f.purpose === purpose) return
    canvas.transact((els) => els.map((e) => (e.id === frameId ? canvas.patch(e, { purpose } as Partial<CanvasElement>) : e)), { undoable: true })
  }

  // The Board tool's surface: drag out a board, or click for one of the default size.
  const at = (e: React.PointerEvent): Pt => fromClient(e.clientX, e.clientY)
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = at(e)
    setDraw({ a: p, b: p })
  }
  const move = (e: React.PointerEvent) => {
    if (draw) setDraw({ ...draw, b: at(e) })
  }
  const up = (e: React.PointerEvent) => {
    if (!draw) return
    const b = at(e)
    setDraw(null)
    canvasActions.setMode(null)
    const z = canvas.view().zoom
    const w = Math.abs(b.x - draw.a.x)
    const h = Math.abs(b.y - draw.a.y)
    const rect = w * z < MIN_DRAG || h * z < MIN_DRAG
      ? { x: draw.a.x, y: draw.a.y, ...NEW_BOARD }
      : { x: Math.min(draw.a.x, b.x), y: Math.min(draw.a.y, b.y), w, h }
    void create(rect, false).catch((err) => console.warn('the board was not made', err))
  }

  /** The delete question's answer: the board only, all of it, or neither (null). */
  const answer = (all: boolean | null) => {
    if (asking && all !== null) deleteBoards(canvas, asking.frames, all, asking.also)
    setAsking(null)
    refocus()
  }

  // The one board selected: its bar (Fit to contents) above its title.
  const sel = view.selectedIds.length === 1 ? frameById(view.selectedIds[0]) : undefined
  // Selected, the full board's hint has done its job (its handles show).
  const fullFrame = full && sel?.id !== full ? frameById(full) : undefined
  // While a handle is dragged, the bar waits (it would sit over the old box).
  const resizing = !!(canvas as Sized & { selector?: { resizing?: unknown } }).selector?.resizing
  const viewH = (canvas.visibleBounds().maxY - canvas.visibleBounds().minY) * view.zoom
  const leftFrame = left ? frameById(left.frameId) : undefined
  // ⌘Z took the resize back: its words leave with it.
  const leftNow = left && leftFrame && canvas.elements().some((e) => left.ids.includes(e.id) && !e.frameId) ? left : null
  const fit = (frameId: string) => {
    ;(canvas as Sized).fitBoard?.(frameId)
    refocus()
  }
  const resizeFull = () => {
    if (full) canvas.select([full])
    setFull(null)
    refocus()
  }
  const undoLeft = () => {
    ;(canvas as Sized).undoScene?.('undo')
    setLeft(null)
    refocus()
  }
  const editFrame = editing ? frameById(editing.frameId) : undefined
  const editBoard = editFrame ? doc.boards?.[boardIdOf(editFrame) ?? ''] : undefined
  const askFrame = asking ? frameById(asking.frames[0]) : undefined
  return (
    <div className="board-layer" ref={root}>
      {mode === 'board' && (
        <div className="bd-tool" role="application" aria-label="Board tool: drag out a board, or click for one" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          <div className="bd-hint" role="status"><b>Board</b><span>Drag out a board, or click for one</span><span className="bd-key">Esc cancels</span></div>
        </div>
      )}
      {draw && (() => {
        const a = toLocal({ x: Math.min(draw.a.x, draw.b.x), y: Math.min(draw.a.y, draw.b.y) })
        return <div className="bd-draft" style={{ left: a.x, top: a.y, width: Math.abs(draw.b.x - draw.a.x) * view.zoom, height: Math.abs(draw.b.y - draw.a.y) * view.zoom }} />
      })()}
      {editFrame && (
        <TitleEditor key={editFrame.id} at={(() => {
          const c = chipOf(editFrame, view.zoom)
          return toLocal({ x: c.x, y: c.y + c.h / 2 })
        })()} width={editFrame.width * view.zoom}
          room={(canvas.visibleBounds().maxY - editFrame.y) * view.zoom}
          title={editFrame.name || editBoard?.title || 'New board'} purpose={(editFrame.purpose as BoardPurpose | undefined) ?? editBoard?.purpose ?? 'none'} fresh={editing!.fresh}
          onTitle={(t) => rename(editFrame.id, t)} onPurpose={(p) => setPurpose(editFrame.id, p)} onDone={() => { setEditing(null); refocus() }} />
      )}
      {sel && !editing && !draw && !resizing && mode !== 'board' && (() => {
        // Above the title chip (boards/grab), never over it: when the top bar leaves no room above, beside it.
        const chip = chipOf(sel as FrameEl, view.zoom)
        const p = toLocal({ x: sel.x + sel.width / 2, y: chip.y })
        const right = toLocal({ x: chip.x + chip.w, y: chip.y + chip.h / 2 })
        const viewW = (canvas.visibleBounds().maxX - canvas.visibleBounds().minX) * view.zoom
        const empty = !contentsOf(canvas.elements(), sel.id).length
        const beside = p.y - 6 < BAR_TOP
        const at = beside ? { left: right.x + 8, top: Math.max(right.y, BAR_TOP - 16) } : { left: Math.min(Math.max(p.x, 120), viewW - 120), top: p.y - 6 }
        return (
          <div className={`toolbar selbar bd-bar ${beside ? 'beside' : ''}`} role="toolbar" aria-label="Board actions" style={at} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="sb-btn" disabled={empty} title={empty ? 'Nothing on this board yet' : 'Shrink or grow the board to what is on it'} data-frame={sel.id} onClick={(e) => fit(e.currentTarget.dataset.frame!)}>Fit to contents</button>
          </div>
        )
      })()}
      {fullFrame && (() => {
        const p = toLocal({ x: fullFrame.x + fullFrame.width, y: fullFrame.y })
        return (
          <div className="bd-full" role="status" style={{ left: Math.max(p.x, 220), top: Math.max(p.y, BAR_TOP - 32) }} onPointerDown={(e) => e.stopPropagation()}>
            <span>Board is full</span>
            <span className="dot">·</span>
            <button type="button" className="btn xs ghost" onClick={resizeFull}>Resize</button>
          </div>
        )
      })()}
      {leftNow && leftFrame && (() => {
        const p = toLocal({ x: leftFrame.x, y: leftFrame.y + leftFrame.height })
        const n = leftNow.ids.length
        const name = leftFrame.name || 'the board'
        return <UndoChip className="bd-left" label={`${n} ${n === 1 ? 'thing' : 'things'} left ${name}`} style={{ left: Math.max(p.x, 230), top: Math.min(Math.max(p.y + 12, BAR_TOP), viewH - 110) }}
          onUndo={undoLeft} />
      })()}
      {asking && askFrame && (() => {
        const p = toLocal({ x: askFrame.x, y: askFrame.y })
        const n = asking.frames.length
        const things = `${asking.count} ${asking.count === 1 ? 'thing' : 'things'}`
        return (
          <div className="bd-ask pt-panel" role="alertdialog" aria-label="Delete the board?" style={{ left: Math.max(8, p.x), top: Math.max(8, p.y + 8) }}>
            <p>{n === 1 ? `Delete the board and the ${things} on it?` : `Delete ${n} boards and the ${things} on them?`}</p>
            <div className="bd-row">
              <button type="button" className="btn sm" autoFocus onClick={() => answer(false)}>Delete board only</button>
              <button type="button" className="btn sm danger" onClick={() => answer(true)}>Delete all</button>
              <button type="button" className="btn sm ghost" onClick={() => answer(null)}>Cancel</button>
            </div>
            <span className="bd-note">{n === 1 ? 'Delete board only keeps what is on it, on no board.' : 'Delete boards only keeps what is on them, on no board.'}</span>
          </div>
        )
      })()}
    </div>
  )
}

/** A board's title, open in place, with its purpose when it was just made (ui-behaviour 3.2). */
function TitleEditor({ at, width, room, title, purpose, fresh, onTitle, onPurpose, onDone }: {
  at: Local
  width: number
  /** Screen pixels below the title: too few, and the purpose picker opens above it. */
  room: number
  title: string
  purpose: BoardPurpose
  fresh: boolean
  onTitle: (t: string) => void
  onPurpose: (p: BoardPurpose) => void
  onDone: () => void
}) {
  const [value, setValue] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const commit = () => onTitle(value)
  return (
    <div className={`bd-edit ${room < 260 ? 'above' : ''}`} style={{ left: at.x, top: at.y - 14, minWidth: Math.min(Math.max(width, 260), 420) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone()
        }
      }}>
      <input ref={input} className="bd-title" aria-label="Board title" value={value} maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            if (!fresh) onDone()
          }
        }}
        onBlur={() => {
          commit()
          if (!fresh) onDone()
        }} />
      {fresh && (
        <div className="bd-purpose pt-panel" role="radiogroup" aria-label="What the board is for">
          <span className="pt-label">What is it for?</span>
          <div className="bd-chips">
            {PURPOSES.map((p) => (
              <button key={p.purpose} type="button" role="radio" aria-checked={purpose === p.purpose} className={`bd-chip ${purpose === p.purpose ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => onPurpose(p.purpose)}>{p.label}</button>
            ))}
          </div>
          <button type="button" className="btn sm primary" onMouseDown={(e) => e.preventDefault()} onClick={() => { commit(); onDone() }}>Done</button>
        </div>
      )}
    </div>
  )
}
