// The canvas's own chrome (ui-behaviour 3.2, 3.3, 7; mocks Main, CanvasReferences, SketchInk):
// the frosted Boards rail with ⌥1…⌥9, the tool bar at the bottom with + Node, and the zoom and undo
// pill. Engine-neutral: it reads the engine only through CanvasChrome (controls.ts) and is fed its
// rows and actions by the stage, so it sits over either canvas adapter.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Float } from '../../ui/Float'
import { UndoButtons } from '../../ui/UndoButtons'
import { NodeIcon } from '../../ui/chrome/Bar'
import { boardKey, rowLabel, type BoardRow } from './boards'
import type { CanvasChrome, ChromeTool } from './controls'
import './canvas.css'

function useChrome(chrome: CanvasChrome | null): { tool: ChromeTool | null; zoom: number } {
  const sub = useCallback((cb: () => void) => (chrome ? chrome.onChange(cb) : () => {}), [chrome])
  const tool = useSyncExternalStore(sub, () => chrome?.tool() ?? 'select')
  const zoom = useSyncExternalStore(sub, () => chrome?.zoom() ?? 1)
  return { tool, zoom }
}

// ── The board rail ──────────────────────────────────────────────────────────

const OPTION = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌥' : 'Alt+'

export function BoardRail({ rows, current, onPick, onFit, narrow = false }: {
  rows: BoardRow[]
  current: string | null
  onPick: (row: BoardRow) => void
  onFit: () => void
  /** iPad and narrow windows: the rail is a "Boards" pill that opens a sheet (ui-behaviour 3.2). */
  narrow?: boolean
}) {
  const pick = useRef(onPick)
  const fit = useRef(onFit)
  const list = useRef(rows)
  useEffect(() => { pick.current = onPick; fit.current = onFit; list.current = rows }, [onPick, onFit, rows])
  useEffect(() => {
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
  }, [])
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
  const newBoard = <button type="button" className="br-new" disabled title="New boards come with board frames on the canvas">+ New board</button>
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

export function CanvasToolbar({ chrome, ratio, onNode }: {
  chrome: CanvasChrome | null
  /** The storyboard's ratio: the sketch area's shape (ui-behaviour 3.7). */
  ratio: string
  onNode: (kind: NewNode) => void
}) {
  const { tool } = useChrome(chrome)
  const nodeRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const t = (id: ChromeTool, label: string, key: string, body: ReactNode = ICON[id]) => (
    <button type="button" className={`tb-tool ${tool === id ? 'on' : ''}`} aria-pressed={tool === id} aria-label={`${label} (${key})`} title={`${label} (${key})`}
      onClick={() => chrome?.setTool(id)}>{body}</button>
  )
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
      {t('select', 'Select', 'V')}
      {t('hand', 'Hand', 'H')}
      {t('pen', 'Pen', 'P')}
      {t('text', 'Text', 'T', <span className="tb-t">T</span>)}
      <span aria-hidden="true" className="tb-sep" />
      <button type="button" className={`tb-tool wide ${tool === 'sketch' ? 'on' : ''}`} aria-pressed={tool === 'sketch'} aria-label={`Sketch area ${ratio} (S)`}
        title={`Sketch area: drag to draw, then Generate brings back a picture at its shape (S)`} onClick={() => chrome?.setTool('sketch')}>
        <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="1" y="1" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>{ratio}
      </button>
      <button type="button" className="tb-tool" disabled aria-label="Board (B)" title="Boards come with board frames on the canvas">{ICON.board}</button>
      {t('image', 'Add a picture', 'I', ICON.image)}
      <button type="button" className="tb-tool" disabled aria-label="Link two nodes (L)" title="Links come with nodes on the canvas">{ICON.link}</button>
      <span aria-hidden="true" className="tb-sep" />
      <button ref={nodeRef} type="button" className="tb-node" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>+ Node</button>
      <Float anchor={nodeRef} open={menu} onClose={() => setMenu(false)} side="above" align="end" label="Add" className="pt-menu">
        {(['script', 'storyboard', 'video'] as const).map((k) => (
          <button key={k} type="button" role="menuitem" className="pt-menurow" onClick={() => { setMenu(false); onNode(k) }}>
            <NodeIcon kind={k} size={16} />{k === 'script' ? 'Script' : k === 'storyboard' ? 'Storyboard' : 'Video'}<span className="hint">open</span>
          </button>
        ))}
        <div className="pt-menusep" />
        <button type="button" role="menuitem" className="pt-menurow" onClick={() => { setMenu(false); onNode('picture') }}>{ICON.image}A picture</button>
        <button type="button" role="menuitem" className="pt-menurow" onClick={() => { setMenu(false); onNode('sketch') }}>
          <svg width="16" height="16" viewBox="0 0 18 12" aria-hidden="true"><rect x="1" y="1" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>A sketch area<span className="hint">{ratio}</span>
        </button>
        <button type="button" role="menuitem" className="pt-menurow" disabled title="Documents come with nodes on the canvas">A document</button>
        <button type="button" role="menuitem" className="pt-menurow" disabled title="Boards come with board frames on the canvas">A board</button>
      </Float>
    </div>
  )
}

// ── Zoom and undo ───────────────────────────────────────────────────────────

export function ZoomPill({ chrome }: { chrome: CanvasChrome | null }) {
  const { zoom } = useChrome(chrome)
  return (
    <div className="zoom-pill" role="group" aria-label="Undo and zoom">
      <UndoButtons bare />
      <span aria-hidden="true" className="zp-sep" />
      <button type="button" aria-label="Zoom out" onClick={() => chrome?.zoomBy(-1)}>−</button>
      <button type="button" className="zp-value" title="Fit everything (⌥0)" onClick={() => chrome?.fitAll()}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" onClick={() => chrome?.zoomBy(1)}>+</button>
    </div>
  )
}
