// The Image editor (ui-behaviour 3.12; mock ImageEditor; features/image-editor.clan): one frame full
// screen over the storyboard, or one picture over the canvas (features/edit-canvas-pictures.clan; what
// differs between the two is in imageEditor/subject.ts). Six tools (Select V, Brush mask B, Lasso L,
// Text T, Crop C, Hand H or Space), the brush strip, a numbered list of edits that changes nothing
// until Apply as new version, layers, and Rhea's actions: Fill area with its Fill and Remove, Change
// whole frame (Gemini 3 Pro on Runway: a words-only model, as nothing is marked) and Upscale (Magnific on Runway). No price anywhere; each job's
// cost is in History. Remove background is gone (owner, 2026-10-16: "I don't know why you still have the
// remove the background going on").
//
// Apply saves exactly what the stage shows, or says why it cannot (fix/editor-apply-keeps-edits): a fill
// is cut by its mask as it was sent, never by what that mask became after.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import type { Frame, Mime } from '../contracts/types'
import { modelChoicesFor, modelWhere } from '../capabilities'
import { assetRef } from '../jobs/assets'
import { selectFrame } from '../jobs/frames'
import type { EditTarget } from '../model/purpose'
import { askOf, isActive } from '../jobs/runner'
import { shotNumber } from '../model/selectors'
import { SHEETS } from '../contracts/load'
import { changeFrame, frameEditCopy } from '../jobs/frameEdit'
import { placeAsk } from '../ui/askPlaces'
import type { JobShot, Shot } from '../contracts/types'
import { getBlob, idbLocation, putBlob } from '../lib/blobs'
import { deleteFrom, removeFrame } from '../doc/remove'
import { systemUpdate } from '../doc/store'
import { errorShown } from '../dogfood/recorder'
import { useBlobUrl } from '../ui/hooks'
import { JobSlot } from '../ui/JobSlot'
import { DownloadButton } from '../ui/Download'
import { useProjectName } from '../ui/useDownload'
import { mediaItem } from '../media/names'
import { EditorBar } from '../ui/chrome/TopBars'
import { newId } from '../lib/ulid'
import { sendWithRow, type UnsentEdit } from './imageEditor/edits'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { Float } from '../ui/Float'
import { Booth } from '../ui/booth/Booth'
import { useBooth } from '../ui/booth/useBooth'
import { croppedCaption } from '../canvas/core/sketch'
import { PromptStart } from '../ui/prompt/PromptStart'
import {
  EMPTY, NOTHING_TO_TAKE, addEdit, afterSend, applyLine, clearMask, editCount, editId, hasFill, newMask, pendingCount, unfilledMasks, editLabel, editsForFrame, hiddenCount,
  layersOf, leaveAsk, leftOutLine, nextStep,
  notApplied, nothingToTake, redoUndone, toggleHidden, undoEdit, undoLast, updateEdit, upscaleSize, withMaskOp,
  type Edit, type EditSession, type MaskOp, type Pt, type Undone,
} from './imageEditor/edits'
import { bounds, rasterize } from './imageEditor/mask'
import { applyProblem, compose, maskToPng, sendPlan, toPng, untouched, type Pic } from './imageEditor/compose'
import { applyEditedStep, applyPictureEditedStep, pickPictureVersionStep } from './imageEditor/apply'
import { subjectOf, type PictureNow } from './imageEditor/subject'
import { BRUSH_MAX, BRUSH_MIN, MASK_TOOLS, TOOLS, brushStep, toolForKey, zoomStep, type ToolId } from './imageEditor/tools'
import { Stage, type Brush } from './imageEditor/Stage'
import { EditTray } from './imageEditor/EditTray'
import { Eye, Lock, ToolIcon } from './imageEditor/icons'
import './image-editor.css'

const UNDO_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘Z' : 'Ctrl+Z'
const capital = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

type Action = 'fill' | 'remove' | 'whole' | 'upscale'
const SENDING: Record<Action, string> = { fill: 'sending the fill', remove: 'sending the removal', whole: 'sending the change', upscale: 'sending the upscale' }
const TRAY_TITLE: Record<Action, string> = {
  fill: 'What the Retouch agent will send to fill the area', remove: 'What the Retouch agent will send to remove what is in the area',
  whole: 'What the Retouch agent will send to change the frame', upscale: 'What the Retouch agent will send to upscale',
}
const TRAY_SEND: Record<Action, string> = { fill: 'Fill', remove: 'Remove', whole: 'Change', upscale: 'Upscale' }
type MaskEdit = Extract<Edit, { kind: 'mask' }>

