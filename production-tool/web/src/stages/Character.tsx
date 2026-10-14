// Stage 1: a free canvas (Excalidraw, or our own engine behind the flag). Draw, write or drop pictures anywhere;
// every picture, drawing, note and result is a node. Select any of them and the
// floating toolbar offers Generate (the result lands beside them, or where you
// click), Name (key_variant, like @maya_laughing), Set as front, and Make the
// other views. Curved arrows show what each result was made from. The dock
// below lists the named references (solid keys), publishes them to the
// person's library (their own, from any project), imports from it, and cleans up unused pictures.

import { CanvasMount } from '../canvas/CanvasMount'
import type { ViewSnapshot } from '../canvas/core/canvasAdapter'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useRouter, useServices, useShowMock, useUi } from '../app/context'
import { scriptRoute } from '../app/route'
import { BoardRail, CanvasToolbar, ZoomPill, type NewNode } from '../canvas/chrome/CanvasChrome'
import { boardFrames, boardRows, type BoardRow } from '../canvas/chrome/boards'
import { BoardsLayer } from '../canvas/chrome/BoardsLayer'
import { PRODUCTION_CARD_CHROME } from '../canvas/chrome/cardChrome'
import { cardOf, linkIdOf } from '../canvas/nodes/nodes'
import { SelectionBar } from '../canvas/selbar/SelectionBar'
import { busyQuestion, type CardKind, type SelInfo } from '../canvas/selbar/selbar'
import { runningOn } from '../canvas/sync'
import { CardChromeContext } from '../canvas/nodes/cardChrome'
import { boardKey, boardsByRank, isBoard, jumpTo } from '../canvas/boards/boards'
import type { CanvasChrome } from '../canvas/chrome/controls'
import { usePanels } from '../ui/chrome/panels'
import { AssetsDrawer } from '../ui/assets/AssetsDrawer'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { CanvasController, viewLabel, type CanvasSnapshot, type GenerateResult } from '../canvas/controller'
import { croppedCaption } from '../canvas/core/sketch'
import { framesFromSketch, sketchDeleteText } from '../doc/remove'
import { AskCard } from '../ui/AskCard'
import { LAYOUT_ONLY } from '../ui/asks'
import type { AnswerChoice } from '../jobs/runner'
import { alive, bounds, byOwnId, cd, imageOf, type Canvas, type El } from '../canvas/scene'
import { showStartCard } from './startCard'
import { REF_ROLES, type Ask, type CustomData, type ModelChoice, type NamedRef, type RefRole } from '../contracts/types'
import { REF_ROLE_TABLE } from '../contracts/load'
import { keyNamed, keysList, mainScript, mainStoryboard, refsList } from '../model/selectors'
import { choiceToSend, modelChoicesFor, modelWhere } from '../capabilities'
import { lastWorkedModel } from '../jobs/follow'
import { ModelPick } from '../ui/ModelPick'
import { isActive } from '../jobs/runner'
import { cleanKey, cleanVariant, nameOf, nameProblem, refByName, wholeKeys } from '../lib/names'
import { TABLET, useColorScheme, useFloating, useMedia } from '../ui/hooks'
import type { Anchor } from '../lib/place'
import { JobNode } from '../ui/JobNode'
import { ArrowCards } from '../ui/ArrowCard'
import { cancelText } from '../ui/cancel'
import { InlineConfirm, UndoChip } from '../ui/Undo'
import { useUndo } from '../ui/useUndo'
import { Thumbs } from '../dogfood/Dogfood'
import { errorShown } from '../dogfood/recorder'
import { DownloadButton } from '../ui/Download'
import { useProjectName } from '../ui/useDownload'
import { mediaItem, viewsOnCanvas, type MediaItem } from '../media/names'
import { linkedRows, sketchOf, unknownTyped } from './trayScope'
import './inputs.css'

