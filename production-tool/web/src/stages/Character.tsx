// Stage 1: the character, on an Excalidraw canvas. Pictures get a badge, a tag
// and a role; selecting things shows a floating toolbar (Generate front view,
// Combine…, Set as Front/3/4/Side/Back); results land beside their inputs with
// provenance arrows that flow while the job runs. A docked strip holds the
// four views and the Lock button.

import { Excalidraw, getSceneVersion, sceneCoordsToViewportCoords } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import { CanvasController, viewLabel, type CanvasSnapshot } from '../canvas/controller'
import { alive, bounds, cd, isUserDrawing, makeSketchFrame, sketchFrame, type El } from '../canvas/scene'
import type { CustomData, View } from '../contracts/types'
import { isActive } from '../jobs/runner'
import { newId } from '../lib/ulid'
import { useBlobUrl, useColorScheme, useFloating } from '../ui/hooks'
import type { Anchor } from '../lib/place'
import { JobNode } from '../ui/JobNode'
import { updateDoc } from '../doc/store'
import { cancelText } from '../ui/cancel'
import { InlineConfirm, UndoChip } from '../ui/Undo'
import { useUndo } from '../ui/useUndo'

type Pt = { x: number; y: number }
interface ViewState {
  scrollX: number
  scrollY: number
  zoom: AppState['zoom']
  offsetLeft: number
  offsetTop: number
  selected: string[]
  els: El[]
  version: number
}

const SLOTS: View[] = ['front', 'three_quarter', 'side', 'back']

