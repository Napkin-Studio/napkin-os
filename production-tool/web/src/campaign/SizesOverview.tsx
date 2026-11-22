// The Sizes overview (features/art-director.clan, slice 2; mock: ~/Documents/napkin-design-mocks/
// sizes-overview-v1): every size of one master on a screen of its own, grouped by channel, shape or
// status, each group folding into a stack. It reads the same sizes as the Campaign board, so a Redo, a
// Lock or a Change method here shows on the board and the other way round. A size's actions open next to
// it; Adjust crop and Edit type work on the picture itself, so "Edit on board" takes you there.

import { BandBack } from '../ui/shell/ShellBar'
import { useCanvasPage } from '../ui/chrome/canvasPage'
import { escapeStep, leaveText } from '../ui/chrome/escapeBack'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormatSet, PersonRef, Size, SizeMethod } from '../contracts/types'
import { useBlobUrl } from '../ui/hooks'
import { formatById, shortName, sizeWords } from './formats'
import { changeMethod, redoSize, sizeSeconds, type CampaignDeps } from './make'
import { groupSizes, statusWord, type GroupBy, type SizeGroup } from './overview'
import { METHOD_WORD, methodWords, PAID, STILL_METHODS, type MethodModel } from './rules'
import { TileFloat } from './TileFloat'
import './campaign.css'

export interface OverviewTray { who: 'wren' | 'rhea'; title: string; rows: { id: string; name: string; words: string }[]; note?: string; send(): Promise<void> }

