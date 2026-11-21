// Stage 1: a free canvas (Excalidraw, or our own engine behind the flag). Draw, write or drop pictures anywhere;
// every picture, drawing, note and result is a node. Select any of them and the
// floating toolbar offers Generate (the result lands beside them, or where you
// click), Name (key_variant, like @maya_laughing), Set as front, Make the
// other views, and Edit (the picture in the Image editor, as a new version in
// place; a double-click on the one picture selected does the same). Curved arrows show what each result was made from. The dock
// below lists the named references (solid keys), publishes them to the
// person's library (their own, from any project), imports from it, and cleans up unused pictures.

import { CanvasMount } from '../canvas/CanvasMount'
import type { ViewSnapshot } from '../canvas/core/canvasAdapter'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useConfig, useDoc, useJobsTick, useRouter, useServices, useShowMock, useUi } from '../app/context'
import { scriptRoute } from '../app/route'
import { BoardRail, CanvasToolbar, LinksToggle, ZoomPill, type NewNode } from '../canvas/chrome/CanvasChrome'
import { boardFrames, boardRows, type BoardRow, type RailNode } from '../canvas/chrome/boards'
import { BoardsLayer } from '../canvas/chrome/BoardsLayer'
import { PRODUCTION_CARD_CHROME } from '../canvas/chrome/cardChrome'
import { cardOf, linkIdOf } from '../canvas/nodes/nodes'
import { SelectionBar } from '../canvas/selbar/SelectionBar'
import { groupLabel, keyGroupsOn, keyOfGroupId } from '../canvas/nodes/keyGroups'
import { setStacked } from '../canvas/nodes/stack'
import { busyQuestion, type CardKind, type SelInfo } from '../canvas/selbar/selbar'
import { runningOn } from '../canvas/sync'
import { CardChromeContext } from '../canvas/nodes/cardChrome'
import { boardIdOf, boardKey, bringIntoView, isBoard, jumpTo, railNodes, railTargets } from '../canvas/boards/boards'
import { gatherOffer, type GatherOffer } from '../canvas/boards/arrange'
import { gatherIntoBoard, moveIntoBoard } from '../canvas/boards/gather'
import type { CanvasChrome } from '../canvas/chrome/controls'
import { canvasActions } from '../canvas/chrome/actions'
import { drivers, type MakeVideoFrom } from '../canvas/nodes/make'
import { planShotsBlocked, planFromScript } from '../jobs/scriptVideo'
import { planOrJoin } from '../jobs/plan'
import { linkInto } from '../jobs/prompt'
import { AskOptions } from '../ui/AskCard'
import { usePanels } from '../ui/chrome/panels'
import { AssetsLibrary } from '../ui/assets/AssetsDrawer'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { CanvasController, OTHER_VIEWS, viewLabel, type CanvasSnapshot, type GenerateResult } from '../canvas/controller'
import { countLine, countRefs, kindOfRole, refLimits, type RefKind, type RefLimits } from '../canvas/refBudget'
import { croppedCaption } from '../canvas/core/sketch'
import { framesFromSketch, sketchDeleteText } from '../doc/remove'
import { AskCard } from '../ui/AskCard'
import { ASK_REVEAL_EVENT } from '../ui/askPlaces'
import { LAYOUT_ONLY, waitingAsk } from '../ui/asks'
import type { AnswerChoice } from '../jobs/runner'
import type { BrandChoice, BrandRow } from '../jobs/context'
import { alive, bounds, byOwnId, cd, imageOf, type Canvas, type El } from '../canvas/scene'
import { scriptToWrite } from './scriptToWrite'
import { useBriefSpinoff } from '../brief/useBriefSpinoff'
import { BriefBooth } from '../brief/BriefBooth'
import { briefOfElement } from '../brief/canvas'
import { Booth } from '../ui/booth/Booth'
import { useBooth } from '../ui/booth/useBooth'
import { boothEarned } from '../ui/booth/state'
import { ImageEditor, VersionRow } from './ImageEditor'
import { editablePicture } from '../canvas/nodes/dblclick'
import { pickPictureVersionStep } from './imageEditor/apply'
import { Float } from '../ui/Float'
import { RightsChip } from '../ui/finals/RightsChip'
import { chipLook } from '../ui/finals/chipLook'
import { BrandFields } from './BrandFields'
import { PaidButton } from '../ui/PaidButton'
import { sendingLine, useSlow } from '../ui/sending'
import { viewsWhat } from '../ui/viewsWhat'
import { isBrandRole, payloadFor, payloadMissing, type BrandPayload } from '../canvas/swatches'
import { REF_ROLES, type Ask, type CustomData, type ModelChoice, type NamedRef, type RefRole } from '../contracts/types'
import { REF_ROLE_TABLE } from '../contracts/load'
import { currentPictureFrame, keyNamed, keysList, mainScript, mainStoryboard, pictureVersions, refsList, videoOfStoryboard } from '../model/selectors'
import { choiceToSend, modelChoicesFor, modelWhere } from '../capabilities'
import { lastWorkedModel } from '../jobs/follow'
import { ModelPick } from '../ui/ModelPick'
import { isActive } from '../jobs/runner'
import { cleanKey, cleanVariant, mentions, nameOf, nameProblem, refByName, wholeKeys } from '../lib/names'
import { TOUCH_OR_PHONE, useColorScheme, useFloating, useMedia } from '../ui/hooks'
import type { Anchor } from '../lib/place'
import { JobNode } from '../ui/JobNode'
import { ArrowCards } from '../ui/ArrowCard'
import { arrowShown, type ArrowLike } from '../canvas/arrowHit'
import { cancelText } from '../ui/cancel'
import { InlineConfirm, UndoChip } from '../ui/Undo'
import { backWhenLive, goneWhenDead, offerGone, useUndo } from '../ui/useUndo'
import { Thumbs } from '../dogfood/Dogfood'
import { errorShown } from '../dogfood/recorder'
import { DownloadButton } from '../ui/Download'
import { useProjectName } from '../ui/useDownload'
import { mediaItem, viewsOnCanvas, type MediaItem } from '../media/names'
import { linkedRows, sketchOf, unknownTyped } from './trayScope'
import './inputs.css'
import { campaignSheet } from '../campaign/sheet'
import { MakeSizesSheet } from '../campaign/MakeSizesSheet'
import { FilmSizesSheet } from '../campaign/FilmSizesSheet'
import { pictureMaster, videoMaster } from '../campaign/master'
import { ResizePanel } from '../campaign/ResizePanel'
import { resizableIn, resizePictures } from '../campaign/resizeSelection'
import { assetRef } from '../jobs/assets'
import { namedInput } from '../jobs/select'
import { FrontButtons, FrontChooser } from './FrontsNeeded'

type Pt = { x: number; y: number }
/** A Generate waiting for its spot (Place…): what it sends, its model's picture budget and who is marked a person. */
type PlaceJob = { ids: string[]; text: string; more: boolean; modelChoice?: ModelChoice; limits?: RefLimits; people?: string[] }
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
  selectionKind(): { kind: 'none' } | { kind: 'one' } | { kind: 'group'; group?: string; ink: boolean } | { kind: 'several'; count: number }
  group(): string | null
  ungroup(): boolean
  setSketchRatio(ratio: string): void
}>