export function Character({ initial, active }: { initial: CanvasSnapshot | null; active: boolean }) {
  const services = useServices()
  const { runner, doc: docStore } = services
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const theme = useColorScheme()
  const { controls, config } = useConfig()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [vs, setVs] = useState<ViewState | null>(null)
  const ctrl = useMemo(() => (api ? new CanvasController(api, services) : null), [api, services])
  const raf = useRef<number | null>(null)
  const lastSig = useRef('')
  const wrap = useRef<HTMLDivElement>(null)
  const [undo, offerUndo, runUndo] = useUndo()
  const [confirming, setConfirming] = useState<{ ids: string[]; text: string; at: Pt } | null>(null)

  const initialData = useMemo(() => {
    if (initial?.elements?.length) return { elements: initial.elements, files: initial.files, scrollToContent: true }
    return { elements: makeSketchFrame(newId('sketch')), scrollToContent: true, appState: { currentItemStrokeWidth: 2 } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(() => {
    if (!api) return
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = null
      const st = api.getAppState()
      const els = api.getSceneElements() as El[]
      const version = getSceneVersion(els)
      const selected = Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k])
      const sig = `${st.scrollX}|${st.scrollY}|${st.zoom.value}|${st.offsetLeft}|${st.offsetTop}|${selected.join(',')}|${version}`
      if (sig === lastSig.current) return
      lastSig.current = sig
      setVs({ scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom, offsetLeft: st.offsetLeft, offsetTop: st.offsetTop, selected, els, version })
    })
  }, [api])

  // Land canvas results; mirror job states into customData.
  useEffect(() => {
    if (!ctrl) return
    return runner.onComplete('canvas', (job) => void ctrl.land(job))
  }, [ctrl, runner])
  useEffect(() => {
    if (!ctrl) return
    ctrl.syncGenStates(docStore.get())
    return docStore.onChange((d) => ctrl.syncGenStates(d))
  }, [ctrl, docStore])

  // Excalidraw measures its container; tell it when the stage comes back into view.
  useEffect(() => {
    if (active && api) {
      api.refresh()
      refresh()
    }
  }, [active, api, refresh])

  // A fresh canvas: fit the sketch frame in view.
  useEffect(() => {
    if (!api || initial?.elements?.length) return
    const t = setTimeout(() => {
      const f = sketchFrame(api.getSceneElements() as El[])
      if (f) api.scrollToContent(f, { fitToViewport: true, viewportZoomFactor: 0.7 })
    }, 50)
    return () => clearTimeout(t)
  }, [api, initial])

  useEffect(() => {
    if (!api) return
    const off = api.onScrollChange(() => refresh())
    refresh()
    return off
  }, [api, refresh])

  const onChange = useCallback(() => {
    ctrl?.onChange()
    refresh()
  }, [ctrl, refresh])

  const toView = useCallback((p: Pt): Pt => {
    if (!vs) return p
    const v = sceneCoordsToViewportCoords({ sceneX: p.x, sceneY: p.y }, { zoom: vs.zoom, offsetLeft: vs.offsetLeft, offsetTop: vs.offsetTop, scrollX: vs.scrollX, scrollY: vs.scrollY })
    return { x: v.x - vs.offsetLeft, y: v.y - vs.offsetTop }
  }, [vs])

  const els = useMemo(() => (vs ? alive(vs.els) : []), [vs])
  const selected = useMemo(() => els.filter((e) => vs?.selected.includes(e.id)), [els, vs])
  const zoom = vs?.zoom.value ?? 1

  const doDelete = useCallback((ids: string[]) => {
    if (!ctrl) return
    setConfirming(null)
    const r = ctrl.deleteElements(ids)
    if (r) offerUndo({ label: r.label, at: r.at, undo: () => ctrl.undelete(r.ids) })
  }, [ctrl, offerUndo])

  /** The 🗑 and the Delete key: straight away, or first a confirm when something is still being made. */
  const requestDelete = useCallback((sel: El[]) => {
    if (!ctrl) return
    const targets = ctrl.deletable(sel)
    if (!targets.length) return
    const ids = targets.map((e) => e.id)
    const running = targets.map((e) => cd(e)).filter((c): c is Extract<CustomData, { kind: 'gen' }> => c?.kind === 'gen')
      .map((c) => docStore.get().jobs.find((j) => j.id === c.id)).filter((j) => j && isActive(runner.liveInfo(j.id)?.state ?? j.state))
    if (running.length) {
      const b = bounds(targets)
      setConfirming({ ids, text: cancelText(running[0], config, true), at: { x: b.minX + b.w / 2, y: b.minY } })
      return
    }
    doDelete(ids)
  }, [ctrl, docStore, runner, config, doDelete])

  // The Delete key on references and generated images goes through the same path
  // (one entry, the inline Undo); other drawings are Excalidraw's own.
  useEffect(() => {
    const el = wrap.current
    if (!el || !ctrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      const st = ctrl.api.getAppState()
      const ids = Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k])
      const sel = alive(ctrl.api.getSceneElements() as El[]).filter((x) => ids.includes(x.id))
      if (!sel.some((x) => cd(x)?.kind === 'ref' || cd(x)?.kind === 'gen')) return
      e.preventDefault()
      e.stopPropagation()
      requestDelete(sel)
    }
    el.addEventListener('keydown', onKey, true)
    return () => el.removeEventListener('keydown', onKey, true)
  }, [ctrl, requestDelete])

  const hasUserMarks = els.some((e) => isUserDrawing(e) || cd(e)?.kind === 'ref' || cd(e)?.kind === 'gen')
  const showHint = !ui.hintDismissed && !hasUserMarks && doc.character.refs.length === 0

  return (
    <div className="character">
      <div className="canvas-wrap" ref={wrap}>
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={initialData}
          onChange={onChange}
          theme={theme}
          name="napkin-character"
          UIOptions={{
            canvasActions: { loadScene: false, export: false, saveToActiveFile: false, saveAsImage: false, toggleTheme: false, clearCanvas: true, changeViewBackgroundColor: true },
            tools: { image: true },
          }}
        />
        <div className="overlay-layer">
          <FlowArrows els={els} toView={toView} />
          {els.map((e) => {
            const c = cd(e)
            if (c?.kind === 'ref') return <RefChips key={e.id} el={e} c={c} at={toView({ x: e.x, y: e.y })} onTag={(v) => ctrl?.setRefTag(e.id, v)} />
            if (c?.kind === 'gen') return <GenOverlay key={e.id} el={e} c={c} toView={toView} zoom={zoom} ctrl={ctrl} />
            return null
          })}
          {ctrl && controls.generate && <SketchGenerate ctrl={ctrl} els={els} toView={toView} />}
          {ctrl && selected.length > 0 && !confirming && <FloatingToolbar ctrl={ctrl} selected={selected} toView={toView} onDelete={requestDelete} />}
          {confirming && (() => {
            const p = toView(confirming.at)
            return (
              <Floating className="toolbar confirming" anchor={{ x: p.x, top: p.y, bottom: p.y }}>
                <InlineConfirm text={confirming.text} yes="Stop and remove" onYes={() => doDelete(confirming.ids)} onNo={() => setConfirming(null)} />
              </Floating>
            )
          })()}
          {undo?.at && (() => {
            const p = toView(undo.at)
            return <UndoChip className="oncanvas" label={undo.label} onUndo={runUndo} style={{ left: p.x, top: p.y }} />
          })()}
        </div>
        {showHint && (
          <div className="hint3" aria-hidden>
            <div className="step"><div className="n">1</div><b>Tag</b><span>Drop or paste pictures. Rename each tag, like <span className="mono">@eyes</span>.</span></div>
            <div className="step"><div className="n">2</div><b>Draw</b><span>Draw your character in the frame. Select pictures to combine them.</span></div>
            <div className="step"><div className="n">3</div><b>Generate</b><span>Press <b style={{ display: 'inline' }}>Generate front view</b> under the frame. It lands beside your sketch.</span></div>
          </div>
        )}
      </div>
      <ViewsDock ctrl={ctrl} els={els} />
    </div>
  )
}

