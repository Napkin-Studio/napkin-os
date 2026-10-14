// Stage 2: script → shot list → one frame per shot, drawn in order: frame 1
// from the shot's named refs (@maya_front, @lamp_on), then each next frame from its refs, frame 1
// (setting, light, style) and the frame before it (jobs/frames.ts). Each frame
// can be changed with a sentence, optionally inside a box (or a painted mask,
// or a click when the provider can segment), and stepped back to an earlier version.
//
// Contract 3: the script's words are the main script's scenes; the shots are the main storyboard's,
// in rank order; the ratio and the target length are the storyboard's; the frame in a shot is its pick.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useRouter, useServices, useUi } from '../app/context'
import type { Ask, DocJob, Frame, ProductionDocument, Ratio, Shot } from '../contracts/types'
import type { UiState } from '../doc/ui'
import { isRunning, jobAt, ratioAspect } from '../jobs/select'
import { croppedCaption } from '../canvas/core/sketch'
import { drawFrame, drawTheRest, firstUndrawn } from '../jobs/frames'
import { planOrJoin, askedShot } from '../jobs/plan'
import { checkDurations, MAX_SHOTS, TARGETS } from '../lib/shots'
import { useBlobUrl } from '../ui/hooks'
import { JobSlot } from '../ui/JobSlot'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeShot, shotDeleteText, shotNeedsConfirm } from '../doc/remove'
import { InlineConfirm } from '../ui/Undo'
import { oldWordsLine } from '../ui/behind'
import { editShot, frameStale, takeStale } from '../jobs/stale'
import { useUpdate } from '../ui/useUpdate'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer, whoIsWorking, workOf } from '../ui/agents/cast'
import { NapkinLoader } from '../ui/loader/NapkinLoader'
import { Thumbs } from '../dogfood/Dogfood'
import { errorShown } from '../dogfood/recorder'
import { DownloadButton } from '../ui/Download'
import { useProjectName } from '../ui/useDownload'
import { mediaItem } from '../media/names'
import { currentFrame, currentTake, framesOf, jobsList, mainStoryboard, openAsks, openStoryboard, refsList, scriptOfStoryboard, scriptText, shotNumber, shotsOf, storyboardSeconds, takesOf } from '../model/selectors'
import { jobCtx, LOCAL_PERSON } from '../jobs/runner'
import { addShot, answerShotAsk, setRatio, setTarget } from './storyboardEdits'
import { scriptRoute } from '../app/route'
import type { ModelStore } from '../model/store'
import { insertShot } from '../script/edits'
import { ShotEditor } from '../script/ShotEditor'
import { scriptMentionHooks } from '../script/mentionHooks'
import { EditorBar } from '../ui/chrome/TopBars'
import { nodeTitle } from '../ui/chrome/panels'
import { Float } from '../ui/Float'
import { trayGroups, type TrayRow } from '../ui/tray'
import { applyClipLine, applyFrameEditStep, cameraDiff, cameraLabel, changeFrame, discardStep, frameEditCopy, frameEditLines, frameEditOf, keepBothStep, proposalOf } from '../jobs/frameEdit'
import { ImageEditor } from './ImageEditor'
import { ScopeLine } from './InputsStrip'
import './storyboard.css'
import { PromptStart } from '../ui/prompt/PromptStart'

const RATIOS: Ratio[] = ['9:16', '1:1', '16:9']

