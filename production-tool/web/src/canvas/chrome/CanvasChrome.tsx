// The canvas's own chrome (ui-behaviour 3.2, 3.3, 7; mocks Main, CanvasReferences, SketchInk):
// the frosted Boards rail with ⌥1…⌥9, the tool bar at the bottom with + Node, and the zoom and undo
// pill. Engine-neutral: it reads the engine only through CanvasChrome (controls.ts) and is fed its
// rows and actions by the stage, so it sits over either canvas adapter.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Float } from '../../ui/Float'
import { UndoButtons } from '../../ui/UndoButtons'
import { NodeIcon } from '../../ui/chrome/Bar'
import { rowLabel, type BoardRow } from './boards'
// ⌥1…⌥9 and ⌥0 (ui-behaviour 3.2): one reading of the keys for the rail and the own engine's boards.
import { boardKey } from '../boards/boards'
import type { CanvasChrome, ChromeTool } from './controls'
import { canvasActions } from './actions'
import { RATIOS, type Ratio } from '../../contracts/types'
import './canvas.css'

/** What the canvas below can do through the chrome's actions (actions.ts), kept current. */
function useActions() {
  useSyncExternalStore(canvasActions.subscribe, canvasActions.version, canvasActions.version)
  return { canNode: canvasActions.canNode(), canBoard: canvasActions.canBoard(), mode: canvasActions.mode(), pending: canvasActions.pending() }
}

function useChrome(chrome: CanvasChrome | null): { tool: ChromeTool | null; zoom: number } {
  const sub = useCallback((cb: () => void) => (chrome ? chrome.onChange(cb) : () => {}), [chrome])
  const tool = useSyncExternalStore(sub, () => chrome?.tool() ?? 'select', () => chrome?.tool() ?? 'select')
  const zoom = useSyncExternalStore(sub, () => chrome?.zoom() ?? 1, () => chrome?.zoom() ?? 1)
  return { tool, zoom }
}

// ── The board rail ──────────────────────────────────────────────────────────

const OPTION = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌥' : 'Alt+'

