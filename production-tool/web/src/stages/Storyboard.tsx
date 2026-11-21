// Stage 2: script → shot list → one frame per shot, drawn in order: frame 1
// from the shot's named refs (@maya_front, @lamp_on), then each next frame from its refs, frame 1
// (setting, light, style) and the frame before it (jobs/frames.ts). Each frame
// can be changed with a sentence, optionally inside a box (or a painted mask,
// or a click when the provider can segment), and stepped back to an earlier version.
//
// Contract 3: the script's words are the main script's scenes; the shots are the main storyboard's,
// in rank order; the ratio and the target length are the storyboard's; the frame in a shot is its pick.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useConfig, useDoc, useJobsTick, useRouter, useServices, useUi } from '../app/context'
import type { Ask, ProductionDocument, Ratio, Shot } from '../contracts/types'
import { isRunning, jobAt, ratioAspect } from '../jobs/select'
import { croppedCaption } from '../canvas/core/sketch'
import { drawFrame, drawTheRest, firstUndrawn, needsFrame } from '../jobs/frames'
import { endCardOf } from '../rooms/timeline'
import { planOrJoin, askedShot } from '../jobs/plan'
import { checkDurations, MAX_SHOTS } from '../lib/shots'
import { lengthChoices } from '../script/length'
import { useBlobUrl } from '../ui/hooks'
import { JobSlot } from '../ui/JobSlot'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeShot, shotDeleteText, shotNeedsConfirm } from '../doc/remove'
import { InlineConfirm } from '../ui/Undo'
import { oldWordsLine } from '../ui/behind'
import { clipBehind, frameStale } from '../jobs/stale'
import { useUpdate } from '../ui/useUpdate'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer, whoIsWorking, workOf } from '../ui/agents/cast'
import { Thumbs } from '../dogfood/Dogfood'
import { errorShown } from '../dogfood/recorder'
import { useProjectName } from '../ui/useDownload'
import { ShotBooth } from './ShotBooth'
import { cameraChips, frameChangeOf, recastAsk } from './shotChange'
import { DecisionsDrawer, type HistoryFocus } from '../ui/History'
import { AskCard } from '../ui/AskCard'
import { plainJobError } from '../jobs/errorWords'
import { agentNotes, storyboardAddresses } from '../ui/booth/notes'
import { useChain } from '../ui/booth/hooks'
import { currentFrame, currentTake, framesOf, jobsList, mainStoryboard, openAsks, openStoryboard, refsList, scriptOfStoryboard, scriptText, shotNumber, shotsOf, storyboardSeconds, takesOf } from '../model/selectors'
import { canvasActions } from '../canvas/chrome/actions'
import { marksNow } from './marksNow'
import { titleOf } from './shotTitle'
import { jobCtx, LOCAL_PERSON } from '../jobs/runner'
import { addShot, answerShotAsk, clipsBehindLine, setRatio, setTarget } from './storyboardEdits'
import { frameRoute, scriptRoute } from '../app/route'
import { insertShot } from '../script/edits'
import { EditorBar } from '../ui/chrome/TopBars'
import { nodeTitle } from '../ui/chrome/panels'
import { Float } from '../ui/Float'
import { trayGroups, type TrayRow } from '../ui/tray'
import { cameraDiff, frameEditOf } from '../jobs/frameEdit'
import { askOf } from '../jobs/runner'
import { placeAsk } from '../ui/askPlaces'
import { ImageEditor } from './ImageEditor'
import { ScopeLine } from './InputsStrip'
import './storyboard.css'
import { PromptStart } from '../ui/prompt/PromptStart'
import { moveOnStoryboard, useShotSort } from './shotDrag'
import { ShotSort } from './ShotSort'
import { lastWorkedModel, startFollow } from '../jobs/follow'
import { SendDisclosure } from '../ui/SendDisclosure'
import { makeClipsRows, sendRows } from '../ui/sendRows'
import { joinHere, missedGuide, splitHere, videoJoin, videoModel, videoPlan, videoShots, videoUnits, type FrameMark } from '../jobs/runView'
import { canJoin } from '../jobs/runs'
import { videoOfStoryboard } from '../model/selectors'
import { FrontButtons } from './FrontsNeeded'
import { keepCharacter, keptFromFirst, suggestKey } from '../jobs/cast'

const RATIOS: Ratio[] = ['9:16', '1:1', '16:9']

/** With no named picture, frame 1 comes from the words and every frame after follows it (anchorFrame). */
const NO_PICTURES = 'No pictures yet, so frame 1 is drawn from the words and every frame after follows it. Name a picture on the canvas, like @samurai, to set how someone looks.'