export function ImageEditor({ target, picture, onBack, onTarget, checkId }: {
  /** A shot's frame, or a picture on the canvas. */
  target: EditTarget
  /** A canvas picture as the canvas shows it now (its picture before the first edit has no version). */
  picture?: PictureNow
  onBack: () => void
  /** ← → between a storyboard's shots. */
  onTarget?: (t: EditTarget) => void
  /** Arriving from Jude's brand flag ("Fix in image editor", 3.18): its rule shows at the top of Edits. */
  checkId?: string
}) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const { config, controls } = useConfig()
  const subject = subjectOf(doc, target, picture)
  const frames = subject?.versions ?? []
  const current: Frame | undefined = subject?.current
  const sha = subject?.sha
  const version = subject?.version ?? 0
  const url = useBlobUrl(sha)
  // The version before this one (its parent, else the one numbered before it): what Before shows once
  // the edits are applied (owner, 2026-10-16: "I click on show before, the new pic never comes back").
  const prevVersion = current ? frames.find((f) => f.id === current.parent_id) ?? frames.filter((f) => f.version < version).at(-1) : undefined
  const prevUrl = useBlobUrl(prevVersion?.asset)
  const asset = sha ? doc.assets[sha] : undefined
  const ratio = subject?.ratio
  const aspect = subject?.aspect ?? 16 / 9
  // The picture's own size: the asset's, else the picture's once it loads (an older asset without w, h).
  const [natural, setNatural] = useState<{ sha: string; w: number; h: number } | null>(null)
  const own = asset?.w && asset?.h ? { w: asset.w, h: asset.h } : natural?.sha === sha ? natural : undefined
  const W = own?.w ?? 1344
  const H = own?.h ?? Math.round(W / aspect)
  const framePic: Pic | undefined = sha ? { sha, w: W, h: H } : undefined
  // The edits not applied yet, kept per version (a picture before its first edit: per node).
  const frameId = subject?.sessionKey
  const session: EditSession = (frameId && ui.imageEdits?.[frameId]) || EMPTY
  const setSession = (fn: (s: EditSession) => EditSession) => {
    if (!frameId) return
    uiStore.update((u) => {
      const next = fn(u.imageEdits?.[frameId] ?? EMPTY)
      u.imageEdits = { ...(u.imageEdits ?? {}), [frameId]: next }
    }, 'image edits')
  }

  const [tool, setTool] = useState<ToolId>('brush')
  const [space, setSpace] = useState(false)
  const [brush, setBrush] = useState<Brush>({ size: 48, soft: 20, mode: 'add' })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 })
  const [view, setView] = useState<'after' | 'before'>('after')
  // What to do with the blue (mock image): one action shown at a time in the Booth.
  const [act, setAct] = useState<'fill' | 'remove' | 'whole' | 'upscale'>('fill')
  const booth = useBooth('storyboard')
  /** A layer picked in Layers that is not a mask (Frame, a result, text): shown picked, with why
   *  it cannot be painted; the next stroke starts a new mask. A mask's pick is the session's active mask. */
  const [picked, setPicked] = useState<string | null>(null)
  const [fill, setFill] = useState('')
  const [keepOutside, setKeepOutside] = useState(true)
  const [whole, setWhole] = useState('')
  const [scale, setScale] = useState<2 | 4>(2)
  const [tray, setTray] = useState<Action | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Why the picture could not be drawn (the stage keeps the last good one), for Rhea's line. */
  const [drawError, setDrawError] = useState<string | null>(null)
  /** What the line under the stage says about the last press ("Nothing to take away yet…"), while the frame, tool and mode stay. */
  const [hintAt, setHintAt] = useState<{ text: string; at: string } | null>(null)
  /** Steps ⌘Z took back on this frame, for ⇧⌘Z (editor-local: the document's undo is not touched). */
  const [redoAt, setRedoAt] = useState<{ frame?: string; steps: Undone[] }>({ steps: [] })
  const versionsBtn = useRef<HTMLButtonElement>(null)
  const fillBtn = useRef<HTMLButtonElement>(null)
  const removeBtn = useRef<HTMLButtonElement>(null)
  const wholeBtn = useRef<HTMLButtonElement>(null)
  const upBtn = useRef<HTMLButtonElement>(null)
  const project = useProjectName()
  const motion = ui.motion !== 'still'
  // Jude's brand flag (3.12, 3.18): the one "Fix in image editor" came from, else an open flag on this frame.
  const check = checkId ? doc.checks[checkId]
    : Object.values(doc.checks).find((c) => c.target.kind === 'frame' && c.target.id === current?.id && c.result === 'flag' && !c.ignored)
  const shotId = target.kind === 'shot' ? target.shotId : undefined
  useEffect(() => { if (error) errorShown('frame', error, shotId ? { shot: shotId } : {}) }, [error, shotId])

  // Results: a job's first output, once it is done.
  const jobState = (id?: string) => (id ? runner.liveInfo(id)?.state ?? doc.jobs[id]?.state : undefined)
  const resultOf = useCallback((e: Edit): Pic | undefined => {
    const id = 'jobId' in e ? e.jobId : undefined
    const j = id ? doc.jobs[id] : undefined
    // A result that came back the same as the picture sent is no result (relay sameness.py): it is never applied.
    const sha = j?.state === 'completed' && !ui.jobs[id!]?.unchanged ? j.outputs?.[0] : undefined
    if (!sha) return undefined
    const a = doc.assets[sha]
    return { sha, w: a?.w ?? W, h: a?.h ?? H }
  }, [doc, ui.jobs, W, H])
  // Ready only once its picture is in the document: the runner can say completed a moment before the
  // document has the output, and Apply composes from the document.
  const stateOf = (e: Edit): 'running' | 'ready' | 'failed' | 'same' | undefined => {
    const id = 'jobId' in e ? e.jobId : undefined
    if (!id) return undefined
    if (resultOf(e)) return 'ready'
    if (runner.isUnstarted(id)) return 'failed'
    if (doc.jobs[id]?.state === 'completed' && ui.jobs[id]?.unchanged) return 'same'
    const s = jobState(id)
    return s === 'failed' || s === 'cancelled' || s === 'uncertain' ? 'failed' : 'running'
  }
  // A row whose job this document never recorded: the page reloaded while it was being sent (Playwright live test
  // 2026-11-18: job_01M7PP7RMYB329R8NHSNHEG7DM was completed and paid at the relay, the row said working for
  // good and held Apply). The relay is asked once (runner.adopt): a job it has is written in and lands like any
  // other; one it never got reads as did not work, with Try again.
  const asked = useRef(new Set<string>())
  const parentKey = (subject?.parents ?? []).join(' ')
  useEffect(() => {
    const parentIds = parentKey ? parentKey.split(' ') : []
    for (const e of session.edits) {
      const id = 'jobId' in e ? e.jobId : undefined
      if (!id || doc.jobs[id] || runner.liveInfo(id) || asked.current.has(id)) continue
      asked.current.add(id)
      void runner.adopt(id, parentIds).then((r) => { if (r === 'unknown') asked.current.delete(id) })
    }
  }, [session.edits, doc.jobs, runner, parentKey])
  // Running is what the list calls working: an 'uncertain' job reads as did not work, so it no longer holds
  // the actions (features/image-editor-masks-layers.clan); its row still offers Stop waiting and Try again.
  const runningEdit = session.edits.find((e) => 'jobId' in e && e.jobId && stateOf(e) === 'running')
  const running = !!runningEdit || !!busy

  // Pictures, loaded once each.
  const pics = useRef(new Map<string, Promise<ImageBitmap>>())
  const image = useCallback((sha: string): Promise<ImageBitmap> => {
    let p = pics.current.get(sha)
    if (!p) {
      p = getBlob(sha).then((b) => {
        if (!b) throw new Error('That picture is not in this browser yet.')
        return createImageBitmap(b)
      })
      p.catch(() => pics.current.delete(sha))
      pics.current.set(sha, p)
    }
    return p
  }, [])
  useEffect(() => {
    if (!sha || (asset?.w && asset?.h)) return
    let alive = true
    void image(sha).then((b) => { if (alive) setNatural({ sha, w: b.width, h: b.height }) }).catch(() => undefined)
    return () => { alive = false }
  }, [sha, asset?.w, asset?.h, image])
  // An edit that came back the same changes nothing, so it is not counted (Playwright live test 2026-11-18: Apply
  // said "saves your 2 edits" with one of them the same).
  const n = editCount(session) - session.edits.filter((e) => !session.hidden.includes(e.id) && stateOf(e) === 'same').length
  // Work here at all (the edits, and a mask painted and not filled): what Before compares and Apply looks at.
  const work = n + unfilledMasks(session)
  // Before / After: with edits not applied, Before is this version as saved and After has the edits;
  // with none, Before is the version before this one and After is this one. Nothing to compare: off.
  const before = work ? { url, version } : prevVersion ? { url: prevUrl, version: prevVersion.version } : undefined
  const showBefore = view === 'before' && !!before
  // Hidden layers are left out of every send and of Apply, and the pill, the Apply line and the tray say so (IM1).
  const applyLeftOut = hiddenCount(session, ['mask'])
  const activeMask = session.edits.find((e): e is MaskEdit => e.id === session.active && e.kind === 'mask')
  const maskHidden = !!activeMask && session.hidden.includes(activeMask.id)
  // A hidden mask cannot be filled: it is left out like any hidden layer, so there would be nothing to fill.
  const masked = !!activeMask && activeMask.ops.length > 0 && !maskHidden
  const sent = framePic ? sendPlan(session, framePic, resultOf, 'action') : undefined
  const shownPlan = sent?.plan
  // The model each action runs on for this agency: Ideogram 4.5 and Magnific when it has them on, else
  // region edits run on Gemini 3 Pro and Upscale cannot run (subprocessors.json: off unless it asks).
  const regionChoice = modelChoicesFor('region_edit', config)[0]
  const upChoice = modelChoicesFor('upscale', config)[0]
  const regionModel = regionChoice ? modelWhere(regionChoice.provider, regionChoice.model) : undefined
  // Change whole frame marks nothing, so it runs on a model that edits from words alone, as the relay picks
  // (service.whole_picture_models): Ideogram 4.5 with no mask gave the frame back unchanged (2026-11-17).
  const wholeChoice = modelChoicesFor('region_edit', config).find((c) => wordsOnly(c.provider, c.model)) ?? regionChoice
  const wholeModel = wholeChoice ? modelWhere(wholeChoice.provider, wholeChoice.model) : undefined
  const upModel = upChoice ? modelWhere(upChoice.provider, upChoice.model) : undefined

  // Keys: the tools, [ ] for the brush, Space held for the Hand, ⌘Z and ⇧⌘Z for strokes.
  const keys = useRef({ undo: () => {}, redo: () => {} })
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      if (e.key === ' ') {
        setSpace(true)
        e.preventDefault()
        return
      }
      if (e.key === '[' || e.key === ']') {
        const k = e.key
        setBrush((b) => ({ ...b, size: brushStep(b.size, k) }))
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        setBrush((b) => ({ ...b, mode: b.mode === 'add' ? 'sub' : 'add' })) // X swaps Add and Subtract
        return
      }
      const t = toolForKey(e)
      if (t) {
        setTool(t)
        setView('after') // a tool is for the edits: Before stays only while looked at
      }
    }
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setSpace(false) }
    // ⌘Z / Ctrl+Z takes back the last stroke here, ⇧⌘Z or Ctrl+Y puts it back. Caught before the
    // document's UndoKeys (capture phase), which would undo a document step instead.
    const undoKeys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return
      const k = e.key.toLowerCase()
      if (k !== 'z' && k !== 'y') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (k === 'y' || e.shiftKey) keys.current.redo()
      else keys.current.undo()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keydown', undoKeys, true)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keydown', undoKeys, true)
      window.removeEventListener('keyup', up)
    }
  }, [])
  const activeTool: ToolId = space ? 'hand' : tool
  const hintKey = `${frameId}|${tool}|${brush.mode}`
  const hint = hintAt?.at === hintKey ? hintAt.text : null
  const redoStack = redoAt.frame === frameId ? redoAt.steps : []
  useEffect(() => {
    keys.current = {
      undo: () => {
        let undone: Undone | undefined
        setSession((s) => {
          const r = undoLast(s)
          undone = r.undone
          return r.session
        })
        if (undone) {
          const u = undone
          setRedoAt((st) => ({ frame: frameId, steps: [...(st.frame === frameId ? st.steps : []), u] }))
        }
      },
      redo: () => {
        const u = redoStack.at(-1)
        if (!u) return
        setRedoAt({ frame: frameId, steps: redoStack.slice(0, -1) })
        setSession((s) => redoUndone(s, u))
      },
    }
  })

  if (!subject) return null

  // Change whole frame on a shot's frame, when the words swap who is in it (features/frame-edit-or-redraw.clan):
  // Dex offers Redraw frame N under the field, before anything is paid. Its row in Edits says so.
  const shotNo = shotId ? shotsOfFrame(doc, shotId) : 0
  const offerEdit = session.edits.find((e) => e.kind === 'whole' && 'jobId' in e && !!e.jobId && askOf(doc, e.jobId)?.state === 'open' && askOf(doc, e.jobId)?.question.kind === 'recast')
  const offerJob = offerEdit && 'jobId' in offerEdit ? offerEdit.jobId : undefined
  const offer = offerJob ? askOf(doc, offerJob) : undefined

  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    setError(null)
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }
  const registerAsset = (sha: string, blob: Blob, w: number, h: number) => systemUpdate(docStore, (d) => {
    if (!d.assets[sha]) d.assets[sha] = { sha256: sha, kind: 'image', mime: (blob.type || 'image/png') as Mime, bytes: blob.size, w, h, origin: 'edited', locations: [idbLocation(sha)] }
  }, 'image editor picture')
  /** The picture an action starts from: the frame, or the edits so far without text, masks or crop. */
  const inputPic = async (): Promise<Pic> => {
    if (!framePic || !shownPlan) throw new Error('Draw this frame first.')
    if (untouched(shownPlan, framePic)) return framePic
    const c = await compose(shownPlan, image)
    const blob = await toPng(c)
    const sha = await putBlob(blob)
    await registerAsset(sha, blob, c.width, c.height)
    return { sha, w: c.width, h: c.height }
  }
  const { purpose, parents } = subject

  // ── the tools ──
  // A fill already sent keeps the mask it was sent with: painting while it runs starts a new mask.
  // A mask whose Fill or Remove was sent stays with it: the next stroke starts a new mask (QA 2026-11-17: a
  // second lasso joined Mask 1, and Fill 2 repainted Fill 1's area). Clear mask still works on it.
  const onMaskOp = (op: MaskOp) => {
    const target = (s: EditSession) => (s.active && hasFill(s, s.active) ? afterSend(s) : s)
    if (nothingToTake(target(session), op)) {
      setHintAt({ text: NOTHING_TO_TAKE, at: hintKey })
      return
    }
    setHintAt(null)
    setRedoAt({ steps: [] })
    setPicked(null)
    setSession((s) => withMaskOp(target(s), op))
  }

  const onAddText = (p: Pt) => setSession((s) => addEdit(s, { id: editId(), kind: 'text', text: '', x: p.x, y: p.y, size: 0.06 }))
  const onText = (id: string, patch: { text?: string; x?: number; y?: number }) => {
    if (patch.text !== undefined && !patch.text.trim()) setSession((s) => undoEdit(s, id))
    else setSession((s) => updateEdit(s, id, patch))
  }
  const onCrop = (r: { x: number; y: number; w: number; h: number }) => setSession((s) => {
    const old = s.edits.find((e) => e.kind === 'crop')
    return old ? updateEdit(s, old.id, r) : addEdit(s, { id: editId(), kind: 'crop', ...r })
  })

  // ── the actions ──
  // The edit's row goes into the session with its job id BEFORE the relay is asked, so a paid result is never
  // lost when the tab closes while it is being sent (QA 2026-11-17: job_01M7N5PEGD8Z433F60SE1C1HCW was paid
  // and only ever in History). If the send fails, the row goes again.
  // The edit's row goes into the session with its job id before the relay is asked (edits.ts sendWithRow).
  const withRow = (row: UnsentEdit, submit: (jobId: string) => Promise<string>) => sendWithRow(setSession, row, submit, newId('job'))
  const send = (a: Action) => void attempt(SENDING[a], async () => {
    setTray(null)
    const input = await inputPic()
    const picture = await assetRef(relay, input.sha, doc)
    const shape = { w: input.w, h: input.h }
    if (a === 'fill' || a === 'remove') {
      if (!activeMask || !masked) throw new Error(maskHidden && activeMask ? `${activeMask.name} is hidden. Show it to ${a}.` : 'Paint the area first.')
      const bits = rasterize(activeMask.ops, input.w, input.h)
      const region = bounds(bits, input.w, input.h)
      if (!region) throw new Error('The mask is empty. Paint the area first.')
      const mask = await assetRef(relay, await putBlob(await maskToPng(bits, input.w, input.h)), doc)
      // The fill keeps the mask as sent: what the result is cut by on the stage and in Apply.
      const ops = activeMask.ops
      if (a === 'remove') {
        // No words: the relay writes the removal (relay-api input.remove), and the area is always the only change.
        await withRow({ id: editId(), kind: 'fill', maskId: activeMask.id, ops, words: '', keepOutside: true, remove: true },
          (jobId) => runner.submit('region_edit', { image: picture, mask, region, remove: true, aspect: shape }, parents, purpose, jobId))
      } else {
        const words = fill.trim()
        await withRow({ id: editId(), kind: 'fill', maskId: activeMask.id, ops, words, keepOutside },
          (jobId) => runner.submit('region_edit', { image: picture, mask, region, text: words, aspect: shape }, parents, purpose, jobId))
        setFill('')
      }
    } else if (a === 'whole') {
      const words = whole.trim()
      const frameShot = shotId && doc.shots[shotId] ? plainShot(doc.shots[shotId]) : undefined
      await withRow({ id: editId(), kind: 'whole', words },
        (jobId) => runner.submit('region_edit', { image: picture, text: words, aspect: shape, ...(frameShot ? { shot: frameShot } : {}) }, parents, purpose, jobId))
      setWhole('')
    } else {
      await withRow({ id: editId(), kind: 'upscale', scale },
        (jobId) => runner.submit('upscale', { image: picture, scale, aspect: shape }, parents, purpose, jobId))
    }
  })
  const apply = () => void attempt('applying', async () => {
    if (!framePic || !frameId) return
    // Never a copy silently missing an edit: say why instead (the owner's v2 was v1, unchanged).
    const problem = applyProblem(session, framePic, resultOf)
    if (problem) throw new Error(problem)
    const c = await compose(sendPlan(session, framePic, resultOf, 'apply').plan, image)
    const blob = await toPng(c)
    const out = { sha: await putBlob(blob), bytes: blob.size, w: c.width, h: c.height, edits: editsForFrame(session) }
    // A frame: v(n+1) of the shot. A canvas picture: v(n+1) in place, its name following (one undo step each).
    const made = target.kind === 'shot'
      ? current && await applyEditedStep(docStore, target.shotId, current.id, out)
      : await applyPictureEditedStep(docStore, { nodeId: target.nodeId, sha: framePic.sha, w: W, h: H }, out)
    // The applied edits are in v(n+1) now. Hidden ones were left out of it and go with the rest: nothing
    // rides on to the new version (owner 2026-11-18, replacing IM3's carry-once).
    if (made) uiStore.update((u) => {
      const all = { ...(u.imageEdits ?? {}) }
      delete all[frameId]
      u.imageEdits = all
    }, 'image edits applied')
  })
  const pickVersion = (f: Frame) => {
    setVersionsOpen(false)
    if (target.kind === 'shot') void selectFrame(docStore, target.shotId, f.id)
    else void pickPictureVersionStep(docStore, f.id)
  }
  const go = (id: string) => (pendingCount(session) > 0 ? setLeaving(id) : id === 'back' ? onBack() : onTarget?.({ kind: 'shot', shotId: id }))
  const leave = (to: string, discard: boolean) => {
    setLeaving(null)
    if (discard) uiStore.update((u) => { if (u.imageEdits && frameId) delete u.imageEdits[frameId] }, 'image edits discarded')
    if (to === 'back') onBack()
    else onTarget?.({ kind: 'shot', shotId: to })
  }
  const deleteVersion = () => void attempt('deleting', async () => { if (current) await deleteFrom(docStore, (d) => removeFrame(d, current.id)) })

  const { prev, next } = subject
  const shown = sha ? mediaItem(doc, project, sha, target.kind === 'shot' ? 'frame' : undefined) : undefined
  const maskTool = MASK_TOOLS.includes(activeTool)
  const tip = TOOLS.find((t) => t.id === activeTool)!
  const applyWords = applyLine(n, version, applyLeftOut)
  const trayItems = (a: Action) => [
    { what: subject.label, detail: `v${version}${n ? ', with your edits' : ''}` },
    ...(a === 'fill' && activeMask ? [{ what: activeMask.name, detail: keepOutside ? 'only the blue area changes' : 'the whole result is kept' }] : []),
    ...(a === 'remove' && activeMask ? [{ what: activeMask.name, detail: 'what it covers goes; the background continues over it' }] : []),
    ...(a === 'remove' ? [] : a === 'fill' ? [{ what: `"${fill.trim()}"` }] : a === 'whole' ? [{ what: `"${whole.trim()}"`, detail: 'the composition and size stay' }] : [{ what: `${scale}× larger`, detail: upscaleSize(W, H, scale) }]),
    ...(sent?.leftOut ? [{ what: capital(leftOutLine(sent.leftOut)), detail: 'The Retouch agent sends what you see' }] : []),
  ]
  const step = nextStep(session)

  return (
    <div className="editor image-editor" data-image-editor="">
      <EditorBar back={subject.back} onBack={() => go('back')} icon="frame" title={subject.title}
        meta={<span className="pt-mono ie-meta">{ratio ? `${ratio} locked` : 'Picture'}</span>}
        afterView={(
          <>
            {frames.length > 0 && (
              <button ref={versionsBtn} type="button" className="btn ie-vbtn" aria-haspopup="menu" aria-expanded={versionsOpen} aria-label={`Version ${version} of ${frames.length}`} onClick={() => setVersionsOpen((o) => !o)}>
                <span className="pt-mono">v{version}</span><span className="ie-vof"> of {frames.length}</span> <span aria-hidden="true" className="ie-caret">▼</span>
              </button>
            )}
            {n + applyLeftOut > 0 && (() => {
              const long = [n ? notApplied(n) : '', applyLeftOut ? leftOutLine(applyLeftOut) : ''].filter(Boolean).join(' · ')
              const short = [n ? `${n} ${n === 1 ? 'edit' : 'edits'}` : '', applyLeftOut ? `${applyLeftOut} left out` : ''].filter(Boolean).join(' · ')
              return <span className="pt-mono ie-pill" title={long}><span className="ie-n-long">{long}</span><span className="ie-n-short">{short}</span></span>
            })()}
            {!(n + applyLeftOut) && <span className="pt-mono ie-pill">No edits yet</span>}
            {/* Either half toggles, pressed or not, so a second press on Before goes back (owner, 2026-10-16). */}
            <div className="pt-seg ie-compare" role="group" aria-label="Compare">
              <button type="button" aria-pressed={showBefore} disabled={!before} title={before ? `v${before.version} as saved` : 'Nothing to compare yet'}
                onClick={() => setView(showBefore ? 'after' : 'before')}>Before</button>
              <button type="button" aria-pressed={!showBefore} disabled={!before} title={n ? 'With your edits' : `v${version} as saved`}
                onClick={() => setView(showBefore ? 'after' : 'before')}>After</button>
            </div>
          </>
        )}
        right={(
          <>
            {/* Zoom, on the stage at the bottom right like the canvas's zoom pill (owner, 2026-10-15). */}
            <div className="ie-zoom" role="group" aria-label="Zoom">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => zoomStep(z, -1))}>−</button>
              <span className="pt-mono">{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => zoomStep(z, 1))}>+</button>
              <button type="button" className="ie-fit" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Fit</button>
            </div>
          </>
        )}
        primary={<button type="button" className="btn primary" disabled={running || !work || !framePic} onClick={apply}
          title={n ? applyWords : 'Make an edit first'}>Apply as new version</button>} />
      <Float anchor={versionsBtn} open={versionsOpen} onClose={() => setVersionsOpen(false)} align="end" label={`Versions of ${subject.label}`} className="ie-versions">
        <div className="ie-vhead pt-mono">{ratio ? `${ratio} locked` : 'Picture'}{own ? ` · ${own.w} × ${own.h}` : ''}</div>
        {frames.map((f) => <VersionRow key={f.id} f={f} open={f.id === current?.id} onPick={() => pickVersion(f)} />)}
        <div className="ie-vfoot">
          <span>{n ? applyWords : `Apply saves your edits as v${version + 1}. v${version} stays.`}</span>
          <span className="ie-vacts">
            {shown && <DownloadButton items={[shown]} className="btn sm ghost" title={`Download v${version}`} />}
            {target.kind === 'shot' && <button type="button" className="btn sm ghost" disabled={!current || running} onClick={deleteVersion}>Delete v{version}</button>}
          </span>
        </div>
      </Float>

      <div className="booth-row ie-row">
        <div className="ie-surface">
          <div className="ie-center">
          {framePic && shownPlan ? (
            <div className="ie-stagewrap">
            <Stage src={url} beforeSrc={before?.url} plan={shownPlan} image={image} w={W} h={H} session={session} tool={activeTool} brush={brush} zoom={zoom} pan={pan} onPan={setPan}
              before={showBefore} onAfter={() => setView('after')} motion={motion} onDrawn={setDrawError} onMaskOp={onMaskOp} onAddText={onAddText} onText={onText} onCrop={onCrop}
              pending={runningEdit?.kind === 'fill' ? runningEdit.maskId : undefined} progress={!!runningEdit && runningEdit.kind !== 'fill'}>
              {showBefore && <span className="pt-mono ie-before">Before · v{before.version} as saved</span>}
            </Stage>
            </div>
          ) : (
            <div className="ie-viewport" style={{ aspectRatio: String(aspect), '--ie-ratio': aspect } as React.CSSProperties}>
              {shotId && <div className="pending idle" style={{ position: 'absolute', inset: 0 }}><PromptStart kind="image" nodeId={shotId} place="editor" /></div>}
            </div>
          )}

          <div className="ie-under">
            {hint && <span className="ie-hint" role="status">{hint}</span>}
            <RheaLine busy={busy} drawError={drawError} />
            {current?.cropped_to && asset?.w && asset?.h && <span className="pt-mono faint">{croppedCaption({ w: asset.w, h: asset.h }, current.cropped_to.to)}</span>}
            <span className="pt-grow" />
            <span className="pt-mono ie-legend">Mask: blue paint marks what changes · X or Alt: Subtract · {UNDO_KEY} takes back your last stroke here</span>
          </div>

            <div className="ie-foot">
              {prev ? <button type="button" className="btn link" onClick={() => go(prev.id)}>← {prev.title}</button> : <span />}
              <span className="pt-grow" />
              <span className="faint">Applying makes <span className="pt-mono">v{Math.max(version, frames.at(-1)?.version ?? 0) + 1}</span> and {subject.applyWhere}</span>
              <span className="pt-grow" />
              {next ? <button type="button" className="btn link" onClick={() => go(next.id)}>{next.title} →</button> : <span />}
            </div>
          </div>
        </div>
        {/* The Booth (mock image): the picture's tools, what to do with the blue, the edits and the layers. */}
        <Booth state={booth} earned>
          <div className="sp-crumb"><button type="button" onClick={() => go('back')}>← {subject.back}</button><span>›</span><b>Picture</b>
            <button type="button" className="x" onClick={() => go('back')} title="Back (Esc)" aria-label="Close the image editor">×</button></div>
          <div className="bsec ie-btools">
            <h4>Tools</h4>
            <div className="ie-toolgrid" role="toolbar" aria-label="Image tools">
              {TOOLS.map((t) => (
                <button key={t.id} type="button" className={`ie-tool ${activeTool === t.id ? 'on' : ''}`} aria-pressed={activeTool === t.id}
                  aria-label={`${t.id === 'crop' ? (ratio ? `Crop, kept at ${ratio}` : 'Crop, kept at its shape') : t.label} (${t.key})`} onClick={() => { setTool(t.id); setView('after') }}>
                  <ToolIcon id={t.id} /><span className="ie-tname">{t.label.split(',')[0]}</span><kbd>{t.key}</kbd>
                </button>
              ))}
            </div>
            <div className="ie-strip" role="group" aria-label={maskTool ? 'Brush mask options' : `${tip.label.split(',')[0]} options`}>
            {maskTool ? (
              <>
                <b>{activeMask?.name ?? 'New mask'}</b>
                <label>Size
                  <input type="range" min={BRUSH_MIN} max={BRUSH_MAX} value={brush.size} aria-label="Brush size" onChange={(e) => setBrush({ ...brush, size: Number(e.target.value) })} />
                  <span className="pt-mono ie-num">{brush.size}</span>
                </label>
                <label>Soft
                  <input type="range" min={0} max={100} value={brush.soft} aria-label="Brush softness" className="ie-soft" onChange={(e) => setBrush({ ...brush, soft: Number(e.target.value) })} />
                  <span className="pt-mono ie-num">{brush.soft}%</span>
                </label>
                <div className={`pt-seg ie-mode ${brush.mode === 'sub' ? 'sub' : ''}`} role="group" aria-label="Brush mode">
                  <button type="button" aria-pressed={brush.mode === 'add'} onClick={() => setBrush({ ...brush, mode: 'add' })}
                    title="Add: the brush and the lasso paint into the mask (X swaps; Alt held paints the other way)">Add</button>
                  <button type="button" aria-pressed={brush.mode === 'sub'} onClick={() => setBrush({ ...brush, mode: 'sub' })}
                    title="Subtract: the brush and the lasso take paint out of the mask (X swaps; Alt held paints the other way)">Subtract</button>
                </div>
                <button type="button" className="btn sm ghost" disabled={!masked} onClick={() => setSession(clearMask)}>Clear mask</button>
                <button type="button" className="btn sm ghost" disabled={!masked} title="Start another mask: the next stroke paints it" onClick={() => setSession(newMask)}>New mask</button>
              </>
            ) : activeTool === 'text' ? (
              <><b>Text</b><span className="faint">Click the frame to place words, then type on them.</span></>
            ) : activeTool === 'crop' ? (
              <><b>Crop</b><span className="faint">Drag over the {ratio ? 'frame' : 'picture'}. It stays {ratio ?? 'the same shape'}.</span>
                <button type="button" className="btn sm ghost" disabled={!session.edits.some((e) => e.kind === 'crop')}
                  onClick={() => setSession((s) => { const c = s.edits.find((e) => e.kind === 'crop'); return c ? undoEdit(s, c.id) : s })}>Reset crop</button></>
            ) : activeTool === 'hand' ? (
              <><b>Hand</b><span className="faint">Drag to move the frame, or hold Space with any tool.</span></>
            ) : (
              <><b>Select</b><span className="faint">Drag text to move it.</span></>
            )}
          </div>

          </div>
          <section className="bsec ie-actions" aria-label="Actions">
            <h4>What to do with the blue</h4>
            <div className="pt-seg ie-actseg" role="group" aria-label="What to do">
              {controls.regionEditFrames && <button type="button" aria-pressed={act === 'fill'} onClick={() => setAct('fill')}>Fill area</button>}
              {controls.regionEditFrames && <button type="button" aria-pressed={act === 'remove'} onClick={() => setAct('remove')}>Remove</button>}
              {controls.regionEditFrames && <button type="button" aria-pressed={act === 'whole'} onClick={() => setAct('whole')}>Whole frame</button>}
              {controls.storyboard && <button type="button" aria-pressed={act === 'upscale'} onClick={() => setAct('upscale')}>Upscale</button>}
            </div>

            {controls.regionEditFrames && (act === 'fill' || act === 'remove') && (
              <div className={`ie-action ${masked ? 'on' : ''}`}>
                <div className="row"><b>{act === 'remove' ? 'Remove' : 'Fill area'}</b>{activeMask && <span className="ie-mtag">{activeMask.name}</span>}</div>
                {act === 'fill' && <><label className="faint" htmlFor="ie-fill">Fill with...</label>
                <textarea id="ie-fill" className="textarea" rows={2} placeholder={masked ? 'add condensation drops' : maskHidden && activeMask ? `${activeMask.name} is hidden. Show it to fill.` : 'Paint or lasso an area first'} value={fill} maxLength={1000}
                  disabled={!masked || running} onChange={(e) => setFill(e.target.value)} /></>}
                <label className="ie-check"><input type="checkbox" checked={keepOutside} onChange={(e) => setKeepOutside(e.target.checked)} /> Keep everything outside the blue exactly as it is</label>
                <div className="row"><span className="faint">{maskHidden && activeMask ? `${activeMask.name} is hidden. Show it to fill.` : 'Only the blue area changes'}</span><span className="spacer" />
                  {act === 'remove' && <button ref={removeBtn} type="button" className="btn sm dark" aria-label="Remove what the mask covers" disabled={!masked || running} onClick={() => setTray('remove')}
                    title={masked ? 'Take out what the blue covers; the background continues over it. No words needed.' : 'Paint or lasso an area first'}>Remove</button>}
                  {act === 'fill' && <button ref={fillBtn} type="button" className="btn sm dark" disabled={!masked || !fill.trim() || running} onClick={() => setTray('fill')}
                    title={masked ? (fill.trim() ? 'Fill the blue area with your words' : 'Say what fills the area first') : 'Paint or lasso an area first'}>Fill</button>}</div>
              </div>
            )}

            {controls.regionEditFrames && act === 'whole' && (
              <div className={`ie-action ${offer ? 'on' : ''}`}>
                <b>Change whole frame</b>
                <div className="row">
                  {/* Two lines, as Fill's: the one-line field cut its own placeholder off (live test 2026-11-16). */}
                  <textarea className="input ie-whole" rows={2} aria-label="Describe the change to the whole frame" placeholder="e.g. warmer light, keep the bottle" value={whole} maxLength={1000}
                    disabled={!current || running} onChange={(e) => setWhole(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (whole.trim() && !running) setTray('whole') } }} />
                  <button ref={wholeBtn} type="button" className="btn sm" disabled={!current || !whole.trim() || running} onClick={() => setTray('whole')}>Change</button>
                </div>
                {offer && offerJob && offerEdit && shotId && (
                  <RedrawOffer askId={offer.id} n={shotNo}
                    onRedraw={() => void attempt('handing the redraw to the Storyboard', async () => {
                      await runner.answer(offerJob, { optionId: 'redraw' })
                      setSession((s) => undoEdit(s, offerEdit.id))
                      await changeFrame({ relay, doc: docStore, ui: uiStore, runner }, shotId, 'words' in offerEdit ? offerEdit.words : whole, { mode: 'redraw' })
                      onBack()
                    })}
                    onAnyway={() => void attempt('sending the change', () => runner.answer(offerJob, { optionId: 'edit' }))} />
                )}
              </div>
            )}

            {controls.storyboard && act === 'upscale' && (
              <div className="ie-action">
                <b>Upscale</b>
                {!controls.upscale && <span className="faint">Magnific, the upscaler, is off for your agency, so Upscale cannot run here.</span>}
                <div className="row">
                  <div className="pt-seg" role="group" aria-label="Upscale amount">
                    <button type="button" className="pt-mono" aria-pressed={scale === 2} onClick={() => setScale(2)}>2×</button>
                    <button type="button" className="pt-mono" aria-pressed={scale === 4} onClick={() => setScale(4)}>4×</button>
                  </div>
                  <span className="pt-mono faint ie-out">{upscaleSize(W, H, scale)}</span>
                  <button ref={upBtn} type="button" className="btn sm" disabled={!current || running || !controls.upscale} onClick={() => setTray('upscale')}>Upscale</button>
                </div>
              </div>
            )}
            {error && <div role="alert" className="ie-error">{error}</div>}
          </section>
          <section className="bsec ie-edits" aria-label="Edits not applied yet">
            {check && <div className="ie-rule" role="note"><AgentFigure agent="jude" size={16} decorative /> <b>Review agent:</b> {check.note}</div>}
            <h4>Edits · not applied yet</h4>
            <span className="faint ie-editsub">Nothing is sent until you run an action. v{version} is never changed.</span>
            <ol className="ie-elist">
              {session.edits.filter((e) => !(e.kind === 'mask' && !e.ops.length && session.active !== e.id)).map((e, i) => {
                const st = stateOf(e)
                const label = editLabel(e, session, st)
                const jobId = 'jobId' in e ? e.jobId : undefined
                // The job's status, elapsed time and Cancel (or its question) live in its row, never over the stage.
                const live = jobId && isActive(jobState(jobId) ?? 'completed') && jobId !== offerJob ? jobId : undefined
                return (
                  <li key={e.id} className={`${session.active === e.id ? 'on' : ''} ${live ? 'ie-hasjob' : ''}`}>
                    <button type="button" className="ie-ebody" onClick={() => { if (e.kind === 'mask') { setPicked(null); setSession((s) => ({ ...s, active: e.id })) } }}>
                      <span className="pt-mono ie-n">{i + 1}</span> {label}
                      {st === 'ready' && <span className="ie-ok">ready</span>}
                      {st === 'running' && !live && <span className="ie-run">{jobId && jobId === offerJob ? 'waiting for your choice' : 'working'}</span>}
                      {st === 'failed' && <span className="ie-bad">did not work</span>}
                      {st === 'same' && <span className="ie-bad" title="Nothing changed in the area, so there is nothing to apply. Try other words, or undo it.">came back the same</span>}
                    </button>
                    {live && <span className="ie-jobrow"><JobSlot jobId={live} row onRetried={(id) => setSession((s) => updateEdit(s, e.id, { jobId: id }))} /></span>}
                    <button type="button" className="ie-undo" aria-label={`Undo edit ${i + 1}, ${label}`} onClick={() => setSession((s) => undoEdit(s, e.id))}>↶</button>
                  </li>
                )
              })}
              {step && <li className="ie-next">{step}</li>}
              {!session.edits.length && <li className="ie-next">No edits yet. Paint the blue over what should change, then Fill.</li>}
            </ol>
            {leaving && (
              <div className="ie-ask" role="alertdialog" aria-label="Edits not applied">
                <span>{leaveAsk(pendingCount(session))}</span>
                <span className="pt-grow" />
                <button type="button" className="btn sm" onClick={() => leave(leaving, false)}>Keep for later</button>
                <button type="button" className="btn sm ghost" onClick={() => leave(leaving, true)}>Discard</button>
                <button type="button" className="btn sm ghost" onClick={() => setLeaving(null)}>Cancel</button>
              </div>
            )}
          </section>
          <section className="bsec ie-layers" aria-label="Layers">
            <h4>Layers <span className="r faint">top is front</span></h4>
            {layersOf(session, version).map((l) => {
              const e = session.edits.find((x) => x.id === l.id)
              const pic = e ? resultOf(e) : undefined
              const on = l.kind === 'mask' ? !!l.active && !picked : picked === l.id
              return (
                <div key={l.id} className={`ie-layer ${on ? 'on' : ''} ${l.hidden ? 'off' : ''}`} aria-current={on || undefined}>
                  {/* Every row picks its layer. A mask: the brush, the lasso, Fill and Remove act on it next (its
                      Edits row does the same). Any other layer cannot be painted: its row says why, and the next
                      stroke starts a new mask. */}
                  {!on && <button type="button" className="ie-lpick" aria-label={l.kind === 'mask' ? `Paint ${l.label}` : `Pick ${l.label}`}
                    onClick={() => {
                      if (l.kind === 'mask') { setPicked(null); setSession((s) => ({ ...s, active: l.id })) } else { setPicked(l.id); setSession((s) => ({ ...s, active: undefined })) }
                    }} />}
                  <LayerThumb kind={l.kind} sha={l.kind === 'frame' ? current?.asset : pic?.sha} />
                  <span className="ie-lname">
                    <span>{l.label}</span>
                    {l.kind === 'frame' && <span className="pt-mono ie-lsub">v{version} · locked</span>}
                    {on && l.kind !== 'mask' && <span className="ie-lsub ie-lwhy" role="note">{whyNotPainted(l.kind)}</span>}
                  </span>
                  {l.kind === 'mask' && on && <span className="pt-mono ie-editing">editing</span>}
                  {l.locked && <span className="ie-lock" role="img" aria-label="Locked"><Lock /></span>}
                  <button type="button" className="ie-eye" aria-label={`${l.hidden ? 'Show' : 'Hide'} ${l.label}`} aria-pressed={l.hidden} onClick={() => setSession((s) => toggleHidden(s, l.id))}><Eye hidden={l.hidden} /></button>
                </div>
              )
            })}
          </section>

        </Booth>
      </div>
      {tray && (
        <EditTray anchor={tray === 'fill' ? fillBtn : tray === 'remove' ? removeBtn : tray === 'whole' ? wholeBtn : upBtn} open onClose={() => setTray(null)}
          title={TRAY_TITLE[tray]}
          items={trayItems(tray)} model={tray === 'upscale' ? upModel : tray === 'whole' ? wholeModel : regionModel} send={TRAY_SEND[tray]}
          onSend={() => send(tray)} />
      )}
    </div>
  )
}