export function SizesOverview({ set, sizes, staleIds, models, deps, by, title, onClose, onTray, onLock, onEditOnBoard }: {
  set: FormatSet
  sizes: Size[]
  staleIds: ReadonlySet<string>
  models: Partial<Record<SizeMethod, MethodModel>>
  deps: CampaignDeps
  by: PersonRef
  title: string
  onClose(): void
  onTray(t: OverviewTray): void
  onLock(id: string, on: boolean): void
  onEditOnBoard(id: string): void
}) {
  const [by_, setBy] = useState<GroupBy>('channel')
  const [onlyLook, setOnlyLook] = useState(false)
  const [width, setWidth] = useState(104)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  // The method menu belongs to the size it was opened for, so picking another size closes it.
  const [methodFor, setMethodFor] = useState<string | null>(null)
  const methodOpen = methodFor !== null && methodFor === sel
  const setMethodOpen = (on: boolean) => setMethodFor(on ? sel : null)
  const picRef = useRef<HTMLDivElement>(null)
  const masterUrl = useBlobUrl(set.master.asset)

  const groups = useMemo(() => groupSizes(sizes, by_, staleIds, onlyLook), [sizes, by_, staleIds, onlyLook])
  const counts = {
    ready: sizes.filter((s) => s.status === 'ready' && !staleIds.has(s.id)).length,
    making: sizes.filter((s) => s.status === 'making').length,
    look: sizes.filter((s) => s.status === 'look').length,
  }
  const picked = sel ? sizes.find((s) => s.id === sel) : undefined
  const allClosed = groups.length > 0 && groups.every((g) => closed.has(g.key))

  useEffect(() => {
    // Esc puts the size down, leaves a text field, then goes back to the canvas; never while a menu is open.
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.defaultPrevented) return; if (sel) { setSel(null); return } const step = escapeStep(e.target, document, root.current); if (step === 'text') leaveText(e.target); else if (step === 'back') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sel, onClose])

  const nameOf = (s: Size) => { const f = formatById(s.format.format_id); return `${f ? shortName(f.format) : s.format.format_id} · ${s.delivery.width}×${s.delivery.height}` }
  const paidTray = (s: Size, method: SizeMethod, head: string, send: () => Promise<unknown>) => onTray({
    who: 'wren', title: head, rows: [{ id: s.id, name: nameOf(s), words: methodWords(method, models) }],
    note: method === 'extend' ? 'Keeps the picture exactly and makes its new edges.' : 'Remakes the picture at this shape from the master.',
    send: async () => { await send() },
  })
  const pickMethod = (s: Size, m: SizeMethod) => {
    setMethodOpen(false)
    if (PAID.has(m)) paidTray(s, m, 'Change method', () => changeMethod(deps, s.id, m, by))
    else void changeMethod(deps, s.id, m, by)
  }
  const toggle = (g: SizeGroup) => setClosed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })

  // The canvas's bar reads "› Canvas › Sizes" while this is open; Canvas closes it.
  useCanvasPage('Sizes', onClose)

  return createPortal(
    <div ref={root} className="ov" role="dialog" aria-label="Sizes" onPointerDown={(e) => e.stopPropagation()}>
      <header className="ov-head">
        <BandBack label="Canvas" onClick={onClose} />
        <span className="band-sep" aria-hidden="true" />
        <h1>Sizes · {title}</h1>
        <div className="ov-seg" role="group" aria-label="Group by"><span>Group by</span>
          {(['channel', 'shape', 'status'] as const).map((g) => <button key={g} type="button" className={`btn xs ${by_ === g ? 'on' : ''}`} aria-pressed={by_ === g} onClick={() => { setBy(g); setClosed(new Set()) }}>{g[0]!.toUpperCase() + g.slice(1)}</button>)}
        </div>
        <button type="button" className={`btn xs ${onlyLook ? 'on' : ''}`} aria-pressed={onlyLook} onClick={() => setOnlyLook(!onlyLook)}>Needs a look only</button>
        <label className="ov-seg">Size <input type="range" min={60} max={170} value={width} onChange={(e) => setWidth(+e.target.value)} aria-label="Tile size" /></label>
        <span className="pt-grow" />
        <button type="button" className="btn xs" onClick={() => setClosed(allClosed ? new Set() : new Set(groups.map((g) => g.key)))}>{allClosed ? 'Expand all' : 'Collapse all'}</button>
        <button type="button" className="btn xs ghost" onClick={onClose} aria-label="Close sizes">Close ✕</button>
      </header>
      <div className="ov-main">
        <aside className="ov-side">
          {/* A film's master is a video: a still of it, never an <img> of a video (Playwright live test 2026-11-18). */}
          <div className="ov-master">{masterUrl ? (set.master.kind === 'render' || set.master.kind === 'video'
            ? <video src={masterUrl} muted playsInline preload="metadata" aria-label="Master" />
            : <img src={masterUrl} alt="Master" />) : null}<i>Master</i></div>
          <div className="ov-stat"><span>Sizes</span><b>{sizes.length}</b></div>
          <div className="ov-bar" aria-hidden>
            <i style={{ width: `${(counts.ready / Math.max(1, sizes.length)) * 100}%`, background: 'var(--ok, #2fa36b)' }} />
            <i style={{ width: `${(counts.making / Math.max(1, sizes.length)) * 100}%`, background: '#4458c8' }} />
            <i style={{ width: `${(counts.look / Math.max(1, sizes.length)) * 100}%`, background: '#e0a030' }} />
          </div>
          <div className="ov-stat"><span>Ready</span><b>{counts.ready}</b></div>
          <div className="ov-stat"><span>Making</span><b>{counts.making}</b></div>
          <div className="ov-stat"><span>Needs a look</span><b>{counts.look}</b></div>
          <p className="faint">Click a group's title to fold it into a stack. Click a size to act on it.</p>
        </aside>
        <section className="ov-scroll" onPointerDown={() => { setSel(null) }}>
          {groups.length === 0 && <p className="faint">{onlyLook ? 'Nothing needs a look.' : 'No sizes yet.'}</p>}
          {groups.map((g) => {
            const isClosed = closed.has(g.key)
            return (
              <div key={g.key} className={`ov-group ${isClosed ? 'closed' : ''}`}>
                <button type="button" className="ov-ghead" aria-expanded={!isClosed} onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle(g)}>
                  <span className="ov-chev">▾</span><h2>{g.label}</h2><span className="ov-count">{g.sizes.length}</span>
                  {g.look > 0 ? <span className="ov-badge warn">{g.look} need a look</span> : <span className="ov-badge ok">Ready</span>}
                  {g.making > 0 && <span className="ov-badge run">{g.making} making</span>}
                </button>
                {isClosed ? (
                  <button type="button" className="ov-stack" aria-label={`Open ${g.label}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle(g)}>
                    {g.sizes.slice(0, 4).map((s, j) => <StackPic key={s.id} size={s} index={j} />)}
                  </button>
                ) : (
                  <div className="ov-grid">
                    {g.sizes.map((s) => {
                      const f = formatById(s.format.format_id)
                      const word = statusWord(s, staleIds.has(s.id))
                      const r = s.delivery.width / s.delivery.height
                      const w = Math.max(46, Math.min(width * 1.9, width * Math.sqrt(r) * 1.15))
                      return (
                        <div key={s.id} className={`ov-tile ${sel === s.id ? 'sel' : ''}`} data-size={s.id} style={{ width: w }}
                          onPointerDown={(e) => { e.stopPropagation(); setSel(s.id) }}>
                          <div ref={sel === s.id ? picRef : undefined} className="ov-pic" style={{ aspectRatio: String(r) }}>
                            <OvPic size={s} />
                            <span className={`ov-chip ${word === 'Ready' ? 'ready' : word === 'Making' ? 'run' : 'look'}`}>{word}</span>
                            {s.locked && <span className="ov-lock" title="Locked: Update sizes never changes it">🔒</span>}
                          </div>
                          <div className="ov-cap"><b>{f ? shortName(f.format) : s.format.format_id}{sizeSeconds(deps.doc.get(), s) ? ` · ${sizeSeconds(deps.doc.get(), s)} s` : ''}</b>
                            <span>{f ? sizeWords(f.format) : `${s.delivery.width}×${s.delivery.height}`} · {s.media === 'video' ? 'Film' : methodWords(s.method, models)}</span></div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      </div>
      {picked && (
        <TileFloat anchor={picRef} onOffscreen={() => setSel(null)}>
          <div className="cb-tools toolbar" role="toolbar" aria-label="Size actions">
            <button type="button" className="btn sm" onClick={() => onEditOnBoard(picked.id)} title="Adjust crop and Edit type work on the picture, on the board">Edit on board</button>
            {picked.media === 'image' && (
              <span className="cb-menuwrap">
                <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={methodOpen} onClick={() => setMethodOpen(!methodOpen)}>Change method</button>
                {methodOpen && (
                  <div className="cb-menu pt-panel" role="menu">
                    {STILL_METHODS.map((m) => {
                      const off = PAID.has(m) && !models[m]
                      return (
                        <button key={m} type="button" role="menuitemradio" aria-checked={picked.method === m} className="pt-menurow" disabled={off || picked.method === m}
                          title={off ? 'Off for your agency' : undefined} onClick={() => pickMethod(picked, m)}>
                          {METHOD_WORD[m]}<span className="hint">{PAID.has(m) ? models[m]?.label ?? 'off' : 'in seconds'}</span>{picked.method === m && ' ✓'}
                        </button>
                      )
                    })}
                  </div>
                )}
              </span>
            )}
            {picked.media === 'image' && (
              <button type="button" className="btn sm" disabled={!PAID.has(picked.method) || !models[picked.method] || picked.status === 'making' || !!picked.locked}
                title={!PAID.has(picked.method) ? 'A crop is the same each time: Redo is another take of Extend or Regenerate.' : picked.locked ? 'Unlock it first' : undefined}
                onClick={() => paidTray(picked, picked.method, 'Redo', () => redoSize(deps, picked.id, by))}>Redo</button>
            )}
            <button type="button" className="btn sm" onClick={() => onLock(picked.id, !picked.locked)}>{picked.locked ? 'Unlock' : 'Lock'}</button>
          </div>
        </TileFloat>
      )}
    </div>,
    document.body,
  )
}

/** A size's picture; a film or a size not made yet shows a plain tile. */
function OvPic({ size }: { size: Size }) {
  const url = useBlobUrl(size.asset)
  // A film size shows its first frame (its own video, paused), not a blank tile.
  if (url && size.media === 'video') return <video src={url} muted playsInline preload="metadata" />
  return url ? <img src={url} alt="" draggable={false} /> : <span className="ov-blank">{size.media === 'video' ? '▶' : ''}</span>
}

function StackPic({ size, index }: { size: Size; index: number }) {
  const url = useBlobUrl(size.media === 'image' ? size.asset : undefined)
  const r = size.delivery.width / size.delivery.height
  return <span className="ov-st" style={{ left: index * 30, height: Math.min(92, 70 / r), aspectRatio: String(r), transform: `rotate(${(index - 1.5) * 3}deg)`, zIndex: index }}>{url ? <img src={url} alt="" /> : null}</span>
}