type Pt = { x: number; y: number }
interface ViewState {
  /** The view as it was rendered (overlays convert coordinates with this snapshot). */
  view: ViewSnapshot
  selected: string[]
  els: El[]
  version: number
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.')

/** What our own engine adds for its selection (features/canvas-edit-tools.clan): grouping and the next sketch area's ratio. */
type OwnEdit = Partial<{
  selectionKind(): { kind: 'none' } | { kind: 'one' } | { kind: 'group'; ink: boolean } | { kind: 'several'; count: number }
  group(): string | null
  ungroup(): boolean
  setSketchRatio(ratio: string): void
}>

export function Character({ initial, active }: { initial: CanvasSnapshot | null; active: boolean }) {
  const services = useServices()
  const { runner, doc: docStore, ui: uiStore, project } = services
  const router = useRouter()
  const panels = usePanels()
  const [chrome, setChrome] = useState<CanvasChrome | null>(null)
  const [board, setBoard] = useState<string | null>(null)
  const narrow = useMedia(TABLET)
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const theme = useColorScheme()
  const { config, controls } = useConfig()
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [vs, setVs] = useState<ViewState | null>(null)
  const ctrl = useMemo(() => (canvas ? new CanvasController(canvas, services) : null), [canvas, services])
  // A canvas opened from the server comes without its pictures' files: put them back from the blobs.
  useEffect(() => {
    if (ctrl) void ctrl.restoreFiles().catch((e) => console.warn('could not put the canvas pictures back', e))
  }, [ctrl])

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
  const [confirming, setConfirming] = useState<{ ids: string[]; text: string; at: Pt; yes?: string } | null>(null)
  /** Waiting for a click that says where the next result goes. */
  const [placing, setPlacing] = useState<{ ids: string[]; text: string; more: boolean; modelChoice?: ModelChoice } | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)
  /** Wren's ask from a placed Generate on a sketch with no words: answered here, then it goes. */
  const [asking, setAsking] = useState<{ ask: Ask; job: { ids: string[]; text: string; more: boolean; modelChoice?: ModelChoice }; at: { x: number; y: number } } | null>(null)