// ── The always-visible Generate button under the sketch frame (D9) ──────────

function SketchGenerate({ ctrl, els, toView }: { ctrl: CanvasController; els: El[]; toView: (p: Pt) => Pt }) {
  const { controls } = useConfig()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const frame = sketchFrame(els)
  if (!frame) return null
  const at = toView({ x: frame.x + frame.width / 2, y: frame.y + frame.height })
  return (
    <div className="sketch-cta" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await ctrl.generateFront(more)
          } catch (e) {
            setError(e instanceof Error ? e.message : 'That did not work. Try again.')
          } finally {
            setBusy(false)
          }
        }}>{busy ? 'Preparing…' : 'Generate front view'}</button>
        {/* 4 variants are cut for Wednesday (D9): only with the moreOptions flag. */}
        {controls.moreOptions && <button className={`btn sm ${more ? 'on' : ''}`} title="Ask for 4 options instead of 1" onClick={() => setMore(!more)}>4 options</button>}
      </div>
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  )
}

// ── Ref chips: badge and editable tag ───────────────────────────────────────

function RefChips({ el, c, at, onTag }: { el: El; c: Extract<CustomData, { kind: 'ref' }>; at: Pt; onTag: (v: string) => void }) {
  const doc = useDoc()
  const label = doc.character.refs.find((r) => r.id === c.id)?.label
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? c.tag
  void el
  return (
    <div className="refchips" style={{ left: at.x, top: at.y }}>
      <span className="badge" title="Badge (display only)">{c.badge}</span>
      <input
        className="tagchip"
        aria-label="Tag"
        title={label && label !== c.tag ? `You typed “${label}”; prompts use @${c.tag}` : 'Rename this tag'}
        value={draft === null ? `@${value}` : value}
        size={Math.max(6, value.length + 2)}
        onFocus={() => setDraft(c.tag)}
        onChange={(e) => setDraft(e.target.value.replace(/^@/, ''))}
        onBlur={() => {
          if (draft !== null && draft !== c.tag) onTag(draft)
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
          e.stopPropagation()
        }}
      />
      {/* The role chip is hidden for Wednesday (D9); roles stay in the data, default 'other'. */}
    </div>
  )
}

// ── Generated images: pending / error in place, labels when done ────────────