export function Storyboard() {
  const { doc: docStore, ui: uiStore, runner, relay, clan, project } = useServices()
  const router = useRouter()
  const doc = useDoc()
  const ui = useUi()
  const { controls } = useConfig()
  useJobsTick()
  const [error, setError] = useState<string | null>(null)
  const [confirmShot, setConfirmShot] = useState<string | null>(null)
  /** "Deleted shot 3." with Undo, after a delete (ui-behaviour 3.3 Delete). */
  const [deleted, setDeleted] = useState<string | null>(null)
  /** The shot whose frame is open in the Image editor (ui-behaviour 3.12). */
  const [editing, setEditing] = useState<string | null>(null)
  const projectName = useProjectName()
  // The storyboard opened on the canvas (ui.openNode), else the main one (features/canvas-nodes.clan).
  const sb = openStoryboard(doc, ui.openNode)
  const shots = shotsOf(doc, sb?.id)
  const targetS = sb?.target_s ?? 15
  const ratio = sb?.ratio ?? '16:9'
  const script = scriptOfStoryboard(doc, sb?.id)
  const words = script ? scriptText(doc, script.id) : ''
  const hasRefs = refsList(doc).length > 0
  const check = checkDurations(shots, targetS)
  const mainSb = mainStoryboard(doc)?.id
  const planJob = jobAt(doc, ui, (c) => c.for === 'shot_list' && (c.storyboardId ?? mainSb) === sb?.id)
  const planning = isRunning(doc, planJob)
  const lastPlan = jobsList(doc).filter((j) => j.op === 'shot_list' && j.state === 'completed').at(-1)
  useEffect(() => { if (error) errorShown('storyboard', error) }, [error])
  const allFramed = shots.length > 0 && shots.every((s) => !!currentFrame(doc, s))
  const anyFrameRunning = shots.some((s) => isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === s.id)))
  const noFrames = !shots.some((s) => framesOf(doc, s.id).length > 0)
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  // Dex's questions about shots a re-plan left out that have frames or clips (jobs/plan.ts): Keep or Remove.
  const shotAsks = new Map(openAsks(doc).flatMap((a) => { const id = askedShot(a); return id ? [[id, a] as const] : [] }))
  const person = ui.me ? `human:${ui.me.participantId}` : LOCAL_PERSON
  const answerAsk = (a: Ask, shotId: string, option: 'keep' | 'remove') => attempt(async () => {
    if (option === 'keep') return updateDoc(docStore, (d) => answerShotAsk(d, a.id, 'keep', person), `answer ${a.question.text}`)
    // One write: the answer and the shot with its frames and clips (Undo in the top bar puts it back).
    return deleteFrom(docStore, (d) => { answerShotAsk(d, a.id, 'remove', person); return removeShot(d, shotId) })
  })

  // Dex plans from the whole script: the scenes' words and the planned shots' action (jobs/plan.ts).
  // The Script editor's Plan shots is the same job on the same node: one running is joined.
  const plan = async () => {
    setError(null)
    if (!words.trim()) return setError('Write a line or two first.')
    await planOrJoin(deps, { storyboardId: sb?.id })
  }
  const mentionHooks = useMemo(() => (clan ? scriptMentionHooks(clan, undefined) : undefined), [clan])
  const openScript = (shot?: string) => script && router.push(scriptRoute(project.id, script.id, shot))

  const attempt = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  // Delete a shot (ui-behaviour 3.11, 3.3 Delete; item 4): at once with Undo, or after a confirm when it has
  // frames or clips. Through the document's removal cascade (doc/remove.ts), one undo step.
  const removeNow = (shotId: string) => attempt(async () => {
    const n = shotNumber(docStore.get(), shotId)
    await deleteFrom(docStore, (d) => removeShot(d, shotId))
    setDeleted(`Deleted shot ${n}.`)
  })
  const deleteShot = (shotId: string) => {
    if (shotNeedsConfirm(docStore.get(), shotId)) setConfirmShot(shotId)
    else void removeNow(shotId)
  }
  const drawFirst = () => attempt(() => drawFrame(deps, 0, 'first', { storyboardId: sb?.id }))
  const drawNext = (index: number) => attempt(() => drawFrame(deps, index, 'next', { storyboardId: sb?.id }))
  const drawRest = () => attempt(() => drawTheRest(deps))


  const lock = async () => {
    await updateDoc(docStore, (d) => {
      for (const s of shotsOf(d, sb?.id)) d.shots[s.id].status = 'locked'
    }, 'lock storyboard')
    uiStore.update((u) => { u.stage = 'video' })
  }

  if (!controls.storyboard) {
    return <div className="panel"><div className="empty-state"><b>Storyboards are off right now.</b></div></div>
  }
  if (editing && shots.some((s) => s.id === editing)) {
    return <ImageEditor shotId={editing} onBack={() => setEditing(null)} onShot={setEditing} />
  }

  const total = storyboardSeconds(doc, sb?.id)
  const over = Math.round((total - targetS) * 10) / 10
  const staleClips = shots.filter((s) => !!takeStale(doc, s.id)).length
  const working = trayGroups(jobsList(doc), (id) => jobCtx(doc, ui, id), (id) => runner.liveInfo(id)).working
  const primary = !shots.length
    ? <button className="btn primary" disabled={planning || !words.trim()} onClick={() => void attempt(plan)} title={words.trim() ? undefined : 'Write the script first'}>{planning ? 'Planning…' : 'Plan shots'}</button>
    : noFrames
      ? <button className="btn primary" disabled={!check.ok || anyFrameRunning || !hasRefs} onClick={drawFirst} title={hasRefs ? 'Frame 1 sets the place, the light and the style for every frame after it' : 'Name a picture on the canvas first, like @maya_front'}>{anyFrameRunning ? 'Drawing…' : 'Draw frame 1'}</button>
      : !allFramed
        ? <button className="btn primary" disabled={!check.ok || anyFrameRunning || firstUndrawn(doc, sb?.id) < 0 || !hasRefs} onClick={drawRest} title="Draw each remaining shot in turn, each one following the one before">{ui.drawingRest && anyFrameRunning ? 'Drawing the rest…' : anyFrameRunning ? 'Drawing…' : 'Draw the rest'}</button>
        : <button className="btn primary" disabled={anyFrameRunning} onClick={() => void attempt(lock)} title="Lock the frames and make a clip of each in the Video editor">Make clips</button>

  return (
    <div className="editor">
      <EditorBar back="Canvas" onBack={() => uiStore.update((u) => { u.stage = 'character' }, 'stage')} icon="storyboard"
        title={`Storyboard · ${nodeTitle(sb?.title, 'Storyboard', projectName)}`}
        meta={<><RatioPill ratio={ratio} onPick={(r) => void updateDoc(docStore, (d) => setRatio(d, r), `set the storyboard format to ${r}`)} /><span className="pt-project">{projectName}</span></>}
        primary={primary} />
      <div className="sb-sub">
        <span className="pt-mono sb-len">{shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {total.toFixed(1)} s of{' '}
          <select className="sb-target" aria-label="The ad's length" value={targetS} onChange={(e) => void updateDoc(docStore, (d) => setTarget(d, Number(e.target.value)), `set the storyboard length to ${e.target.value} s`)}>
            {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select> s</span>
        {shots.length > 0 && <span className={`pt-pill ${check.ok ? 'ok' : 'warn'}`} title={check.ok ? undefined : check.reason}>{check.ok ? 'Lengths fit the ad' : over > 0 ? `${over.toFixed(1)} s over` : `${(-over).toFixed(1)} s short`}</span>}
        {working.slice(0, 2).map((r) => <CrewLine key={r.job.id} row={r} />)}
        <span className="pt-grow" />
        {staleClips > 0 && <span className="pt-pill warn">{staleClips} {staleClips === 1 ? 'clip' : 'clips'} out of date</span>}
        {shots.length > 0 && <button className="btn" disabled={shots.length >= MAX_SHOTS} onClick={() => void attempt(() => updateDoc(docStore, (d) => { addShot(d) }, 'add shot'))}>+ Add shot</button>}
      </div>
      <ScopeLine nodeId={sb?.id} shotNumber={(id) => shotNumber(doc, id)} />
      <div className="panel sb-body pt-grid">
        {error && <div role="alert" className="sb-error">{error}</div>}
        {deleted && (
          <div role="status" className="sb-deleted">
            <span>{deleted}</span>
            {docStore.undo && <button className="btn xs" onClick={() => { setDeleted(null); void docStore.undo?.() }}>Undo</button>}
            <button className="btn xs ghost" onClick={() => setDeleted(null)}>OK</button>
          </div>
        )}
        {planJob && !shots.length && <div className="sb-planning"><JobSlot jobId={planJob} /></div>}
        {!shots.length && !planJob && (
          <div className="sb-empty pt-card">
            <div className="row" style={{ gap: 10 }}><AgentFigure agent="dex" size={28} decorative /><b>No shots yet</b><span className="pt-mono">{sayer('dex')}</span></div>
            {sb && <PromptStart kind="storyboard" nodeId={sb.id} place="editor" />}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" disabled={!clan || !script} onClick={() => openScript()}>Open script</button>
            </div>
          </div>
        )}
        <div className="sb-grid">
          {shots.map((s, i) => (
            <ShotCard key={s.id} shot={s} index={i} prev={shots[i - 1]} store={clan} mentions={mentionHooks}
              onOpen={() => setEditing(s.id)} onDraw={() => (i === 0 ? drawFirst() : drawNext(i))} onScript={() => openScript(s.id)}
              onDelete={() => deleteShot(s.id)}
              confirming={confirmShot === s.id} onConfirm={(yes) => {
                setConfirmShot(null)
                if (yes) void removeNow(s.id) // Undo puts it back
              }}
              ask={shotAsks.get(s.id)} onAsk={(a, option) => void answerAsk(a, s.id, option)} />
          ))}
          {shots.length > 0 && (
            <button className="sb-addtile" disabled={shots.length >= MAX_SHOTS} onClick={() => void attempt(() => updateDoc(docStore, (d) => { addShot(d) }, 'add shot'))}>+ Add a shot at the end</button>
          )}
        </div>
        {shots.length > 0 && <Thumbs compact target={{ kind: 'shot-list', jobId: lastPlan?.id, model: lastPlan?.director?.model, promptVersion: lastPlan?.director?.promptVersion, shots: shots.length }} />}
      </div>
    </div>
  )
}

/** The storyboard's ratio, as a pill that opens the three shapes. */
function RatioPill({ ratio, onPick }: { ratio: Ratio; onPick: (r: Ratio) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} type="button" className="pt-ratio sb-ratio" aria-haspopup="menu" aria-expanded={open} title="The storyboard's shape" onClick={() => setOpen(!open)}>{ratio}</button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} label="Storyboard shape" className="pt-menu">
        {RATIOS.map((r) => <button key={r} type="button" role="menuitem" className="pt-menurow" aria-checked={r === ratio} onClick={() => { setOpen(false); onPick(r) }}>{r}{r === ratio && <span className="hint">now</span>}</button>)}
      </Float>
    </>
  )
}

