// Stage 1: a free canvas (Excalidraw). Draw, write or drop pictures anywhere;
// every picture, drawing, note and result is a node. Select any of them and the
// floating toolbar offers Generate (the result lands beside them, or where you
// click), Name (key_variant, like @maya_laughing), Set as front, and Make the
// other views. Curved arrows show what each result was made from. The dock
// below lists the named references (solid keys), publishes them to the
// workspace library, imports from it, and cleans up unused pictures.

import { Excalidraw, getSceneVersion, sceneCoordsToViewportCoords, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import { CanvasController, OTHER_VIEWS, viewLabel, type CanvasSnapshot } from '../canvas/controller'
import { alive, bounds, cd, imageOf, isText, isUserDrawing, type El } from '../canvas/scene'
import type { CustomData, KeyEntry, LibraryIndex, ModelChoice, NamedRef, RefRole, View } from '../contracts/types'
import { choiceToSend } from '../capabilities'
import { lastWorkedModel } from '../jobs/follow'
import { ModelPick } from '../ui/ModelPick'
import { REF_ROLES } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { sweep, unused } from '../doc/gc'
import { isActive } from '../jobs/runner'
import { deleteBlob } from '../lib/blobs'
import { cleanKey, cleanVariant, nameOf, nameProblem, refByName, wholeKeys } from '../lib/names'
import { useBlobUrl, useColorScheme, useFloating } from '../ui/hooks'
import type { Anchor } from '../lib/place'
import { JobNode } from '../ui/JobNode'
import { cancelText } from '../ui/cancel'
import { InlineConfirm, UndoChip } from '../ui/Undo'
import { useUndo } from '../ui/useUndo'
import { RelayError } from '../relay'

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

const errText = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.')

export function Character({ initial, active }: { initial: CanvasSnapshot | null; active: boolean }) {
  const services = useServices()
  const { runner, doc: docStore } = services
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const theme = useColorScheme()
  const { config, controls } = useConfig()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [vs, setVs] = useState<ViewState | null>(null)
  const ctrl = useMemo(() => (api ? new CanvasController(api, services) : null), [api, services])
  // Switching project or going Home: the canvas is saved first (features/project-home.clan).
  useEffect(() => {
    if (!ctrl) return
    const save = () => ctrl.save()
    services.project.beforeClose.add(save)
    return () => void services.project.beforeClose.delete(save)
  }, [ctrl, services])
  const raf = useRef<number | null>(null)
  const lastSig = useRef('')
  const wrap = useRef<HTMLDivElement>(null)
  const [undo, offerUndo, runUndo] = useUndo()
  const [confirming, setConfirming] = useState<{ ids: string[]; text: string; at: Pt } | null>(null)
  /** Waiting for a click that says where the next result goes. */
  const [placing, setPlacing] = useState<{ ids: string[]; text: string; more: boolean; modelChoice?: ModelChoice } | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)

  const initialData = useMemo(() => {
    if (initial?.elements?.length) return { elements: initial.elements, files: initial.files, scrollToContent: true }
    return { elements: [], appState: { currentItemStrokeWidth: 2 } }
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
  const limits = useMemo(() => ({ max: controls.generateMax, characters: controls.generateCharacters }), [controls.generateMax, controls.generateCharacters])

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

  // The Delete key on the tool's nodes goes through the same path (one entry, the inline
  // Undo); plain drawings are Excalidraw's own. Escape leaves place mode.
  useEffect(() => {
    const el = wrap.current
    if (!el || !ctrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && placing) {
        setPlacing(null)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      const st = ctrl.api.getAppState()
      const ids = Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k])
      const sel = alive(ctrl.api.getSceneElements() as El[]).filter((x) => ids.includes(x.id))
      if (!sel.some((x) => imageOf(x))) return
      e.preventDefault()
      e.stopPropagation()
      requestDelete(sel)
    }
    el.addEventListener('keydown', onKey, true)
    return () => el.removeEventListener('keydown', onKey, true)
  }, [ctrl, requestDelete, placing])

  /** The click that places a result: the new node's top-left goes there. */
  const onPlace = useCallback(async (e: React.PointerEvent) => {
    if (!placing || !ctrl || !api) return
    e.preventDefault()
    e.stopPropagation()
    const st = api.getAppState()
    const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st)
    const job = placing
    setPlacing(null)
    try {
      await ctrl.generate(job.ids, job.text, { at: { x: p.x - 150, y: p.y - 200 }, more: job.more, limits, modelChoice: job.modelChoice })
    } catch (err) {
      setPlaceError(errText(err))
    }
  }, [placing, ctrl, api, limits])

  const hasMarks = els.some((e) => isUserDrawing(e) || isText(e) || !!imageOf(e))
  const showHint = !ui.hintDismissed && !hasMarks && doc.refs.length === 0

  return (
    <div className="character">
      <div className="canvas-wrap" ref={wrap}>
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={initialData}
          onChange={onChange}
          theme={theme}
          name="napkin-canvas"
          UIOptions={{
            canvasActions: { loadScene: false, export: false, saveToActiveFile: false, saveAsImage: false, toggleTheme: false, clearCanvas: true, changeViewBackgroundColor: true },
            tools: { image: true },
          }}
        />
        <div className="overlay-layer">
          <FlowArrows els={els} toView={toView} />
          {els.map((e) => {
            const img = imageOf(e)
            const c = cd(e)
            const named = img ? doc.refs.find((r) => r.node === img.id) : undefined
            return (
              <span key={e.id}>
                {named && <NameChip r={named} at={toView({ x: e.x, y: e.y })} />}
                {c?.kind === 'gen' && <GenOverlay el={e} c={c} toView={toView} zoom={zoom} ctrl={ctrl} named={!!named} />}
              </span>
            )
          })}
          {ctrl && selected.length > 0 && !confirming && !placing && (
            <FloatingToolbar ctrl={ctrl} selected={selected} toView={toView} onDelete={requestDelete} limits={limits}
              onPlace={(ids, text, more, modelChoice) => { setPlaceError(null); setPlacing({ ids, text, more, modelChoice }) }} />
          )}
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
        {placing && (
          <div className="placing" onPointerDown={onPlace} role="button" aria-label="Click where the new image goes">
            <div className="placing-hint">Click where the new image goes · <button className="btn xs ghost" onPointerDown={(e) => { e.stopPropagation(); setPlacing(null) }}>Cancel</button></div>
          </div>
        )}
        {placeError && <div className="place-error" role="alert">{placeError} <button className="btn xs ghost" onClick={() => setPlaceError(null)}>OK</button></div>}
        {showHint && (
          <div className="hint3" aria-hidden>
            <div className="step"><div className="n">1</div><b>Make</b><span>Draw, write or drop pictures anywhere on the canvas.</span></div>
            <div className="step"><div className="n">2</div><b>Generate</b><span>Select any of them, then <b style={{ display: 'inline' }}>Generate</b>. Results are new nodes you can use again.</span></div>
            <div className="step"><div className="n">3</div><b>Name</b><span>Name the ones you keep, like <span className="mono">@maya_front</span>. Your script uses those names.</span></div>
          </div>
        )}
      </div>
      <RefsDock ctrl={ctrl} els={els} />
    </div>
  )
}

