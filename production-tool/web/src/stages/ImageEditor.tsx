// The Image editor (ui-behaviour 3.12; mock ImageEditor; features/image-editor.clan): one frame full
// screen over the storyboard, or one picture over the canvas (features/edit-canvas-pictures.clan; what
// differs between the two is in imageEditor/subject.ts). Eight tools (Select V, Click-select A, Brush mask B, Lasso L, Eraser E,
// Text T, Crop C, Hand H or Space), the brush strip, a numbered list of edits that changes nothing
// until Apply as new version, layers, and Rhea's actions: Remove background (on the device, or our
// server), Fill area and Change whole frame (Ideogram 4.5 on Runway), Upscale (Magnific on Runway).
// No price anywhere; each job's cost is in History.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import type { Frame, Mime, RefRole } from '../contracts/types'
import { modelChoicesFor, modelWhere } from '../capabilities'
import { assetRef } from '../jobs/assets'
import { selectFrame } from '../jobs/frames'
import type { EditTarget } from '../model/purpose'
import { isActive } from '../jobs/runner'
import { nameAsset, ROLE_PILLS, suggestName } from '../jobs/prompt'
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
import { CopyLinkLater } from '../ui/chrome/MoreMenu'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { Float } from '../ui/Float'
import { croppedCaption } from '../canvas/core/sketch'
import { PromptStart } from '../ui/prompt/PromptStart'
import { cutoutWhere, within, type CutoutWhere } from '../ml/process'
import type { DeviceEnv } from '../ml/runtime'
import {
  EMPTY, NOTHING_TO_TAKE, addEdit, applyLine, clearMask, editCount, editId, editLabel, editsForFrame, hiddenCount, keptAfterApply,
  layersOf, leaveAsk, leftOutLine, nextStep,
  notApplied, nothingToTake, redoUndone, toggleHidden, undoEdit, undoLast, updateEdit, upscaleSize, withMaskOp,
  type Edit, type EditSession, type MaskOp, type Pt, type Undone,
} from './imageEditor/edits'
import { bounds, painted, rasterize, rle, shrink } from './imageEditor/mask'
import { compose, maskToPng, sendPlan, toPng, untouched, type Pic } from './imageEditor/compose'
import { applyEditedStep, applyPictureEditedStep, pickPictureVersionStep } from './imageEditor/apply'
import { subjectOf, type PictureNow } from './imageEditor/subject'
import { BRUSH_MAX, BRUSH_MIN, MASK_TOOLS, TOOLS, brushStep, toolForKey, zoomStep, type ToolId } from './imageEditor/tools'
import { Stage, type Brush } from './imageEditor/Stage'
import { EditTray } from './imageEditor/EditTray'
import { Eye, Lock, ToolIcon } from './imageEditor/icons'
import './image-editor.css'

/** The on-device runtime, loaded only when a tool first needs it (onnxruntime-web is large). */
const ml = () => import('../ml/runtime')

const CUT_ON_DEVICE = 'cut-out ready, ran on your device'
const UNDO_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘Z' : 'Ctrl+Z'
const capital = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