/** Dex's offer under Change whole frame (features/frame-edit-or-redraw.clan, mock frame-edit-or-redraw-v2): the
 *  words swap who is in the shot's frame, which a whole-frame change cannot do; nothing is paid yet. */
function RedrawOffer({ askId, n, onRedraw, onAnyway }: { askId: string; n: number; onRedraw: () => void; onAnyway: () => void }) {
  useEffect(() => placeAsk(askId), [askId])
  return (
    <div className="ie-offer" role="group" aria-label="The Director agent offers a redraw">
      <div className="row"><AgentFigure agent="dex" size={24} state="needs-you" decorative /><p><b>{frameEditCopy.recast.title}</b> {frameEditCopy.recast.bodyWhole(n)}</p></div>
      <div className="row">
        <button type="button" className="btn sm dark" onClick={onRedraw}>{frameEditCopy.recast.redrawN(n)}</button>
        <button type="button" className="btn sm" onClick={onAnyway}>{frameEditCopy.recast.changeAnyway}</button>
        <span className="spacer" />
        <span className="faint">{frameEditCopy.recast.unpaid}</span>
      </div>
    </div>
  )
}

/** A region_edit model that edits from words alone (its sheet mask "none"), as the relay's whole_picture_models. */
function wordsOnly(provider: string, model: string): boolean {
  const sheet = SHEETS[provider as keyof typeof SHEETS] as unknown as { mask?: string; ops?: Record<string, { model: string; mask?: string; alternates?: { model: string; mask?: string }[] }> } | undefined
  const spec = sheet?.ops?.region_edit
  if (!spec) return false
  const own = spec.mask ?? sheet?.mask ?? 'none'
  const row = spec.model === model ? { mask: own } : spec.alternates?.find((a) => a.model === model)
  return !!row && (row.mask ?? own) === 'none'
}