export function Storyboard() {
  const { doc: docStore, ui: uiStore, runner, relay, clan, project } = useServices()
  const router = useRouter()
  const doc = useDoc()
  const ui = useUi()
  const { controls, config } = useConfig()
  useJobsTick()
  const [error, setError] = useState<string | null>(null)
  const [confirmShot, setConfirmShot] = useState<string | null>(null)
  /** "Deleted shot 3." or "Shot 5 is now shot 3." with Undo, after a delete or a move (ui-behaviour 3.3 Delete, 3.11). */
  const [deleted, setDeleted] = useState<string | null>(null)
  /** The shot whose frame is open in the Image editor (ui-behaviour 3.12): in the URL (?frame=), so a reload
   *  reopens it (re-test 8d). */
  const route = useSyncExternalStore(router.subscribe, router.get)
  const editing = route.kind === 'project' && route.projectId === project.id && route.stage === 'storyboard' ? route.frame ?? null : null
  const setEditing = (shotId: string | null) => router.replace(frameRoute(project.id, shotId))
  /** The shot open in the Booth (the Booth rule: no shot selected, no Booth). */
  const [selected, setSelected] = useState<string | null>(null)
  /** Decisions narrowed to one shot (its Booth's History row). */
  const [why, setWhy] = useState<HistoryFocus | null>(null)
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
  // Connected video (features/connected-video.clan): the pin or "guide" on each frame, and the join a gap can
  // take, as the video this storyboard renders would make them. Nothing when the flag is off.
  const linked = videoOfStoryboard(doc, sb?.id)
  const film = videoJoin(doc, linked?.id, config) === 'film'
  const vModel = film ? videoModel(doc, linked?.id, config, lastWorkedModel(doc, 'clip', config)) : null
  const vPlan = vModel ? videoPlan(doc, linked?.id, vModel) : undefined
  const marks = vPlan ? marksNow(doc, linked?.id, vPlan) : {}
  // The same strips as the Film timeline, as a light bracket under the cards that will be one video.
  const units = vPlan && linked ? videoUnits(doc, ui, linked.id, vPlan) : []
  const facts = vPlan && linked ? videoShots(doc, linked.id) : []
  const stripPlace = (i: number): StripPlace | undefined => {
    const u = units.find((x) => x.kind === 'strip' && x.shotIds.includes(shots[i]?.id))
    if (!u || u.kind !== 'strip') return undefined
    const k = u.shotIds.indexOf(shots[i].id)
    return k === 0 ? 'first' : k === u.shotIds.length - 1 ? 'last' : 'mid'
  }
  // The handle before card i: ✂ inside a strip, 🔗 where two neighbours may be one video.
  const handleAt = (i: number): 'split' | 'join' | undefined => {
    if (!vPlan || i <= 0) return undefined
    const here = stripPlace(i)
    if (here === 'mid' || here === 'last') return 'split'
    return facts[i - 1] && facts[i] && canJoin(facts[i - 1], facts[i]) ? 'join' : undefined
  }
  const mainSb = mainStoryboard(doc)?.id
  const planJob = jobAt(doc, ui, (c) => c.for === 'shot_list' && (c.storyboardId ?? mainSb) === sb?.id)
  const planning = isRunning(doc, planJob)
  const lastPlan = jobsList(doc).filter((j) => j.op === 'shot_list' && j.state === 'completed').at(-1)
  useEffect(() => { if (error) errorShown('storyboard', error) }, [error])
  // Esc puts the shot down (the Booth goes with it), unless the person is typing in it.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], .pt-menu, [role="dialog"]')) return
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])
  const allFramed = shots.length > 0 && shots.every((s) => !needsFrame(s) || !!currentFrame(doc, s))
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
  // Drag reorder (ui-behaviour 3.11): one rank write with the drift marks, one undo step.
  const moveShot = (shotId: string, place: { beforeId: string | null; afterId: string | null }) => attempt(async () => {
    if (!clan) return
    const was = shotNumber(clan.get(), shotId)
    setDeleted(null)
    await moveOnStoryboard(clan, shotId, place)
    setDeleted(`Shot ${was} is now shot ${shotNumber(clan.get(), shotId)}.`)
  })
  const drawFirst = () => attempt(() => drawFrame(deps, 0, 'first', { storyboardId: sb?.id }))
  const drawNext = (index: number) => attempt(() => drawFrame(deps, index, 'next', { storyboardId: sb?.id }))
  const drawRest = () => attempt(() => drawTheRest(deps))


  const lock = async () => {
    await updateDoc(docStore, (d) => {
      for (const s of shotsOf(d, sb?.id)) d.shots[s.id].status = 'locked'
    }, 'lock storyboard')
    // A blank canvas has no Film node (owner 2026-11-03), so Make clips on a storyboard with none makes
    // one first, the canvas's own Make film (one undo step, the renders link), and opens it. Before,
    // it opened the Film editor on "No film here yet." with no way back (full test, 2026-11-04).
    let videoId = videoOfStoryboard(docStore.get(), sb?.id)?.id
    if (!videoId && sb) {
      const script = scriptOfStoryboard(docStore.get(), sb.id)
      const made = canvasActions.makeVideo({ storyboardId: sb.id, ...(script ? { scriptId: script.id } : {}) })
      if (!made) throw new Error('Make the video from the canvas: select this storyboard there and choose Make film.')
      videoId = (await made).videoId
    }
    uiStore.update((u) => {
      if (videoId) u.openNode = { ...u.openNode, video: videoId }
      u.stage = 'video'
    })
  }

  if (!controls.storyboard) {
    return <div className="panel"><div className="empty-state"><b>Storyboards are off right now.</b></div></div>
  }
  if (editing && shots.some((s) => s.id === editing)) {
    return <ImageEditor target={{ kind: 'shot', shotId: editing }} onBack={() => setEditing(null)} onTarget={(t) => setEditing(t.kind === 'shot' ? t.shotId : null)} />
  }

  const selShot = shots.find((s) => s.id === selected)
  const docId = (() => { try { return clan?.documentId() ?? '' } catch { return '' } })()
  const total = storyboardSeconds(doc, sb?.id)
  const over = Math.round((total - targetS) * 10) / 10
  const working = trayGroups(jobsList(doc), (id) => jobCtx(doc, ui, id), (id) => runner.liveInfo(id)).working
  const next = !shots.length
    ? <button className="btn primary" disabled={planning || !words.trim()} onClick={() => void attempt(plan)} title={words.trim() ? undefined : 'Write the script first'}>{planning ? 'Planning…' : 'Plan shots'}</button>
    : noFrames
      ? <button className="btn primary" disabled={!check.ok || anyFrameRunning} onClick={drawFirst} title={hasRefs ? 'Frame 1 sets the place, the light and the style for every frame after it' : NO_PICTURES}>{anyFrameRunning ? 'Drawing…' : 'Draw frame 1'}</button>
      : !allFramed
        ? <button className="btn primary" disabled={!check.ok || anyFrameRunning || firstUndrawn(doc, sb?.id) < 0} onClick={drawRest} title="Draw each remaining shot in turn, each one following the one before">{ui.drawingRest && anyFrameRunning ? 'Drawing the rest…' : anyFrameRunning ? 'Drawing…' : 'Draw the rest'}</button>
        : <button className="btn primary" disabled={anyFrameRunning} onClick={() => void attempt(lock)} title="Lock the frames and make a clip of each in the Film editor">Make clips</button>
  // The next step's "What the X agent will send" (features/production-new-ui.clan): what goes, the brief, no price.
  const named = refsList(doc).length
  const sending = !shots.length
    ? { who: 'the Director agent', action: 'Plan shots', op: 'shot_list' as const, what: [{ key: 'script', label: 'The script’s words', detail: `${words.trim().split(/\s+/).filter(Boolean).length} words` }, { key: 'fit', label: `${targetS} s at ${ratio}`, detail: 'the length and shape to plan to' }] }
    : noFrames || !allFramed
      ? { who: 'the Camera agent', action: noFrames ? 'Draw frame 1' : 'Draw the rest', op: 'frame' as const, what: [{ key: 'shots', label: noFrames ? 'Shot 1’s words and camera' : 'Each undrawn shot’s words and camera, one at a time' }, { key: 'refs', label: `${named} named ${named === 1 ? 'picture' : 'pictures'}`, detail: noFrames ? 'frame 1 sets the look for the rest' : 'and the frame before each one' }] }
      : { who: 'the Camera agent', action: 'Make clips', op: 'clip' as const, ...makeClipsRows(shots.filter(needsFrame).length, shots.filter((s) => !needsFrame(s)).length, named) }
  const primary = <SendDisclosure primary={next} who={sending.who} rows={sendRows(doc, sb?.id, sending.what, sending.action, sending.op, 'promise' in sending ? sending.promise : undefined)} />

  return (
    <div className="editor">
      <EditorBar back="Canvas" onBack={() => uiStore.update((u) => { u.stage = 'character' }, 'stage')} icon="storyboard"
        undo
        title="Storyboard"
        holdEscape={!!selected}
        // The band (mock production-new-ui-v2 sbBand): length, fit, shape and who is at work on the left; how to
        // reorder, undo and + Add shot on the right.
        meta={<>
          <span className="pt-mono sb-len">{shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {total.toFixed(1)} s of{' '}
            <select className="sb-target" aria-label="The ad's length" value={targetS} onChange={(e) => void updateDoc(docStore, (d) => setTarget(d, Number(e.target.value)), `set the storyboard length to ${e.target.value} s`)}>
              {lengthChoices(targetS).map((t) => <option key={t} value={t}>{t}</option>)}
            </select> s</span>
          {shots.length > 0 && <span className={`pt-pill sb-fit ${check.ok ? 'ok' : 'warn'}`} title={check.ok ? undefined : check.reason}>{check.ok ? 'Lengths fit the ad' : over > 0 ? `${over.toFixed(1)} s over` : `${(-over).toFixed(1)} s short`}</span>}
          <RatioPill ratio={ratio} onPick={(r) => void updateDoc(docStore, (d) => setRatio(d, r), `set the storyboard format to ${r}`)} />
          {working.slice(0, 2).map((r) => <CrewLine key={r.job.id} row={r} />)}
        </>}
        right={<>
          {shots.length > 1 && <span className="hint sb-reorder">Drag ⋮⋮ to reorder, or Space and the arrows</span>}
          {shots.length > 0 && <button className="sp-btn" disabled={shots.length >= MAX_SHOTS} onClick={() => void attempt(() => updateDoc(docStore, (d) => { addShot(d) }, 'add shot'))}>+ Add shot</button>}
        </>}
        primary={primary} />
      <div className="booth-row">
      <div className="panel sb-body sb-desk">
      <article className="sb-sheet" aria-label="Storyboard">
        <span className="stab">{(projectName ?? 'Untitled').split(' · ').at(-1)} · storyboard</span>
        <div className="sh-head">
          <div><small>Storyboard · {ratio} · {targetS} seconds</small><h1>{nodeTitle(sb?.title, 'Storyboard', projectName)}</h1></div>
          <div className="r">{shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {total.toFixed(1)} s
            <div className="sb-inputs"><ScopeLine nodeId={sb?.id} shotNumber={(id) => shotNumber(doc, id)} /></div></div>
        </div>
        <SheetNote storyboardId={sb?.id} />
        {error && <div role="alert" className="sb-error">{error}<FrontButtons text={error} /></div>}
        {deleted && (
          <div role="status" className="sb-deleted">
            <span>{deleted}</span>
            {docStore.undo && <button className="btn xs" onClick={() => { setDeleted(null); void docStore.undo?.() }}>Undo</button>}
            <button className="btn xs ghost" onClick={() => setDeleted(null)}>OK</button>
          </div>
        )}
        {/* A plan that asks shows its question once, in the sheet's note above (UAT round 5 S3-3: it showed there and
            again here, clipped by this box's height). */}
        {planJob && !shots.length && !(doc.jobs[planJob]?.state === 'needs_input' && askOf(doc, planJob)?.state === 'open') && <div className="sb-planning"><JobSlot jobId={planJob} /></div>}
        {!shots.length && !planJob && (
          <div className="sb-empty pt-card">
            <div className="row" style={{ gap: 10 }}><AgentFigure agent="dex" size={28} decorative /><b>No shots yet</b><span className="pt-mono">{sayer('dex')}</span></div>
            {sb && <PromptStart kind="storyboard" nodeId={sb.id} place="editor" />}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" disabled={!clan || !script} onClick={() => openScript()}>Open script</button>
            </div>
          </div>
        )}
        <ShotSort ids={shots.map((s) => s.id)} doc={doc} onMove={(id, place) => void moveShot(id, place)}
          overlay={(id) => { const i = shots.findIndex((s) => s.id === id); return i < 0 ? null : <LiftedCard shot={shots[i]} index={i} /> }}
          note={(w) => w && (
            <div className="sb-dragnote" role="status">
              <AgentFigure agent="dex" size={24} decorative />
              <span><span className="pt-mono">{sayer('dex')}</span> {w}</span>
            </div>
          )}>
        <div className="sb-grid">
          {shots.map((s, i) => (
            <ShotCard key={s.id} shot={s} index={i} prev={shots[i - 1]} selected={selected === s.id} onSelect={() => setSelected(s.id)}
              onOpen={() => setEditing(s.id)} onDraw={() => (i === 0 ? drawFirst() : drawNext(i))}
              onDelete={() => deleteShot(s.id)}
              confirming={confirmShot === s.id} onConfirm={(yes) => {
                setConfirmShot(null)
                if (yes) void removeNow(s.id) // Undo puts it back
              }}
              ask={shotAsks.get(s.id)} onAsk={(a, option) => void answerAsk(a, s.id, option)}
              mark={marks[s.id]} film={film && linked ? { videoId: linked.id, strip: stripPlace(i), handle: handleAt(i) } : undefined} />
          ))}
          {shots.length > 0 && (
            <button className="sb-addtile" disabled={shots.length >= MAX_SHOTS} onClick={() => void attempt(() => updateDoc(docStore, (d) => { addShot(d) }, 'add shot'))}>+ Add a shot at the end</button>
          )}
        </div>
        </ShotSort>
        {shots.length > 0 && <Thumbs compact target={{ kind: 'shot-list', jobId: lastPlan?.id, model: lastPlan?.director?.model, promptVersion: lastPlan?.director?.promptVersion, shots: shots.length }} />}
      </article>
      </div>
      {/* The Booth on a selected shot only (the Booth rule): Change this frame, camera, words, versions. */}
      {selShot && <ShotBooth shot={selShot} index={shots.indexOf(selShot)} storyboardId={sb?.id} store={clan} onClose={() => setSelected(null)}
        onOpen={() => setEditing(selShot.id)} onScript={() => openScript(selShot.id)} onDelete={() => deleteShot(selShot.id)}
        onHistory={() => setWhy({ label: `Shot ${shots.indexOf(selShot) + 1}`, addresses: shotAddresses(doc, docId, selShot.id) })} />}
      {why && <DecisionsDrawer key={why.addresses.join()} store={clan} focus={why} onClose={() => setWhy(null)} />}
      </div>
    </div>
  )
}

/** A shot's addresses in the decision chain: the shot, its frames and the jobs that made them (History · the shot). */
function shotAddresses(doc: ProductionDocument, docId: string, shotId: string): string[] {
  const frames = Object.values(doc.frames).filter((f) => f.shot_id === shotId)
  return [`${docId}#shots[${shotId}]`, ...frames.flatMap((f) => [`${docId}#frames[${f.id}]`, ...(f.job_id ? [`${docId}#jobs[${f.job_id}]`] : [])])]
}

/** The line on the sheet (mock "storyboard": notes and out of date sit on the sheet, not in a Booth): the Director
 *  agent's latest note on these shots; a plan that asks or stopped; which clips are out of date because their
 *  frames changed after them, and Update N clips (jobs/follow.ts, scope direct). Frame asks and failures sit on
 *  their shot's cell. */
function SheetNote({ storyboardId }: { storyboardId?: string }) {
  const doc = useDoc()
  const ui = useUi()
  const services = useServices()
  const { config } = useConfig()
  const chain = useChain(services.clan)
  const [error, setError] = useState<string | null>(null)
  const shots = shotsOf(doc, storyboardId)
  const withTakes = shots.filter((s) => !!currentTake(doc, s.id))
  const behind = shots.map((s, i) => ({ n: i + 1, b: !!clipBehind(doc, s.id) })).filter((x) => x.b).map((x) => x.n)
  const docId = (() => { try { return services.clan?.documentId() ?? '' } catch { return '' } })()
  const note = agentNotes(chain, 'dex', storyboardAddresses(doc, docId, storyboardId), doc, 1)[0]
  const mainSb = mainStoryboard(doc)?.id
  const planJob = jobAt(doc, ui, (c) => c.for === 'shot_list' && (c.storyboardId ?? mainSb) === storyboardId)
  const plan = planJob ? doc.jobs[planJob] : undefined
  const planAsk = plan?.state === 'needs_input' ? askOf(doc, plan.id) : undefined
  const planFailed = plan?.state === 'failed' && !ui.jobs[plan.id]?.dismissed ? plan : undefined
  if (!withTakes.length && !note && !planAsk && !planFailed) return null
  return (
    <div className="sheet-note" role="status">
      {note && <span className="wl"><AgentFigure agent="dex" size={20} decorative /><span><b>{sayer('dex')}:</b> {note.body}</span></span>}
      {planFailed && <span className="warn">The plan did not work{planFailed.error ? `: ${plainJobError(planFailed.error, planFailed.op).message}` : '.'}
        <button type="button" className="sp-btn" onClick={() => services.ui.update((u) => { u.jobs[planFailed.id] = { ...u.jobs[planFailed.id], dismissed: true } })}>Clear</button></span>}
      {withTakes.length > 0 && (behind.length
        ? <><span className="warn">{clipsBehindLine(behind)}</span>
          <button type="button" className="sp-btn" onClick={() => { setError(null); void startFollow(services, config, { scope: { kind: 'direct' } }).catch((e) => setError(e instanceof Error ? e.message : 'That did not start.')) }}>
            Update {behind.length} {behind.length === 1 ? 'clip' : 'clips'}</button></>
        : <span className="ok">{clipsBehindLine([])}</span>)}
      {planAsk?.state === 'open' && <div className="sheet-ask"><AskCard ask={planAsk} /></div>}
      {error && <span className="warn" role="alert">{error}</span>}
    </div>
  )
}

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

/** A crew status line in the sub bar: the figure at work, the line and a mono tag (PLANNING, RENDERING). */
function CrewLine({ row }: { row: TrayRow }) {
  const doc = useDoc()
  const shotId = row.ctx && 'shotId' in row.ctx ? row.ctx.shotId : undefined
  const who = whoIsWorking(row.job, row.state, row.ctx, shotNumber(doc, shotId) || undefined)
  const work = workOf(row.job.op, row.state)
  const tag = work === 'plan' ? 'PLANNING' : work === 'learn' ? 'CHECKING' : work === 'produce' ? 'EDITING' : 'RENDERING'
  return (
    <span className="sb-crewline" role="status">
      <AgentFigure agent={who.agent} state="working" size={20} decorative />
      <span>{who.line}</span>
      <span className="sb-tag">{tag}</span>
    </span>
  )
}

/** The card under the pointer while it is dragged (3.11): tilted, blue outline, shadow. */
function LiftedCard({ shot, index }: { shot: Shot; index: number }) {
  const doc = useDoc()
  const current = currentFrame(doc, shot) ?? framesOf(doc, shot.id).at(-1)
  const url = useBlobUrl(current?.asset)
  const asset = current ? doc.assets[current.asset] : undefined
  const ratio = doc.storyboards[shot.storyboard_id]?.ratio ?? '16:9'
  const aspect = asset?.w && asset?.h ? asset.w / asset.h : ratioAspect(ratio)
  return (
    <div className="sb-card sb-lifted" aria-hidden="true">
      <header className="sb-cardhead">
        <span className="sb-handle">⋮⋮</span>
        <span className="sb-num">{index + 1}</span>
        <b className="sb-title">{titleOf(shot)}</b>
        <span className="pt-mono sb-dur">{shot.duration_s.toFixed(1)} s</span>
      </header>
      <div className="sb-frame" style={{ aspectRatio: String(aspect) }}>
        {url ? <img src={url} alt="" /> : <div className="sb-noframe"><span>No frame yet</span></div>}
      </div>
      {shot.action && <div className="sb-liftwords">{shot.action}</div>}
    </div>
  )
}

/** After frame 1 lands (UAT round 2 UX 4): keep its person as a named character, so every later frame sends them by
 *  name and they stay themselves. Once kept, the card says who. */
function KeepPerson({ asset, storyboardId, action }: { asset: string; storyboardId?: string; action?: string }) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => suggestKey(action))
  const [error, setError] = useState<string | null>(null)
  const kept = keptFromFirst(doc, storyboardId)
  if (kept) return <p className="sb-kept faint">Later frames keep <b>@{kept.key}</b> from this frame.</p>
  if (!open) return <button type="button" className="linkbtn sb-keep" onClick={() => setOpen(true)}>Keep a person from this frame…</button>
  const save = () => void keepCharacter(store, asset, name).then(() => setOpen(false), (e) => setError(e instanceof Error ? e.message : 'That name did not take.'))
  return (
    <div className="sb-keepform row" role="group" aria-label="Keep a person from this frame">
      <span className="faint">Keep</span>
      <input className="input" aria-label="Their name" placeholder="mia" value={name} autoFocus
        onChange={(e) => { setName(e.target.value); setError(null) }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false) }} />
      <span className="faint">as a character</span>
      <button type="button" className="btn xs primary" disabled={!name.trim()} onClick={save}>Keep</button>
      <button type="button" className="btn xs ghost" onClick={() => setOpen(false)}>Cancel</button>
      {/* UAT round 4 S3-7: the whole frame is kept, the street and bench with the person. Said, before it is kept. */}
      <span className="faint sb-keepnote" role="note">This keeps the whole frame as their picture, the place too. To keep only the person, crop the frame to them first (Edit).</span>
      {error && <span role="alert" className="tray-error">{error}</span>}
    </div>
  )
}