/** A crew status line in the sub bar: the loader, the figure, the line and a mono tag (PLANNING, RENDERING). */
function CrewLine({ row }: { row: TrayRow }) {
  const doc = useDoc()
  const shotId = row.ctx && 'shotId' in row.ctx ? row.ctx.shotId : undefined
  const who = whoIsWorking(row.job, row.state, row.ctx, shotNumber(doc, shotId) || undefined)
  const work = workOf(row.job.op, row.state)
  const tag = work === 'plan' ? 'PLANNING' : work === 'learn' ? 'CHECKING' : work === 'produce' ? 'EDITING' : 'RENDERING'
  return (
    <span className="sb-crewline" role="status">
      <AgentFigure agent={who.agent} state="working" size={20} decorative />
      <NapkinLoader work={work} size={20} />
      <span>{who.line}</span>
      <span className="sb-tag">{tag}</span>
    </span>
  )
}

const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
/** A card's title: the first words of its action, else its size. */
function titleOf(s: Shot): string {
  const words = (s.action ?? '').replace(/@\w+/g, '').replace(/\s+/g, ' ').trim().split(/[.;,:—-]/)[0].trim()
  return words ? cap(words.length > 26 ? `${words.slice(0, 25).replace(/\s+\S*$/, '')}…` : words) : cap(cameraLabel('size', s.camera.size))
}