// ── The name on a named node ────────────────────────────────────────────────

function NameChip({ r, at }: { r: NamedRef; at: Pt }) {
  return (
    <div className="refchips" style={{ left: at.x, top: at.y }}>
      <span className="tagchip" title="Its name: write it with @ in instructions and shots">@{nameOf(r)}</span>
    </div>
  )
}

// ── Generated images: pending / error in place, labels when done ────────────

function GenOverlay({ el, c, toView, zoom, ctrl, named }: { el: El; c: Extract<CustomData, { kind: 'gen' }>; toView: (p: Pt) => Pt; zoom: number; ctrl: CanvasController | null; named: boolean }) {
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
  const showNode = (isActive(state) || state === 'failed' || state === 'cancelled') && !dismissed && state !== 'completed'
  return (
    <>
      {showNode && (
        <div className="gennode" style={{ left: tl.x, top: tl.y, width: w, height: h }}>
          <JobNode jobId={c.id} compact={w < 170} onRetried={(id) => ctrl?.retarget(c.id, id)} />
        </div>
      )}
      {state === 'completed' && !named && (
        <div className="genlabel" style={{ left: tl.x, top: tl.y }}>
          {c.view && <span className="pill">{viewLabel(c.view)}</span>}
          {showMock && c.mock && <span className="mockbadge">MOCK</span>}
        </div>
      )}
    </>
  )
}

// ── The signature: provenance arrows flow in the brand colour while running ──