  const refresh = useCallback(() => {
    if (!canvas) return
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = null
      const st = canvas.view()
      const els = canvas.elements()
      const version = canvas.version(els)
      const selected = st.selectedIds
      const sig = `${st.scrollX}|${st.scrollY}|${st.zoom}|${st.offsetLeft}|${st.offsetTop}|${selected.join(',')}|${version}`
      if (sig === lastSig.current) return
      lastSig.current = sig
      setVs({ view: st, selected, els, version })
    })
  }, [canvas])

  // Land canvas results; mirror job states into customData.
  useEffect(() => {
    if (!ctrl) return
    const offCanvas = runner.onComplete('canvas', (job) => void ctrl.land(job))
    // A Generate on a sketch area lands on the canvas too, as a frame made from it (features/frame-aspect.clan).
    const offSketch = runner.onComplete('sketch', (job) => void ctrl.land(job))
    return () => {
      offCanvas()
      offSketch()
    }
  }, [ctrl, runner])
  useEffect(() => {
    if (!ctrl) return
    ctrl.syncGenStates(docStore.get())
    return docStore.onChange((d) => ctrl.syncGenStates(d))
  }, [ctrl, docStore])

  // Excalidraw measures its container; tell it when the stage comes back into view.
  useEffect(() => {
    if (active && canvas) {
      canvas.refresh()
      refresh()
    }
  }, [active, canvas, refresh])

  useEffect(() => {
    if (!canvas) return
    const off = canvas.onScroll(() => refresh())
    refresh()
    return off
  }, [canvas, refresh])

  // A resized sketch area keeps its shape: corrected once, when the pointer comes up (features/frame-aspect.clan).
  useEffect(() => {
    if (!canvas || !ctrl) return
    return canvas.onPointer((p) => {
      if (p.phase === 'up') requestAnimationFrame(() => ctrl.lockAreas())
    })
  }, [canvas, ctrl])

  const onChange = useCallback(() => {
    ctrl?.onChange()
    refresh()
  }, [ctrl, refresh])

  const toView = useCallback((p: Pt): Pt => {
    if (!vs || !canvas) return p
    const v = canvas.sceneToViewport(p, vs.view)
    return { x: v.x - vs.view.offsetLeft, y: v.y - vs.view.offsetTop }
  }, [vs, canvas])

  const els = useMemo(() => (vs ? alive(vs.els) : []), [vs])
  // Nodes and boards (our own engine) have their own handles: the floating toolbar is for marks and pictures.
  const selected = useMemo(() => els.filter((e) => vs?.selected.includes(e.id) && !cardOf(e) && !isBoard(e)), [els, vs])
  // Our own engine's bar for nodes, links and groups (ui-behaviour 3.9); pictures, marks and sketch areas keep the Generate bar.
  const ownEdit = canvas?.engine === 'own' ? (canvas as unknown as OwnEdit) : null
  const ownSel = useMemo((): { info: SelInfo; els: El[] } | null => {
    if (!ownEdit || !vs) return null
    const all = els.filter((e) => vs.selected.includes(e.id) && !isBoard(e))
    if (!all.length) return null
    const kind = ownEdit.selectionKind?.() ?? { kind: 'none' as const }
    const cards = all.map(cardOf).filter((c): c is NonNullable<ReturnType<typeof cardOf>> => !!c).map((c) => c.kind as CardKind)
    const links = all.filter((e) => linkIdOf(e)).length
    const group = kind.kind === 'group' ? { ink: kind.ink } : null
    if (!cards.length && !links && !group) return null
    const units = kind.kind === 'several' ? kind.count : kind.kind === 'none' ? 0 : 1
    return { info: { cards, links, group, units, locked: all.every((e) => (e as El & { locked?: boolean }).locked) }, els: all }
  }, [ownEdit, vs, els])
  const zoom = vs?.view.zoom ?? 1
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
    // A sketch area: what was made from it stays, and the confirm says so (features/frame-aspect.clan).
    const areas = targets.flatMap((e) => { const c = cd(e); return c?.kind === 'sketch' ? [c.id] : [] })
    const made = areas.reduce((n, id) => n + framesFromSketch(docStore.get(), id).length, 0)
    if (made) {
      const b = bounds(targets)
      setConfirming({ ids, text: sketchDeleteText(made), at: { x: b.minX + b.w / 2, y: b.minY } })
      return
    }
    // A node with a job still running on it (or on its shots) asks first (ui-behaviour 3.3 Delete).
    const d = docStore.get()
    const busy = targets.map((e) => cardOf(e)).flatMap((c) => (c ? runningOn(d, c.kind, c.id) : []))
      .map((id) => d.jobs[id]).filter((j) => j && isActive(runner.liveInfo(j.id)?.state ?? j.state))
    if (busy.length) {
      const b = bounds(targets)
      setConfirming({ ids, text: busyQuestion(d, busy[0]), at: { x: b.minX + b.w / 2, y: b.minY }, yes: 'Stop and delete' })
      return
    }
    const running = targets.map((e) => cd(e)).filter((c): c is Extract<CustomData, { kind: 'gen' }> => c?.kind === 'gen')
      .map((c) => docStore.get().jobs[c.id]).filter((j) => j && isActive(runner.liveInfo(j.id)?.state ?? j.state))
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
    if (!el || !ctrl || !canvas) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && placing) {
        setPlacing(null)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      const ids = canvas.view().selectedIds
      const sel = alive(canvas.elements()).filter((x) => ids.includes(x.id))
      // On our own engine every delete but a board's comes here (the confirm, the Undo chip, the
      // document's cascade; canvas-edit-tools); boards keep their own.
      const ownPath = canvas.engine === 'own' && sel.length > 0 && !sel.some(isBoard)
      if (!ownPath && !sel.some((x) => imageOf(x) || cd(x)?.kind === 'sketch')) return
      e.preventDefault()
      e.stopPropagation()
      requestDelete(sel)
    }
    el.addEventListener('keydown', onKey, true)
    return () => el.removeEventListener('keydown', onKey, true)
  }, [ctrl, canvas, requestDelete, placing])

  /** The click that places a result: the new node's top-left goes there. */
  const onPlace = useCallback(async (e: React.PointerEvent) => {
    if (!placing || !ctrl || !canvas) return
    e.preventDefault()
    e.stopPropagation()
    const p = canvas.viewportToScene({ x: e.clientX, y: e.clientY }, canvas.view())
    const job = placing
    setPlacing(null)
    const at = { x: p.x - 150, y: p.y - 200 }
    try {
      const r = await ctrl.generate(job.ids, job.text, { at, more: job.more, limits, modelChoice: job.modelChoice })
      if ('ask' in r) setAsking({ ask: r.ask, job, at })
    } catch (err) {
      setPlaceError(errText(err))
    }
  }, [placing, ctrl, canvas, limits])

  /** The answer to Wren's ask from a placed Generate: layout only goes as it is; described, its words go. */
  const onAskAnswered = useCallback(async (answer: AnswerChoice) => {
    if (!ctrl || !asking) return
    const { job, at } = asking
    setAsking(null)
    try {
      if ('optionId' in answer && answer.optionId === LAYOUT_ONLY) await ctrl.generate(job.ids, job.text, { at, more: job.more, limits, modelChoice: job.modelChoice, layoutOnly: true })
      else if ('text' in answer) await ctrl.generate(job.ids, answer.text, { at, more: job.more, limits, modelChoice: job.modelChoice })
    } catch (err) {
      setPlaceError(errText(err))
    }
  }, [ctrl, asking, limits])

  const showHint = showStartCard(els, { dismissed: !!ui.hintDismissed, refs: Object.keys(doc.refs).length })

  // Our own engine has the boards as real frames and the nodes as real elements (art-boards,
  // canvas-nodes): the rail jumps to the frames, and nothing is drawn over the canvas for them.
  const own = canvas?.engine === 'own'
  // The rail's left edge: what a jump keeps clear (the rail covers the left 240px; none when narrow).
  const railInset = narrow || panels.assets ? 0 : 240
  // The board rail and + Node (ui-behaviour 3.2, 3.3): a reference board fits the canvas to its
  // pictures; Script, Storyboard and Video open their editors over the canvas.
  const counts = useMemo(() => {
    const n: Record<string, number> = {}
    if (!own) return n
    const boardOf = new Map(els.filter(isBoard).map((e) => [e.id, (e.customData as { id: string }).id]))
    for (const e of els) {
      const b = e.frameId ? boardOf.get(e.frameId) : undefined
      if (b && imageOf(e)) n[b] = (n[b] ?? 0) + 1
    }
    return n
  }, [els, own])
  const rows = useMemo(() => boardRows(doc, own, counts), [doc, own, counts])
  const open = useCallback((editor: 'script' | 'storyboard' | 'video') => {
    if (editor === 'script') {
      const sc = mainScript(docStore.get())
      if (sc) router.push(scriptRoute(project.id, sc.id))
      return
    }
    uiStore.update((u) => { u.stage = editor }, 'stage')
  }, [docStore, router, project.id, uiStore])
  const pickBoard = useCallback((row: BoardRow) => {
    setBoard(row.id)
    if (row.target.kind === 'open') return open(row.target.editor)
    if (!canvas) return
    if (own && row.target.kind === 'board') {
      const id = row.target.id
      jumpTo(canvas, docStore.get(), boardsByRank(docStore.get()).findIndex((b) => b.id === id), !matchMedia('(prefers-reduced-motion: reduce)').matches, railInset)
      canvas.setCurrentBoard?.(id)
      return
    }
    const want = row.target.kind === 'refs' ? new Set(row.target.nodes) : new Set<string>()
    const hit = alive(canvas.elements()).filter((e) => {
      const c = cd(e)
      return want.has(e.id) || (!!c && 'id' in c && want.has(c.id)) || (row.target.kind === 'board' && c?.kind === 'board' && c.id === row.target.id)
    })
    if (hit.length) canvas.fit(hit, { zoomFactor: 0.8, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
  }, [canvas, open, own, docStore, railInset])
  // On our own engine the canvas takes ⌥1…⌥9 (canvas/boards/BoardLayer); the rail only shows which is current.
  useEffect(() => {
    if (!own || !canvas) return
    const onKey = (e: KeyboardEvent) => {
      const k = boardKey(e)
      if (k === null) return
      const b = k === 'fit' ? null : boardsByRank(docStore.get())[k]
      setBoard(b?.id ?? null)
      canvas.setCurrentBoard?.(b?.id ?? null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [own, canvas, docStore])
  const onNode = useCallback((kind: NewNode) => {
    if (kind === 'picture') return chrome?.setTool('image')
    if (kind === 'sketch') return chrome?.setTool('sketch')
    open(kind)
  }, [chrome, open])
  const ratio = mainStoryboard(doc)?.ratio ?? '16:9'
  // The next sketch area's shape on our own engine: the storyboard's ratio (ui-behaviour 3.7).
  useEffect(() => { ownEdit?.setSketchRatio?.(ratio) }, [ownEdit, ratio])
  // ⌥0: everything, the boards drawn over the canvas included.
  const fitEverything = () => {
    if (own && canvas) {
      setBoard(null)
      canvas.setCurrentBoard?.(null)
      jumpTo(canvas, docStore.get(), 'fit', !matchMedia('(prefers-reduced-motion: reduce)').matches, railInset)
      return
    }
    if (!chrome) return
    if (!frames.length) return chrome.fitAll()
    const els = canvas ? alive(canvas.elements()) : []
    const b = els.length ? bounds(els) : undefined
    const xs = frames.flatMap((f) => [f.rect.x, f.rect.x + f.rect.w]).concat(b ? [b.minX, b.maxX] : [])
    const ys = frames.flatMap((f) => [f.rect.y - 16, f.rect.y + f.rect.h]).concat(b ? [b.minY, b.maxY] : [])
    // The rail covers the left 240px: fit to the right of it.
    const x = Math.min(...xs) - 240
    chrome.fitRect({ x, y: Math.min(...ys), w: Math.max(...xs) - x, h: Math.max(...ys) - Math.min(...ys) })
  }
  // The boards drawn over the canvas until art-boards makes them frames (mock Main): picture boards
  // wrap their pictures; Script, Storyboard and Video hold their node cards.
  const frames = ((): ReturnType<typeof boardFrames> => {
    if (!canvas || own) return []
    const groups = rows.flatMap((r) => {
      if (r.target.kind !== 'refs') return []
      const hit = r.target.nodes.map((n) => byOwnId(els, n)).filter((e): e is El => !!e)
      return hit.length ? [{ id: r.id, title: r.title, box: bounds(hit) }] : []
    })
    return boardFrames(groups)
  })()
  // The dot grid moves with the canvas.
  const grid = vs ? { '--grid-x': `${vs.view.scrollX * vs.view.zoom}px`, '--grid-y': `${vs.view.scrollY * vs.view.zoom}px`, '--grid-s': `${24 * vs.view.zoom}px` } as React.CSSProperties : undefined

  return (
    <div className="character">
      <CardChromeContext.Provider value={PRODUCTION_CARD_CHROME}>
      <div className="canvas-wrap pt-grid" ref={wrap} style={grid}>
        {frames.length > 0 && <BoardsLayer part="frames" frames={frames} toView={toView} zoom={zoom} current={board} onOpen={open} />}
        <CanvasMount initial={initial} onReady={setCanvas} onChrome={setChrome} onChange={onChange} theme={theme} railInset={railInset} />
        {frames.length > 0 && <BoardsLayer part="cards" frames={frames} toView={toView} zoom={zoom} current={board} onOpen={open} />}
        <div className="overlay-layer">
          <FlowArrows els={els} toView={toView} />
          {els.map((e) => {
            const img = imageOf(e)
            const c = cd(e)
            const named = img ? refsList(doc).find((r) => r.node === img.id) : undefined
            return (
              <span key={e.id}>
                {named && <NameChip r={named} at={toView({ x: e.x, y: e.y + e.height })} />}
                {c?.kind === 'gen' && <GenOverlay el={e} c={c} toView={toView} zoom={zoom} ctrl={ctrl} named={!!named} />}
              </span>
            )
          })}
          {ctrl && canvas && ownSel && !confirming && !placing && (() => {
            const b = bounds(ownSel.els)
            const top = toView({ x: b.minX + b.w / 2, y: b.minY })
            return (
              <SelectionBar info={ownSel.info} anchor={{ x: top.x, top: top.y - (ownSel.info.group?.ink ? 30 : 0), bottom: toView({ x: b.minX, y: b.maxY }).y }} actions={{
                open: () => { const c = ownSel.els.map(cardOf).find(Boolean); if (c) open(c.kind) },
                group: () => { ownEdit?.group?.() },
                ungroup: () => { ownEdit?.ungroup?.() },
                lock: (locked) => {
                  const ids = new Set(ownSel.els.map((e) => e.id))
                  canvas.transact((all) => all.map((e) => (ids.has(e.id) ? canvas.patch(e, { locked } as Partial<El>) : e)), { undoable: true })
                },
                remove: () => requestDelete(ownSel.els),
              }} />
            )
          })()}
          {ctrl && selected.length > 0 && !ownSel && !confirming && !placing && (
            <FloatingToolbar ctrl={ctrl} selected={selected} toView={toView} onDelete={requestDelete} limits={limits}
              onGroup={ownEdit?.group && selected.length > 1 ? () => { ownEdit.group?.() } : undefined}
              onPlace={(ids, text, more, modelChoice) => { setPlaceError(null); setPlacing({ ids, text, more, modelChoice }) }} />
          )}
          {confirming && (() => {
            const p = toView(confirming.at)
            return (
              <Floating className="toolbar confirming" anchor={{ x: p.x, top: p.y, bottom: p.y }}>
                <InlineConfirm text={confirming.text} yes={confirming.yes ?? (confirming.text.startsWith('Delete this sketch area') ? 'Delete' : 'Stop and remove')} onYes={() => doDelete(confirming.ids)} onNo={() => setConfirming(null)} />
              </Floating>
            )
          })()}
          {canvas && !confirming && !placing && <ArrowCards canvas={canvas} wrap={wrap} selected={selected} toView={toView} />}
          {asking && (() => {
            const p = toView(asking.at)
            return (
              <Floating className="popover" anchor={{ x: p.x + 150, top: p.y, bottom: p.y }}>
                <AskCard ask={docStore.get().asks[asking.ask.id] ?? asking.ask} onLocalAnswer={onAskAnswered} />
                <button className="btn xs ghost" onClick={() => setAsking(null)}>Cancel</button>
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
        {showHint && <StartCard onScript={() => open('script')} onPictures={() => chrome?.setTool('image')} />}
        {panels.assets
          ? <AssetsDrawer ctrl={ctrl} onClose={() => panels.toggle('assets')} onBoards={() => { panels.toggle('assets'); chrome?.fitAll() }}
              onPicture={() => chrome?.setTool('image')} onCanvas={els.map((e) => imageOf(e)?.asset).filter((x): x is string => !!x)} />
          : <BoardRail rows={rows} current={board} onPick={pickBoard} onFit={fitEverything} narrow={narrow} keys={!own} />}
        <CanvasToolbar chrome={chrome} ratio={ratio} onNode={onNode} vertical={narrow} />
        <ZoomPill chrome={chrome} touch={narrow} />
      </div>
      </CardChromeContext.Provider>
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
  const job = doc.jobs[c.id]
  const live = runner.liveInfo(c.id)
  const state = live?.state ?? job?.state ?? c.state
  const tl = toView({ x: el.x, y: el.y })
  const w = el.width * zoom
  const h = el.height * zoom
  const dismissed = ui.jobs[c.id]?.dismissed
  // "1344×756 · cropped to 16:9": the relay cut the model's size to the sketch's shape (features/frame-aspect.clan).
  const frame = Object.values(doc.frames).find((f) => f.job_id === c.id)
  const own = frame ? doc.assets[frame.asset] : undefined
  const caption = frame?.cropped_to && own?.w && own?.h ? croppedCaption({ w: own.w, h: own.h }, frame.cropped_to.to) : undefined
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
      {state === 'completed' && caption && <div className="gencaption" style={{ left: tl.x, top: tl.y + h }}>{caption}</div>}
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
    const job = doc.jobs[c.to]
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

function FloatingToolbar({ ctrl, selected, toView, onDelete, onPlace, limits, onGroup }: {
  ctrl: CanvasController
  selected: El[]
  toView: (p: Pt) => Pt
  onDelete: (sel: El[]) => void
  /** Group the selection (our own engine; ui-behaviour 3.9's "Several mixed things"). */
  onGroup?: () => void
  onPlace: (ids: string[], text: string, more: boolean, modelChoice?: ModelChoice) => void
  limits: { max: number; characters: number }
}) {
  const doc = useDoc()
  const project = useProjectName()
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
      errorShown('canvas', errText(e))
    } finally {
      setBusy(null)
    }
  }

  const preview = ctrl.preview(ids)
  // A sketch area counts on its own: its strokes are the sketch, and words are optional (Wren asks).
  const usable = preview.inputs.length + preview.drawings + preview.notes.length + (preview.sketch ? 1 : 0) > 0
  const single = meaningful.length === 1 ? imageOf(meaningful[0]) : undefined
  const singleImage = single?.asset ? single : undefined
  const named = singleImage ? ctrl.nameOn(singleImage.id, doc) : undefined

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
  // The beta's thumbs on a picture the tool made (features/production-tool-dogfood.clan).
  const made = singleImage?.kind === 'gen' ? cd(meaningful[0]) : undefined
  if (made?.kind === 'gen' && singleImage?.asset) {
    const job = doc.jobs[made.id]
    groups.push(<Thumbs key={`thumbs-${made.id}`} compact target={{
      kind: made.op === 'view' ? 'view' : 'picture', id: singleImage.asset, jobId: made.id, op: made.op, view: made.view,
      provider: job?.provider, model: job?.model,
    }} />)
  }
  // Download: each selected picture or result, named as in Download all media.
  const pictures = meaningful.map((e) => imageOf(e)?.asset).filter((a): a is string => !!a)
  if (pictures.length) {
    const views = viewsOnCanvas(doc, ctrl.liveElements())
    const items = pictures.map((a) => mediaItem(doc, project, a, undefined, views)).filter((m): m is MediaItem => !!m)
    if (items.length) groups.push(<DownloadButton key="dl" items={items} className="btn sm ghost" iconOnly={items.length === 1} />)
  }
  if (onGroup) groups.push(<button key="group" className="btn sm ghost" title="Group (Ctrl+G)" onClick={onGroup}>Group</button>)
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

/** The ten main role pills of the Name dialog (the rest under More…), as the contract's role table sorts them. */
const MAIN_ROLES = REF_ROLES.filter((r) => REF_ROLE_TABLE[r].picker === 'main')
const roleWord = (r: RefRole) => (r === 'brand_rule' ? 'brand rule' : r)

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
  // The model for this Generate: the last that worked for pictures, or the one picked here.
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const choice = pick ?? lastWorkedModel(doc, 'generate', config)
  const modelChoice = choiceToSend('generate', config, choice)
  const preview = ctrl.preview(ids, choice?.model ?? modelChoicesFor('generate', config)[0]?.model)
  /** Wren's ask on a sketch with no words, shown here; nothing is sent until it is answered. */
  const [asked, setAsked] = useState<Ask | null>(null)
  const [text, setText] = useState('')
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState(false)
  const [off, setOff] = useState<Set<string>>(() => new Set())
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
  const go = async (fn: () => Promise<GenerateResult>) => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if ('ask' in r) setAsked(r.ask)
      else onClose()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const submit = () => go(() => ctrl.generate(sent(ids), text, { more, limits, modelChoice }))
  const answered = async (answer: AnswerChoice) => {
    setAsked(null)
    if ('optionId' in answer && answer.optionId === LAYOUT_ONLY) await go(() => ctrl.generate(ids, text, { more, limits, modelChoice, layoutOnly: true }))
    else if ('text' in answer) await go(() => ctrl.generate(ids, answer.text, { more, limits, modelChoice }))
  }
  if (asked) {
    return (
      <Floating className="popover" anchor={at}>
        <AskCard ask={doc.asks[asked.id] ?? asked} onLocalAnswer={answered} />
        <div className="row" style={{ marginTop: 8 }}><span className="spacer" /><button className="btn sm ghost" onClick={onClose}>Cancel</button></div>
      </Floating>
    )
  }
  const oneArea = preview.areas <= 1
  // What is linked into the sketch area (model/scope.ts): its references go with it, ticked; the rest is listed.
  const linked = linkedRows(doc, sketchOf(ctrl.liveElements(), ids), ctrl.liveElements(), ids)
  const unknown = unknownTyped(doc, text)
  // What goes: every input of the selection, each with its tick (ui-behaviour 3.16). Unticked
  // pictures stay out of the send; the sketch, the drawing and the notes are the selection itself.
  // Ticked linked references join it; unticking one leaves it out of this send only (the link stays).
  const sent = (all: string[]) => [...all.filter((id) => {
    const el = ctrl.liveElements().find((e) => e.id === id)
    const c = el ? cd(el) : undefined
    return !(c && 'id' in c && off.has(c.id))
  }), ...linked.filter((r) => !off.has(r.key)).flatMap((r) => r.elIds)]
  const inputs = preview.inputs.filter((i) => !off.has(i.nodeId)).length + linked.filter((r) => r.elIds.length && !off.has(r.key)).length
  const summary = [preview.sketch ? 'Sketch' : preview.drawings ? 'Drawing' : null,
    inputs ? `${inputs} ${inputs === 1 ? 'input' : 'inputs'}` : null,
    preview.notes.length ? `${preview.notes.length} ${preview.notes.length === 1 ? 'note' : 'notes'}` : null,
    text.trim() ? 'your words' : null].filter(Boolean).join(', ') || 'Your words only'
  // "<model> on Runway" (ui-behaviour 3.7), the pick or the first routed model.
  const shown = choice ?? modelChoicesFor('generate', config)[0]
  const model = shown ? modelWhere(shown.provider, shown.model) : undefined
  const tick = (id: string, label: React.ReactNode, on: boolean, change?: () => void) => (
    <label key={id} className="tray-row">
      <input type="checkbox" checked={on} disabled={!change} onChange={change} />
      <span>{label}</span>
    </label>
  )
  return (
    <Floating className="popover send-tray" anchor={at}>
      <div className="tray-head">
        <button type="button" className="tray-fold" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d={open ? 'M3 7.5 L6 4.5 L9 7.5' : 'M3 4.5 L6 7.5 L9 4.5'} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <AgentFigure agent="dex" size={22} decorative />
        <div className="tray-title"><b>What Dex will send</b><span>{sayer('dex')}</span></div>
      </div>
      {!open && <button type="button" className="tray-line" onClick={() => setOpen(true)}>{summary}</button>}
      {open && (
        <div className="tray-rows" role="group" aria-label="Inputs to send">
          {preview.sketch && tick('sketch', <><b>Sketch</b> <span className="faint">· {preview.sketch.label} layout</span></>, true)}
          {preview.drawings > 0 && tick('drawing', <><b>Drawing</b> <span className="faint">· as drawn</span></>, true)}
          {preview.inputs.map((i) => tick(i.nodeId, i.name
            ? <><span className="pt-ref">@{i.name}</span> <span className="faint">· {KIND_WORD[i.kind]}</span></>
            : <><b>{KIND_WORD[i.kind][0].toUpperCase() + KIND_WORD[i.kind].slice(1)}</b> <span className="faint">· not named</span></>,
          !off.has(i.nodeId), () => setOff((o) => { const n = new Set(o); if (n.has(i.nodeId)) n.delete(i.nodeId); else n.add(i.nodeId); return n })))}
          {preview.notes.map((n, k) => tick(`note${k}`, <><b>Note</b> <span className="faint">· instruction:</span> {n.length > 60 ? `${n.slice(0, 59)}…` : n}</>, true))}
          {linked.map((r) => tick(r.key, <>{r.item.kind === 'ref' ? <span className="pt-ref">{r.label.split(' · ')[0]}</span> : <b>{r.label.split(' · ')[0]}</b>} <span className="faint">· {r.label.split(' · ').slice(1).join(' · ')}{r.off ? ` · ${r.off}` : ''}</span></>,
            r.elIds.length > 0 && !off.has(r.key), r.elIds.length ? () => setOff((o) => { const n = new Set(o); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n }) : undefined))}
        </div>
      )}
      {unknown.length > 0 && (
        <div className="tray-unknown" role="note">{unknown.length === 1 ? '1 name isn\'t a reference' : `${unknown.length} names aren't references`}: {unknown.map((n) => `@${n}`).join(', ')} <span className="faint">· it goes as plain words</span></div>
      )}
      <label className="tray-words">
        <span className="pt-label">{preview.notes.length ? 'Anything to add' : 'Your words'}</span>
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
      </label>
      {refsList(doc).length > 0 && (
        <div className="taghints" aria-label="Names you can use">
          {wholeKeys(doc).map((k) => <button key={k} className="taghint whole" title={`${k}: its front and other views`} onClick={() => insert(k)}>@{k}</button>)}
          {refsList(doc).map((r) => <button key={r.id} className="taghint" onClick={() => insert(nameOf(r))}>@{nameOf(r)}</button>)}
        </div>
      )}
      {preview.cropLine && <div className="faint" role="note" style={{ fontSize: 12.5 }}>{preview.cropLine}</div>}
      {!oneArea && <div role="alert" className="tray-error">Pick one sketch area for one Generate.</div>}
      {error && <div role="alert" className="tray-error">{error}</div>}
      <div className="tray-foot">
        <ModelPick op="generate" value={choice} onChange={setPick} />
        {controls.moreOptions && <button className={`btn xs ${more ? 'on' : ''}`} title="Ask for 4 options instead of 1" onClick={() => setMore(!more)}>4 options</button>}
        <span className="spacer" />
        <button className="btn xs ghost" disabled={busy || !oneArea} title="Click on the canvas where it should land" onClick={() => { onClose(); onPlace(sent(ids), text, more, modelChoice) }}>Place…</button>
      </div>
      <div className="tray-foot nowrap" title="Nothing is sent until you press Generate.">
        <span className="pt-mono tray-model">{model ?? 'The default model'}{preview.sketch ? <><br />{preview.sketch.label}</> : null}</span>
        <button className="btn sm" onClick={onClose}>Cancel</button>
        <button className="btn sm primary" disabled={busy || !oneArea} onClick={() => void submit()}>{busy ? 'Sending…' : 'Generate'}</button>
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
  const [key, setKey] = useState(current?.key ?? keysList(doc)[0]?.key ?? '')
  const [variant, setVariant] = useState(presetVariant ?? current?.variant ?? '')
  const [role, setRole] = useState<RefRole>('character')
  const [moreRoles, setMoreRoles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ck = cleanKey(key)
  const cv = cleanVariant(variant)
  const isNewKey = !!ck && !keyNamed(doc, ck)
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
        <datalist id="napkin-keys">{keysList(doc).map((k) => <option key={k.key} value={k.key} />)}</datalist>
      </div>
      {isNewKey && (
        <div style={{ marginTop: 8 }}>
          <div className="row rolepills" role="radiogroup" aria-label={`What ${ck} is`}>
            <span className="faint" style={{ fontSize: 12 }}>{ck} is</span>
            {(moreRoles ? REF_ROLES : MAIN_ROLES).map((r) => (
              <button key={r} role="radio" aria-checked={role === r} className={`btn xs ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>{roleWord(r)}</button>
            ))}
            {!moreRoles && <button className="btn xs ghost" onClick={() => setMoreRoles(true)}>More…</button>}
          </div>
          <div className="faint roleline">{REF_ROLE_TABLE[role].ui_line}</div>
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

/** A new project's first card (mock States, "New project · Ad template"): Skye offers the script. */
function StartCard({ onScript, onPictures }: { onScript: () => void; onPictures: () => void }) {
  return (
    <div className="start-card pt-card" role="note">
      <div className="row" style={{ gap: 10 }}>
        <AgentFigure agent="skye" size={22} decorative />
        <b>Start with the script</b>
        <span className="pt-mono">{sayer('skye')}</span>
      </div>
      <p>Paste a script, or tell Skye the idea. Then draw or drop your characters, places and products.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onPictures}>Add pictures</button>
        <button type="button" className="btn primary" onClick={onScript}>Write the script</button>
      </div>
    </div>
  )
}

