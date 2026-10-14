// Stage 2: script → shot list → one frame per shot, drawn in order: frame 1
// from the shot's named refs (@maya_front, @lamp_on), then each next frame from its refs, frame 1
// (setting, light, style) and the frame before it (jobs/frames.ts). Each frame
// can be changed with a sentence, optionally inside a box (or a painted mask,
// or a click when the provider can segment), and stepped back to an earlier version.
//
// Contract 3: the script's words are the main script's scenes; the shots are the main storyboard's,
// in rank order; the ratio and the target length are the storyboard's; the frame in a shot is its pick.

import { useEffect, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import type { CameraMovement, CameraSize, ModelChoice, Ratio, Region, Shot } from '../contracts/types'
import { CAMERA_MOVEMENTS, CAMERA_SIZES } from '../contracts/types'
import { assetRef } from '../jobs/assets'
import { isRunning, jobAt, ratioAspect } from '../jobs/select'
import { nameOf, subjectRefs, wholeKeys } from '../lib/names'
import { continuity, drawFrame, drawTheRest, firstUndrawn, SCRIPT_MAX, selectFrame } from '../jobs/frames'
import { planShots } from '../jobs/plan'
import { putBlob } from '../lib/blobs'
import { checkDurations, MAX_SHOTS, TARGETS } from '../lib/shots'
import { useBlobUrl } from '../ui/hooks'
import { JobSlot } from '../ui/JobSlot'
import { RegionImage, type MarkMode, type Stroke } from '../ui/RegionImage'
import { maskPng } from '../lib/mask'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeFrame, removeShot, shotDeleteText } from '../doc/remove'
import { InlineConfirm } from '../ui/Undo'
import { ModelPick } from '../ui/ModelPick'
import { choiceToSend, modelChoicesFor } from '../capabilities'
import { madeWith, startingChoice } from '../ui/modelChoice'
import { behindLabel, driftLabel, oldWordsLine } from '../ui/behind'
import { editShot, frameDrift, frameStale, takeStale } from '../jobs/stale'
import { useUpdate } from '../ui/useUpdate'
import type { FollowScope } from '../jobs/follow'
import { SplitButton } from '../ui/SplitButton'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { Thumbs } from '../dogfood/Dogfood'
import { errorShown } from '../dogfood/recorder'
import { DownloadButton } from '../ui/Download'
import { useProjectName } from '../ui/useDownload'
import { mediaItem } from '../media/names'
import { currentFrame, framesOf, jobsList, mainStoryboard, openAsks, refsList, scriptText, shotSubjects, shotsOf, staleList, takesOf, unplannedText } from '../model/selectors'
import { askedShot } from '../jobs/plan'
import { LOCAL_PERSON } from '../jobs/runner'
import type { Ask, CrewId } from '../contracts/types'
import { addShot, answerShotAsk, setRatio, setTarget, withMention, withoutMention, wordsPatch, writeScript } from './storyboardEdits'

const RATIOS: Ratio[] = ['9:16', '1:1', '16:9']
const label = (s: string) => s.replace(/_/g, ' ')