/** A shot as a whole-frame change sends it: enough for Dex to know the picture is its storyboard frame, its
 *  words with no @names (the change sends none of the shot's pictures, so a name would refer to nothing). */
function plainShot(shot: Shot): JobShot {
  const action = (shot.action ?? '').replace(/@([a-z][a-z0-9_-]*)/gi, (_, name: string) => name.split('_')[0]).slice(0, 600)
  return { id: shot.id, kind: shot.kind, duration_s: shot.duration_s, camera: shot.camera, action, refs: [] }
}

/** The shot's number on its storyboard (1 when it cannot be told). */
function shotsOfFrame(doc: ReturnType<typeof useDoc>, shotId: string): number {
  return Math.max(1, shotNumber(doc, shotId))
}

/** Why a picked layer that is not a mask cannot be painted, and what a stroke does instead. */
function whyNotPainted(kind: string): string {
  if (kind === 'frame') return 'Locked: the version you opened. Brush or lasso makes a new mask over it.'
  if (kind === 'text') return 'Words: move them with Select (V), retype with Text (T). Brush or lasso makes a new mask.'
  return "The Retouch agent's result. Brush or lasso makes a new mask over it."
}

/** What Rhea says under the stage: at work, or why the picture could not be drawn. */
function RheaLine({ busy, drawError }: {
  busy: string | null
  /** The picture could not be drawn: the last good one stays, and the line says why. */
  drawError: string | null
}) {
  const line = busy ? `${busy}…` : drawError ? `the picture could not be drawn: ${drawError}` : null
  if (!line) return null
  const bad = !busy && !!drawError
  return (
    <div role="status" className={`ie-said ${bad ? 'bad' : ''}`}>
      <AgentFigure agent="rhea" size={18} state={busy ? 'working' : 'idle'} decorative />
      <span><b>Retouch agent:</b> {line}</span>
    </div>
  )
}