export function BoardRail({ rows, current, onPick, onFit, narrow = false, keys = true }: {
  rows: BoardRow[]
  current: string | null
  onPick: (row: BoardRow) => void
  onFit: () => void
  /** iPad and narrow windows: the rail is a "Boards" pill that opens a sheet (ui-behaviour 3.2). */
  narrow?: boolean
  /** The rail takes ⌥1…⌥9 and ⌥0 itself; false where the canvas does (our own engine's boards). */
  keys?: boolean
}) {
  const pick = useRef(onPick)
  const fit = useRef(onFit)
  const list = useRef(rows)
  useEffect(() => { pick.current = onPick; fit.current = onFit; list.current = rows }, [onPick, onFit, rows])
  useEffect(() => {
    if (!keys) return
    const onKey = (e: KeyboardEvent) => {
      const k = boardKey(e)
      if (k === null) return
      e.preventDefault()
      if (k === 'fit') return fit.current()
      const row = list.current[k]
      if (row && !row.off) pick.current(row)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys])
  const actions = useActions()
  // A board just made ("+ New board"): picked (made current, jumped to) once its row is listed.
  useEffect(() => {
    if (!actions.pending) return
    const row = rows.find((r) => r.id === actions.pending)
    if (!row) return
    canvasActions.pickWhenListed(null)
    pick.current(row)
  }, [actions.pending, rows])
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLButtonElement>(null)
  const items = rows.map((r, i) => (
    <button key={r.id} type="button" className={`br-row ${current === r.id ? 'current' : ''}`} aria-current={current === r.id ? 'true' : undefined}
      disabled={!!r.off} title={r.off} onClick={() => { setOpen(false); onPick(r) }}>
      <span>{rowLabel(r)}</span>
      {i < 9 && !narrow && <span className="br-key">{OPTION}{i + 1}</span>}
      {narrow && r.count ? <span className="br-key">{r.count}</span> : null}
    </button>
  ))
  const newBoard = actions.canBoard
    ? <button type="button" className="br-new" data-tip="New board (B): name it, pick what it is for" onClick={() => { setOpen(false); canvasActions.board() }}>+ New board</button>
    : <button type="button" className="br-new" aria-disabled="true" data-tip="New boards need the new canvas (it has boards as frames)">+ New board</button>
  if (narrow) {
    const cur = rows.find((r) => r.id === current)
    return (
      <>
        <button ref={pillRef} type="button" className="br-pill pt-panel" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="10" y="2" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="2" y="10" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="10" y="10" width="6" height="6" rx="1.5" fill="#2F64F5" /></svg>
          <b>Boards</b>{cur && <span className="br-cur">{cur.title}</span>}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <Float anchor={pillRef} open={open} onClose={() => setOpen(false)} role="dialog" label="Jump to a board" className="br-sheet">
          <div className="br-sheethead"><span className="pt-label">Jump to a board</span><button type="button" className="br-close" aria-label="Close" onClick={() => setOpen(false)}>×</button></div>
          {items}
          {newBoard}
        </Float>
      </>
    )
  }
  return (
    <nav className="board-rail pt-panel" aria-label="Boards">
      <div className="br-head">Boards</div>
      {items}
      {newBoard}
      <div className="br-foot">{OPTION}1–9 jump to a board<br />{OPTION}0 fit everything</div>
    </nav>
  )
}

// ── The tool bar ────────────────────────────────────────────────────────────

const ICON: Record<string, ReactNode> = {
  select: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2 L13 8 L8 9 L6 14 Z" fill="currentColor" /></svg>,
  hand: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 8 V3.5 a1 1 0 0 1 2 0 V7 M7 7 V2.5 a1 1 0 0 1 2 0 V7 M9 7 V3.5 a1 1 0 0 1 2 0 V9 c0 3 -2 5 -4.5 5 C4 14 3 12 2.5 10 L2 8.5 a1 1 0 0 1 1.8 -0.8 L5 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  pen: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 L4 9.5 L11 2.5 L13.5 5 L6.5 12 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
  board: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" /></svg>,
  image: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M3 12 L7 8 L10 11 L12 9 L14 11" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  link: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6.2 8 H9.8" stroke="currentColor" strokeWidth="1.3" /></svg>,
  eraser: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 13 H13 M3.5 10.5 L9 5 L12 8 L7.5 12.5 H5.5 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
}

export type NewNode = 'script' | 'storyboard' | 'video' | 'picture' | 'sketch'

export function CanvasToolbar({ chrome, ratio, onNode, vertical = false }: {
  chrome: CanvasChrome | null
  /** The storyboard's ratio: the sketch area's shape (ui-behaviour 3.7). */
  ratio: string
  /** A node the canvas cannot make itself (a picture, a sketch area; on Excalidraw, a node to open). */
  onNode: (kind: NewNode) => void
  /** iPad (mock TabletCanvas): a column on the left, each tool with its name, 44px targets, undo and redo in it. */
  vertical?: boolean
}) {
  const { tool } = useChrome(chrome)
  const actions = useActions()
  const nodeRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  // The next sketch area's shape (ui-behaviour 3.7): the storyboard's ratio until the person picks one.
  // An existing area's ratio never changes; the picker is the only way the next one's does.
  const shapeRef = useRef<HTMLButtonElement>(null)
  const [picked, setPicked] = useState<Ratio | null>(null)
  const [shapes, setShapes] = useState(false)
  const shape = picked ?? ratio
  useEffect(() => {
    if (picked) chrome?.setSketchRatio?.(picked)
  }, [chrome, picked])
  // A chrome tool (Board, Link) is on: the engine's tool shows as not pressed. Picking an engine tool ends it.
  const shown = actions.mode ? null : tool
  useEffect(() => {
    if (!actions.mode || !chrome) return
    const was = chrome.tool()
    return chrome.onChange(() => { if (chrome.tool() !== was) canvasActions.setMode(null) })
  }, [actions.mode, chrome])
  const has = (id: ChromeTool) => !chrome?.supports || chrome.supports(id)
  /** Every button's tooltip: its name and key, or why it is off (ui-behaviour 7; no dead buttons). */
  const t = (id: ChromeTool, label: string, key: string, body: ReactNode = ICON[id], tip = `${label} (${key})`) => {
    const on = has(id)
    return (
      <button type="button" className={`tb-tool ${shown === id ? 'on' : ''}`} aria-pressed={shown === id} aria-label={`${label} (${key})`}
        aria-disabled={on ? undefined : 'true'} data-tip={on ? tip : `${label} (${key}) · not on this canvas yet`}
        onClick={() => {
          if (!on) return
          canvasActions.setMode(null)
          chrome?.setTool(id)
        }}>{body}{vertical && <span className="tb-name">{label}</span>}</button>
    )
  }
  const mode = (m: 'board' | 'link', label: string, key: string, can: boolean, tip: string, off: string) => (
    <button type="button" className={`tb-tool ${actions.mode === m ? 'on' : ''}`} aria-pressed={actions.mode === m} aria-label={`${label} (${key})`}
      aria-disabled={can ? undefined : 'true'} data-tip={can ? tip : off} onClick={() => { if (can) canvasActions.toggle(m) }}>
      {ICON[m]}{vertical && <span className="tb-name">{label}</span>}
    </button>
  )
  const NAME: Record<'script' | 'storyboard' | 'video', string> = { script: 'Script', storyboard: 'Storyboard', video: 'Video' }
  const newKind = (k: 'script' | 'storyboard' | 'video') => {
    setMenu(false)
    if (!canvasActions.node(k)) onNode(k)
  }
  const row = (key: string, label: ReactNode, hint: string | null, can: boolean, why: string, run: () => void) => (
    <button key={key} type="button" role="menuitem" className="pt-menurow" aria-disabled={can ? undefined : 'true'} data-tip={can ? undefined : why}
      onClick={() => { if (!can) return; setMenu(false); run() }}>
      {label}{hint && <span className="hint">{hint}</span>}
    </button>
  )
  const sketchIcon = <svg width="16" height="16" viewBox="0 0 18 12" aria-hidden="true"><rect x="1" y="1" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
  const menuItems = (
    <>
      {(['script', 'storyboard', 'video'] as const).map((k) => (
        <button key={k} type="button" role="menuitem" className="pt-menurow" onClick={() => newKind(k)}>
          <NodeIcon kind={k} size={16} />{NAME[k]}<span className="hint">{actions.canNode ? 'new' : 'open'}</span>
        </button>
      ))}
      <div className="pt-menusep" />
      {row('picture', <>{ICON.image}A picture</>, null, has('image'), 'Pictures are not on this canvas yet', () => onNode('picture'))}
      {row('sketch', <>{sketchIcon}A sketch area</>, ratio, has('sketch'), 'Sketch areas are not on this canvas yet', () => onNode('sketch'))}
      {row('board', <>{ICON.board}A board</>, 'B', actions.canBoard, 'New boards need the new canvas (it has boards as frames)', () => canvasActions.board())}
    </>
  )
  const nodeButton = (
    <button ref={nodeRef} type="button" className="tb-node" aria-haspopup="menu" aria-expanded={menu} data-tip="Add a script, storyboard, video, picture or board"
      onClick={() => setMenu(!menu)}>{vertical ? <><b>+</b>Node</> : '+ Node'}</button>
  )
  if (vertical) {
    return (
      <div className="canvas-toolbar vertical" role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">
        {t('pen', 'Pen', 'P')}
        {t('eraser', 'Eraser', 'E')}
        {t('select', 'Select', 'V')}
        {t('hand', 'Hand', 'H')}
        {t('sketch', ratio, 'S', <svg width="20" height="14" viewBox="0 0 18 12" aria-hidden="true"><rect x="1" y="1" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>, `Sketch area ${ratio} (S)`)}
        {t('text', 'Text', 'T', <span className="tb-t">T</span>)}
        {t('image', 'Picture', 'I', ICON.image)}
        {mode('board', 'Board', 'B', actions.canBoard, 'Board (B): drag out a board', 'Board (B) · needs the new canvas')}
        {mode('link', 'Link', 'L', actions.canNode, 'Link (L): tap a node, then the node it feeds', 'Link (L) · needs the new canvas')}
        <span aria-hidden="true" className="tb-sep" />
        <span className="tb-undo"><UndoButtons bare /></span>
        {nodeButton}
        <Float anchor={nodeRef} open={menu} onClose={() => setMenu(false)} side="above" align="start" label="Add" className="pt-menu">{menuItems}</Float>
      </div>
    )
  }
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
      {t('select', 'Select', 'V')}
      {t('hand', 'Hand', 'H')}
      {t('pen', 'Pen', 'P')}
      {t('text', 'Text', 'T', <span className="tb-t">T</span>)}
      <span aria-hidden="true" className="tb-sep" />
      {(() => {
        const on = has('sketch')
        const active = shown === 'sketch'
        return (
          <>
            <button ref={shapeRef} type="button" className={`tb-tool wide ${active ? 'on' : ''}`} aria-pressed={active} aria-label={`Sketch area ${shape} (S)`}
              aria-haspopup={on && active ? 'dialog' : undefined} aria-expanded={on && active ? shapes : undefined}
              aria-disabled={on ? undefined : 'true'}
              data-tip={!on ? 'Sketch area (S) · not on this canvas yet' : active ? `Sketch area ${shape}: press again to pick the shape` : `Sketch area ${shape} (S): drag to draw, then Generate brings back a picture at its shape`}
              onClick={() => {
                if (!on) return
                if (active) return setShapes(!shapes)
                canvasActions.setMode(null)
                chrome?.setTool('sketch')
              }}>
              <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="1" y="1" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>{shape}
            </button>
            <Float anchor={shapeRef} open={shapes} onClose={() => setShapes(false)} side="above" align="start" role="dialog" label="Sketch area shape" className="tb-shapes pt-menu">
              <span className="pt-label">Sketch area shape</span>
              <div role="radiogroup" aria-label="Sketch area shape">
                {RATIOS.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={shape === r} className={`pt-menurow ${shape === r ? 'on' : ''}`}
                    onClick={() => { setPicked(r); setShapes(false) }}>
                    <span className="tb-shape" style={{ aspectRatio: r.replace(':', ' / ') }} aria-hidden="true" />{r}
                    {r === ratio && <span className="hint">storyboard</span>}
                  </button>
                ))}
              </div>
              <span className="tb-shapenote">The next area takes this shape; drawn areas keep theirs.</span>
            </Float>
          </>
        )
      })()}
      {mode('board', 'Board', 'B', actions.canBoard, 'Board (B): drag out a board, or click for one', 'Board (B) · needs the new canvas (it has boards as frames)')}
      {t('image', 'Add a picture', 'I', ICON.image)}
      {mode('link', 'Link two nodes', 'L', actions.canNode, 'Link (L): click a node, then the node it feeds', 'Link (L) · needs the new canvas (it has nodes on it)')}
      <span aria-hidden="true" className="tb-sep" />
      {nodeButton}
      <Float anchor={nodeRef} open={menu} onClose={() => setMenu(false)} side="above" align="end" label="Add" className="pt-menu">{menuItems}</Float>
    </div>
  )
}

// ── Zoom and undo ───────────────────────────────────────────────────────────

export function ZoomPill({ chrome, touch = false }: { chrome: CanvasChrome | null; touch?: boolean }) {
  const { zoom } = useChrome(chrome)
  return (
    <div className={`zoom-pill ${touch ? 'touch' : ''}`} role="group" aria-label="Undo and zoom">
      {!touch && <><UndoButtons bare /><span aria-hidden="true" className="zp-sep" /></>}
      <button type="button" aria-label="Zoom out" data-tip="Zoom out (Ctrl −)" onClick={() => chrome?.zoomBy(-1)}>−</button>
      <button type="button" className="zp-value" aria-label={`Zoom ${Math.round(zoom * 100)}%: fit everything (${OPTION}0)`} data-tip={`Fit everything (${OPTION}0)`} onClick={() => chrome?.fitAll()}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" data-tip="Zoom in (Ctrl +)" onClick={() => chrome?.zoomBy(1)}>+</button>
      {touch && <><span aria-hidden="true" className="zp-sep" /><button type="button" className="zp-fit" onClick={() => chrome?.fitAll()}>Fit</button></>}
    </div>
  )
}