type Action = 'fill' | 'whole' | 'upscale'
type CutoutEdit = Extract<Edit, { kind: 'cutout' }>
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
  const [fill, setFill] = useState('')
  const [keepOutside, setKeepOutside] = useState(true)
  const [whole, setWhole] = useState('')
  const [scale, setScale] = useState<2 | 4>(2)
  const [tray, setTray] = useState<Action | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [env, setEnv] = useState<DeviceEnv | null>(null)
  const [said, setSaid] = useState<string | null>(null)
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
  const wholeBtn = useRef<HTMLButtonElement>(null)
  const upBtn = useRef<HTMLButtonElement>(null)
  const nameAnchor = useRef<HTMLButtonElement>(null)
  const project = useProjectName()
  const motion = ui.motion !== 'still'
  // Jude's brand flag (3.12, 3.18): the one "Fix in image editor" came from, else an open flag on this frame.
  const check = checkId ? doc.checks[checkId]
    : Object.values(doc.checks).find((c) => c.target.kind === 'frame' && c.target.id === current?.id && c.result === 'flag' && !c.ignored)
  const shotId = target.kind === 'shot' ? target.shotId : undefined
  useEffect(() => { if (error) errorShown('frame', error, shotId ? { shot: shotId } : {}) }, [error, shotId])

  // What this device offers, once (WebGPU, memory): where Remove background runs.
  useEffect(() => {
    let alive = true
    void ml().then((m) => m.deviceEnv()).then((e) => { if (alive) setEnv(e) }).catch(() => { if (alive) setEnv({ webgpu: false }) })
    return () => { alive = false }
  }, [])
  const where: CutoutWhere = env ? cutoutWhere(env) : 'device'

  // Results: a job's first output, once it is done.
  const jobState = (id?: string) => (id ? runner.liveInfo(id)?.state ?? doc.jobs[id]?.state : undefined)
  const resultOf = useCallback((e: Edit): Pic | undefined => {
    if (e.kind === 'cutout' && e.sha) return { sha: e.sha, w: W, h: H }
    const id = 'jobId' in e ? e.jobId : undefined
    const j = id ? doc.jobs[id] : undefined
    const sha = j?.state === 'completed' ? j.outputs?.[0] : undefined
    if (!sha) return undefined
    const a = doc.assets[sha]
    return { sha, w: a?.w ?? W, h: a?.h ?? H }
  }, [doc, W, H])
  const stateOf = (e: Edit): 'running' | 'ready' | 'failed' | undefined => {
    if (e.kind === 'cutout' && e.failed) return 'failed'
    if (e.kind === 'cutout' && e.sha) return 'ready'
    const id = 'jobId' in e ? e.jobId : undefined
    if (!id) return undefined
    const s = jobState(id)
    return s === 'completed' ? 'ready' : s === 'failed' || s === 'cancelled' || s === 'uncertain' ? 'failed' : 'running'
  }
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
  // Cut-outs' alpha, for Snap to cut-out: loaded once, read at any size.
  const [cutPics, setCutPics] = useState<Record<string, ImageBitmap>>({})
  useEffect(() => {
    for (const e of session.edits) {
      const pic = e.kind === 'cutout' ? resultOf(e) : undefined
      if (pic && !cutPics[e.id]) void image(pic.sha).then((b) => setCutPics((m) => ({ ...m, [e.id]: b }))).catch(() => undefined)
    }
  }, [session.edits, resultOf, image, cutPics])
  const alphaOf = useCallback((id: string, w: number, h: number) => {
    const b = cutPics[id]
    if (!b) return undefined
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(b, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    const a = new Uint8Array(w * h)
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]
    return a
  }, [cutPics])
  /** What a cut-out's alpha is drawn from: its picture once loaded, '' before (a snap's cache key). */
  const cutKey = session.edits.filter((e) => e.kind === 'cutout' && cutPics[e.id]).map((e) => `${e.id}=${resultOf(e)?.sha ?? ''}`).join(',')
  const alphaKey = useCallback((id: string) => cutKey.split(',').find((x) => x.startsWith(`${id}=`))?.slice(id.length + 1) ?? '', [cutKey])

  const n = editCount(session)
  // Hidden layers are left out of every send and of Apply, and the pill, the Apply line and the tray say so (IM1).
  const hiddenEdits = hiddenCount(session) - (session.hidden.includes('frame') ? 1 : 0)
  const applyLeftOut = hiddenCount(session, ['mask'])
  const activeMask = session.edits.find((e): e is MaskEdit => e.id === session.active && e.kind === 'mask')
  const maskHidden = !!activeMask && session.hidden.includes(activeMask.id)
  // A hidden mask cannot be filled: it is left out like any hidden layer, so there would be nothing to fill.
  const masked = !!activeMask && activeMask.ops.length > 0 && !maskHidden
  const cutouts = session.edits.filter((e) => e.kind === 'cutout' && resultOf(e))
  const lastCutout = [...session.edits].reverse().find((e): e is CutoutEdit => e.kind === 'cutout')
  const sent = framePic ? sendPlan(session, framePic, resultOf, 'action') : undefined
  const shownPlan = sent?.plan
  // The model each action runs on for this agency: Ideogram 4.5 and Magnific when it has them on, else
  // region edits run on Gemini 3 Pro and Upscale cannot run (subprocessors.json: off unless it asks).
  const regionChoice = modelChoicesFor('region_edit', config)[0]
  const upChoice = modelChoicesFor('upscale', config)[0]
  const regionModel = regionChoice ? modelWhere(regionChoice.provider, regionChoice.model) : undefined
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
      const t = toolForKey(e)
      if (t) setTool(t)
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
  const maskOf = (id: string, w: number, h: number) => {
    const m = session.edits.find((e) => e.id === id)
    return m && m.kind === 'mask' ? rasterize(m.ops, w, h, alphaOf) : new Uint8Array(w * h)
  }
  const registerAsset = (sha: string, blob: Blob, w: number, h: number) => systemUpdate(docStore, (d) => {
    if (!d.assets[sha]) d.assets[sha] = { sha256: sha, kind: 'image', mime: (blob.type || 'image/png') as Mime, bytes: blob.size, w, h, origin: 'edited', locations: [idbLocation(sha)] }
  }, 'image editor picture')
  /** The picture an action starts from: the frame, or the edits so far without text, masks or crop. */
  const inputPic = async (): Promise<Pic> => {
    if (!framePic || !shownPlan) throw new Error('Draw this frame first.')
    if (untouched(shownPlan, framePic)) return framePic
    const c = await compose(shownPlan, image, maskOf)
    const blob = await toPng(c)
    const sha = await putBlob(blob)
    await registerAsset(sha, blob, c.width, c.height)
    return { sha, w: c.width, h: c.height }
  }
  const { purpose, parents } = subject

  // ── the tools ──
  // A fill already sent keeps the mask it was sent with: painting while it runs starts a new mask.
  const filling = runningEdit?.kind === 'fill' ? runningEdit.maskId : undefined
  const onMaskOp = (op: MaskOp) => {
    const target = (s: EditSession) => (filling && s.active === filling ? { ...s, active: undefined } : s)
    if (nothingToTake(target(session), op)) {
      setHintAt({ text: NOTHING_TO_TAKE, at: hintKey })
      return
    }
    setHintAt(null)
    setRedoAt({ steps: [] })
    setSession((s) => withMaskOp(target(s), op))
  }

  const onClick = (p: Pt) => void attempt('finding the object', async () => {
    if (!framePic || !shownPlan) return
    const base = shownPlan.steps.find((s) => s.kind === 'base')
    const pic = base && base.kind === 'base' ? base.pic : framePic
    let bits: Uint8Array
    try {
      const m = await ml()
      bits = await within(m.clickSelect(await image(pic.sha), pic.w, pic.h, pic.sha, p, env ?? { webgpu: false }), 90_000, 'click-select took too long')
    } catch (e) {
      console.warn('Click-select could not run on this device.', e)
      throw new Error('Click-select could not run on this device. Paint the area with the brush instead.', { cause: e })
    }
    if (!painted(bits)) throw new Error('Rhea found nothing there. Click on the thing itself, or paint it.')
    const small = shrink(bits, pic.w, pic.h)
    onMaskOp({ t: 'pick', mode: brush.mode, w: small.w, h: small.h, rle: rle(small.data) })
    setSaid('found it, on your device')
  })
  const onAddText = (p: Pt) => setSession((s) => addEdit(s, { id: editId(), kind: 'text', text: 'Your words', x: p.x, y: p.y, size: 0.06 }))
  const onText = (id: string, patch: { text?: string; x?: number; y?: number }) => {
    if (patch.text !== undefined && !patch.text.trim()) setSession((s) => undoEdit(s, id))
    else setSession((s) => updateEdit(s, id, patch))
  }
  const onCrop = (r: { x: number; y: number; w: number; h: number }) => setSession((s) => {
    const old = s.edits.find((e) => e.kind === 'crop')
    return old ? updateEdit(s, old.id, r) : addEdit(s, { id: editId(), kind: 'crop', ...r })
  })
  const snap = () => {
    const c = [...session.edits].reverse().find((e) => e.kind === 'cutout' && resultOf(e))
    if (c && activeMask) onMaskOp({ t: 'snap', cutout: c.id })
  }

  // ── the actions ──
  const removeBackground = () => void attempt('removing the background', async () => {
    const input = await inputPic()
    let made: Edit | undefined
    if (where === 'device') {
      try {
        const m = await ml()
        const blob = await within(m.removeBackground(await image(input.sha), input.w, input.h, env ?? { webgpu: true }), 120_000, 'the device took too long')
        const sha = await putBlob(blob)
        await registerAsset(sha, blob, input.w, input.h)
        made = { id: editId(), kind: 'cutout', where: 'device', sha }
        setSaid(CUT_ON_DEVICE)
      } catch (e) {
        console.warn('Remove background could not run on this device; our server does it.', e)
        made = undefined // the device could not: our server does it (3.12)
      }
    }
    if (!made) {
      const jobId = await runner.submit('cutout', { image: await assetRef(relay, input.sha, doc) }, parents, purpose)
      made = { id: editId(), kind: 'cutout', where: 'server', jobId }
      setSaid(null)
    }
    const e = made
    // Frame stays as it is (owner answer IM2): Rhea's line suggests hiding it to see the cut-out alone.
    setSession((s) => addEdit(s, e))
  })
  const send = (a: Action) => void attempt(a === 'fill' ? 'sending the fill' : a === 'whole' ? 'sending the change' : 'sending the upscale', async () => {
    setTray(null)
    const input = await inputPic()
    const picture = await assetRef(relay, input.sha, doc)
    const shape = { w: input.w, h: input.h }
    if (a === 'fill') {
      if (!activeMask || !masked) throw new Error(maskHidden && activeMask ? `${activeMask.name} is hidden. Show it to fill.` : 'Paint the area first.')
      const bits = rasterize(activeMask.ops, input.w, input.h, alphaOf)
      const region = bounds(bits, input.w, input.h)
      if (!region) throw new Error('The mask is empty. Paint the area first.')
      const mask = await assetRef(relay, await putBlob(await maskToPng(bits, input.w, input.h)), doc)
      const words = fill.trim()
      const jobId = await runner.submit('region_edit', { image: picture, mask, region, text: words, aspect: shape }, parents, purpose)
      setSession((s) => addEdit(s, { id: editId(), kind: 'fill', maskId: activeMask.id, words, keepOutside, jobId }))
      setFill('')
    } else if (a === 'whole') {
      const words = whole.trim()
      const jobId = await runner.submit('region_edit', { image: picture, text: words, aspect: shape }, parents, purpose)
      setSession((s) => addEdit(s, { id: editId(), kind: 'whole', words, jobId }))
      setWhole('')
    } else {
      const jobId = await runner.submit('upscale', { image: picture, scale, aspect: shape }, parents, purpose)
      setSession((s) => addEdit(s, { id: editId(), kind: 'upscale', scale, jobId }))
    }
  })
  const apply = () => void attempt('applying', async () => {
    if (!framePic || !frameId) return
    const c = await compose(sendPlan(session, framePic, resultOf, 'apply').plan, image, maskOf)
    const blob = await toPng(c)
    const out = { sha: await putBlob(blob), bytes: blob.size, w: c.width, h: c.height, edits: editsForFrame(session) }
    // A frame: v(n+1) of the shot. A canvas picture: v(n+1) in place, its name following (one undo step each).
    const made = target.kind === 'shot'
      ? current && await applyEditedStep(docStore, target.shotId, current.id, out)
      : await applyPictureEditedStep(docStore, { nodeId: target.nodeId, sha: framePic.sha, w: W, h: H }, out)
    // The applied edits are in v(n+1) now. Hidden ones were left out of it: they stay, hidden, on the new
    // version (owner answer IM3: nothing vanishes).
    const kept = keptAfterApply(session)
    if (made) uiStore.update((u) => {
      const all = { ...(u.imageEdits ?? {}) }
      delete all[frameId]
      if (kept) all[made.id] = kept
      u.imageEdits = all
    }, 'image edits applied')
    setSaid(null)
  })
  const pickVersion = (f: Frame) => {
    setVersionsOpen(false)
    if (target.kind === 'shot') void selectFrame(docStore, target.shotId, f.id)
    else void pickPictureVersionStep(docStore, f.id)
  }
  const go = (id: string) => (n + hiddenEdits > 0 ? setLeaving(id) : id === 'back' ? onBack() : onTarget?.({ kind: 'shot', shotId: id }))
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
  const applyWords = `${applyLine(n, version)}${applyLeftOut ? ` ${capital(leftOutLine(applyLeftOut))}.` : ''}`
  const trayItems = (a: Action) => [
    { what: subject.label, detail: `v${version}${n ? ', with your edits' : ''}` },
    ...(a === 'fill' && activeMask ? [{ what: activeMask.name, detail: keepOutside ? 'only the blue area changes' : 'the whole result is kept' }] : []),
    ...(a === 'fill' ? [{ what: `"${fill.trim()}"` }] : a === 'whole' ? [{ what: `"${whole.trim()}"`, detail: 'the composition and size stay' }] : [{ what: `${scale}× larger`, detail: upscaleSize(W, H, scale) }]),
    ...(sent?.leftOut ? [{ what: capital(leftOutLine(sent.leftOut)), detail: 'Rhea sends what you see' }] : []),
  ]
  const step = nextStep(session)

  return (
    <div className="editor image-editor" data-image-editor="">
      <EditorBar back={subject.back} onBack={() => go('back')} icon="frame" title={subject.title}
        meta={<span className="pt-mono ie-meta">{ratio ? `${ratio} locked` : 'Picture'}</span>}
        right={(
          <>
            {/* Zoom sits on the stage and Presence in the bar itself (topbar-declutter); the pill keeps the
                hidden layers Apply leaves out (masks-layers), with a short form at the tight fit. */}
            {n + applyLeftOut > 0 && (() => {
              const long = [n ? notApplied(n) : '', applyLeftOut ? leftOutLine(applyLeftOut) : ''].filter(Boolean).join(' · ')
              const short = [n ? `${n} ${n === 1 ? 'edit' : 'edits'}` : '', applyLeftOut ? `${applyLeftOut} left out` : ''].filter(Boolean).join(' · ')
              return <span className="pt-mono ie-pill" title={long}><span className="ie-n-long">{long}</span><span className="ie-n-short">{short}</span></span>
            })()}
            {frames.length > 0 && (
              <button ref={versionsBtn} type="button" className="btn ie-vbtn" aria-haspopup="menu" aria-expanded={versionsOpen} aria-label={`Version ${version} of ${frames.length}`} onClick={() => setVersionsOpen((o) => !o)}>
                <span className="pt-mono">v{version}</span><span className="ie-vof"> of {frames.length}</span> <span aria-hidden="true" className="ie-caret">▼</span>
              </button>
            )}
          </>
        )}
        more={() => <CopyLinkLater />}
        primary={<button type="button" className="btn primary" disabled={running || !n || !framePic} onClick={apply}
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

      <div className="ie-body">
        <div className="ie-tools" role="toolbar" aria-label="Image tools" aria-orientation="vertical">
          {TOOLS.map((t, i) => (
            <span key={t.id} className="ie-toolslot">
              {i === TOOLS.length - 1 && <span className="ie-tsep" aria-hidden="true" />}
              <button type="button" className={activeTool === t.id ? 'on' : ''} aria-pressed={activeTool === t.id}
                aria-label={`${t.id === 'crop' ? (ratio ? `Crop, kept at ${ratio}` : 'Crop, kept at its shape') : t.label} (${t.key})`} onClick={() => setTool(t.id)}><ToolIcon id={t.id} /></button>
              {activeTool === t.id && <span role="tooltip" className="ie-tip">{t.label.split(',')[0]} <span className="pt-mono">{t.key}</span></span>}
            </span>
          ))}
        </div>

        <div className="ie-center">
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
                <div className="pt-seg ie-mode" role="group" aria-label="Brush mode">
                  <button type="button" aria-pressed={brush.mode === 'add'} onClick={() => setBrush({ ...brush, mode: 'add' })}>Add</button>
                  <button type="button" aria-pressed={brush.mode === 'sub'} onClick={() => setBrush({ ...brush, mode: 'sub' })}>Subtract</button>
                </div>
                <button type="button" className="btn sm" disabled={!masked || !cutouts.length} onClick={snap}
                  title={cutouts.length ? "Fit the mask to Rhea's cut-out edge" : 'Remove the background first: the mask snaps to the cut-out'}>Snap to cut-out</button>
                <button type="button" className="btn sm ghost" disabled={!masked} onClick={() => setSession(clearMask)}>Clear mask</button>
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

          {framePic && shownPlan ? (
            <div className="ie-stagewrap">
            <Stage src={url} plan={shownPlan} image={image} w={W} h={H} session={session} tool={activeTool} brush={brush} zoom={zoom} pan={pan} onPan={setPan}
              before={view === 'before'} motion={motion} alphaOf={alphaOf} alphaKey={alphaKey} onDrawn={setDrawError} onMaskOp={onMaskOp} onClick={onClick} onAddText={onAddText} onText={onText} onCrop={onCrop}
              pending={runningEdit?.kind === 'fill' ? runningEdit.maskId : undefined} progress={!!runningEdit && runningEdit.kind !== 'fill'}>
              {view === 'before' && <span className="pt-mono ie-before">Before · v{version} as saved</span>}
            </Stage>
            {/* Zoom, on the stage at the bottom right like the canvas's zoom pill (owner, 2026-10-15). */}
            <div className="ie-zoom" role="group" aria-label="Zoom">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => zoomStep(z, -1))}>−</button>
              <span className="pt-mono">{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => zoomStep(z, 1))}>+</button>
              <button type="button" className="ie-fit" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Fit</button>
            </div>
            </div>
          ) : (
            <div className="ie-viewport" style={{ aspectRatio: String(aspect), '--ie-ratio': aspect } as React.CSSProperties}>
              {shotId && <div className="pending idle" style={{ position: 'absolute', inset: 0 }}><PromptStart kind="image" nodeId={shotId} place="editor" /></div>}
            </div>
          )}

          <div className="ie-under">
            <div className="pt-seg ie-compare" role="group" aria-label="Compare">
              <button type="button" aria-pressed={view === 'before'} onClick={() => setView('before')}>Before</button>
              <button type="button" aria-pressed={view === 'after'} onClick={() => setView('after')}>After</button>
            </div>
            {hint && <span className="ie-hint" role="status">{hint}</span>}
            <RheaLine busy={busy} said={said} cutout={lastCutout} state={lastCutout ? stateOf(lastCutout) : undefined}
              frameShown={!session.hidden.includes('frame')} drawError={drawError}
              error={lastCutout?.jobId ? doc.jobs[lastCutout.jobId]?.error?.message : undefined} />
            {current?.cropped_to && asset?.w && asset?.h && <span className="pt-mono faint">{croppedCaption({ w: asset.w, h: asset.h }, current.cropped_to.to)}</span>}
            <span className="pt-grow" />
            <span className="pt-mono ie-legend">Mask: blue paint marks what changes · {UNDO_KEY} takes back your last stroke here</span>
          </div>

          <section className="ie-edits" aria-label="Edits not applied yet">
            {check && <div className="ie-rule" role="note"><AgentFigure agent="jude" size={16} decorative /> <b>Jude · judges:</b> {check.note}</div>}
            <div className="ie-edithead">
              <h2 className="pt-label">Edits · not applied yet</h2>
              <span className="pt-grow" />
              <span className="faint">Nothing is sent until you run an action. v{version} is never changed.</span>
            </div>
            <ol className="ie-elist">
              {session.edits.filter((e) => !(e.kind === 'mask' && !e.ops.length && session.active !== e.id)).map((e, i) => {
                const st = stateOf(e)
                const label = editLabel(e, session, st)
                const jobId = 'jobId' in e ? e.jobId : undefined
                // The job's status, elapsed time and Cancel (or its question) live in its row, never over the stage.
                const live = jobId && isActive(jobState(jobId) ?? 'completed') ? jobId : undefined
                return (
                  <li key={e.id} className={`${session.active === e.id ? 'on' : ''} ${live ? 'ie-hasjob' : ''}`}>
                    <button type="button" className="ie-ebody" onClick={() => { if (e.kind === 'mask') setSession((s) => ({ ...s, active: e.id })) }}>
                      <span className="pt-mono ie-n">{i + 1}</span> {label}
                      {st === 'ready' && <span className="ie-ok">ready</span>}
                      {st === 'running' && !live && <span className="ie-run">working</span>}
                      {st === 'failed' && <span className="ie-bad">did not work</span>}
                    </button>
                    {live && <span className="ie-jobrow"><JobSlot jobId={live} row onRetried={(id) => setSession((s) => updateEdit(s, e.id, { jobId: id }))} /></span>}
                    <button type="button" className="ie-undo" aria-label={`Undo edit ${i + 1}, ${label}`} onClick={() => setSession((s) => undoEdit(s, e.id))}>↶</button>
                  </li>
                )
              })}
              {step && <li className="ie-next">{step}</li>}
              {!session.edits.length && <li className="ie-next">No edits yet. Pick a tool on the left.</li>}
            </ol>
            <div className="ie-foot">
              {prev ? <button type="button" className="btn link" onClick={() => go(prev.id)}>← {prev.title}</button> : <span />}
              <span className="pt-grow" />
              <span className="faint">Applying makes <span className="pt-mono">v{Math.max(version, frames.at(-1)?.version ?? 0) + 1}</span> and {subject.applyWhere}</span>
              <span className="pt-grow" />
              {next ? <button type="button" className="btn link" onClick={() => go(next.id)}>{next.title} →</button> : <span />}
            </div>
            {leaving && (
              <div className="ie-ask" role="alertdialog" aria-label="Edits not applied">
                <span>{leaveAsk(n + hiddenEdits)}</span>
                <span className="pt-grow" />
                <button type="button" className="btn sm" onClick={() => leave(leaving, false)}>Keep for later</button>
                <button type="button" className="btn sm ghost" onClick={() => leave(leaving, true)}>Discard</button>
                <button type="button" className="btn sm ghost" onClick={() => setLeaving(null)}>Cancel</button>
              </div>
            )}
          </section>
        </div>

        <aside className="ie-side">
          <section className="ie-panel" aria-label="Layers">
            <div className="ie-panelhead"><h2 className="pt-label">Layers</h2><span className="faint">top is front</span></div>
            {layersOf(session, version).map((l) => {
              const e = session.edits.find((x) => x.id === l.id)
              const pic = e ? resultOf(e) : undefined
              return (
                <div key={l.id} className={`ie-layer ${l.active ? 'on' : ''} ${l.hidden ? 'off' : ''}`} aria-current={l.active || undefined}>
                  {/* A mask's row picks it: the brush paints it next (the Edits list does the same). */}
                  {l.kind === 'mask' && !l.active && <button type="button" className="ie-lpick" aria-label={`Paint ${l.label}`} onClick={() => setSession((s) => ({ ...s, active: l.id }))} />}
                  <LayerThumb kind={l.kind} sha={l.kind === 'frame' ? current?.asset : pic?.sha} />
                  <span className="ie-lname">
                    <span>{l.label}</span>
                    {l.kind === 'frame' && <span className="pt-mono ie-lsub">v{version} · locked</span>}
                    {l.kind === 'cutout' && pic && <span className="ie-lsub">by Rhea · <button ref={naming === l.id ? nameAnchor : undefined} type="button" className="btn link" onClick={() => setNaming(l.id)}>Save as reference</button></span>}
                    {l.kind === 'cutout' && !pic && <span className="ie-lsub">Rhea is cutting it out…</span>}
                  </span>
                  {l.active && <span className="pt-mono ie-editing">editing</span>}
                  {l.locked && <span className="ie-lock" role="img" aria-label="Locked"><Lock /></span>}
                  <button type="button" className="ie-eye" aria-label={`${l.hidden ? 'Show' : 'Hide'} ${l.label}`} aria-pressed={l.hidden} onClick={() => setSession((s) => toggleHidden(s, l.id))}><Eye hidden={l.hidden} /></button>
                </div>
              )
            })}
            {naming && (() => {
              const e = session.edits.find((x) => x.id === naming)
              const pic = e ? resultOf(e) : undefined
              return pic ? <SaveRef anchor={nameAnchor} sha={pic.sha} onClose={() => setNaming(null)} /> : null
            })()}
          </section>

          <section className="ie-panel ie-actions" aria-label="Actions">
            <div className="ie-panelhead"><h2 className="pt-label">Actions</h2></div>

            <div className="ie-action ie-rowcard">
              <div className="ie-acol">
                <b>Remove background</b>
                <span className="faint">{where === 'device' ? 'On your device' : 'On our server (no WebGPU here)'}</span>
              </div>
              {lastCutout && stateOf(lastCutout) === 'ready'
                ? <span className="ie-ok">Done</span>
                : <button type="button" className="btn sm" disabled={running || !current} onClick={removeBackground}>{lastCutout && stateOf(lastCutout) === 'running' ? 'Working…' : 'Remove'}</button>}
            </div>

            {controls.regionEditFrames && (
              <div className={`ie-action ${masked ? 'on' : ''}`}>
                <div className="row"><b>Fill area</b>{activeMask && <span className="ie-mtag">{activeMask.name}</span>}</div>
                <label className="faint" htmlFor="ie-fill">Fill with...</label>
                <textarea id="ie-fill" className="textarea" rows={2} placeholder={masked ? 'add condensation drops' : maskHidden && activeMask ? `${activeMask.name} is hidden. Show it to fill.` : 'Paint, lasso or click an area first'} value={fill} maxLength={1000}
                  disabled={!masked || running} onChange={(e) => setFill(e.target.value)} />
                <label className="ie-check"><input type="checkbox" checked={keepOutside} onChange={(e) => setKeepOutside(e.target.checked)} /> Keep everything outside the blue exactly as it is</label>
                <div className="row"><span className="faint">{maskHidden && activeMask ? `${activeMask.name} is hidden. Show it to fill.` : 'Only the blue area changes'}</span><span className="spacer" />
                  <button ref={fillBtn} type="button" className="btn sm dark" disabled={!masked || !fill.trim() || running} onClick={() => setTray('fill')}>Fill area</button></div>
              </div>
            )}

            {controls.regionEditFrames && (
              <div className="ie-action">
                <b>Change whole frame</b>
                <div className="row">
                  <input className="input" aria-label="Describe the change to the whole frame" placeholder="e.g. warmer light, keep the bottle" value={whole} maxLength={1000}
                    disabled={!current || running} onChange={(e) => setWhole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && whole.trim() && !running) setTray('whole') }} />
                  <button ref={wholeBtn} type="button" className="btn sm" disabled={!current || !whole.trim() || running} onClick={() => setTray('whole')}>Change</button>
                </div>
              </div>
            )}

            {controls.storyboard && (
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
        </aside>
      </div>
      {tray && (
        <EditTray anchor={tray === 'fill' ? fillBtn : tray === 'whole' ? wholeBtn : upBtn} open onClose={() => setTray(null)}
          title={tray === 'fill' ? 'What Rhea will send to fill the area' : tray === 'whole' ? 'What Rhea will send to change the frame' : 'What Rhea will send to upscale'}
          items={trayItems(tray)} model={tray === 'upscale' ? upModel : regionModel} send={tray === 'fill' ? 'Fill area' : tray === 'whole' ? 'Change' : 'Upscale'}
          onSend={() => send(tray)} />
      )}
    </div>
  )
}