/** The latest Change this frame on a shot, and what it proposed. */
function frameChangeOf(doc: ProductionDocument, ui: Pick<UiState, 'jobs'>, shotId: string): { job: DocJob; proposal?: Frame } | undefined {
  const jobs = jobsList(doc)
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]
    if (j.op !== 'frame_edit') continue
    const ctx = jobCtx(doc, ui, j.id)
    if (!ctx || ctx.dismissed || !('shotId' in ctx) || ctx.shotId !== shotId) continue
    return { job: j, proposal: proposalOf(doc, j.id) }
  }
  return undefined
}

function ShotCard({ shot, index, prev, store, mentions, onOpen, onDraw, onScript, onDelete, confirming, onConfirm, ask, onAsk }: {
  shot: Shot; index: number; prev?: Shot; store: ModelStore | null; mentions?: ReturnType<typeof scriptMentionHooks>
  onOpen: () => void; onDraw: () => void; onScript: () => void; onDelete: () => void
  confirming: boolean; onConfirm: (yes: boolean) => void
  ask?: Ask; onAsk: (a: Ask, option: 'keep' | 'remove') => void
}) {
  const doc = useDoc()
  const ui = useUi()
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const frames = framesOf(doc, shot.id)
  const current = currentFrame(doc, shot) ?? frames.at(-1)
  const idx = current ? frames.indexOf(current) : -1
  const url = useBlobUrl(current?.asset)
  const asset = current ? doc.assets[current.asset] : undefined
  const ratio = doc.storyboards[shot.storyboard_id]?.ratio ?? mainStoryboard(doc)?.ratio ?? '16:9'
  const aspect = asset?.w && asset?.h ? asset.w / asset.h : ratioAspect(ratio)
  const frameJob = jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === shot.id)
  const drawing = isRunning(doc, frameJob)
  const take = currentTake(doc, shot.id)
  const clipJob = jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === shot.id)
  const clipping = isRunning(doc, clipJob)
  const clipStale = take ? !!takeStale(doc, shot.id) : false
  const prevDrawn = !prev || !!currentFrame(doc, prev)
  const change = frameChangeOf(doc, ui, shot.id)
  const changeRunning = change ? isRunning(doc, change.job.id) : false
  const showChange = !!change && (changeRunning || (!!change.proposal && shot.pick?.current !== change.proposal.id && !shot.pick?.alternates?.includes(change.proposal.id)))
  const [changing, setChanging] = useState(false)
  const [words, setWords] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const [gap, setGap] = useState(false)
  const gapRef = useRef<HTMLButtonElement>(null)
  const project = useProjectName()
  const shown = current ? mediaItem(doc, project, current.asset, 'frame') : undefined
  const attempt = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  const send = (redoOf?: string) => attempt(async () => {
    await changeFrame({ relay, doc: docStore, ui: uiStore, runner }, shot.id, words, redoOf ? { redoOf } : {})
  })
  const chips = ([['size', shot.camera.size], ['angle', shot.camera.angle], ['movement', shot.camera.movement ?? 'static'], ['lens_mm', shot.camera.lens_mm]] as const)
    .filter(([, v]) => v !== undefined && v !== null).map(([field, v]) => ({ field, label: cap(cameraLabel(field, v)) }))
  const changed = change && !changeRunning ? cameraDiff(shot.camera, frameEditOf(change.job)?.camera) : undefined
  const changedFields = new Set(changed?.rows.map((r) => r.field) ?? [])
  const badge = clipping ? <span className="sb-badge warm"><NapkinLoader size={14} />Rendering clip</span>
    : take ? (clipStale ? <span className="sb-badge warn">Clip out of date · frame changed</span> : <span className="sb-badge ok">Clip ready</span>)
    : null
  if (confirming) {
    return (
      <article className="sb-card confirming" data-shot-card={shot.id}>
        <InlineConfirm text={shotDeleteText(index + 1, frames.length, takesOf(doc, shot.id).length)} yes="Delete shot" onNo={() => onConfirm(false)} onYes={() => onConfirm(true)} />
      </article>
    )
  }
  return (
    <article className={`sb-card ${showChange || changing ? 'on' : ''}`} data-shot-card={shot.id} aria-label={`Shot ${index + 1}`} tabIndex={0}
      onKeyDown={(e) => {
        // Delete or Backspace on the focused card (not in its fields) deletes the shot.
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === e.currentTarget) {
          e.preventDefault()
          onDelete()
        }
      }}>
      {index > 0 && (
        <>
          <button ref={gapRef} type="button" className="sb-gap" aria-label={`Insert between ${index} and ${index + 1}`} aria-haspopup="menu" aria-expanded={gap} onClick={() => setGap(!gap)}>+</button>
          <Float anchor={gapRef} open={gap} onClose={() => setGap(false)} label={`Insert between ${index} and ${index + 1}`} className="pt-menu sb-insert">
            <div className="pt-label sb-inserthead">Insert between {index} and {index + 1}</div>
            <button type="button" role="menuitem" className="pt-menurow" disabled={!store || !prev} onClick={() => { setGap(false); if (store && prev) void attempt(() => insertShot(store, { afterShotId: prev.id })) }}>
              <span className="sb-ins-blank" aria-hidden="true" /><span><b>Empty shot</b><br /><span className="faint">A blank card you fill in</span></span>
            </button>
            <button type="button" role="menuitem" className="pt-menurow" disabled title="Not in this version yet">
              <AgentFigure agent="dex" size={22} decorative /><span><b>Bridge</b><br /><span className="faint">Dex draws a shot that links {index} and {index + 1} · not in this version yet</span></span>
            </button>
          </Float>
        </>
      )}
      <header className="sb-cardhead">
        <span className="sb-handle" aria-hidden="true">⋮⋮</span>
        <span className="sb-num">{index + 1}</span>
        <b className="sb-title">{titleOf(shot)}</b>
        <span className="pt-mono sb-dur">{shot.duration_s.toFixed(1)} s</span>
        <button type="button" className="sb-del" aria-label={`Delete shot ${index + 1}`} title="Delete this shot (Delete)" onClick={onDelete}>×</button>
        <button ref={menuRef} type="button" className="sb-more" aria-label={`More for shot ${index + 1}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
        <Float anchor={menuRef} open={menu} onClose={() => setMenu(false)} align="end" label={`Shot ${index + 1}`} className="pt-menu">
          <button type="button" role="menuitem" className="pt-menurow" disabled={!current} onClick={() => { setMenu(false); setChanging(true) }}>Change this frame</button>
          <button type="button" role="menuitem" className="pt-menurow" disabled={!current} onClick={() => { setMenu(false); onOpen() }}>Open in image editor</button>
          <button type="button" role="menuitem" className="pt-menurow" onClick={() => { setMenu(false); onScript() }}>Open in script</button>
          <label className="pt-menurow">Length
            <input className="input" type="number" min={1} max={10} step={0.5} aria-label="Seconds" value={shot.duration_s} style={{ width: 70, marginLeft: 'auto' }}
              onChange={(e) => void updateDoc(docStore, (d) => editShot(d, shot.id, { duration_s: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }), 'edit shot')} /> s
          </label>
          {shown && <DownloadButton items={[shown]} className="pt-menurow" title={`Download v${idx + 1}`} />}
          <div className="pt-menusep" />
          <button type="button" role="menuitem" className="pt-menurow" onClick={() => { setMenu(false); onDelete() }}>Delete shot</button>
        </Float>
      </header>
      <div className="sb-frame" style={{ aspectRatio: String(aspect) }}>
        {url && !drawing && <img src={url} alt={`Frame ${index + 1}`} />}
        {frameJob && drawing && <div className="sb-framejob"><JobSlot jobId={frameJob} compact /></div>}
        {!current && !drawing && (
          <div className="sb-noframe">
            {prevDrawn
              ? <><span>No frame yet</span><button className="btn xs" onClick={onDraw} disabled={!refsList(doc).length || !!frameJob}>{index === 0 ? 'Draw frame 1' : 'Draw this one'}</button></>
              : <span>Draw shot {index} first</span>}
          </div>
        )}
        {current && <span className="sb-vtag">v{idx + 1}</span>}
        {badge && <span className="sb-badgewrap">{badge}</span>}
        {current && !drawing && <button type="button" className="sb-openie" onClick={onOpen}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>Open in image editor</button>}
        {current?.cropped_to && asset?.w && asset?.h && <span className="sb-crop">{croppedCaption({ w: asset.w, h: asset.h }, current.cropped_to.to)}</span>}
      </div>
      <div className="sb-chips">{chips.map((c) => <span key={c.field} className={`sb-chip ${changedFields.has(c.field) ? 'changing' : ''}`}>{c.label}</span>)}</div>
      <div className="sb-words">
        {store ? <ShotEditor store={store} shotId={shot.id} name={`Shot ${index + 1}`} compact mentions={mentions} keys={{ remove: (how) => (how === 'command' ? (onDelete(), true) : false) }} /> : <div className="script-excerpt">{shot.action ?? ''}</div>}
      </div>
      <OldWords shot={shot} index={index} />
      {ask && (
        <div className="shotask" role="group" aria-label={`Shot ${index + 1}: keep or remove`}>
          <AgentFigure agent="dex" size={22} state="needs-you" decorative />
          <span><b>Shot {index + 1} no longer has a scene.</b> Keep it or remove it?</span>
          <span className="spacer" />
          <button className="btn xs" onClick={() => onAsk(ask, 'keep')}>Keep</button>
          <button className="btn xs ghost" onClick={() => onAsk(ask, 'remove')}>Remove</button>
        </div>
      )}
      {(changing || showChange) && (
        <div className="sb-change">
          <b>Change this frame</b>
          <div className="row">
            <input className="input" aria-label="What to change in this frame" placeholder="Make this an overhead aerial shot" value={words} maxLength={1000}
              onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && words.trim() && !changeRunning) void send(showChange ? change?.job.id : undefined) }} />
            <button className="btn sm" disabled={!words.trim() || changeRunning} onClick={() => void send(showChange ? change?.job.id : undefined)}>{showChange ? 'Redo' : 'Send'}</button>
          </div>
          {change && changeRunning && <div className="sb-changejob"><JobSlot jobId={change.job.id} compact /></div>}
          {change && !changeRunning && change.proposal && showChange && (
            <div className="sb-result">
              <div className="row"><AgentFigure agent="dex" size={20} decorative /><span>{frameEditLines(change.job)[0]}</span></div>
              {frameEditLines(change.job).slice(1).map((l) => <span key={l} className="faint">{l}</span>)}
              <div className="sb-diff">
                <ProposalThumb sha={change.proposal.asset} version={change.proposal.version} />
                <div>
                  {changed?.rows.map((r) => <div key={r.field} className="sb-diffrow"><span>{r.field.replace('_mm', '')}</span><del>{r.from}</del>→<ins>{r.to}</ins></div>)}
                  {changed?.stay && <div className="faint">{changed.stay}</div>}
                </div>
              </div>
              <div className="row">
                <button className="btn sm primary" onClick={() => void attempt(() => applyFrameEditStep(docStore, change.job.id, shot.id))}>{frameEditCopy.apply}</button>
                <button className="btn sm" onClick={() => void attempt(() => keepBothStep(docStore, change.job.id, shot.id))}>{frameEditCopy.keepBoth}</button>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => void attempt(() => discardStep(docStore, change.job.id))}>{frameEditCopy.discard}</button>
              </div>
              {applyClipLine(doc, shot.id) && <div className="pt-pill warn sb-applyline">{applyClipLine(doc, shot.id)}</div>}
            </div>
          )}
          {!showChange && <button className="btn xs ghost" onClick={() => setChanging(false)}>Close</button>}
        </div>
      )}
      {error && <div role="alert" className="framecard-error">{error}</div>}
    </article>
  )
}

function ProposalThumb({ sha, version }: { sha: string; version: number }) {
  const url = useBlobUrl(sha)
  return <span className="sb-proposal">{url && <img src={url} alt="" />}<span>{frameEditCopy.newVersion(version)}</span></span>
}

/** Under a shot whose own frame or clip still uses what the shot said before an edit: "Frame 3 uses the
 *  old words · Redraw frame 3" (features/one-to-one-updates.clan). Nothing while it is being made again. */
function OldWords({ shot, index }: { shot: Shot; index: number }) {
  const doc = useDoc()
  const ui = useUi()
  const update = useUpdate()
  const [error, setError] = useState<string | null>(null)
  const making = (kind: 'frame' | 'clip') => isRunning(doc, jobAt(doc, ui, (c) => c.for === kind && c.shotId === shot.id))
  const own = (m: ReturnType<typeof frameStale>) => (m?.caused_by.kind === 'shot' && m.caused_by.id === shot.id ? m : undefined)
  const frame = making('frame') ? undefined : own(frameStale(doc, shot.id))
  const clip = making('clip') ? undefined : own(takeStale(doc, shot.id))
  if (!frame && !clip) return null
  const go = async (kind: 'frame' | 'clip') => {
    setError(null)
    try {
      await update.start({ kind: 'one', item: { kind, shotId: shot.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  return (
    <div className="oldwords">
      {frame && (
        <span>{oldWordsLine('frame', index + 1, frame)} · <button className="linkbtn" disabled={update.running} onClick={() => void go('frame')}>Redraw frame {index + 1}</button></span>
      )}
      {clip && (
        <span>{oldWordsLine('take', index + 1, clip)} · <button className="linkbtn" disabled={update.running} onClick={() => void go('clip')}>Remake clip {index + 1}</button></span>
      )}
      {error && <span role="alert" className="framecard-error">{error}</span>}
    </div>
  )
}