export function Storyboard() {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { controls } = useConfig()
  useJobsTick()
  const [error, setError] = useState<string | null>(null)
  const [confirmShot, setConfirmShot] = useState<string | null>(null)
  const shots = shotsOf(doc)
  const sb = mainStoryboard(doc)
  const targetS = sb?.target_s ?? 15
  const ratio = sb?.ratio ?? '16:9'
  const words = unplannedText(doc)
  const hasRefs = refsList(doc).length > 0
  const check = checkDurations(shots, targetS)
  const planJob = jobAt(doc, ui, (c) => c.for === 'shot_list')
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
  const plan = async () => {
    setError(null)
    if (!scriptText(doc).trim()) return setError('Write a line or two first.')
    await planShots(deps)
  }

  const attempt = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  const drawFirst = () => attempt(() => drawFrame(deps, 0, 'first'))
  const drawNext = (index: number) => attempt(() => drawFrame(deps, index, 'next'))
  const drawRest = () => attempt(() => drawTheRest(deps))

  // The shot's own frame (words) or clip (camera, length) is marked in the same write, so undo takes both back.
  const updateShot = (id: string, patch: Partial<Shot>) => updateDoc(docStore, (d) => editShot(d, id, patch), 'edit shot')
  const updateWords = (s: Shot, w: { action?: string; direction?: string }) => updateShot(s.id, wordsPatch(doc, s, w))

  const lock = async () => {
    await updateDoc(docStore, (d) => {
      for (const s of shotsOf(d)) d.shots[s.id].status = 'locked'
    }, 'lock storyboard')
    uiStore.update((u) => { u.stage = 'video' })
  }

  if (!controls.storyboard) {
    return <div className="panel"><div className="empty-state"><b>Storyboards are off right now.</b></div></div>
  }

  return (
    <div className="panel">
      <div className="panel-inner">
        <div className="eyebrow">Step 2</div>
        <h1>Storyboard</h1>
        <p className="lede">Write what happens in your ad. We plan the shots, then draw a frame for each one.</p>
        <div className="split">
          <div className="card section stack">
            <div className="row"><h2>Script</h2><span className="spacer" /><span className="counter">{words.length}/{SCRIPT_MAX}</span></div>
            <textarea
              className="textarea"
              rows={6}
              maxLength={SCRIPT_MAX}
              aria-label="Script"
              placeholder={shots.length ? 'Add more of the story here, then Plan again.' : 'e.g. It starts to rain. Our hero opens a bright umbrella and grins. The logo appears.'}
              value={words}
              onChange={(e) => void attempt(() => updateDoc(docStore, (d) => writeScript(d, e.target.value), 'edit'))}
            />
            <div className="row wrap">
              <span className="eyebrow" style={{ width: 56 }}>Length</span>
              {TARGETS.map((t) => (
                <button key={t} className={`chip ${targetS === t ? 'on' : ''}`}
                  onClick={() => void updateDoc(docStore, (d) => setTarget(d, t), `set the storyboard length to ${t} s`)}>{t} s</button>
              ))}
            </div>
            <div className="row wrap">
              <span className="eyebrow" style={{ width: 56 }}>Format</span>
              {RATIOS.map((r) => (
                <button key={r} className={`chip ${ratio === r ? 'on' : ''}`}
                  onClick={() => void updateDoc(docStore, (d) => setRatio(d, r), `set the storyboard format to ${r}`)}>{r}</button>
              ))}
            </div>
            <div className="row">
              <button className="btn primary" disabled={planning || !scriptText(doc).trim()} onClick={() => void attempt(plan)}>{planning ? 'Planning…' : shots.length ? 'Plan again' : 'Plan shots'}</button>
              {!hasRefs && <span className="faint" style={{ fontSize: 12 }}>Name an image on the canvas first, like @maya_front.</span>}
            </div>
            {planJob && <div style={{ minHeight: 120, borderRadius: 12, overflow: 'hidden' }}><JobSlot jobId={planJob} /></div>}
            {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>{error}</div>}
          </div>

          <div className="card section stack">
            <div className="row">
              <h2>Shots</h2>
              {shots.length > 0 && <Thumbs compact target={{ kind: 'shot-list', jobId: lastPlan?.id, model: lastPlan?.director?.model, promptVersion: lastPlan?.director?.promptVersion, shots: shots.length }} />}
              <span className="spacer" />
              {shots.length > 0 && (
                <span className={`sum ${check.ok ? 'ok' : 'bad'}`}>
                  {check.total} / {targetS} s {check.ok ? '✓' : `· ${check.reason}`}
                </span>
              )}
            </div>
            {!shots.length && (
              <div className="shots-empty">
                <AgentFigure agent="dex" size={56} decorative />
                <span className="sayer">{sayer('dex')}</span>
                <b>No shots yet</b>
                <span className="faint">Write what happens in your ad, then Plan shots. Your shots show up here, and you can change every one.</span>
              </div>
            )}
            <div className="shots">
              {shots.map((s, i) => confirmShot === s.id ? (
                <div key={s.id} className="shotrow confirming">
                  <span className="num">{i + 1}</span>
                  <InlineConfirm
                    text={shotDeleteText(i + 1, framesOf(doc, s.id).length, takesOf(doc, s.id).length)}
                    yes="Delete shot"
                    onNo={() => setConfirmShot(null)}
                    onYes={async () => {
                      setConfirmShot(null)
                      await deleteFrom(docStore, (d) => removeShot(d, s.id)) // Undo in the top bar puts it back
                    }}
                  />
                </div>
              ) : (
                <div key={s.id} className="shotrow">
                  <span className="num">{i + 1}</span>
                  <div className="stack" style={{ gap: 4 }}>
                    <select className="select" aria-label="Shot size" value={s.camera.size} onChange={(e) => updateShot(s.id, { camera: { ...s.camera, size: e.target.value as CameraSize } })}>
                      {CAMERA_SIZES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                    </select>
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    <textarea className="textarea" aria-label="Action" maxLength={300} value={s.action ?? ''} onChange={(e) => updateWords(s, { action: e.target.value })} />
                    <ShotRefs shot={s} onAction={(action) => updateWords(s, { action })} />
                  </div>
                  <select className="select" aria-label="Camera move" value={s.camera.movement ?? 'static'} onChange={(e) => updateShot(s.id, { camera: { ...s.camera, movement: e.target.value as CameraMovement } })}>
                    {CAMERA_MOVEMENTS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                  </select>
                  <div className="row" style={{ gap: 4 }}>
                    <input className="input" aria-label="Seconds" type="number" min={1} max={10} step={0.5} value={s.duration_s}
                      onChange={(e) => updateShot(s.id, { duration_s: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
                    <span className="faint">s</span>
                  </div>
                  <button className="btn icon sm ghost" aria-label="Delete shot" title={shots.length <= 2 ? 'A storyboard needs at least 2 shots' : 'Delete this shot'} disabled={shots.length <= 2}
                    onClick={() => setConfirmShot(s.id)}>✕</button>
                  <OldWords shot={s} index={i} />
                  {shotAsks.has(s.id) && (
                    <div className="shotask" role="group" aria-label={`Shot ${i + 1}: keep or remove`}>
                      <AgentFigure agent="dex" size={22} decorative />
                      <span><b>Shot {i + 1} no longer has a scene.</b> Keep it or remove it?</span>
                      <span className="spacer" />
                      <button className="btn xs" onClick={() => void answerAsk(shotAsks.get(s.id)!, s.id, 'keep')}>Keep</button>
                      <button className="btn xs ghost" onClick={() => void answerAsk(shotAsks.get(s.id)!, s.id, 'remove')}>Remove</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {shots.length > 0 && (
              <div className="row">
                <button className="btn sm ghost" disabled={shots.length >= MAX_SHOTS}
                  onClick={() => void attempt(() => updateDoc(docStore, (d) => { addShot(d) }, 'add shot'))}>+ Add shot</button>
                <span className="spacer" />
                {noFrames ? (
                  <button className="btn dark" disabled={!check.ok || anyFrameRunning || !hasRefs} onClick={drawFirst}
                    title="Frame 1 sets the place, the light and the style for every frame after it">
                    {anyFrameRunning ? 'Drawing…' : 'Draw frame 1'}
                  </button>
                ) : (
                  <button className="btn dark" disabled={!check.ok || anyFrameRunning || allFramed || firstUndrawn(doc) < 0 || !hasRefs} onClick={drawRest}
                    title="Draw each remaining shot in turn, each one following the one before">
                    {ui.drawingRest && anyFrameRunning ? 'Drawing the rest…' : anyFrameRunning ? 'Drawing…' : allFramed ? 'All frames drawn' : 'Draw the rest'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {shots.length > 0 && (
          <>
            <div className="row" style={{ margin: '28px 0 12px' }}>
              <h2>Frames</h2>
              <span className="faint" style={{ fontSize: 12 }}>· drawn in order: each follows frame 1 and the one before</span>
              <span className="spacer" />
              <button className="btn primary" disabled={!allFramed || anyFrameRunning} onClick={() => void attempt(lock)} title={allFramed ? '' : 'Every shot needs a frame'}>Lock storyboard → Video</button>
            </div>
            <div className="frames">
              {shots.map((s, i) => (
                <FrameCard key={s.id} shot={s} index={i} onDraw={() => (i === 0 ? drawFirst() : drawNext(i))}
                  onNext={i + 1 < shots.length ? () => drawNext(i + 1) : undefined} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FrameCard({ shot, index, onDraw, onNext }: { shot: Shot; index: number; onDraw: () => void; onNext?: () => void }) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config, controls } = useConfig()
  const showMock = useShowMock()
  const frames = framesOf(doc, shot.id)
  const current = currentFrame(doc, shot) ?? frames.at(-1)
  const idx = current ? frames.indexOf(current) : -1
  const url = useBlobUrl(current?.asset)
  const asset = current ? doc.assets[current.asset] : undefined
  const jobId = jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === shot.id)
  const running = isRunning(doc, jobId)
  const [mode, setMode] = useState<MarkMode>('none')
  const [text, setText] = useState('')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const region = current ? ui.frameRegions[current.id] : undefined
  useEffect(() => { if (error) errorShown('frame', error, { shot: index + 1 }) }, [error, index])
  const made = madeWith(doc, ui, current?.job_id)
  const choice = pick ?? startingChoice(modelChoicesFor('frame', config), made.made)
  const staleMark = current && staleList(doc).find((s) => s.target.kind === 'frame' && s.target.id === current.id)
  const drift = current ? frameDrift(doc, shot.id) : undefined
  const update = useUpdate()
  const afterScope = { kind: 'after', item: { kind: 'frame', shotId: shot.id } } as const
  const carryScope = { kind: 'carry', from: shot.id } as const
  const after = update.size(afterScope)
  const start = async (scope: FollowScope) => {
    setError(null)
    try {
      await update.start(scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  const shots = shotsOf(doc)
  const prevShot = index > 0 ? shots[index - 1] : undefined
  const prevDrawn = !prevShot || !!currentFrame(doc, prevShot)
  const nextShot = shots[index + 1]
  const nextEmpty = !!nextShot && framesOf(doc, nextShot.id).length === 0
  const nextBusy = !!nextShot && isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === nextShot.id))
  const aspect = asset?.w && asset?.h ? asset.w / asset.h : ratioAspect(mainStoryboard(doc)?.ratio ?? '16:9')
  const project = useProjectName()
  const shown = current ? mediaItem(doc, project, current.asset, 'frame') : undefined

  const setRegion = (r: Region | null) => current && uiStore.update((u) => { u.frameRegions[current.id] = r ?? undefined })
  const select = (frameId: string) => selectFrame(docStore, shot.id, frameId)

  const regenerate = async () => {
    setError(null)
    try {
      if (current && region && controls.regionEditFrames) {
        const image = await assetRef(relay, current.asset)
        let mask
        if (strokes.length && controls.maskBrush && asset?.w && asset?.h) {
          const sha = await putBlob(await maskPng(strokes, asset.w, asset.h))
          mask = await assetRef(relay, sha)
        }
        // A region edit keeps the frame in its sequence: shot 1's frame and the one before go too.
        const anchors = await continuity(relay, doc, index)
        await runner.submit('region_edit', { image, region, text: text.trim(), ...(mask ? { mask } : {}), ...anchors }, current.job_id ? [current.job_id] : [], { for: 'frame', shotId: shot.id, parentFrameId: current.id, how: 'again' })
      } else {
        // A pick only on a regenerate: the first draw runs the routed default.
        const modelChoice = current ? choiceToSend('frame', config, choice) : undefined
        await drawFrame({ relay, doc: docStore, ui: uiStore, runner }, index, current ? 'again' : index === 0 ? 'first' : 'next', { text, ...(current ? { parent: current } : {}), ...(modelChoice ? { modelChoice } : {}) })
      }
      setText('')
      setStrokes([])
      setMode('none')
      if (current) setRegion(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

  const parent = current?.parent_id ? frames.find((f) => f.id === current.parent_id) : undefined
  const tools: { id: MarkMode; icon: string; label: string; show: boolean; title: string }[] = [
    { id: 'box', icon: '▭', label: 'Box', show: controls.regionEditFrames, title: 'Box: draw a box around what to change' },
    { id: 'brush', icon: '✎', label: 'Brush', show: controls.maskBrush, title: 'Brush: paint over what to change' },
    { id: 'click', icon: '◎', label: 'Click', show: controls.clickSelect, title: 'Click: click the thing to change' },
  ]

  const deleteVersion = async () => {
    if (!current) return
    setError(null)
    try {
      await deleteFrom(docStore, (d) => removeFrame(d, current.id)) // Undo in the top bar puts it back
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

  return (
    <div className="framecard" data-shot-card={shot.id}>
      <div className="head">
        <span className="num">{index + 1}</span>
        <b>{label(shot.camera.size)}</b>
        <span className="faint">· {label(shot.camera.movement ?? 'static')} · {shot.duration_s}s</span>
        <span className="spacer" />
        {/* The mark is on the version on show; while its replacement is drawn, say so instead. */}
        {staleMark && running && <span className="behind updating" title={staleMark.reason}>Updating…</span>}
        {showMock && current?.kind === 'mock' && <span className="mockbadge">MOCK</span>}
        {made.fallback && <span className="madeon" title={`${made.fallback}. ${ui.jobs[current?.job_id ?? '']?.fallbackReason ?? ''}`.trim()}>Made on Runway</span>}
      </div>
      {/* Out of date: what changed, and Redraw (this one) with ▾ for this and the frames after. */}
      {staleMark && !running && (
        <div className="cardstate">
          <span className="behind" title={staleMark.reason}>{behindLabel(doc, staleMark)}</span>
          <span className="spacer" />
          <SplitButton kind="dark" size="xs" menuLabel={`More ways to redraw frame ${index + 1}`} disabled={update.running}
            title={`Redraw frame ${index + 1} only, from what shot ${index + 1} says now`}
            onClick={() => void start({ kind: 'one', item: { kind: 'frame', shotId: shot.id } })}
            items={after > 1 ? [{
              label: `Redraw this and the frames after (${after})`, icon: '⇥',
              onSelect: () => void start(afterScope),
            }] : []}>
            Redraw
          </SplitButton>
        </div>
      )}
      {/* Continuity only: quiet, never "out of date"; the old chain is one click away. */}
      {!staleMark && !running && drift !== undefined && (
        <div className="cardstate drift">
          <span>{driftLabel(drift)}</span><span aria-hidden="true">·</span>
          <button className="linkbtn" disabled={update.running}
            title={`Redraw this frame and every one after it, then their clips and the ad (${update.size(carryScope)})`}
            onClick={() => void start(carryScope)}>Carry the look forward</button>
        </div>
      )}
      <div className="framepic">
        <RegionImage src={url} aspect={aspect} mode={running ? 'none' : mode} region={region} strokes={strokes}
          onRegion={setRegion} onStrokes={setStrokes}>
          {jobId && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <JobSlot jobId={jobId} />
            </div>
          )}
          {!current && !jobId && (
            <div className="pending idle" style={{ position: 'absolute', inset: 0 }}>
              {ui.drawingRest && !prevDrawn ? (
                <div className="faint">Waiting for shot {index}</div>
              ) : prevDrawn ? (
                <>
                  <AgentFigure agent="dex" size={44} decorative />
                  <div className="faint">No frame yet</div>
                  <button className="btn xs" onClick={onDraw} disabled={!refsList(doc).length}>{index === 0 ? 'Draw frame 1' : 'Draw this one'}</button>
                </>
              ) : (
                <div className="faint">Draw shot {index} first</div>
              )}
            </div>
          )}
        </RegionImage>
        {/* The picture's tools float on it: shown on hover and focus, and kept while marking. */}
        {current && (
          <div className={`hoverbar ${mode !== 'none' || region || strokes.length ? 'pinned' : ''}`} role="toolbar" aria-label={`Shot ${index + 1} frame tools`}>
            {tools.filter((t) => t.show).map((t) => (
              <button key={t.id} className={`btn xs ${mode === t.id ? 'on' : 'ghost'}`} title={t.title} aria-label={t.label} aria-pressed={mode === t.id} disabled={running} onClick={() => setMode(mode === t.id ? 'none' : t.id)}>{t.icon}<span className="hb-label">{t.label}</span></button>
            ))}
            {(region || strokes.length > 0) && <button className="btn xs ghost" onClick={() => { setRegion(null); setStrokes([]) }}>Clear</button>}
            <span className="sep" />
            <button className="btn xs icon ghost" aria-label="Previous version" disabled={idx <= 0} onClick={() => select(frames[idx - 1].id)}>‹</button>
            <span className="mono vlabel" title={made.label}>v{idx + 1}/{frames.length}</span>
            <button className="btn xs icon ghost" aria-label="Next version" disabled={idx >= frames.length - 1} onClick={() => select(frames[idx + 1].id)}>›</button>
            <span className="sep" />
            {shown && <DownloadButton items={[shown]} className="btn xs icon ghost" iconOnly title={`Download v${idx + 1} (${shown.name})`} />}
            <button className="btn xs icon ghost iconbtn-del" aria-label={`Delete version ${idx + 1}`} disabled={running}
              title={frames.length <= 1 ? 'Delete the only version: Update what follows draws it again' : `Delete v${idx + 1}`}
              onClick={deleteVersion}>🗑</button>
          </div>
        )}
      </div>
      {current && (
        <>
          {frames.length > 1 && (
            <div className="vstrip" role="group" aria-label="Versions">
              {frames.map((f, i) => <VersionThumb key={f.id} sha={f.asset} n={i + 1} on={f.id === current.id} onPick={() => select(f.id)} />)}
            </div>
          )}
          <div className="promptbar">
            <input className="promptbar-input" aria-label={region ? 'Change what is in the box' : 'Change this frame'} placeholder={region ? 'Change what is in the box…' : 'Change this frame…'} maxLength={1000} value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !running && (text.trim() || !region) && regenerate()} />
            <div className="row wrap">
              {!region && <ModelPick op="frame" value={choice} onChange={setPick} />}
              <span className="spacer" />
              {parent && <button className="btn sm ghost" onClick={() => select(parent.id)} title="Go back to the version this came from">↶ Revert</button>}
              <button className="btn sm primary" disabled={running || (!!region && !text.trim())} onClick={regenerate}>{region ? 'Change the box' : 'Regenerate'}</button>
            </div>
          </div>
          <div className="framecard-foot">
            <span className="faint" title={made.label}>{made.made ? `${madeBy(current.crew)} · directed by Dex · ${made.label}` : ''}</span>
            <Thumbs key={current.id} compact target={{
              kind: 'frame', id: current.id, jobId: current.job_id, shot: index + 1, asset: current.asset,
              provider: current.job_id ? doc.jobs[current.job_id]?.provider : undefined, model: current.job_id ? doc.jobs[current.job_id]?.model : undefined,
            }} />
            <span className="spacer" />
            {onNext && nextEmpty && !ui.drawingRest && (
              <button className="btn sm" disabled={running || nextBusy} onClick={onNext} title={`Draw shot ${index + 2}, continuing from this frame`}>Next frame →</button>
            )}
          </div>
          {error && <div role="alert" className="framecard-error">{error}</div>}
        </>
      )}
    </div>
  )
}

/** Who made a frame, from its own crew: Wren renders, Rhea retouches (Dex directs every one). */
function madeBy(crew: CrewId): string {
  return crew === 'rhea' ? 'Retouched by Rhea' : crew === 'wren' ? 'Rendered by Wren' : `Made by ${crew[0].toUpperCase()}${crew.slice(1)}`
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

/** One version in the strip under a frame: its picture, its number; a click selects it. */
function VersionThumb({ sha, n, on, onPick }: { sha: string; n: number; on: boolean; onPick: () => void }) {
  const url = useBlobUrl(sha)
  return (
    <button className={`vthumb ${on ? 'on' : ''}`} aria-label={`Version ${n}`} aria-pressed={on} onClick={onPick}>
      {url && <img src={url} alt="" />}
      <span className="vthumb-n">v{n}</span>
    </button>
  )
}

/** The named refs a shot shows: they are its words' @mentions, so a chip taken off takes the mention out
 *  of the words, and one added goes at the end of the action. */
function ShotRefs({ shot, onAction }: { shot: Shot; onAction: (action: string) => void }) {
  const doc = useDoc()
  const names = shotSubjects(doc, shot)
  const free = [...wholeKeys(doc), ...refsList(doc).map(nameOf)].filter((n) => !names.includes(n))
  const problem = (n: string) => {
    try {
      return subjectRefs(doc, n).length ? null : 'No image has this name'
    } catch (e) {
      return e instanceof Error ? e.message : 'Set a front first'
    }
  }
  return (
    <div className="shotrefs">
      {names.map((n) => (
        <span key={n} className={`taghint ${problem(n) ? 'missing' : n.includes('_') ? '' : 'whole'}`} title={problem(n) ?? (n.includes('_') ? undefined : 'The whole character')}>
          @{n}
          <button className="x" aria-label={`Take @${n} off this shot`} onClick={() => onAction(withoutMention(shot.action ?? '', n))}>×</button>
        </span>
      ))}
      {free.length > 0 && names.length < 9 && (
        <select className="select xs" aria-label="Add a reference to this shot" value="" onChange={(e) => e.target.value && onAction(withMention(shot, e.target.value))}>
          <option value="">+ ref</option>
          {free.map((n) => <option key={n} value={n}>@{n}</option>)}
        </select>
      )}
    </div>
  )
}