/** What Rhea says under the stage: at work, a cut-out ready (on the device or our server), or nothing. */
function RheaLine({ busy, said, cutout, state, error, frameShown, drawError }: {
  busy: string | null; said: string | null; cutout?: CutoutEdit; state?: string; error?: string
  /** Frame is showing: a ready cut-out sits over it, so the line says how to see the cut-out alone. */
  frameShown: boolean
  /** The picture could not be drawn: the last good one stays, and the line says why. */
  drawError: string | null
}) {
  let line: string | null = null
  const alone = frameShown ? ' · hide Frame to see the cut-out alone' : ''
  if (busy) line = `${busy}…`
  else if (drawError) line = `the picture could not be drawn: ${drawError}`
  else if (cutout && state === 'running') line = 'removing the background on our server…'
  else if (cutout && state === 'failed') line = error ?? 'the cut-out did not work'
  else if (cutout && state === 'ready' && cutout.where === 'server') line = `cut-out ready, ran on our server${alone}`
  else if (said) line = said === CUT_ON_DEVICE ? `${said}${alone}` : said
  if (!line) return null
  const bad = !busy && (!!drawError || state === 'failed')
  return (
    <div role="status" className={`ie-said ${bad ? 'bad' : ''}`}>
      <AgentFigure agent="rhea" size={18} state={busy || state === 'running' ? 'working' : 'idle'} decorative />
      <span><b>Rhea · retouches:</b> {line}</span>
    </div>
  )
}