function ShotCard({ shot, index, prev, selected, onSelect, onOpen, onDraw, onDelete, confirming, onConfirm, ask, onAsk, mark, film }: {
  shot: Shot; index: number; prev?: Shot
  /** The shot open in the Booth (mock "frame": the cell tinted, a rule on its left). */
  selected: boolean; onSelect: () => void
  onOpen: () => void; onDraw: () => void; onDelete: () => void
  confirming: boolean; onConfirm: (yes: boolean) => void
  ask?: Ask; onAsk: (a: Ask, option: 'keep' | 'remove') => void
  /** Connected video: the frame's pin or guide, and the video whose joins the gap sets. */
  mark?: FrameMark; film?: { videoId: string; strip?: StripPlace; handle?: 'split' | 'join' }
}) {
  const doc = useDoc()
  const ui = useUi()
  const { doc: docStore, ui: uiStore, clan: store } = useServices()
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, lifted, line, dragging, moving } = useShotSort(shot.id, !store || confirming)
  const frames = framesOf(doc, shot.id)
  const current = currentFrame(doc, shot) ?? frames.at(-1)
  const idx = current ? frames.indexOf(current) : -1
  const url = useBlobUrl(current?.asset)
  const asset = current ? doc.assets[current.asset] : undefined
  const ratio = doc.storyboards[shot.storyboard_id]?.ratio ?? mainStoryboard(doc)?.ratio ?? '16:9'
  const aspect = asset?.w && asset?.h ? asset.w / asset.h : ratioAspect(ratio)
  const frameJob = jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === shot.id)
  const drawing = isRunning(doc, frameJob)
  const frameFailed = frameJob && !drawing && doc.jobs[frameJob]?.state === 'failed' && !ui.jobs[frameJob]?.dismissed ? doc.jobs[frameJob] : undefined
  const take = currentTake(doc, shot.id)
  const clipJob = jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === shot.id)
  const clipping = isRunning(doc, clipJob)
  const clipper = clipping && clipJob && doc.jobs[clipJob] ? whoIsWorking(doc.jobs[clipJob], doc.jobs[clipJob].state).agent : 'wren'
  const prevDrawn = !prev || !!currentFrame(doc, prev)
  const change = frameChangeOf(doc, ui, shot.id)
  const changeRunning = change ? isRunning(doc, change.job.id) : false
  // The Director agent's question on this shot's Change this frame: the amber tag here; the ask itself in the
  // shot's Booth (placed here, so the dock under the bar does not show it twice).
  const recast = recastAsk(doc, change)
  const frameAsk = frameJob && doc.jobs[frameJob]?.state === 'needs_input' ? askOf(doc, frameJob) : undefined
  const waits = (recast ?? (frameAsk?.state === 'open' ? frameAsk : undefined))
  const waitId = !selected ? waits?.id : undefined
  useEffect(() => (waitId ? placeAsk(waitId) : undefined), [waitId])
  const [error, setError] = useState<string | null>(null)
  const [gap, setGap] = useState(false)
  const gapRef = useRef<HTMLButtonElement>(null)
  const [keepVideo, setKeepVideo] = useState(false)
  const attempt = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  const chips = cameraChips(shot.camera)
  const changed = change && !changeRunning ? cameraDiff(shot.camera, frameEditOf(change.job)?.camera) : undefined
  const changedFields = new Set(changed?.rows.map((r) => r.field) ?? [])
  const badge = clipping ? <span className="sb-badge warm"><AgentFigure agent={clipper} state="working" size={20} decorative />Rendering clip</span>
    : take ? (clipBehind(doc, shot.id) ? <span className="sb-badge warn">Clip out of date · frame changed</span> : <span className="sb-badge ok">Clip ready</span>)
    : null
  if (confirming) {
    return (
      <article ref={setNodeRef} className="sb-card confirming" data-shot-card={shot.id}>
        <InlineConfirm text={shotDeleteText(index + 1, frames.length, takesOf(doc, shot.id).length)} yes="Delete shot" onNo={() => onConfirm(false)} onYes={() => onConfirm(true)} />
      </article>
    )
  }
  // A click anywhere on the cell that is not one of its own controls selects the shot (its Booth comes in).
  const pickHere = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button, a, input, select, textarea, [contenteditable="true"], .pt-menu')) return
    onSelect()
  }
  return (
    <article ref={setNodeRef} className={`sb-card ${selected ? 'on' : ''} ${lifted ? 'slot' : ''} ${line ? `drop-${line}` : ''} ${dragging ? 'sorting' : ''} ${film?.strip ? `instrip ${film.strip}` : ''}`}
      data-shot-card={shot.id} data-select="shot" aria-label={`Shot ${index + 1}`} aria-current={selected || undefined} tabIndex={0} onClick={pickHere}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        // Enter or Space on the focused card selects it; Delete or Backspace deletes the shot.
        if (e.key === 'Enter') { e.preventDefault(); onSelect() }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          onDelete()
        }
      }}>
      {line && <span className={`sb-dropline ${line}`} aria-hidden="true"><span>Shot {moving} moves here</span></span>}
      {film?.strip && <span className="sb-bracket" aria-hidden="true">{film.strip === 'first' && <span>One video</span>}</span>}
      {film?.handle && (
        <button type="button" className={`sb-joinh ${film.handle}`} aria-label={film.handle === 'split' ? `Split here, between shot ${index} and shot ${index + 1}` : `Join shot ${index} and shot ${index + 1} into one video`}
          title={film.handle === 'split' ? 'Split here' : 'Join into one video'}
          onClick={() => void attempt(() => (film.handle === 'split' ? splitHere : joinHere)(docStore, film.videoId, shot.id))}>
          <span aria-hidden="true">{film.handle === 'split' ? '✂' : '🔗'}</span>
        </button>
      )}
      {index > 0 && (
        <>
          <button ref={gapRef} type="button" className="sb-gap" aria-label={`Insert between ${index} and ${index + 1}`} aria-haspopup="menu" aria-expanded={gap} onClick={() => setGap(!gap)}>+</button>
          <Float anchor={gapRef} open={gap} onClose={() => setGap(false)} label={`Insert between ${index} and ${index + 1}`} className="pt-menu sb-insert">
            <div className="pt-label sb-inserthead">Insert between {index} and {index + 1}</div>
            <button type="button" role="menuitem" className="pt-menurow" disabled={!store || !prev} onClick={() => { setGap(false); if (store && prev) void attempt(() => insertShot(store, { afterShotId: prev.id })) }}>
              <span className="sb-ins-blank" aria-hidden="true" /><span><b>Empty shot</b><br /><span className="faint">A blank card you fill in</span></span>
            </button>
            <button type="button" role="menuitem" className="pt-menurow" disabled title="Not in this version yet">
              <AgentFigure agent="dex" size={22} decorative /><span><b>Bridge</b><br /><span className="faint">The Director agent draws a shot that links {index} and {index + 1} · not in this version yet</span></span>
            </button>
          </Float>
        </>
      )}
      <header className="sb-cardhead">
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className="sb-handle" aria-label={`Move shot ${index + 1}`} title="Drag to move this shot (or Space, then the arrow keys)" disabled={!store}>⋮⋮</button>
        <span className="sb-num">{index + 1}</span>
        <b className="sb-title">{titleOf(shot)}</b>
        <span className="pt-mono sb-dur">{shot.duration_s.toFixed(1)} s</span>
      </header>
      {waits && <button type="button" className="tagcall" onClick={onSelect}>Needs your call</button>}
      <div className="sb-frame" style={{ aspectRatio: String(aspect) }}>
        {url && !drawing && <img src={url} alt={`Frame ${index + 1}`} />}
        {frameJob && drawing && <div className="sb-framejob"><JobSlot jobId={frameJob} compact /></div>}
        {!current && !drawing && !frameFailed && !needsFrame(shot) && (() => {
          // The end card is typeset in the render from its words, so it needs no picture (jobs/frames.ts needsFrame).
          const card = endCardOf(doc, shot.storyboard_id)
          return (
            <div className="sb-endcard" style={{ background: card?.bg }}>
              <b>{card?.headline}</b>{card?.line && card.line !== card.headline && <span>{card.line}</span>}
              <small>Set in type when the ad renders · <button type="button" className="linkbtn" onClick={onDraw} disabled={!!frameJob && !frameFailed}>draw a picture instead</button></small>
            </div>
          )
        })()}
        {!current && !drawing && !frameFailed && needsFrame(shot) && (
          <div className="sb-noframe">
            {prevDrawn
              ? <><span>No frame yet</span><button className="btn xs" onClick={onDraw} disabled={!!frameJob && !frameFailed}>{index === 0 ? 'Draw frame 1' : 'Draw this one'}</button>
                {index === 0 && !refsList(doc).length && <span className="sb-nopics">{NO_PICTURES}</span>}</>
              : <span>Draw shot {index} first</span>}
          </div>
        )}
        {frameFailed && (
          <div className="sb-failed" role="group" aria-label={`Shot ${index + 1}: the frame did not draw`}>
            <b>Couldn’t draw this frame</b>
            <span>{frameFailed.error ? plainJobError(frameFailed.error, frameFailed.op).message : 'The job stopped.'}</span>
            <span className="row">
              <button type="button" className="btn xs" onClick={onDraw}>Try again</button>
              <button type="button" className="btn xs ghost" onClick={() => uiStore.update((u) => { u.jobs[frameFailed.id] = { ...u.jobs[frameFailed.id], dismissed: true } })}>Clear</button>
            </span>
          </div>
        )}
        {current && <span className="sb-vtag">v{idx + 1}</span>}
        {current && mark && <FrameMarkTag mark={mark} />}
        {badge && <span className="sb-badgewrap">{badge}</span>}
        {current && !drawing && <button type="button" className="sb-openie" onClick={onOpen}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>Open in image editor</button>}
        {current?.cropped_to && asset?.w && asset?.h && <span className="sb-crop">{croppedCaption({ w: asset.w, h: asset.h }, current.cropped_to.to)}</span>}
      </div>
      {index === 0 && current && !drawing && <KeepPerson asset={current.asset} storyboardId={shot.storyboard_id} action={shot.action} />}
      <div className="sb-chips">{chips.map((c) => <span key={c.field} className={`sb-chip ${changedFields.has(c.field) ? 'changing' : ''}`}>{c.label}</span>)}</div>
      {/* The words are edited in the shot's Booth (its words and direction); the cell shows them. */}
      <div className="sb-words"><p className="sb-action">{shot.action?.trim() || <span className="faint">What happens in this shot…</span>}</p></div>
      <OldWords shot={shot} index={index} />
      {film && !keepVideo && missedGuide(doc, shot.id) && (
        <div className="sb-guidenote" role="group" aria-label={`Shot ${index + 1}: the video and this frame`}>
          <span>The video went its own way here.</span>
          <span className="spacer" />
          <button className="btn xs" onClick={() => setKeepVideo(true)}>Keep the video</button>
          <button className="btn xs ghost" onClick={() => void attempt(() => splitHere(docStore, film.videoId, shot.id))}>Make it match</button>
          <button className="btn xs ghost" disabled title="Not in this version yet">Use the video's frame</button>
        </div>
      )}
      {ask && (
        <div className="shotask" role="group" aria-label={`Shot ${index + 1}: keep or remove`}>
          <AgentFigure agent="dex" size={22} state="needs-you" decorative />
          <span><b>Shot {index + 1} no longer has a scene.</b> Keep it or remove it?</span>
          <span className="spacer" />
          <button className="btn xs" onClick={() => onAsk(ask, 'keep')}>Keep</button>
          <button className="btn xs ghost" onClick={() => onAsk(ask, 'remove')}>Remove</button>
        </div>
      )}
      {error && <div role="alert" className="framecard-error">{error}</div>}
    </article>
  )
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
  if (!frame) return null
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
      {error && <span role="alert" className="framecard-error">{error}</span>}
    </div>
  )
}

/** The frame's role in a connected video: a pin (the video must hit it) or "guide" (inside one take). */
function FrameMarkTag({ mark }: { mark: FrameMark }) {
  return mark === 'pin'
    ? (
      <span className="sb-mark pin" title="The video hits this frame exactly">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.8a3 3 0 0 1 3 3c0 2.2-3 5.4-3 5.4S2 6 2 3.8a3 3 0 0 1 3-3Z" fill="currentColor" /></svg>
        <span className="pt-sr">Pinned: the video hits this frame</span>
      </span>
    )
    : <span className="sb-mark guide" title="Inside one take: the video follows this frame as a guide">guide</span>
}

/** Where a card sits in the bracket of shots that will be one video. */
type StripPlace = 'first' | 'mid' | 'last'