export function Character({ initial, active, onPictureEditor }: {
  initial: CanvasSnapshot | null
  active: boolean
  /** A canvas picture is open in the Image editor (true) or closed again: the page shows only the editor's bar. */
  onPictureEditor?: (open: boolean) => void
}) {
  const services = useServices()
  const { runner, doc: docStore, ui: uiStore, project } = services
  const router = useRouter()
  const panels = usePanels()
  const [chrome, setChrome] = useState<CanvasChrome | null>(null)
  const [board, setBoard] = useState<string | null>(null)
  // The touch layout (labelled rail, Boards pill, big zoom) on a touch screen or a phone; a laptop or a
  // narrow desktop window keeps the desktop rail (owner answer 2026-11-18: the Boards pill on touch only;
  // mock production-new-ui-v2 w1024-canvas).
  const narrow = useMedia(TOUCH_OR_PHONE)
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const theme = useColorScheme()
  const sheet = useSyncExternalStore(campaignSheet.subscribe, campaignSheet.get)
  const { config, controls } = useConfig()
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [vs, setVs] = useState<ViewState | null>(null)
  const ctrl = useMemo(() => (canvas ? new CanvasController(canvas, services) : null), [canvas, services])
  // The e2e harness reads the canvas's elements and positions (web/e2e/README.md); never in a build.
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __canvas?: Canvas | null }).__canvas = canvas }, [canvas])
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __ctrl?: CanvasController | null }).__ctrl = ctrl }, [ctrl])
  // Show (the tray) or Open (Decisions) on a question that waits on a canvas result: the canvas comes to the result,
  // at once, so its card mounts beside it and takes the focus (UAT round 1 IMG-1).
  useEffect(() => {
    if (!ctrl || !canvas) return
    const onReveal = (e: Event) => {
      const jobId = docStore.get().asks[(e as CustomEvent<string>).detail]?.job_id
      const el = jobId ? byOwnId(canvas.elements(), jobId) : undefined
      if (el && !el.isDeleted) ctrl.reveal([el.id], false)
    }
    window.addEventListener(ASK_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(ASK_REVEAL_EVENT, onReveal)
  }, [ctrl, canvas, docStore])
  // A canvas opened from the server comes without its pictures' files: put them back from the blobs.
  useEffect(() => {
    if (ctrl) void ctrl.restoreFiles().catch((e) => console.warn('could not put the canvas pictures back', e))
    // Views made again after the first ones were deleted take back their names (their key group).
    if (ctrl) { try { ctrl.claimViewNames() } catch (e) { console.warn('could not name the views', e) } }
    // A placeholder whose job was never written down (the page closed first): followed if the relay has it, else "never started".
    if (ctrl) void ctrl.recoverPlaceholders().catch((e) => console.warn('could not look up the canvas placeholders', e))
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
  const [placing, setPlacing] = useState<PlaceJob | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)
  /** Resize… from the node bar (a selection with nodes and pictures): the pictures it resizes. */
  const [resizeOn, setResizeOn] = useState<{ els: El[]; key: string } | null>(null)
  /** Dex's question when Make film has two scripts or two storyboards (3.5): which one drives. */
  // Generate opened from an ink group's bar (container-select): the popover over the group's strokes.
  const [genFor, setGenFor] = useState<string[] | null>(null)
  const [which, setWhich] = useState<{ scripts: string[]; storyboards: string[]; at: Pt } | null>(null)
  /** Fin's ask from a placed Generate on a sketch with no words: answered here, then it goes. */
  const [asking, setAsking] = useState<{ ask: Ask; job: PlaceJob; at: { x: number; y: number } } | null>(null)

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
  // A picture shows its current version: Apply, a version picked, and their undo move it (edit-canvas-pictures).
  useEffect(() => {
    if (!ctrl) return
    const sync = (d: ReturnType<typeof docStore.get>) => void ctrl.syncPictureVersions(d).catch((e) => console.warn('could not show the picture version', e))
    sync(docStore.get())
    return docStore.onChange(sync)
  }, [ctrl, docStore])

  // The picture open in the Image editor (its node id): from Edit in its bar, or a double-click.
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => canvasActions.onEditPicture(setEditing), [])

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
  // The canvas's Booth (features/production-new-ui.clan, the Booth rule): only for a selected Brief node, whose
  // whole spine needs room; with nothing of that selected the canvas takes the full width.
  const booth = useBooth('canvas')
  // In link mode the first click picks the source: no Booth for it, so the targets on the right stay in reach
  // (re-test N8: the Brief's Booth covered the Storyboard and the Sizes board until Hide).
  const linkMode = useSyncExternalStore(canvasActions.subscribe, () => canvasActions.mode() === 'link')
  const selBrief = useMemo(() => {
    const ids = vs?.selected ?? []
    return ids.length === 1 && !linkMode ? briefOfElement(els.find((e) => e.id === ids[0])) : null
  }, [vs, els, linkMode])
  // The picture open in the Image editor, as the canvas shows it now; gone from the canvas, the editor closes.
  const editingPic = useMemo(() => {
    if (!editing) return null
    const el = byOwnId(els, editing)
    const sha = editablePicture(el) ? imageOf(el)!.asset : undefined
    if (!el || !sha) return null
    const a = doc.assets[sha]
    return { nodeId: editing, picture: { sha, ...(a?.w && a?.h ? { w: a.w, h: a.h } : {}) } }
  }, [editing, els, doc.assets])
  // While it is open the editor is the page: its bar is the only one (owner, 2026-10-16: "Double buttons?").
  const pictureOpen = !!editingPic
  useEffect(() => {
    onPictureEditor?.(pictureOpen)
  }, [pictureOpen, onPictureEditor])
  useEffect(() => () => onPictureEditor?.(false), [onPictureEditor])
  // Nodes and boards (our own engine) have their own handles: the floating toolbar is for marks and pictures.
  // ⌘Z (or the undo buttons) took the step back: its "· Undo" chip leaves with it.
  useEffect(() => {
    if (undo && offerGone(undo, new Set(els.map((e) => e.id)))) offerUndo(null)
  }, [els, undo, offerUndo])
  const selected = useMemo(() => els.filter((e) => vs?.selected.includes(e.id) && !cardOf(e) && !isBoard(e)), [els, vs])
  // Resize… from the node bar is for the selection it opened on: another selection closes it.
  const selKey = vs?.selected.join(',') ?? ''
  const resizing = resizeOn && resizeOn.key === selKey ? resizeOn.els : null
  const setResizing = (els: El[] | null) => setResizeOn(els ? { els, key: selKey } : null)
  // Our own engine's bar for nodes, links and groups (ui-behaviour 3.9); pictures, marks and sketch areas keep the Generate bar.
  const ownEdit = canvas?.engine === 'own' ? (canvas as unknown as OwnEdit) : null
  const ownSel = useMemo((): { info: SelInfo; els: El[] } | null => {
    if (!ownEdit || !vs) return null
    const all = els.filter((e) => vs.selected.includes(e.id) && !isBoard(e))
    if (!all.length) return null
    const kind = ownEdit.selectionKind?.() ?? { kind: 'none' as const }
    const cards = all.map(cardOf).filter((c): c is NonNullable<ReturnType<typeof cardOf>> => !!c).map((c) => c.kind as CardKind)
    const links = all.filter((e) => linkIdOf(e)).length
    // A key's views (owner 2026-10-15): "Samurai · 3 views", stacked or spread.
    const key = kind.kind === 'group' ? keyOfGroupId(kind.group) : null
    const kg = key ? keyGroupsOn(els, doc).find((g) => g.key === key) : undefined
    const group = kind.kind === 'group' ? { ink: kind.ink, ...(kg ? { key: { label: groupLabel(kg), stacked: kg.stacked } } : {}) } : null
    if (!cards.length && !links && !group) return null
    const units = kind.kind === 'several' ? kind.count : kind.kind === 'none' ? 0 : 1
    // What cannot run on this selection now, with why (3.9: greyed with the reason).
    const d = doc
    const ids = all.map(cardOf).filter((c): c is NonNullable<ReturnType<typeof cardOf>> => !!c)
    const scripts = ids.filter((c) => c.kind === 'script').map((c) => c.id)
    const boards = ids.filter((c) => c.kind === 'storyboard').map((c) => c.id)
    const off: SelInfo['off'] = {}
    if (scripts.length === 1) {
      const why = planShotsBlocked(d, scripts[0])
      if (why) off['plan-shots'] = why
      const other = boards.length === 1 ? drivers(d, { kind: 'storyboard', id: boards[0] }).filter((s) => s !== scripts[0]) : []
      if (!why && other.length) off['plan-shots'] = 'That storyboard follows another script'
    }
    if (!canvasActions.canMake()) off['make-video'] = 'Make film needs the canvas'
    if (!controls.generate) off.generate = 'Generate is turned off here'
    const pictures = resizableIn(all).count
    return { info: { cards, links, group, units, locked: all.every((e) => (e as El & { locked?: boolean }).locked), off, ...(pictures ? { pictures } : {}) }, els: all }
  }, [ownEdit, vs, els, doc, controls.generate])
  const zoom = vs?.view.zoom ?? 1

  const doDelete = useCallback((ids: string[]) => {
    if (!ctrl) return
    setConfirming(null)
    const r = ctrl.deleteElements(ids)
    if (r) offerUndo({ label: r.label, at: r.at, undo: () => ctrl.undelete(r.ids), gone: backWhenLive(r.ids) })
    // The 🗑 had the focus: the next ⌘Z is the canvas's, and takes the delete back (its chip leaves with it).
    ;(canvas as unknown as { focusCanvas?: (() => void) | null } | null)?.focusCanvas?.()
  }, [ctrl, offerUndo, canvas])

  /** Resize… placed its results: one Undo takes every one away, made or still making (Ctrl+Z does too
   *  until the first lands; a landed picture is the crew's change, which the canvas's undo leaves). */
  const onResized = useCallback((jobs: string[]) => {
    if (!canvas || !ctrl) return
    const els = alive(canvas.elements()).filter((e) => jobs.includes(e.id))
    if (!els.length) return
    const b = bounds(els)
    offerUndo({ label: `${jobs.length} ${jobs.length === 1 ? 'picture' : 'pictures'} on the way`, at: { x: b.minX + b.w / 2, y: b.maxY + 16 },
      undo: () => { ctrl.deleteElements(jobs) }, gone: goneWhenDead(jobs) })
  }, [canvas, ctrl, offerUndo])

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
        // Handled: the canvas's own Esc (leave a Drawing, clear the selection) then stands aside.
        e.preventDefault()
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

  // Esc clears the canvas selection wherever the focus is (UAT round 1 IMG-13: after a click on the bar the canvas had
  // no focus, and its own Esc never came). Not while typing, and not when something else took the key first.
  useEffect(() => {
    if (!canvas || !active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || placing) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], .ie-versions')) return
      if (canvas.view().selectedIds.length) canvas.select([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canvas, active, placing])

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
      const r = await ctrl.generate(job.ids, job.text, { at, more: job.more, limits: job.limits, people: job.people, modelChoice: job.modelChoice })
      if ('ask' in r) setAsking({ ask: r.ask, job, at })
    } catch (err) {
      setPlaceError(errText(err))
    }
  }, [placing, ctrl, canvas])

  /** The answer to Fin's ask from a placed Generate: layout only goes as it is; described, its words go. */
  const onAskAnswered = useCallback(async (answer: AnswerChoice) => {
    if (!ctrl || !asking) return
    const { job, at } = asking
    setAsking(null)
    try {
      const opts = { at, more: job.more, limits: job.limits, people: job.people, modelChoice: job.modelChoice }
      if ('optionId' in answer && answer.optionId === LAYOUT_ONLY) await ctrl.generate(job.ids, job.text, { ...opts, layoutOnly: true })
      else if ('text' in answer) await ctrl.generate(job.ids, answer.text, opts)
    } catch (err) {
      setPlaceError(errText(err))
    }
  }, [ctrl, asking])

  // A node made from an editor (the Film editor's Make a storyboard from these shots): its Undo here.
  useEffect(() => canvasActions.onMade((m) => {
    const undoScene = (canvas as unknown as { undoScene?: (dir: 'undo' | 'redo') => boolean } | null)?.undoScene
    offerUndo({ label: m.label, at: { x: m.el.x + m.el.width / 2, y: m.el.y }, above: true, undo: () => { undoScene?.call(canvas, 'undo') }, gone: goneWhenDead([m.el.id]) })
  }), [canvas, offerUndo])

  /** Make film from a script, a storyboard or both (3.5): one undo step, said with Undo. */
  const makeVideoFrom = useCallback(async (from: MakeVideoFrom) => {
    setWhich(null)
    setPlaceError(null)
    try {
      const made = canvasActions.makeVideo(from)
      if (!made) throw new Error('Make film needs the canvas.')
      const r = await made
      const undoScene = (canvas as unknown as { undoScene?: (dir: 'undo' | 'redo') => boolean } | null)?.undoScene
      offerUndo({ label: r.label, at: { x: r.el.x + r.el.width / 2, y: r.el.y }, above: true, undo: () => { undoScene?.call(canvas, 'undo') }, gone: goneWhenDead([r.el.id]) })
    } catch (err) {
      setPlaceError(errText(err))
    }
  }, [canvas, offerUndo])

  /** The selection's scripts and storyboards, as document ids. */
  const selected3 = (sel: El[]) => {
    const cs = sel.map(cardOf).filter((c): c is NonNullable<ReturnType<typeof cardOf>> => !!c)
    return { scripts: cs.filter((c) => c.kind === 'script').map((c) => c.id), storyboards: cs.filter((c) => c.kind === 'storyboard').map((c) => c.id) }
  }

  const onMakeVideo = useCallback((sel: El[]) => {
    const { scripts, storyboards } = selected3(sel)
    if (scripts.length > 1 || storyboards.length > 1) {
      const b = bounds(sel)
      setWhich({ scripts, storyboards, at: { x: b.minX + b.w / 2, y: b.minY } })
      return
    }
    void makeVideoFrom({ ...(scripts[0] ? { scriptId: scripts[0] } : {}), ...(storyboards[0] ? { storyboardId: storyboards[0] } : {}) })
  }, [makeVideoFrom])

  /** Plan shots from the selection (3.10): the script's storyboard (made beside it when it has none), or the selected one. */
  const onPlanShots = useCallback(async (sel: El[]) => {
    const { scripts, storyboards } = selected3(sel)
    const scriptId = scripts[0]
    if (!scriptId) return
    setPlaceError(null)
    try {
      if (storyboards[0]) {
        const d = docStore.get()
        if (!drivers(d, { kind: 'storyboard', id: storyboards[0] }).includes(scriptId)) {
          await linkInto(docStore, { kind: 'script', id: scriptId }, { kind: 'storyboard', id: storyboards[0] })
        }
        await planOrJoin(services, { storyboardId: storyboards[0] })
        return
      }
      const r = await planFromScript(services, scriptId)
      if (r.made) {
        const el = canvas ? alive(canvas.elements()).find((e) => cardOf(e)?.id === r.storyboardId) : undefined
        const undoScene = (canvas as unknown as { undoScene?: (dir: 'undo' | 'redo') => boolean } | null)?.undoScene
        if (el) offerUndo({ label: 'Storyboard made from Script · The Director agent is planning the shots', at: { x: el.x + el.width / 2, y: el.y }, undo: () => { undoScene?.call(canvas, 'undo') } })
      }
    } catch (err) {
      setPlaceError(errText(err))
    }
  }, [docStore, services, canvas, offerUndo])

  // A blank canvas asks nothing (owner 2026-11-18): no Start card, no prompt. Arriving from Brief Maker
  // (?brief=<doc id>) puts that brief's Brief node on it, alone, once (features/production-new-ui.clan).
  useBriefSpinoff(canvas?.engine === 'own' ? { canvas, doc: docStore } : null)
  // Dev only: the canvas for window.__seed.brief (dev/seed.ts), so a Brief node can be put on it in a screenshot.
  useEffect(() => {
    if (!import.meta.env.DEV || !canvas) return
    ;(window as unknown as { __canvasEnv?: unknown }).__canvasEnv = { canvas, doc: docStore }
  }, [canvas, docStore])

  // Our own engine has the boards as real frames and the nodes as real elements (art-boards,
  // canvas-nodes): the rail jumps to the frames, and nothing is drawn over the canvas for them.
  const own = canvas?.engine === 'own'
  // What a jump keeps clear on the left: the tool rail's column (none when narrow, where it sits over the top).
  const railInset = narrow ? 0 : 64
  // New results land in view right of the rail (board-autolayout).
  useEffect(() => { ctrl?.setInset(railInset) }, [ctrl, railInset])
  // Assets opened on purpose (+ › A brief from Brief Maker…, Continue in › Link a brief…) is the newest ask: a
  // selected Brief would keep the Booth on itself and the library never showed (re-test 4c).
  const assetsAsk = panels.assets ? `assets:${panels.assetsTab ?? ''}` : ''
  const lastAsk = useRef('')
  useEffect(() => {
    const fresh = !!assetsAsk && assetsAsk !== lastAsk.current
    lastAsk.current = assetsAsk
    if (fresh && canvas && selBrief) canvas.select([])
  }, [assetsAsk, canvas, selBrief])
  // And the other way: a Brief selected while the library is open takes the Booth, and the library closes under
  // it. Closing the Brief's Booth (✕) then leaves nothing behind (re-test N-H: the library came back, and stayed
  // open in link mode over the Script target).
  const lastBrief = useRef<string | null>(null)
  useEffect(() => {
    const fresh = !!selBrief && selBrief !== lastBrief.current
    lastBrief.current = selBrief
    if (fresh && panels.assets) panels.toggle('assets')
  }, [selBrief, panels])
  // Selecting pans the node into the visible area (production-new-ui design guard; re-test 2b: a selected Brief
  // sat half under the tool rail, and the Booth's column opening took the right edge). One node (never a picture),
  // once per selection, after the Booth has slid in; never mid-drag, and not after the person moved it.
  const oneSel = vs?.selected.length === 1 ? vs.selected[0] : ''
  const revealOpts = useRef({ own, linkMode, railInset })
  useEffect(() => { revealOpts.current = { own, linkMode, railInset } }, [own, linkMode, railInset])
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Imperative, never a state change: a re-render between the two presses of a double-click reset the node
  // layer's press tracking (e2e canvas-picture: a group's picture opened on the first double-click).
  const scheduleReveal = useCallback(() => {
    if (revealTimer.current) clearTimeout(revealTimer.current)
    revealTimer.current = null
    const o = revealOpts.current
    const ids = canvas?.view().selectedIds ?? []
    if (!canvas || !o.own || o.linkMode || ids.length !== 1) return
    const id = ids[0]
    const at = canvas.elements().find((e) => e.id === id)
    if (!at || isBoard(at) || !(cardOf(at) || briefOfElement(at))) return
    const from = { x: at.x, y: at.y }
    let tries = 0
    const reveal = () => {
      revealTimer.current = null
      const e = canvas.elements().find((x) => x.id === id && !x.isDeleted)
      if (!e || canvas.view().selectedIds.join() !== id) return
      if (canvas.isBusy()) {
        if (++tries < 20) revealTimer.current = setTimeout(reveal, 150)
        return
      }
      if (e.x !== from.x || e.y !== from.y) return
      bringIntoView(canvas, { minX: e.x, minY: e.y, maxX: e.x + e.width, maxY: e.y + e.height }, revealOpts.current.railInset, !matchMedia('(prefers-reduced-motion: reduce)').matches)
    }
    revealTimer.current = setTimeout(reveal, 480)
  }, [canvas])
  useEffect(() => {
    if (oneSel) scheduleReveal()
    return () => { if (revealTimer.current) clearTimeout(revealTimer.current) }
  }, [oneSel, linkMode, scheduleReveal])
  // A click (not a drag) on the canvas or a card asks again: clicking the node already selected brings it back.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) setTimeout(scheduleReveal, 0)
      down = null
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
    }
  }, [scheduleReveal])
  // A picture named on no board goes to its role's board: "Moved to Characters · Undo" (board-autolayout).
  useEffect(() => ctrl?.onRouted((r) => {
    const e = canvas?.elements().find((x) => x.id === r.ids[0])
    offerUndo({ label: `Moved to ${r.title}`, at: e ? { x: e.x, y: e.y } : undefined, undo: () => ctrl.unroute(r) })
  }), [ctrl, canvas, offerUndo])
  // The Gather nudge and Move to <Board> on the pictures' bar (board-autolayout; BA2 = c, BA3).
  const gather = useMemo(() => (own && canvas && selected.length ? gatherOffer(els, doc, selected.map((e) => e.id)) : null), [own, canvas, selected, els, doc])
  const onGather = useCallback(async (o: GatherOffer) => {
    if (!canvas) return
    try {
      const frameId = o.existing && moveIntoBoard(canvas, docStore.get(), o) ? o.existing : await gatherIntoBoard(canvas, docStore, o)
      // The board and the pictures in view, right of the rail; the next ⌘Z is the canvas's (it takes this back).
      const f = canvas.elements().find((e) => e.id === frameId)
      if (f) bringIntoView(canvas, { minX: f.x, minY: f.y, maxX: f.x + f.width, maxY: f.y + f.height }, railInset, !matchMedia('(prefers-reduced-motion: reduce)').matches)
      ;(canvas as unknown as { focusCanvas?: (() => void) | null }).focusCanvas?.()
    } catch (e) {
      console.warn('the board was not made', e)
    }
  }, [canvas, docStore, railInset])
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
  // The rail lists the loose nodes first (Script, Storyboard, Video), then the boards (board-autolayout).
  const rail = useMemo((): RailNode[] => (own ? railNodes(els, doc).map((n) => ({ card: n.card, elId: n.el.id })) : []), [els, doc, own])
  const rows = useMemo(() => boardRows(doc, own, counts, rail), [doc, own, counts, rail])
  const open = useCallback((editor: 'script' | 'storyboard' | 'video', id?: string) => {
    if (editor === 'script') {
      if (id) return router.push(scriptRoute(project.id, id))
      // A blank project has no script yet: on our own engine one is made as + Node → Script makes it.
      const env = canvas?.engine === 'own' ? { canvas, doc: docStore } : null
      void scriptToWrite(docStore.get(), env)
        .then((sc) => { if (sc) router.push(scriptRoute(project.id, sc)) })
        .catch((e) => console.warn('the script was not made', e))
      return
    }
    uiStore.update((u) => {
      if (id) u.openNode = { ...u.openNode, [editor]: id }
      u.stage = editor
    }, 'stage')
  }, [docStore, router, project.id, uiStore, canvas])
  const pickBoard = useCallback((row: BoardRow) => {
    setBoard(row.id)
    if (row.target.kind === 'open') return open(row.target.editor)
    if (!canvas) return
    if (own && (row.target.kind === 'board' || row.target.kind === 'node')) {
      const t = row.target
      const el = t.kind === 'node' ? t.id : canvas.elements().find((e) => boardIdOf(e) === t.id)?.id
      if (el) jumpTo(canvas, docStore.get(), { el }, !matchMedia('(prefers-reduced-motion: reduce)').matches, railInset)
      canvas.setCurrentBoard?.(t.kind === 'board' ? t.id : null)
      return
    }
    const want = row.target.kind === 'refs' ? new Set(row.target.nodes) : new Set<string>()
    const hit = alive(canvas.elements()).filter((e) => {
      const c = cd(e)
      return want.has(e.id) || (!!c && 'id' in c && want.has(c.id)) || (row.target.kind === 'board' && c?.kind === 'board' && c.id === row.target.id)
    })
    if (hit.length) canvas.fit(hit, { zoomFactor: 0.8, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
  }, [canvas, open, own, docStore, railInset])
  // The Excalidraw fallback has no frames of its own: ⌥1…⌥9 pick its rows (the rail took them; it is gone).
  const pickRef = useRef<(r: BoardRow) => void>(() => {})
  const fitRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (own || narrow) return
    const onKey = (e: KeyboardEvent) => {
      const k = boardKey(e)
      if (k === null) return
      e.preventDefault()
      if (k === 'fit') return fitRef.current()
      const row = rows[k]
      if (row && !row.off) pickRef.current(row)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [own, narrow, rows])
  // On our own engine the canvas takes ⌥1…⌥9 (canvas/boards/BoardLayer) and keeps which is current.
  useEffect(() => {
    if (!own || !canvas) return
    const onKey = (e: KeyboardEvent) => {
      const k = boardKey(e)
      if (k === null) return
      const t = k === 'fit' ? null : railTargets(canvas.elements(), docStore.get())[k]
      setBoard(t ? (t.kind === 'board' ? t.board.id : t.el.id) : null)
      canvas.setCurrentBoard?.(t?.kind === 'board' ? t.board.id : null)
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

  useEffect(() => { pickRef.current = pickBoard; fitRef.current = fitEverything })

  return (
    <div className="character">
      <CardChromeContext.Provider value={PRODUCTION_CARD_CHROME}>
      <div className="cv-row">
      <div className="canvas-wrap pt-grid" ref={wrap} style={grid}>
        {frames.length > 0 && <BoardsLayer part="frames" frames={frames} toView={toView} zoom={zoom} current={board} onOpen={open} />}
        <CanvasMount initial={initial} onReady={setCanvas} onChrome={setChrome} onChange={onChange} theme={theme} railInset={railInset} />
        {frames.length > 0 && <BoardsLayer part="cards" frames={frames} toView={toView} zoom={zoom} current={board} onOpen={open} />}
        <div className="overlay-layer">
          <FlowArrows els={els} selectedIds={vs?.selected ?? []} toView={toView} />
          {els.map((e) => {
            const img = imageOf(e)
            const c = cd(e)
            const named = img ? refsList(doc).find((r) => r.node === img.id) : undefined
            // A stacked view shows no name of its own: its stack has one label ("Samurai · 3 views").
            const stacked = !!(e as El & { stack?: unknown }).stack
            return (
              <span key={e.id}>
                {named && !stacked && <NameChip r={named} at={toView({ x: e.x, y: e.y + e.height })} width={e.width * zoom} zoom={zoom} />}
                {c?.kind === 'gen' && <GenOverlay el={e} c={c} toView={toView} zoom={zoom} ctrl={ctrl} named={!!named} />}
                {img && img.kind !== 'drawn' && !stacked && <VersionChip nodeId={img.id} at={toView({ x: e.x + e.width, y: e.y })} />}
                {img?.kind === 'pic' && img.asset && !stacked && <RightsChip sha={img.asset} at={toView({ x: e.x, y: e.y })} zoom={zoom} />}
              </span>
            )
          })}
          {ctrl && resizing && (() => {
            const r = resizableIn(resizing)
            const b = bounds(resizing)
            const top = toView({ x: b.minX + b.w / 2, y: b.minY })
            return r.count ? <ResizeFor ctrl={ctrl} items={r.items} strokes={r.strokes} total={r.total} onSent={onResized} at={{ x: top.x, top: top.y, bottom: toView({ x: b.minX, y: b.maxY }).y }} onClose={() => setResizing(null)} /> : null
          })()}
          {ctrl && canvas && ownSel && !selBrief && !resizing && !confirming && !placing && !which && (() => {
            const b = bounds(ownSel.els)
            // A selection scrolled out of view has no bar pinned to the edge (UAT round 1 IMG-13).
            if (!genFor && !inView(canvas, b)) return null
            const top = toView({ x: b.minX + b.w / 2, y: b.minY })
            const ids = ownSel.els.map((e) => e.id)
            if (genFor && genFor.join() === ids.join()) {
              return <GeneratePopover ctrl={ctrl} ids={ids} at={{ x: top.x, top: top.y, bottom: toView({ x: b.minX, y: b.maxY }).y }}
                onClose={() => setGenFor(null)} onPlace={(job) => { setGenFor(null); setPlaceError(null); setPlacing(job) }} />
            }
            return (
              <SelectionBar info={ownSel.info} anchor={{ x: top.x, top: top.y - (ownSel.info.group?.ink ? 30 : 0), bottom: toView({ x: b.minX, y: b.maxY }).y, ...(ownSel.info.cards.length ? { left: toView({ x: b.minX, y: b.minY }).x } : {}) }} actions={{
                open: () => { const c = ownSel.els.map(cardOf).find(Boolean); if (c) open(c.kind, c.id) },
                makeVideo: () => onMakeVideo(ownSel.els),
                // The storyboard's film opens on its Make room; with no film yet, Make film makes one and opens it.
                makeClips: () => {
                  const c = ownSel.els.map(cardOf).find((x) => x?.kind === 'storyboard')
                  const v = c ? videoOfStoryboard(doc, c.id) : undefined
                  if (v) open('video', v.id)
                  else onMakeVideo(ownSel.els)
                },
                planShots: () => void onPlanShots(ownSel.els),
                group: () => { ownEdit?.group?.() },
                ungroup: () => { ownEdit?.ungroup?.() },
                lock: (locked) => {
                  const ids = new Set(ownSel.els.map((e) => e.id))
                  canvas.transact((all) => all.map((e) => (ids.has(e.id) ? canvas.patch(e, { locked } as Partial<El>) : e)), { undoable: true })
                },
                remove: () => requestDelete(ownSel.els),
                generate: () => setGenFor(ids),
                makeSizes: () => {
                  const c = ownSel.els.map(cardOf).find((x) => x?.kind === 'video')
                  if (!c) return
                  const m = videoMaster(docStore.get(), c.id)
                  if (!m) { setPlaceError('Render the ad first: Make all sizes starts from the rendered ad.'); return }
                  campaignSheet.open({ master: m, nearId: ownSel.els[0]?.id })
                },
                resize: () => setResizing(ownSel.els),
                stack: (on) => {
                  const kg = keyGroupsOn(canvas.elements(), docStore.get()).find((g) => g.members.some((m) => ownSel.els.some((e) => e.id === m.id)))
                  if (kg) setStacked(canvas, kg.members, on, { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
                },
              }} />
            )
          })()}
          {ctrl && selected.length > 0 && !ownSel && !selBrief && !confirming && !placing && (
            <FloatingToolbar ctrl={ctrl} selected={selected} toView={toView} onDelete={requestDelete} onEdit={setEditing} gather={gather} onGather={onGather}
              onSizes={own ? (el) => {
                // A picture, or a scamp's picture (a Drawing's strokes, a sketch area's region) as the master.
                void ctrl.resizeSources([el.id]).then(async ([src]) => {
                  if (!src) return
                  const m = await pictureMaster(docStore.get(), { id: src.nodeId, asset: src.asset })
                  campaignSheet.open({ master: { ...m, w: src.w, h: src.h, ...(src.kind !== 'picture' && m.label === 'Key visual' ? { label: src.kind === 'sketch' ? 'Sketch' : 'Drawing' } : {}) }, nearId: el.id })
                }).catch((e) => setPlaceError(errText(e)))
              } : undefined}
              onResized={onResized}
              onGroup={ownEdit?.group && selected.length > 1 ? () => { ownEdit.group?.() } : undefined}
              onPlace={(job) => { setPlaceError(null); setPlacing(job) }} />
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
          {which && (() => {
            const p = toView(which.at)
            const d = docStore.get()
            const pickScript = which.scripts.length > 1
            const ids = pickScript ? which.scripts : which.storyboards
            const title = (id: string) => (pickScript ? d.scripts[id]?.title : d.storyboards[id]?.title)?.trim() || (pickScript ? 'Script' : 'Storyboard')
            const q = { id: 'q_which', kind: 'ambiguity' as const, text: `Which ${pickScript ? 'script' : 'storyboard'} drives the video?`, allow_text: false,
              why: `You picked ${ids.length} ${pickScript ? 'scripts' : 'storyboards'}. A video follows one.`,
              options: ids.map((id) => ({ id, label: title(id), value: { route: id } })) }
            return (
              <Floating className="popover" anchor={{ x: p.x, top: p.y, bottom: p.y }}>
                <section className="askcard open" role="group" aria-label={`dex asks: ${q.text}`}>
                  <div className="askcard-head">
                    <AgentFigure agent="dex" size={28} state="needs-you" decorative />
                    <span className="askcard-who">{sayer('dex')}</span>
                    <span className="askcard-sp" />
                    <button className="askcard-latr" onClick={() => setWhich(null)}>Cancel</button>
                  </div>
                  <div className="askcard-q">{q.text}</div>
                  <div className="askcard-why faint">{q.why}</div>
                  <AskOptions q={q} disabled={false} onPick={(id) => {
                    const next = pickScript ? { ...which, scripts: [id] } : { ...which, storyboards: [id] }
                    if (next.scripts.length > 1 || next.storyboards.length > 1) { setWhich(next); return }
                    void makeVideoFrom({ ...(next.scripts[0] ? { scriptId: next.scripts[0] } : {}), ...(next.storyboards[0] ? { storyboardId: next.storyboards[0] } : {}) })
                  }} />
                </section>
              </Floating>
            )
          })()}
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
            return <UndoChip className={`oncanvas ${undo.above ? 'above' : ''}`} label={undo.label} onUndo={runUndo} style={{ left: p.x, top: p.y }} />
          })()}
        </div>
        {placing && (
          <div className="placing" onPointerDown={onPlace} role="button" aria-label="Click where the new image goes">
            <div className="placing-hint">Click where the new image goes · <button className="btn xs ghost" onPointerDown={(e) => { e.stopPropagation(); setPlacing(null) }}>Cancel</button></div>
          </div>
        )}
        {sheet && canvas && sheet.master.media === 'video' && (
          <FilmSizesSheet master={sheet.master} deps={{ canvas, doc: docStore, runner, relay: services.relay }}
            by={ui.me ? `human:${ui.me.participantId}` : 'human:p_local'}
            near={sheet.nearId ? canvas.elements().find((e) => e.id === sheet.nearId)
              : sheet.node ? canvas.elements().find((e) => { const c = cardOf(e); return !e.isDeleted && c?.kind === sheet.node!.kind && c.id === sheet.node!.id }) : undefined}
            onClose={() => campaignSheet.close()}
            onMade={(el) => {
              const frame = el.frameId ? canvas.elements().find((e) => e.id === el.frameId) : undefined
              canvas.fit(frame ? [frame] : [el], { zoomFactor: 0.85, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
            }} />
        )}
        {sheet && canvas && sheet.master.media !== 'video' && (
          <MakeSizesSheet master={sheet.master} deps={{ canvas, doc: docStore, runner, relay: services.relay }}
            by={ui.me ? `human:${ui.me.participantId}` : 'human:p_local'}
            near={sheet.nearId ? canvas.elements().find((e) => e.id === sheet.nearId) : undefined}
            onClose={() => campaignSheet.close()}
            onMade={(el) => {
              const frame = el.frameId ? canvas.elements().find((e) => e.id === el.frameId) : undefined
              canvas.fit(frame ? [frame] : [el], { zoomFactor: 0.85, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
            }} />
        )}
        <FrontChooser />
        {placeError && <div className="place-error" role="alert">{placeError}<FrontButtons text={placeError} /> <button className="btn xs ghost" onClick={() => setPlaceError(null)}>OK</button></div>}
        {/* Boards are frames on the canvas (⌥1…⌥9 jump, ⌥0 fits); on touch, with no ⌥, the Boards pill opens the jump sheet. */}
        {narrow && <BoardRail rows={rows} current={board} onPick={pickBoard} onFit={fitEverything} narrow keys={!own} />}
        <CanvasToolbar chrome={chrome} ratio={ratio} onNode={onNode} onBrief={() => { canvas?.select([]); panels.openAssets('napkin') }}
          onAssets={() => { canvas?.select([]); if (!panels.assets) panels.toggle('assets') }} vertical={narrow} />
        <ZoomPill chrome={chrome} touch={narrow} />
        <LinksToggle chrome={chrome} />
      </div>
      <Booth state={booth} earned={boothEarned({ selection: !!selBrief, library: panels.assets })}>
        {selBrief ? <BriefBooth briefId={selBrief} onClose={() => canvas?.select([])} />
          : panels.assets ? <AssetsLibrary ctrl={ctrl} env={canvas?.engine === 'own' ? { canvas, doc: docStore } : null} tab={panels.assetsTab} onClose={() => panels.toggle('assets')} onPicture={() => chrome?.setTool('image')}
              onCanvas={els.map((e) => imageOf(e)?.asset).filter((x): x is string => !!x)} onScript={() => open('script', mainScript(docStore.get())?.id)} />
          : null}
      </Booth>
      </div>
      </CardChromeContext.Provider>
      {editingPic && <ImageEditor target={{ kind: 'picture', nodeId: editingPic.nodeId }} picture={editingPic.picture} onBack={() => setEditing(null)} />}
    </div>
  )
}

// ── A picture's versions: "v2" on it, and its versions to pick (edit-canvas-pictures) ──

function VersionChip({ nodeId, at }: { nodeId: string; at: Pt }) {
  const { doc: store } = useServices()
  const doc = useDoc()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const versions = pictureVersions(doc, nodeId)
  const current = currentPictureFrame(doc, nodeId)
  if (versions.length < 2 || !current) return null
  return (
    <>
      <button ref={btn} type="button" className="vchip pt-mono" style={{ left: at.x, top: at.y }} aria-haspopup="menu" aria-expanded={open}
        title={`v${current.version} of ${versions.length}: pick another version`} onClick={() => setOpen((o) => !o)}>v{current.version}</button>
      <Float anchor={btn} open={open} onClose={() => setOpen(false)} align="end" label="Versions of this picture" className="ie-versions">
        {versions.map((f) => <VersionRow key={f.id} f={f} open={f.id === current.id} onPick={() => { setOpen(false); void pickPictureVersionStep(store, f.id) }} />)}
      </Float>
    </>
  )
}

// ── The name on a named node ────────────────────────────────────────────────

/** The height of the @name line under a picture (styles.css .refchips): what sits below it starts here. */
const NAME_LINE = 16

/** A picture's name under it, never wider than the picture: views placed side by side ran their names into
 *  each other ("@mira_three-quarter@mira_side", live test 2026-11-16), so a long one ends in an ellipsis
 *  and says itself in full in its title. */
export function NameChip({ r, at, width, zoom = 1 }: { r: NamedRef; at: Pt; width: number; zoom?: number }) {
  const name = `@${nameOf(r)}`
  // Scaled with the canvas, and gone when zoomed far out, like the Rights? chip (UAT round 3, R2-11 leftover: the names
  // stayed screen size at 25 % and lay over the next row's pictures).
  const look = chipLook(zoom)
  if (look.dot) return null
  return (
    <div className="refchips" style={{ left: at.x, top: at.y, maxWidth: Math.max(32, Math.round(width / look.scale)), transform: `translateY(${6 * look.scale}px) scale(${look.scale})`, transformOrigin: 'top left' }}>
      <span className="tagchip" title={`${name}: its name; write it with @ in instructions and shots`}>{name}</span>
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
  // Only while the canvas shows that picture: an edited version (v2, an upscale) is another size (UAT round 1 IMG-15).
  const shownNow = currentPictureFrame(doc, c.id)
  const edited = !!shownNow && !!frame && shownNow.asset !== frame.asset
  const caption = !edited && frame?.cropped_to && own?.w && own?.h ? croppedCaption({ w: own.w, h: own.h }, frame.cropped_to.to) : undefined
  const showNode = (isActive(state) || state === 'failed' || state === 'cancelled') && !dismissed && state !== 'completed'
  // Nothing is making it (runner.adopt): say so, never a blank box (2026-10-15).
  if (!job && !live && runner.isUnstarted(c.id)) {
    const what = c.view ? `The ${viewLabel(c.view).toLowerCase()} view` : 'This picture'
    return (
      <div className="gennode" style={{ left: tl.x, top: tl.y, width: w, height: h }}>
        <div className={`errnode ${w < 170 ? 'compact' : ''}`} role="alert">
          <div className="msg">{what} never started: the page closed before it was sent.</div>
          <div className="optbar" role="group" aria-label="What to do with it">
            {c.op === 'view' && c.view && (
              <button className="btn sm ghost" onClick={() => void ctrl?.remakeView(c.id).catch((e) => console.warn('could not make the view', e))}>Make it</button>
            )}
            <button className="btn sm ghost" onClick={() => ctrl?.deleteElements([el.id])}>Remove</button>
          </div>
        </div>
      </div>
    )
  }
  // Dex's question waits on this result: a card of its own beside the node, at screen size (UAT round 1 IMG-1: inside
  // the placeholder, overflow hidden, an 814 px card showed one or two words at any zoom).
  const asked = state === 'needs_input' ? waitingAsk(doc, c.id) : undefined
  // The size and view pills scale with the canvas and go when zoomed far out (UAT round 3, R2-11 leftover).
  const look = chipLook(zoom)
  const labelStyle: React.CSSProperties = { left: tl.x, top: tl.y, transform: `translateY(calc(-100% - ${6 * look.scale}px)) scale(${look.scale})`, transformOrigin: 'left bottom' }
  return (
    <>
      {showNode && (
        <div className="gennode" style={{ left: tl.x, top: tl.y, width: w, height: h }}>
          <JobNode jobId={c.id} compact={w < 170} askElsewhere={!!asked} onRetried={(id) => ctrl?.retarget(c.id, id)} />
        </div>
      )}
      {asked && !dismissed && <CanvasAsk ask={asked} rect={{ x: tl.x, y: tl.y, w, h }} />}
      {c.shape && state !== 'completed' && !look.dot && <div className="genlabel" style={labelStyle}><span className="pill">{c.shape}</span></div>}
      {state === 'completed' && !named && !look.dot && (
        <div className="genlabel" style={labelStyle}>
          {c.view && <span className="pill">{viewLabel(c.view)}</span>}
          {c.shape && <span className="pill" title="Resized to this shape">{c.shape}</span>}
          {showMock && c.mock && <span className="mockbadge">MOCK</span>}
        </div>
      )}
      {/* Under the picture's @name when it has one, not on top of it (owner, 2026-10-16). */}
      {/* Scaled with the canvas and left out when zoomed far out, like the Rights? chip (UAT round 2 R2-11). */}
      {state === 'completed' && caption && !look.dot && <div className="gencaption" style={{ left: tl.x, top: tl.y + h + (named ? NAME_LINE * look.scale : 0), transform: `scale(${look.scale})`, transformOrigin: 'top left' }}>{caption}</div>}
    </>
  )
}

/**
 * A result's waiting question on the canvas: the ask card in a popover beside the node, never inside it, at screen
 * size whatever the zoom. Only while the node is on screen: off it, the ask dock under the bar shows the question
 * instead (askPlaces: the card places the ask while it is mounted), and Show or Decisions' Open pans here first.
 */
function CanvasAsk({ ask, rect }: { ask: Ask; rect: { x: number; y: number; w: number; h: number } }) {
  const doc = useDoc()
  const probe = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  // Every render on purpose (the canvas resizes); the comparison inside stops the loop, as useFloating's does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const layer = probe.current?.closest<HTMLElement>('.overlay-layer')
    if (!layer) return
    const next = { w: layer.clientWidth, h: layer.clientHeight }
    if (!box || box.w !== next.w || box.h !== next.h) setBox(next)
  })
  const onScreen = !!box && rect.x + rect.w > 0 && rect.y + rect.h > 0 && rect.x < box.w && rect.y < box.h
  return (
    <span ref={probe} className="canvas-ask-at">
      {onScreen && (
        <Floating className="popover canvas-ask" anchor={{ x: rect.x + rect.w / 2, left: rect.x, top: rect.y, bottom: rect.y + rect.h }}>
          <AskCard ask={doc.asks[ask.id] ?? ask} />
        </Floating>
      )}
    </span>
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

function FlowArrows({ els, selectedIds, toView }: { els: El[]; selectedIds: readonly string[]; toView: (p: Pt) => Pt }) {
  const { runner } = useServices()
  const doc = useDoc()
  const paths: string[] = []
  const byEl = new Map(els.map((e) => [e.id, e]))
  const selected = new Set(selectedIds)
  for (const a of els) {
    const c = cd(a)
    if (c?.kind !== 'provenance' || a.type !== 'arrow') continue
    // A key's views from its front only while one of them is selected, as the canvas draws them.
    if (!arrowShown(a as unknown as ArrowLike, (id) => byEl.get(id), selected)) continue
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

type Popover = null | 'generate' | 'name' | 'resize'

export function FloatingToolbar({ ctrl, selected, toView, onDelete, onPlace, onGroup, onEdit, gather, onGather, onSizes, onResized }: {
  ctrl: CanvasController
  /** Open the one selected picture in the Image editor (edit-canvas-pictures). */
  onEdit: (nodeId: string) => void
  /** Gather into a <Role> board, or Move to <Board> (board-autolayout), when the selection fits one. */
  gather?: GatherOffer | null
  onGather?: (o: GatherOffer) => void | Promise<void>
  selected: El[]
  toView: (p: Pt) => Pt
  onDelete: (sel: El[]) => void
  /** Group the selection (our own engine; ui-behaviour 3.9's "Several mixed things"). */
  onGroup?: () => void
  onPlace: (job: PlaceJob) => void
  /** Make all sizes from this picture (features/campaign-formats.clan); our own engine only. */
  onSizes?: (el: El) => void
  /** Resize… placed its results (features/resize-selection.clan): offer Undo for all of them. */
  onResized?: (jobs: string[]) => void
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

  // A Campaign board has its own actions on its tiles (features/campaign-formats.clan).
  const meaningful = selected.filter((e) => cd(e)?.kind !== 'provenance' && (e.customData as { kind?: string } | undefined)?.kind !== 'format_set')
  if (!meaningful.length) return null
  const b = bounds(meaningful)
  // Scrolled out of view: no bar pinned to the canvas's edge (UAT round 1 IMG-13), unless a popover of it is open.
  if (!open && !inView(ctrl.canvasAdapter, b)) return null
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
  // A sketch area counts on its own: its strokes are the sketch, and words are optional (Fin asks).
  const usable = preview.inputs.length + preview.drawings + preview.notes.length + (preview.sketch ? 1 : 0) > 0
  const single = meaningful.length === 1 ? imageOf(meaningful[0]) : undefined
  const singleImage = single?.asset ? single : undefined
  const named = singleImage ? ctrl.nameOn(singleImage.id, doc) : undefined
  // Resize… (features/resize-selection.clan): pictures, results and scamps (a Drawing, a sketch area).
  const resizable = resizableIn(meaningful)
  const scampAlone = meaningful.length === 1 && resizable.items.length === 1 && !singleImage ? meaningful[0] : undefined

  if (open === 'generate') {
    return <GeneratePopover ctrl={ctrl} ids={ids} at={at} onClose={() => setOpen(null)} onPlace={onPlace} />
  }
  if (open === 'resize' && resizable.count) {
    return <ResizeFor ctrl={ctrl} items={resizable.items} strokes={resizable.strokes} total={resizable.total} at={at} onClose={() => setOpen(null)} onSent={onResized} />
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
            <PaidButton className="btn sm dark" label="Make the other views" busy={busy === 'views'} disabled={!!busy}
              what={viewsWhat(named.key, OTHER_VIEWS)} yes={`Make ${OTHER_VIEWS.length}`}
              onYes={() => run('views', () => ctrl.makeViews(named.key, undefined, choiceToSend('view', config, viewChoice)))} />
          </>
        )}
        {named && <button className="btn xs ghost" onClick={() => ctrl.unname(singleImage.id)}>Remove name</button>}
      </span>,
    )
    // Edit: the picture in the Image editor; Apply puts the new version in its place (not a drawing's).
    if (editablePicture(meaningful[0])) {
      groups.push(<button key="edit" className="btn sm" title="Open in the Image editor (or double-click the picture)" onClick={() => onEdit(singleImage.id)}>Edit</button>)
    }
  }
  if ((singleImage || scampAlone) && onSizes) groups.push(<button key="sizes" className="btn sm" title="Every still format of a campaign from this picture" onClick={() => onSizes(meaningful[0])}>Make all sizes…</button>)
  if (resizable.count) groups.push(<button key="resize" className="btn sm" title="Make these pictures at other shapes, each beside its original" onClick={() => setOpen('resize')}>Resize…</button>)
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
  if (gather && onGather) {
    groups.push(<button key="gather" className="btn sm" title={gather.existing ? `Put ${gather.ids.length === 1 ? 'it' : 'them'} on the ${gather.title} board` : `Make a ${gather.title} board round these and put them in it`}
      onClick={() => void onGather(gather)}>{gather.existing ? `Move to ${gather.title}` : `Gather into a ${gather.title} board`}</button>)
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

/** Resize… on these pictures (features/resize-selection.clan): the panel, and Send placing every result. */
function ResizeFor({ ctrl, items, strokes, total, at, onClose, onSent }: { ctrl: CanvasController; items: El[]; strokes: El[]; total: number; at: Anchor; onClose: () => void; onSent?: (jobs: string[]) => void }) {
  const services = useServices()
  return (
    <ResizePanel anchor={at} total={total} load={() => ctrl.resizeSources(items.map((e) => e.id), strokes.map((e) => e.id))} onClose={onClose}
      send={async (planned) => {
        const jobs = await resizePictures({
          canvas: ctrl.canvasAdapter, runner: services.runner, doc: () => services.doc.get(),
          ref: (sha) => assetRef(services.relay, sha, services.doc.get()),
          named: (r) => namedInput(services.relay, services.doc.get(), r),
          wrap: (s) => ctrl.wrapForResize(s),
        }, planned)
        ctrl.reveal([...jobs, ...items.map((e) => e.id)])
        onSent?.(jobs)
      }} />
  )
}

/** Whether any of a scene box is in the canvas's view. */
function inView(canvas: Pick<Canvas, 'visibleBounds'>, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  const v = canvas.visibleBounds()
  return b.maxX >= v.minX && b.minX <= v.maxX && b.maxY >= v.minY && b.minY <= v.maxY
}

/** A toolbar or popover over the canvas, kept fully inside it (flips below the selection at the top). */
function Floating({ className, anchor, children }: { className: string; anchor: Anchor; children: React.ReactNode }) {
  const { ref, style } = useFloating<HTMLDivElement>(anchor)
  return <div ref={ref} className={className} style={style} onPointerDown={(e) => e.stopPropagation()}>{children}</div>
}

/** The ten main role pills of the Name dialog (the rest under More…), as the contract's role table sorts them. */
const MAIN_ROLES = REF_ROLES.filter((r) => REF_ROLE_TABLE[r].picker === 'main')
const roleWord = (r: RefRole) => (r === 'brand_rule' ? 'brand rule' : r)
/** The role's one line in the Name dialog; a palette's says its colours can be changed (UAT round 2: one line, not two). */
const roleLine = (r: RefRole) => `${REF_ROLE_TABLE[r].ui_line}${r === 'palette' ? '. Click a colour to change it.' : ''}`

const KIND_WORD = { pic: 'picture', drawn: 'drawing', gen: 'result' } as const
/** A brand row's kind, as the Generate tray says it. */
const BRAND_WORD: Record<BrandRow['kind'], string> = { brand_rule: 'brand rule', palette: 'palette', typography: 'typography' }

function GeneratePopover({ ctrl, ids, at, onClose, onPlace }: {
  ctrl: CanvasController
  ids: string[]
  at: Anchor
  onClose: () => void
  onPlace: (job: PlaceJob) => void
}) {
  const doc = useDoc()
  const { controls, config } = useConfig()
  // The model for this Generate: the last that worked for pictures, or the one picked here.
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const choice = pick ?? lastWorkedModel(doc, 'generate', config)
  const modelChoice = choiceToSend('generate', config, choice)
  // The picked model's picture budget (refBudget): counted here, before anything is uploaded.
  const limits = refLimits('generate', choice, config)
  const preview = ctrl.preview(ids, choice?.model ?? modelChoicesFor('generate', config)[0]?.model)
  /** Fin's ask on a sketch with no words, shown here; nothing is sent until it is answered. */
  const [asked, setAsked] = useState<Ask | null>(null)
  const [text, setText] = useState('')
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState(false)
  const [off, setOff] = useState<Set<string>>(() => new Set())
  /** Unnamed pictures the person marked as a person: they go as characters (Runway subject human). */
  const [people, setPeople] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The person's ticks on the brand (UAT round 3 R3-2, UX 1): refs left out or put in, and a strict palette. */
  const [brandLeave, setBrandLeave] = useState<Set<string>>(() => new Set())
  const [brandAdd, setBrandAdd] = useState<Set<string>>(() => new Set())
  const [strict, setStrict] = useState(false)
  const brandChoice: BrandChoice = { leave: [...brandLeave], add: [...brandAdd], strict }
  // When sending takes a while, what is happening (UAT round 2 R2-3, UX 3).
  const slow = useSlow(busy, 3000)
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
  const submit = () => go(() => ctrl.generate(sent(ids), text, { more, limits, modelChoice, people: [...people], brand: brandChoice }))
  const answered = async (answer: AnswerChoice) => {
    setAsked(null)
    if ('optionId' in answer && answer.optionId === LAYOUT_ONLY) await go(() => ctrl.generate(ids, text, { more, limits, modelChoice, people: [...people], layoutOnly: true, brand: brandChoice }))
    else if ('text' in answer) await go(() => ctrl.generate(ids, answer.text, { more, limits, modelChoice, people: [...people], brand: brandChoice }))
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
  // The brand this Generate reads, each with its tick (UAT round 3 R3-2, UX 1): rules by default, the palette (as
  // accents) and the type only for brand work; the person can leave one out or put one in.
  const brand = ctrl.brandFor(ids, text, brandChoice)
  const brandTick = (b: BrandRow) => {
    const flip = (set: Set<string>, on: boolean) => { const n = new Set(set); if (on) n.add(b.ref); else n.delete(b.ref); return n }
    if (b.on) { setBrandAdd((a) => flip(a, false)); setBrandLeave((l) => flip(l, b.byDefault)) } else { setBrandLeave((l) => flip(l, false)); setBrandAdd((a) => flip(a, !b.byDefault)) }
  }
  const brandOn = brand.filter((b) => b.on).length
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
    brandOn ? `brand (${brand.filter((b) => b.on).map((b) => BRAND_WORD[b.kind]).join(', ')})` : null,
    text.trim() ? 'your words' : null].filter(Boolean).join(', ') || 'Your words only'
  // Every picture that goes, as a person or a thing, against the model's limits (UAT round 1 IMG-6/7/8): the tray
  // says it before Generate, and refuses with what to untick, so nothing is uploaded only to be refused.
  const kindOfInput = (i: (typeof preview.inputs)[number]): RefKind => (i.name ? kindOfRole(i.role) : people.has(i.nodeId) ? 'person' : 'thing')
  const going = new Set([...preview.inputs.filter((i) => i.name).map((i) => i.name!), ...linked.filter((r) => !off.has(r.key)).map((r) => r.label.split(' · ')[0].replace(/^@/, ''))])
  const fromWords = mentions(doc, text).found.filter((r) => !going.has(nameOf(r)) && !going.has(r.key))
  const kinds: RefKind[] = [
    ...(preview.sketch ? ['thing' as const] : []), ...(preview.drawings ? ['thing' as const] : []),
    ...preview.inputs.filter((i) => !off.has(i.nodeId)).map(kindOfInput),
    ...linked.filter((r) => r.elIds.length && !off.has(r.key)).flatMap((r) => r.elIds.map(() => kindOfRole(r.item.role))),
    ...fromWords.map((r) => kindOfRole(r.role)),
  ]
  const counted = countRefs(kinds, limits)
  const kindTag = (i: (typeof preview.inputs)[number]) => {
    const k = kindOfInput(i)
    if (i.name) return <span className={`tray-kind ${k}`} title={k === 'person' ? 'Named as a character: sent as a person' : 'Sent as a thing (an object)'}>{k}</span>
    return (
      <button type="button" className={`tray-kind ${k} switch`} aria-pressed={k === 'person'}
        title={k === 'person' ? 'Sent as a person (a character). Click to send it as a thing.' : 'Sent as a thing (an object). Click if it shows a person to keep.'}
        onClick={() => setPeople((p) => { const n = new Set(p); if (n.has(i.nodeId)) n.delete(i.nodeId); else n.add(i.nodeId); return n })}>{k} ⇄</button>
    )
  }
  const blocked = !!counted.problem
  // "<model> on Runway" (ui-behaviour 3.7), the pick or the first routed model.
  const shown = choice ?? modelChoicesFor('generate', config)[0]
  const model = shown ? modelWhere(shown.provider, shown.model) : undefined
  const tick = (id: string, label: React.ReactNode, on: boolean, change?: () => void, extra?: React.ReactNode) => (
    <div key={id} className="tray-rowline">
      <label className="tray-row">
        <input type="checkbox" checked={on} disabled={!change} onChange={change} />
        <span>{label}</span>
      </label>
      {extra}
    </div>
  )
  return (
    <Floating className="popover send-tray" anchor={at}>
      <div className="tray-head">
        <button type="button" className="tray-fold" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d={open ? 'M3 7.5 L6 4.5 L9 7.5' : 'M3 4.5 L6 7.5 L9 4.5'} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <AgentFigure agent="dex" size={22} decorative />
        <div className="tray-title"><b>What the Director agent will send</b><span>{sayer('dex')}</span></div>
      </div>
      {!open && !blocked && <button type="button" className="tray-line" onClick={() => setOpen(true)}>{summary}</button>}
      {limits.max > 0 && kinds.length > 0 && <div className={`tray-count pt-mono ${blocked ? 'over' : ''}`} role="status">{countLine(counted, limits)}</div>}
      {(open || blocked) && (
        <div className="tray-rows" role="group" aria-label="Inputs to send">
          {preview.sketch && tick('sketch', <><b>Sketch</b> <span className="faint">· {preview.sketch.label} layout</span></>, true)}
          {preview.drawings > 0 && tick('drawing', <><b>Drawing</b> <span className="faint">· as drawn</span></>, true)}
          {preview.inputs.map((i) => tick(i.nodeId, i.name
            ? <><span className="pt-ref">@{i.name}</span> <span className="faint">· {KIND_WORD[i.kind]}</span></>
            : <><b>{KIND_WORD[i.kind][0].toUpperCase() + KIND_WORD[i.kind].slice(1)}</b> <span className="faint">· not named</span></>,
          !off.has(i.nodeId), () => setOff((o) => { const n = new Set(o); if (n.has(i.nodeId)) n.delete(i.nodeId); else n.add(i.nodeId); return n }), kindTag(i)))}
          {preview.notes.map((n, k) => tick(`note${k}`, <><b>Note</b> <span className="faint">· instruction:</span> {n.length > 60 ? `${n.slice(0, 59)}…` : n}</>, true))}
          {linked.map((r) => tick(r.key, <>{r.item.kind === 'ref' || r.item.kind === 'key' ? <span className="pt-ref">{r.label.split(' · ')[0]}</span> : <b>{r.label.split(' · ')[0]}</b>} <span className="faint">· {r.label.split(' · ').slice(1).join(' · ')}{r.off ? ` · ${r.off}` : r.goes ? ` · ${r.goes}` : ''}</span></>,
            r.elIds.length > 0 ? !off.has(r.key) : !!r.goes, r.elIds.length ? () => setOff((o) => { const n = new Set(o); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n }) : undefined,
            r.elIds.length > 0 ? <span className={`tray-kind ${kindOfRole(r.item.role)}`}>{kindOfRole(r.item.role)}</span> : undefined))}
          {brand.map((b) => tick(`brand:${b.ref}`, <><b>{BRAND_WORD[b.kind][0].toUpperCase() + BRAND_WORD[b.kind].slice(1)}</b> <span className="faint">· {b.label}{b.kind === 'palette' && b.on ? ` · ${strict ? 'only these colours' : 'as accents'}` : ''}{!b.on && !b.byDefault ? ' · only for brand work: tick to send' : ''}</span></>,
            b.on, () => brandTick(b),
            b.kind === 'palette' && b.on ? <button type="button" className={`btn xs ${strict ? 'on' : ''}`} aria-pressed={strict} title={strict ? 'Only these colours: click to use them as accents' : 'Used as accents: click to make them the only colours'} onClick={() => setStrict((x) => !x)}>{strict ? 'Strict' : 'Accents'}</button> : undefined))}
          {fromWords.map((r) => tick(`said:${r.id}`, <><span className="pt-ref">@{nameOf(r)}</span> <span className="faint">· from your words</span></>, true, undefined,
            <span className={`tray-kind ${kindOfRole(r.role)}`}>{kindOfRole(r.role)}</span>))}
        </div>
      )}
      {counted.problem && <div role="alert" className="tray-error">{counted.problem}</div>}
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !blocked) void submit()
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
      {slow && <div role="status" className="faint tray-slow">{sendingLine(counted.total)}</div>}
      <div className="tray-foot">
        <ModelPick op="generate" value={choice} onChange={setPick} />
        {controls.moreOptions && <button className={`btn xs ${more ? 'on' : ''}`} title="Ask for 4 options instead of 1" onClick={() => setMore(!more)}>4 options</button>}
        <span className="spacer" />
        <button className="btn xs ghost" disabled={busy || !oneArea || blocked} title="Click on the canvas where it should land" onClick={() => { onClose(); onPlace({ ids: sent(ids), text, more, modelChoice, limits, people: [...people] }) }}>Place…</button>
      </div>
      <div className="tray-foot nowrap" title="Nothing is sent until you press Generate.">
        <span className="pt-mono tray-model">{model ?? 'The default model'}{preview.sketch ? <><br />{preview.sketch.label}</> : null}</span>
        <button className="btn sm" onClick={onClose}>Cancel</button>
        <button className="btn sm primary" disabled={busy || !oneArea || blocked} title={counted.problem} onClick={() => void submit()}>{busy ? 'Sending…' : 'Generate'}</button>
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
  const [brand, setBrand] = useState<BrandPayload>({ swatches: current?.swatches, font: current?.font, rule: current?.rule })
  const ck = cleanKey(key)
  const cv = cleanVariant(variant)
  const isNewKey = !!ck && !keyNamed(doc, ck)
  // The role the ref will hold: the one picked for a new key, else its key's (UAT round 2 R2-1: a brand role needs its payload).
  const holds = (isNewKey ? role : (keyNamed(doc, ck)?.role as RefRole | undefined)) ?? role
  const brandRole = isBrandRole(holds) ? holds : undefined
  const needs = brandRole ? payloadMissing(brandRole, brand) : undefined
  const asset = imageOf(ctrl.nodeEl(nodeId))?.asset ?? undefined
  const taken = ck && cv ? refByName(doc, `${ck}_${cv}`) : undefined
  const movesName = taken && taken.node !== nodeId
  const problem = ck || cv ? nameProblem(ck, cv) : null
  const save = () => {
    try {
      ctrl.name(nodeId, ck, cv, role, brandRole ? payloadFor(brandRole, brand) : undefined)
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
          <div className="faint roleline">{roleLine(role)}</div>
        </div>
      )}
      {/* A brand key named before: its role's line once, above its fields (the pills above say it for a new key). */}
      {brandRole && !isNewKey && <div className="faint roleline">{roleLine(brandRole)}</div>}
      {brandRole && <BrandFields role={brandRole} asset={asset} value={brand} onChange={setBrand} />}
      {ck && cv && <div className="mono" style={{ marginTop: 8 }}>@{ck}_{cv}</div>}
      {movesName && <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Another image is @{ck}_{cv}. Saving moves the name here, and what was made from the other one is marked out of date.</div>}
      {(problem || error) && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>{problem ?? error}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onClose}>Cancel</button>
        <button className="btn sm primary" disabled={!ck || !cv || !!problem || !!needs} title={needs} onClick={save}>{movesName ? 'Move the name here' : 'Save'}</button>
      </div>
    </Floating>
  )
}


