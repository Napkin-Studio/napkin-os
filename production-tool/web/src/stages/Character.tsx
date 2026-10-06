// Stage 1: the character, on an Excalidraw canvas. Pictures get a badge, a tag
// and a role; selecting things shows a floating toolbar (Generate front view,
// Combine…, Set as Front/3/4/Side/Back); results land beside their inputs with
// provenance arrows that flow while the job runs. A docked strip holds the
// four views and the Lock button.

import { Excalidraw, getSceneVersion, sceneCoordsToViewportCoords } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { CanvasController, viewLabel, type CanvasSnapshot } from '../canvas/controller'
import { alive, bounds, cd, isUserDrawing, makeSketchFrame, sketchFrame, type El } from '../canvas/scene'
import type { CustomData, RefRole, View } from '../contracts/types'
import { REF_ROLES } from '../contracts/types'
import { isActive } from '../jobs/runner'
import { newId } from '../lib/ulid'
import { useBlobUrl, useColorScheme } from '../ui/hooks'
import { JobNode } from '../ui/JobNode'
import { updateDoc } from '../doc/store'

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
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [vs, setVs] = useState<ViewState | null>(null)
  const ctrl = useMemo(() => (api ? new CanvasController(api, services) : null), [api, services])
  const raf = useRef<number | null>(null)
  const lastSig = useRef('')

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

  const hasUserMarks = els.some((e) => isUserDrawing(e) || cd(e)?.kind === 'ref' || cd(e)?.kind === 'gen')
  const showHint = !ui.hintDismissed && !hasUserMarks && doc.character.refs.length === 0

  return (
    <div className="character">
      <div className="canvas-wrap">
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
            if (c?.kind === 'ref') return <RefChips key={e.id} el={e} c={c} at={toView({ x: e.x, y: e.y })} onTag={(v) => ctrl?.setRefTag(e.id, v)} onRole={(r) => ctrl?.setRefRole(e.id, r)} />
            if (c?.kind === 'gen') return <GenOverlay key={e.id} el={e} c={c} toView={toView} zoom={zoom} ctrl={ctrl} />
            return null
          })}
          {ctrl && selected.length > 0 && <FloatingToolbar ctrl={ctrl} selected={selected} toView={toView} />}
        </div>
        {showHint && (
          <div className="hint3" aria-hidden>
            <div className="step"><div className="n">1</div><b>Tag</b><span>Drop or paste pictures. Each gets a tag like <span className="mono">@eyes</span>.</span></div>
            <div className="step"><div className="n">2</div><b>Select</b><span>Draw your character in the frame, then click the frame.</span></div>
            <div className="step"><div className="n">3</div><b>Generate</b><span>Press <b style={{ display: 'inline' }}>Generate front view</b>. It lands beside your sketch.</span></div>
          </div>
        )}
      </div>
      <ViewsDock ctrl={ctrl} els={els} />
    </div>
  )
}

// ── Ref chips: badge, editable tag, role ────────────────────────────────────

function RefChips({ el, c, at, onTag, onRole }: { el: El; c: Extract<CustomData, { kind: 'ref' }>; at: Pt; onTag: (v: string) => void; onRole: (r: RefRole) => void }) {
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
      <select className="rolechip" aria-label="Role" value={c.role} onChange={(e) => onRole(e.target.value as RefRole)}>
        {REF_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  )
}

// ── Generated images: pending / error in place, labels when done ────────────

function GenOverlay({ el, c, toView, zoom, ctrl }: { el: El; c: Extract<CustomData, { kind: 'gen' }>; toView: (p: Pt) => Pt; zoom: number; ctrl: CanvasController | null }) {
  const { runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
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
          {!views.length && !c.view && <span className="pill">{c.op === 'combine' ? 'Combined' : 'Front?'}</span>}
          {c.mock && <span className="mockbadge">MOCK</span>}
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

function FloatingToolbar({ ctrl, selected, toView }: { ctrl: CanvasController; selected: El[]; toView: (p: Pt) => Pt }) {
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
  const at = toView({ x: b.minX + b.w / 2, y: b.minY })

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
    groups.push(<button key="combine" className="btn sm dark" disabled={!!busy} onClick={() => setCombining(true)}>Combine {meaningful.length}…</button>)
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
  if (!groups.length && !error) return null

  if (combining) {
    return <CombinePopover ctrl={ctrl} ids={meaningful.map((e) => e.id)} at={at} onClose={() => setCombining(false)} />
  }

  return (
    <div className="toolbar" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      {groups.map((g, i) => (
        <span key={i} className="row">
          {i > 0 && <span className="sep" />}
          {g}
        </span>
      ))}
      {error && <span className="row" role="alert" style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600, padding: '0 6px' }}>{error}</span>}
    </div>
  )
}

function CombinePopover({ ctrl, ids, at, onClose }: { ctrl: CanvasController; ids: string[]; at: Pt; onClose: () => void }) {
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
    <div className="popover" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
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
    </div>
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
        {controls.views && controls.angles && <span className="faint" style={{ fontSize: 11.5 }}>Exact angles: 45°, 90°, 180°</span>}
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