export function VersionRow({ f, open, onPick }: { f: Frame; open: boolean; onPick: () => void }) {
  const url = useBlobUrl(f.asset)
  const who = f.crew === 'rhea' ? 'The Retouch agent' : f.crew === 'dex' ? 'The Director agent' : 'The Camera agent'
  const what = f.kind === 'edited' ? 'edited' : f.kind === 'original' ? 'as it was on the canvas' : f.version === 1 ? `drawn by ${who}` : `redrawn by ${who}`
  return (
    <button type="button" role="menuitem" className={`ie-vrow ${open ? 'on' : ''}`} aria-current={open || undefined} onClick={onPick}>
      <span className="ie-vthumb">{url && <img src={url} alt="" />}</span>
      <span className="ie-vtext">
        <span><span className="pt-mono">v{f.version}</span> · {what}{open ? ' · open now' : ''}</span>
        <span className="faint">{f.kind === 'edited' ? `${f.edits?.length ?? 0} ${(f.edits?.length ?? 0) === 1 ? "edit" : "edits"} by the Retouch agent` : f.kind === 'original' ? 'before its first edit' : f.model ?? (f.kind === 'mock' ? 'the mock' : '')}</span>
      </span>
    </button>
  )
}

function LayerThumb({ kind, sha }: { kind: string; sha?: string }) {
  const url = useBlobUrl(kind === 'text' || kind === 'mask' ? undefined : sha)
  if (kind === 'text') return <span className="ie-lthumb ie-lt">T</span>
  if (kind === 'mask') return <span className="ie-lthumb ie-lm"><span /></span>
  return <span className="ie-lthumb">{url && <img src={url} alt="" />}</span>
}