export function VersionRow({ f, open, onPick }: { f: Frame; open: boolean; onPick: () => void }) {
  const url = useBlobUrl(f.asset)
  const who = f.crew === 'rhea' ? 'Rhea' : f.crew === 'dex' ? 'Dex' : 'Fin'
  const what = f.kind === 'edited' ? 'edited' : f.kind === 'original' ? 'as it was on the canvas' : f.version === 1 ? `drawn by ${who}` : `redrawn by ${who}`
  return (
    <button type="button" role="menuitem" className={`ie-vrow ${open ? 'on' : ''}`} aria-current={open || undefined} onClick={onPick}>
      <span className="ie-vthumb">{url && <img src={url} alt="" />}</span>
      <span className="ie-vtext">
        <span><span className="pt-mono">v{f.version}</span> · {what}{open ? ' · open now' : ''}</span>
        <span className="faint">{f.kind === 'edited' ? `${f.edits?.length ?? 0} edits by Rhea` : f.kind === 'original' ? 'before its first edit' : f.model ?? (f.kind === 'mock' ? 'the mock' : '')}</span>
      </span>
    </button>
  )
}

function LayerThumb({ kind, sha }: { kind: string; sha?: string }) {
  const url = useBlobUrl(kind === 'text' || kind === 'mask' ? undefined : sha)
  if (kind === 'text') return <span className="ie-lthumb ie-lt">T</span>
  if (kind === 'mask') return <span className="ie-lthumb ie-lm"><span /></span>
  return <span className={`ie-lthumb ${kind === 'cutout' ? 'ie-lcut' : ''}`}>{url && <img src={url} alt="" />}</span>
}