/** An SVG path through the arrow's points: a smooth curve through the middle one when there are three. */
function curvePath(pts: Pt[]): string {
  if (pts.length === 3) {
    const [a, m, b] = pts
    // The quadratic whose curve passes through m at its midpoint.
    const c = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 }
    return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`
  }
  return `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`
}

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
    paths.push(curvePath(pts))
  }
  if (!paths.length) return null
  return (
    <svg className="flow" aria-hidden>
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

// ── The floating toolbar on the selection ───────────────────────────────────

type Popover = null | 'generate' | 'name'

function FloatingToolbar({ ctrl, selected, toView, onDelete, onPlace, limits }: {
  ctrl: CanvasController
  selected: El[]
  toView: (p: Pt) => Pt
  onDelete: (sel: El[]) => void
  onPlace: (ids: string[], text: string, more: boolean, modelChoice?: ModelChoice) => void
  limits: { max: number; characters: number }
}) {
  const doc = useDoc()
  const { controls, config } = useConfig()
  // The model for Make the other views: the last that worked for views, or the one picked here.
  const [viewPick, setViewPick] = useState<ModelChoice | undefined>()
  const viewChoice = viewPick ?? lastWorkedModel(doc, 'view', config)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Popover>(null)
  const [nameVariant, setNameVariant] = useState<string | undefined>(undefined)
  const selKey = selected.map((e) => e.id).join(',')
  const [lastKey, setLastKey] = useState(selKey)
  if (lastKey !== selKey) {
    setLastKey(selKey)
    setError(null)
    setOpen(null)
  }

  const meaningful = selected.filter((e) => cd(e)?.kind !== 'provenance')
  if (!meaningful.length) return null
  const b = bounds(meaningful)
  const raw = toView({ x: b.minX + b.w / 2, y: b.minY })
  const chipRow = meaningful.some((e) => imageOf(e)) ? 30 : 0
  const at: Anchor = { x: raw.x, top: raw.y - chipRow, bottom: toView({ x: b.minX, y: b.maxY }).y }
  const ids = meaningful.map((e) => e.id)

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }

  const preview = ctrl.preview(ids)
  const usable = preview.inputs.length + preview.drawings + preview.notes.length > 0
  const single = meaningful.length === 1 ? imageOf(meaningful[0]) : undefined
  const singleImage = single?.asset ? single : undefined
  const named = singleImage ? doc.refs.find((r) => r.node === singleImage.id) : undefined

  if (open === 'generate') {
    return <GeneratePopover ctrl={ctrl} ids={ids} at={at} limits={limits} onClose={() => setOpen(null)} onPlace={onPlace} />
  }
  if (open === 'name' && singleImage) {
    return <NamePopover ctrl={ctrl} nodeId={singleImage.id} current={named} presetVariant={nameVariant} at={at} onClose={() => setOpen(null)} />
  }

  const groups: React.ReactNode[] = []
  if (usable && controls.generate) {
    groups.push(<button key="gen" className="btn sm primary" disabled={!!busy || preview.pending > 0} title={preview.pending ? 'One of these is still being made' : undefined} onClick={() => setOpen('generate')}>Generate</button>)
  }
  if (singleImage) {
    groups.push(
      <span key="name" className="row">
        <button className="btn sm" onClick={() => { setNameVariant(undefined); setOpen('name') }}>{named ? `@${nameOf(named)}` : 'Name…'}</button>
        {named?.variant !== 'front' && (
          <button className="btn sm" title="Make this the front of a character or object" onClick={() => {
            if (named) void run('front', () => ctrl.name(singleImage.id, named.key, 'front'))
            else {
              setNameVariant('front')
              setOpen('name')
            }
          }}>Set as front</button>
        )}
        {named?.variant === 'front' && controls.views && (
          <>
            <ModelPick op="view" value={viewChoice} onChange={setViewPick} />
            <button className="btn sm dark" disabled={!!busy} onClick={() => run('views', () => ctrl.makeViews(named.key, undefined, choiceToSend('view', config, viewChoice)))}>{busy === 'views' ? 'Starting…' : 'Make the other views'}</button>
          </>
        )}
        {named && <button className="btn xs ghost" onClick={() => ctrl.unname(singleImage.id)}>Remove name</button>}
      </span>,
    )
  }
  if (ctrl.deletable(meaningful).length) {
    groups.push(<button key="del" className="btn sm icon ghost iconbtn-del" aria-label="Delete" title="Delete (Undo for a few seconds, or Ctrl+Z)" onClick={() => onDelete(meaningful)}>🗑</button>)
  }
  if (!groups.length && !error) return null

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

const KIND_WORD = { pic: 'picture', drawn: 'drawing', gen: 'result' } as const

function GeneratePopover({ ctrl, ids, at, limits, onClose, onPlace }: {
  ctrl: CanvasController
  ids: string[]
  at: Anchor
  limits: { max: number; characters: number }
  onClose: () => void
  onPlace: (ids: string[], text: string, more: boolean, modelChoice?: ModelChoice) => void
}) {
  const doc = useDoc()
  const { controls, config } = useConfig()
  const preview = ctrl.preview(ids)
  // The model for this Generate: the last that worked for pictures, or the one picked here.
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const choice = pick ?? lastWorkedModel(doc, 'generate', config)
  const modelChoice = choiceToSend('generate', config, choice)
  const [text, setText] = useState('')
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const insert = (name: string) => {
    const t = ref.current
    const add = `@${name} `
    if (!t) return setText(text + add)
    const s = t.selectionStart ?? text.length
    setText(text.slice(0, s) + add + text.slice(t.selectionEnd ?? s))
    requestAnimationFrame(() => {
      t.focus()
      t.selectionStart = t.selectionEnd = s + add.length
    })
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await ctrl.generate(ids, text, { more, limits, modelChoice })
      onClose()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const count = preview.inputs.length + preview.drawings
  return (
    <Floating className="popover" anchor={at}>
      <h3>Generate from {count ? `${count} ${count === 1 ? 'input' : 'inputs'}` : 'your words'}</h3>
      <div className="taghints">
        {preview.inputs.map((i) => <span key={i.nodeId} className="taghint static">{i.name ? `@${i.name}` : KIND_WORD[i.kind]}</span>)}
        {preview.drawings > 0 && <span className="taghint static">new drawing</span>}
        {preview.notes.map((n, i) => <span key={`n${i}`} className="taghint static" title={n}>“{n.length > 24 ? `${n.slice(0, 23)}…` : n}”</span>)}
      </div>
      {doc.refs.length > 0 && (
        <>
          <div className="faint" style={{ fontSize: 12.5 }}>Tap a name to use it in your words. A bare name is the whole character.</div>
          <div className="taghints">
            {wholeKeys(doc).map((k) => <button key={k} className="taghint whole" title={`${k}: its front and other views`} onClick={() => insert(k)}>@{k}</button>)}
            {doc.refs.map((r) => <button key={r.id} className="taghint" onClick={() => insert(nameOf(r))}>@{nameOf(r)}</button>)}
          </div>
        </>
      )}
      <textarea
        ref={ref}
        className="textarea"
        maxLength={1000}
        placeholder={preview.notes.length ? 'Anything to add to the notes you selected?' : 'What should it make? e.g. the character from the drawing, in the colours of the photo'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          if (e.key === 'Escape') onClose()
        }}
      />
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>{error}</div>}
      <div className="row" style={{ marginTop: 10, gap: 6 }}>
        <span className="faint" style={{ fontSize: 11.5 }}>{text.length}/1000</span>
        {controls.moreOptions && <button className={`btn xs ${more ? 'on' : ''}`} title="Ask for 4 options instead of 1" onClick={() => setMore(!more)}>4 options</button>}
        <ModelPick op="generate" value={choice} onChange={setPick} />
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onClose}>Cancel</button>
        <button className="btn sm" disabled={busy} title="Click on the canvas where it should land" onClick={() => { onClose(); onPlace(ids, text, more, modelChoice) }}>Place…</button>
        <button className="btn sm primary" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Generate'}</button>
      </div>
    </Floating>
  )
}

function NamePopover({ ctrl, nodeId, current, presetVariant, at, onClose }: {
  ctrl: CanvasController
  nodeId: string
  current?: NamedRef
  presetVariant?: string
  at: Anchor
  onClose: () => void
}) {
  const doc = useDoc()
  const [key, setKey] = useState(current?.key ?? doc.keys[0]?.key ?? '')
  const [variant, setVariant] = useState(presetVariant ?? current?.variant ?? '')
  const [role, setRole] = useState<RefRole>('character')
  const [error, setError] = useState<string | null>(null)
  const ck = cleanKey(key)
  const cv = cleanVariant(variant)
  const isNewKey = !!ck && !doc.keys.some((k) => k.key === ck)
  const taken = ck && cv ? refByName(doc, `${ck}_${cv}`) : undefined
  const movesName = taken && taken.node !== nodeId
  const problem = ck || cv ? nameProblem(ck, cv) : null
  const save = () => {
    try {
      ctrl.name(nodeId, ck, cv, role)
      onClose()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Floating className="popover" anchor={at}>
      <h3>{current ? `Rename @${nameOf(current)}` : 'Name this image'}</h3>
      <div className="faint" style={{ fontSize: 12.5 }}>Who or what it is, then what this one shows. Your script uses the name, like <span className="mono">@maya_laughing</span>.</div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <input className="input" list="napkin-keys" aria-label="Character or object" placeholder="maya" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
        <span className="mono">_</span>
        <input className="input" aria-label="What this one shows" placeholder="front, laughing…" value={variant} onChange={(e) => setVariant(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !problem && ck && cv) save()
            if (e.key === 'Escape') onClose()
          }} />
        <datalist id="napkin-keys">{doc.keys.map((k) => <option key={k.key} value={k.key} />)}</datalist>
      </div>
      {isNewKey && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <span className="faint" style={{ fontSize: 12 }}>{ck} is</span>
          <button className={`btn xs ${role === 'character' ? 'on' : ''}`} onClick={() => setRole('character')}>a character</button>
          <button className={`btn xs ${role !== 'character' ? 'on' : ''}`} onClick={() => setRole('prop')}>an object</button>
        </div>
      )}
      {ck && cv && <div className="mono" style={{ marginTop: 8 }}>@{ck}_{cv}</div>}
      {movesName && <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Another image is @{ck}_{cv}. Saving moves the name here, and what was made from the other one is marked out of date.</div>}
      {(problem || error) && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>{problem ?? error}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onClose}>Cancel</button>
        <button className="btn sm primary" disabled={!ck || !cv || !!problem} onClick={save}>{movesName ? 'Move the name here' : 'Save'}</button>
      </div>
    </Floating>
  )
}

// ── References: the solid keys, the library and Clean up ───────────────────

function RefsDock({ ctrl, els }: { ctrl: CanvasController | null; els: El[] }) {
  const doc = useDoc()
  const { doc: docStore, project } = useServices()
  const { controls } = useConfig()
  const [library, setLibrary] = useState(false)
  const [cleaning, setCleaning] = useState<string[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const onCanvas = els.map((e) => imageOf(e)?.asset).filter((x): x is string => !!x)

  const startCleanUp = () => {
    setNote(null)
    const gone = unused(docStore.get(), onCanvas)
    if (!gone.length) return setNote('Nothing to clean up: every picture is still in use.')
    setCleaning(gone)
  }
  const cleanUp = async (gone: string[]) => {
    setCleaning(null)
    await systemUpdate(docStore, (d) => sweep(d, gone), 'clean up')
    // Blobs are shared by every project: a picture another project still uses keeps its bytes.
    await Promise.all(gone.filter((sha) => !project.usedElsewhere(sha)).map((sha) => deleteBlob(sha)))
    setNote(`Removed ${gone.length} unused ${gone.length === 1 ? 'picture' : 'pictures'}.`)
  }

  return (
    <div className="dock refsdock">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>References</div>
        {doc.keys.length === 0 && <span className="faint" style={{ fontSize: 12.5 }}>Name an image (select it, then Name…) to keep it as a reference for your script.</span>}
        <div className="keys">
          {doc.keys.map((k) => <KeyRow key={k.key} k={k} ctrl={ctrl} views={controls.views} />)}
        </div>
      </div>
      <div className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setLibrary(true)} disabled={!ctrl} title="Characters and objects your team published">Team library</button>
          <button className="btn sm ghost" onClick={startCleanUp} title="Remove pictures nothing uses any more">Clean up</button>
        </div>
        {cleaning && <InlineConfirm text={`Remove ${cleaning.length} unused ${cleaning.length === 1 ? 'picture' : 'pictures'} from this browser? Named images and anything on the canvas or in the storyboard stay.`} yes="Remove" onYes={() => void cleanUp(cleaning)} onNo={() => setCleaning(null)} />}
        {note && <span className="faint" style={{ fontSize: 12 }}>{note}</span>}
        <button className="btn primary" disabled={!doc.refs.length} title={doc.refs.length ? undefined : 'Name at least one image first'}
          onClick={() => systemUpdate(docStore, (d) => { d.stage = { current: 'storyboard', next_action: 'Write a short script and plan the shots.' } }, 'stage')}>
          Go to Storyboard →
        </button>
      </div>
      {library && ctrl && <LibraryPanel ctrl={ctrl} onClose={() => setLibrary(false)} />}
    </div>
  )
}

function KeyRow({ k, ctrl, views }: { k: KeyEntry; ctrl: CanvasController | null; views: boolean }) {
  const doc = useDoc()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refs = doc.refs.filter((r) => r.key === k.key)
  const front = refs.find((r) => r.variant === 'front')
  const missingViews = OTHER_VIEWS.filter((v: View) => !refs.some((r) => r.variant === v))
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof RelayError && e.error.code === 'conflict' ? e.message : errText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="keyrow">
      <b className="mono">{k.key}</b>
      <select className="select xs" aria-label={`What ${k.key} is`} value={k.role} onChange={(e) => ctrl?.setRole(k.key, e.target.value as RefRole)}>
        {REF_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <div className="variants">
        {refs.map((r) => <Variant key={r.id} r={r} onShow={() => r.node && ctrl?.scrollTo(r.node)} />)}
      </div>
      {views && front && missingViews.length > 0 && <button className="btn xs" disabled={!!busy || !ctrl} onClick={() => run('views', () => ctrl!.makeViews(k.key, missingViews))}>{busy === 'views' ? 'Starting…' : 'Make views'}</button>}
      <button className="btn xs" disabled={!!busy || !ctrl || !refs.length} title="Share this key with your team" onClick={() => run('publish', () => ctrl!.publish(k.key))}>
        {busy === 'publish' ? 'Publishing…' : k.library ? `Publish v${k.library.ver + 1}` : 'Publish'}
      </button>
      {k.library && <span className="faint" style={{ fontSize: 11.5 }}>v{k.library.ver} · {k.library.workspace}</span>}
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>{error}</span>}
    </div>
  )
}

function Variant({ r, onShow }: { r: NamedRef; onShow: () => void }) {
  const url = useBlobUrl(r.asset)
  return (
    <button className="variant" onClick={onShow} title={`@${nameOf(r)}`}>
      {url && <img src={url} alt="" />}
      <span className="name">{r.variant}</span>
    </button>
  )
}

function LibraryPanel({ ctrl, onClose }: { ctrl: CanvasController; onClose: () => void }) {
  const { relay } = useServices()
  const doc = useDoc()
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    relay.library().then(setIndex, (e) => setError(errText(e)))
  }, [relay])
  const importKey = async (key: string) => {
    setBusy(key)
    setError(null)
    try {
      await ctrl.importEntry(await relay.libraryEntry(key))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="candidates library" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row">
        <b>Team library{index ? ` · ${index.workspace}` : ''}</b>
        <span className="faint" style={{ fontSize: 12 }}>Characters and objects your team published. Importing copies them in.</span>
        <span className="spacer" />
        <button className="btn xs ghost" onClick={onClose}>Close</button>
      </div>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
      {!index && !error && <span className="faint" style={{ fontSize: 12.5 }}>Loading…</span>}
      {index && !index.keys.length && <span className="faint" style={{ fontSize: 12.5 }}>Nothing yet. Publish a key from References to share it.</span>}
      <div className="grid">
        {index?.keys.map((k) => {
          const mine = doc.keys.find((x) => x.key === k.key)
          const newer = mine?.library && mine.library.ver < k.ver
          return (
            <div key={k.key} className="stack libkey" style={{ gap: 4 }}>
              <LibraryCover url={k.cover.url} sha={k.cover.sha256} />
              <b className="mono">{k.key}</b>
              <span className="faint" style={{ fontSize: 11.5 }}>v{k.ver} · @{k.by} · {k.variants.join(', ')}</span>
              <button className="btn xs" disabled={!!busy || (!!mine?.library && !newer)} onClick={() => void importKey(k.key)}>
                {busy === k.key ? 'Importing…' : mine?.library ? (newer ? `Update to v${k.ver}` : 'Up to date') : mine ? 'Import (replaces yours)' : 'Import'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LibraryCover({ url, sha }: { url: string; sha: string }) {
  const local = useBlobUrl(sha)
  return <div className="cand">{(local ?? url) && <img src={local ?? url} alt="" />}</div>
}