function GenOverlay({ el, c, toView, zoom, ctrl }: { el: El; c: Extract<CustomData, { kind: 'gen' }>; toView: (p: Pt) => Pt; zoom: number; ctrl: CanvasController | null }) {
  const { runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const showMock = useShowMock()
  const job = doc.jobs.find((j) => j.id === c.id)
  const live = runner.liveInfo(c.id)
  const state = live?.state ?? job?.state ?? c.state
  const tl = toView({ x: el.x, y: el.y })
  const w = el.width * zoom
  const h = el.height * zoom
  const dismissed = ui.jobCtx[c.id]?.dismissed
  const showNode = (isActive(state) || state === 'failed' || state === 'cancelled') && !dismissed && !(state === 'completed')
  const views = Object.entries(doc.character.views).filter(([, p]) => p?.job_id === c.id).map(([v]) => v as View)
  return (
    <>
      {showNode && (
        <div className="gennode" style={{ left: tl.x, top: tl.y, width: w, height: h }}>
          <JobNode jobId={c.id} compact={w < 170} onRetried={(id) => ctrl?.retarget(c.id, id)} />
        </div>
      )}
      {state === 'completed' && (
        <div className="genlabel" style={{ left: tl.x, top: tl.y }}>
          {views.map((v) => <span key={v} className="pill view">{viewLabel(v)} ✓</span>)}
          {!views.length && c.view && <span className="pill">{viewLabel(c.view)}</span>}
          {/* Not picked for any view yet: selecting it opens the "Set as" choices. */}
          {!views.length && !c.view && (
            <button className="pill pick" title="Set it as the front, 3/4, side or back view" onClick={() => ctrl?.api.updateScene({ appState: { selectedElementIds: { [el.id]: true } } })}>Use as…</button>
          )}
          {showMock && c.mock && <span className="mockbadge">MOCK</span>}
        </div>
      )}
    </>
  )
}

// ── The signature: provenance arrows flow in the brand colour while running ──

function FlowArrows({ els, toView }: { els: El[]; toView: (p: Pt) => Pt }) {
  const { runner } = useServices()
  const doc = useDoc()
  const paths: string[] = []
  for (const a of els) {
    const c = cd(a)
    if (c?.kind !== 'provenance' || a.type !== 'arrow') continue
    const job = doc.jobs.find((j) => j.id === c.to)
    const state = runner.liveInfo(c.to)?.state ?? job?.state
    if (!state || !isActive(state)) continue
    const pts = (a as El & { points: readonly [number, number][] }).points.map(([x, y]) => toView({ x: a.x + x, y: a.y + y }))
    if (pts.length < 2) continue
    paths.push(`M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`)
  }
  if (!paths.length) return null
  return (
    <svg className="flow" aria-hidden>
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

// ── The floating toolbar on the selection ───────────────────────────────────

function FloatingToolbar({ ctrl, selected, toView, onDelete }: { ctrl: CanvasController; selected: El[]; toView: (p: Pt) => Pt; onDelete: (sel: El[]) => void }) {
  const doc = useDoc()
  const { controls } = useConfig()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [combining, setCombining] = useState(false)
  const [more, setMore] = useState(false)
  const selKey = selected.map((e) => e.id).join(',')
  const [lastKey, setLastKey] = useState(selKey)
  if (lastKey !== selKey) {
    setLastKey(selKey)
    setError(null)
    setCombining(false)
  }

  const meaningful = selected.filter((e) => cd(e)?.kind !== 'provenance')
  if (!meaningful.length) return null
  const b = bounds(meaningful)
  const raw = toView({ x: b.minX + b.w / 2, y: b.minY })
  // Above the selection and its label row; useFloating keeps it inside the canvas.
  const chipRow = meaningful.some((e) => cd(e)?.kind === 'ref' || cd(e)?.kind === 'gen') ? 30 : 0
  const at: Anchor = { x: raw.x, top: raw.y - chipRow, bottom: toView({ x: b.minX, y: b.maxY }).y }

  const all = ctrl.api.getSceneElements() as El[]
  const frame = sketchFrame(all)
  const frameSelected = !!frame && meaningful.some((e) => e.id === frame.id) && meaningful.every((e) => e.id === frame.id || e.frameId === frame.id)
  const gens = meaningful.filter((e) => cd(e)?.kind === 'gen')
  const singleDoneGen = meaningful.length === 1 && gens.length === 1 && (cd(gens[0]) as Extract<CustomData, { kind: 'gen' }>).state === 'completed'
  const combinable = meaningful.length >= 2 && meaningful.length <= 4 && meaningful.every((e) => {
    const c = cd(e)
    return c?.kind === 'ref' || (c?.kind === 'gen' && !!c.asset)
  })
  const drawings = meaningful.filter((e) => isUserDrawing(e) && (!frame || e.frameId !== frame.id))
  const asRef = drawings.length > 0 && drawings.length === meaningful.length
  const singleRef = meaningful.length === 1 && cd(meaningful[0])?.kind === 'ref'

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const groups: React.ReactNode[] = []
  if (frameSelected && controls.generate) {
    groups.push(
      <span key="gen" className="row">
        <button className="btn sm primary" disabled={!!busy} onClick={() => run('gen', () => ctrl.generateFront(more))}>{busy === 'gen' ? 'Preparing…' : 'Generate front view'}</button>
        {controls.moreOptions && <button className={`btn sm ${more ? 'on' : ''}`} title="Ask for 4 options instead of 1" onClick={() => setMore(!more)}>4 options</button>}
      </span>,
    )
  }
  if (combinable && controls.combine) {
    groups.push(<button key="combine" className="btn sm dark" disabled={!!busy} onClick={() => setCombining(true)}>Combine {meaningful.length} items</button>)
  }
  if (singleDoneGen) {
    const g = cd(gens[0]) as Extract<CustomData, { kind: 'gen' }>
    groups.push(
      <span key="views" className="row">
        <span className="lbl">Set as</span>
        {SLOTS.map((v) => {
          const on = doc.character.views[v]?.job_id === g.id
          return <button key={v} className={`btn xs ${on ? 'on' : ''}`} onClick={() => ctrl.pickView(g.id, v)}>{viewLabel(v)}</button>
        })}
      </span>,
    )
  }
  if (asRef) {
    groups.push(<button key="asref" className="btn sm" disabled={!!busy} onClick={() => run('ref', () => ctrl.drawingToRef(drawings.map((d) => d.id)))}>{busy === 'ref' ? 'Saving…' : 'Use as reference'}</button>)
  }
  if (singleRef) {
    groups.push(<button key="unref" className="btn xs ghost" onClick={() => ctrl.removeRef(meaningful[0].id)}>Not a reference</button>)
  }
  if (ctrl.deletable(meaningful).length) {
    groups.push(<button key="del" className="btn sm icon ghost iconbtn-del" aria-label="Delete" title="Delete (Undo for a few seconds, or Ctrl+Z)" onClick={() => onDelete(meaningful)}>🗑</button>)
  }
  if (!groups.length && !error) return null

  if (combining) {
    return <CombinePopover ctrl={ctrl} ids={meaningful.map((e) => e.id)} at={at} onClose={() => setCombining(false)} />
  }

  return (
    <Floating className="toolbar" anchor={at}>
      {groups.map((g, i) => (
        <span key={i} className="row">
          {i > 0 && <span className="sep" />}
          {g}
        </span>
      ))}
      {error && <span className="row" role="alert" style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600, padding: '0 6px' }}>{error}</span>}
    </Floating>
  )
}

/** A toolbar or popover over the canvas, kept fully inside it (flips below the selection at the top). */
function Floating({ className, anchor, children }: { className: string; anchor: Anchor; children: React.ReactNode }) {
  const { ref, style } = useFloating<HTMLDivElement>(anchor)
  return <div ref={ref} className={className} style={style} onPointerDown={(e) => e.stopPropagation()}>{children}</div>
}

function CombinePopover({ ctrl, ids, at, onClose }: { ctrl: CanvasController; ids: string[]; at: Anchor; onClose: () => void }) {
  const items = ctrl.combineItems(ids)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const insert = (tag: string) => {
    const t = ref.current
    const add = `@${tag} `
    if (!t) return setText(text + add)
    const s = t.selectionStart ?? text.length
    const next = text.slice(0, s) + add + text.slice(t.selectionEnd ?? s)
    setText(next)
    requestAnimationFrame(() => {
      t.focus()
      t.selectionStart = t.selectionEnd = s + add.length
    })
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await ctrl.combine(ids, text.trim())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Floating className="popover" anchor={at}>
      <h3>Combine {items.length} pictures</h3>
      <div className="faint" style={{ fontSize: 12.5 }}>Say what to take from each. Tap a tag to add it.</div>
      <div className="taghints">
        {items.map((i) => <button key={i.id} className="taghint" onClick={() => insert(i.tag)}>@{i.tag}</button>)}
      </div>
      <textarea
        ref={ref}
        className="textarea"
        maxLength={1000}
        placeholder={`e.g. the character from @${items[0]?.tag ?? 'ref_1'} wearing the hat from @${items[1]?.tag ?? 'ref_2'}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void submit()
          if (e.key === 'Escape') onClose()
        }}
      />
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>{error}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <span className="faint" style={{ fontSize: 11.5 }}>{text.length}/1000</span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onClose}>Cancel</button>
        <button className="btn sm primary" disabled={!text.trim() || busy} onClick={submit}>{busy ? 'Sending…' : 'Combine'}</button>
      </div>
    </Floating>
  )
}

// ── The views strip and Lock ────────────────────────────────────────────────

function ViewsDock({ ctrl, els }: { ctrl: CanvasController | null; els: El[] }) {
  const doc = useDoc()
  const { runner, doc: docStore } = useServices()
  const { controls } = useConfig()
  useJobsTick()
  const [open, setOpen] = useState<View | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const front = doc.character.views.front

  const gens = els.filter((e) => cd(e)?.kind === 'gen').map((e) => cd(e) as Extract<CustomData, { kind: 'gen' }>)
  const runningFor = (v: View) => gens.some((g) => g.op === 'view' && g.view === v && isActive(runner.liveInfo(g.id)?.state ?? doc.jobs.find((j) => j.id === g.id)?.state ?? 'completed'))
  const viewsRunning = SLOTS.slice(1).some(runningFor)
  const candidates = (v: View) =>
    gens.filter((g) => g.state === 'completed' && g.asset && (g.view === v || g.pickedAs === v || (v === 'front' && (g.op === 'generate' || g.op === 'combine'))))

  const lock = () => {
    updateDoc(docStore, (d) => {
      d.character.locked = true
      d.character.locked_at = new Date().toISOString()
      d.stage = { current: 'storyboard', next_action: 'Write a short script and plan the shots.' }
    }, 'lock character')
  }

  return (
    <div className="dock">
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Character views</div>
        <div className="views">
          {SLOTS.map((v) => (
            <Slot key={v} view={v} sha={doc.character.views[v]?.asset} running={runningFor(v)} active={open === v} onClick={() => setOpen(open === v ? null : v)} />
          ))}
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {controls.views && (
          <button className="btn" disabled={!front || viewsRunning || busy || !ctrl} title={front ? (controls.angles ? 'Made by exact camera angle' : 'Made from your front view') : 'Set a Front view first'}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await ctrl!.makeViews()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That did not work.')
              } finally {
                setBusy(false)
              }
            }}>
            {viewsRunning ? 'Making views…' : 'Make the other views'}
          </button>
        )}
        {controls.views && controls.angles && <span className="faint" style={{ fontSize: 11.5 }}>Made by exact camera angle</span>}
        {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>{error}</span>}
      </div>
      <span className="spacer" />
      <div className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
        <span className="faint" style={{ fontSize: 12 }}>{front ? (doc.character.locked ? 'Character locked. You can still change views.' : 'Happy with it? Lock it and plan your ad.') : 'Pick a Front view to continue.'}</span>
        <button className="btn primary" disabled={!front} onClick={doc.character.locked ? () => updateDoc(docStore, (d) => { d.stage.current = 'storyboard' }) : lock}>
          {doc.character.locked ? 'Go to Storyboard →' : 'Lock character → Storyboard'}
        </button>
      </div>
      {open && (
        <div className="candidates" onPointerDown={(e) => e.stopPropagation()}>
          <div className="row">
            <b>{viewLabel(open)}</b>
            <span className="faint" style={{ fontSize: 12 }}>{candidates(open).length ? 'Pick one' : 'No candidates yet'}</span>
            <span className="spacer" />
            <button className="btn xs ghost" onClick={() => setOpen(null)}>Close</button>
          </div>
          <div className="grid">
            {candidates(open).map((g) => (
              <Candidate key={g.id} sha={g.asset!} picked={doc.character.views[open]?.job_id === g.id} onPick={() => ctrl?.pickView(g.id, open)} onShow={() => ctrl?.scrollTo(g.id)} />
            ))}
            {!candidates(open).length && <span className="faint" style={{ fontSize: 12.5, maxWidth: 360 }}>{open === 'front' ? 'Select your sketch frame and press Generate front view.' : 'Set a Front view, then press Make the other views.'}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function Slot({ view, sha, running, active, onClick }: { view: View; sha?: string; running: boolean; active: boolean; onClick: () => void }) {
  const url = useBlobUrl(sha)
  return (
    <button className={`slot ${view} ${sha ? 'filled' : ''} ${active ? 'active' : ''}`} onClick={onClick} title={`${viewLabel(view)} view`}>
      {url && <img src={url} alt="" />}
      {running && <span className="pend"><span className="spinner" /></span>}
      <span className="name">{viewLabel(view)}</span>
    </button>
  )
}

function Candidate({ sha, picked, onPick, onShow }: { sha: string; picked: boolean; onPick: () => void; onShow: () => void }) {
  const url = useBlobUrl(sha)
  return (
    <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
      <button className={`cand ${picked ? 'picked' : ''}`} onClick={onPick} title="Use this one">{url && <img src={url} alt="" />}</button>
      <button className="btn xs ghost" onClick={onShow}>Show</button>
    </div>
  )
}