/** Save as reference: Name this picture, with the role preselected (3.12). */
function SaveRef({ anchor, sha, onClose }: { anchor: React.RefObject<HTMLElement | null>; sha: string; onClose: () => void }) {
  const { doc: store } = useServices()
  const doc = useDoc()
  const [role, setRole] = useState<RefRole>('product')
  const [name, setName] = useState(() => suggestName(doc, 'cutout', 'product'))
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      await nameAsset(store, sha, { ...name, role })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That name did not work.')
    }
  }
  return (
    <Float anchor={anchor} open onClose={onClose} role="dialog" label="Name this picture" className="ie-name">
      <b>Name this picture</b>
      <div className="ie-pills" role="radiogroup" aria-label="What it is for">
        {ROLE_PILLS.slice(0, 6).map((r) => <button key={r} type="button" role="radio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r}</button>)}
      </div>
      <div className="row"><span className="pt-mono">@</span>
        <input className="input" aria-label="Who or what" value={name.key} onChange={(e) => setName({ ...name, key: e.target.value.toLowerCase() })} />
        <span className="pt-mono">_</span>
        <input className="input" aria-label="This view" value={name.variant} onChange={(e) => setName({ ...name, variant: e.target.value.toLowerCase() })} />
      </div>
      <div className="row"><span className="spacer" /><button type="button" className="btn sm" onClick={onClose}>Cancel</button><button type="button" className="btn sm primary" onClick={() => void save()}>Save</button></div>
      {error && <div role="alert" className="ie-error">{error}</div>}
    </Float>
  )
}
