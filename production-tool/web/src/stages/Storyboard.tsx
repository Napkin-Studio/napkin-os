// Stage 2: script → shot list → one frame per shot, drawn in order: frame 1
// from the shot's named refs (@maya_front, @lamp_on), then each next frame from its refs, frame 1
// (setting, light, style) and the frame before it (jobs/frames.ts). Each frame
// can be changed with a sentence, optionally inside a box (or a painted mask,
// or a click when the provider can segment), and stepped back to an earlier version.

import { useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import type { Composition, CameraMove, ModelChoice, Ratio, Region, Shot } from '../contracts/types'
import { CAMERA_MOVES, COMPOSITIONS } from '../contracts/types'
import { assetRef, boxMaskRef } from '../jobs/assets'
import { allNamed, isRunning, jobAt, ratioAspect } from '../jobs/select'
import { nameOf, subjectRefs, wholeKeys } from '../lib/names'
import { continuity, drawFrame, drawTheRest, firstUndrawn, SCRIPT_MAX, selectFrame, selectedFrame } from '../jobs/frames'
import { putBlob } from '../lib/blobs'
import { checkDurations, MAX_SHOTS, TARGETS } from '../lib/shots'
import { newId } from '../lib/ulid'
import { useBlobUrl } from '../ui/hooks'
import { JobNode } from '../ui/JobNode'
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
  const shots = doc.shots ?? []
  const check = checkDurations(shots, ui.targetS)
  const planJob = jobAt(doc, ui, (c) => c.for === 'shot_list')
  const planning = isRunning(doc, planJob)
  const allFramed = shots.length > 0 && shots.every((s) => (doc.frames ?? []).some((f) => f.shot_id === s.id && f.selected))
  const anyFrameRunning = shots.some((s) => isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === s.id)))
  const noFrames = !(doc.frames ?? []).some((f) => shots.some((s) => s.id === f.shot_id))
  const deps = { relay, doc: docStore, ui: uiStore, runner }

  const plan = async () => {
    setError(null)
    const text = ui.scriptDraft.trim()
    if (!text) return setError('Write a line or two first.')
    const revId = newId('rev')
    updateDoc(docStore, (d) => {
      d.script ??= { revisions: [] }
      for (const r of d.script.revisions) if (r.status !== 'superseded') r.status = 'superseded'
      d.script.revisions.push({ id: revId, created_at: new Date().toISOString(), imported_text: text.slice(0, SCRIPT_MAX), target_s: ui.targetS, status: 'draft', ...(d.script.current ? { parent: d.script.current } : {}) })
      d.script.current = revId
    }, 'script revision')
    // The named refs go along, so each shot can name the ones it shows (@maya_front, @lamp_on).
    const refs = await allNamed(relay, docStore.get())
    await runner.submit('shot_list', { script: text.slice(0, SCRIPT_MAX), targetS: ui.targetS, ...(refs.length ? { refs } : {}) }, [], { for: 'shot_list', revId })
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

  const lock = () => updateDoc(docStore, (d) => {
    for (const s of d.shots ?? []) s.status = 'locked'
    const rev = d.script?.revisions.find((r) => r.id === d.script?.current)
    if (rev) rev.status = 'approved'
    d.stage = { current: 'video', next_action: 'Make a clip for each shot.' }
  }, 'lock storyboard')

  if (!controls.storyboard) {
    return <div className="panel"><div className="empty-state"><b>Storyboards are off right now.</b>The organisers will switch them on soon.</div></div>
  }

  return (
    <div className="panel">
      <div className="panel-inner">
        <div className="eyebrow">Step 2</div>
        <h1>Storyboard</h1>
        <p className="lede">Write what happens in your ad. We plan the shots, then draw a frame for each one.</p>
        <div className="split">
          <div className="card section stack">
            <div className="row"><h2>Script</h2><span className="spacer" /><span className="counter">{ui.scriptDraft.length}/{SCRIPT_MAX}</span></div>
            <textarea
              className="textarea"
              rows={6}
              maxLength={SCRIPT_MAX}
              placeholder="e.g. It starts to rain. Our hero opens a bright umbrella and grins. The logo appears."
              value={ui.scriptDraft}
              onChange={(e) => uiStore.update((u) => { u.scriptDraft = e.target.value })}
            />
            <div className="row wrap">
              <span className="eyebrow" style={{ width: 56 }}>Length</span>
              {TARGETS.map((t) => (
                <button key={t} className={`chip ${ui.targetS === t ? 'on' : ''}`} onClick={() => uiStore.update((u) => { u.targetS = t })}>{t} s</button>
              ))}
            </div>
            <div className="row wrap">
              <span className="eyebrow" style={{ width: 56 }}>Format</span>
              {RATIOS.map((r) => (
                <button key={r} className={`chip ${ui.ratio === r ? 'on' : ''}`} onClick={() => uiStore.update((u) => { u.ratio = r })}>{r}</button>
              ))}
            </div>
            <div className="row">
              <button className="btn primary" disabled={planning || !ui.scriptDraft.trim()} onClick={() => void attempt(plan)}>{planning ? 'Planning…' : shots.length ? 'Plan again' : 'Plan shots'}</button>
              {!doc.refs.length && <span className="faint" style={{ fontSize: 12 }}>Name an image on the canvas first, like @maya_front.</span>}
            </div>
            {planJob && <div style={{ height: 120, borderRadius: 12, overflow: 'hidden' }}><JobNode jobId={planJob} /></div>}
            {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>{error}</div>}
          </div>

          <div className="card section stack">
            <div className="row">
              <h2>Shots</h2>
              <span className="spacer" />
              {shots.length > 0 && (
                <span className={`sum ${check.ok ? 'ok' : 'bad'}`}>
                  {check.total} / {ui.targetS} s {check.ok ? '✓' : `· ${check.reason}`}
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
                    text={shotDeleteText(i + 1, (doc.frames ?? []).filter((f) => f.shot_id === s.id).length, (doc.takes ?? []).filter((t) => t.shot_id === s.id).length)}
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
                    <select className="select" aria-label="Composition" value={s.composition} onChange={(e) => updateShot(s.id, { composition: e.target.value as Composition })}>
                      {COMPOSITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                    </select>
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    <textarea className="textarea" aria-label="Action" maxLength={300} value={s.action} onChange={(e) => updateShot(s.id, { action: e.target.value })} />
                    <ShotRefs shot={s} onChange={(refs) => updateShot(s.id, { refs })} />
                  </div>
                  <select className="select" aria-label="Camera move" value={s.camera_move} onChange={(e) => updateShot(s.id, { camera_move: e.target.value as CameraMove })}>
                    {CAMERA_MOVES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                  </select>
                  <div className="row" style={{ gap: 4 }}>
                    <input className="input" aria-label="Seconds" type="number" min={1} max={10} step={0.5} value={s.duration_s}
                      onChange={(e) => updateShot(s.id, { duration_s: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
                    <span className="faint">s</span>
                  </div>
                  <button className="btn icon sm ghost" aria-label="Delete shot" title={shots.length <= 2 ? 'A storyboard needs at least 2 shots' : 'Delete this shot'} disabled={shots.length <= 2}
                    onClick={() => setConfirmShot(s.id)}>✕</button>
                  <OldWords shot={s} index={i} />
                </div>
              ))}
            </div>
            {shots.length > 0 && (
              <div className="row">
                <button className="btn sm ghost" disabled={shots.length >= MAX_SHOTS}
                  onClick={() => updateDoc(docStore, (d) => {
                    d.shots ??= []
                    d.shots.push({ id: newId('shot'), order: d.shots.length + 1, duration_s: 5, composition: 'medium', action: '', camera_move: 'static', refs: [], status: 'planned' })
                  }, 'add shot')}>+ Add shot</button>
                <span className="spacer" />
                {noFrames ? (
                  <button className="btn dark" disabled={!check.ok || anyFrameRunning || !doc.refs.length} onClick={drawFirst}
                    title="Frame 1 sets the place, the light and the style for every frame after it">
                    {anyFrameRunning ? 'Drawing…' : 'Draw frame 1'}
                  </button>
                ) : (
                  <button className="btn dark" disabled={!check.ok || anyFrameRunning || allFramed || firstUndrawn(doc) < 0 || !doc.refs.length} onClick={drawRest}
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
              <button className="btn primary" disabled={!allFramed || anyFrameRunning} onClick={lock} title={allFramed ? '' : 'Every shot needs a frame'}>Lock storyboard → Video</button>
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
  const frames = (doc.frames ?? []).filter((f) => f.shot_id === shot.id)
  const current = frames.find((f) => f.selected) ?? frames[frames.length - 1]
  const idx = current ? frames.indexOf(current) : -1
  const url = useBlobUrl(current?.asset)
  const asset = doc.assets.find((a) => a.sha256 === current?.asset)
  const jobId = jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === shot.id)
  const running = isRunning(doc, jobId)
  const [mode, setMode] = useState<MarkMode>('none')
  const [text, setText] = useState('')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const region = current ? ui.frameRegions[current.id] : undefined
  const made = madeWith(doc, ui, current?.job_id)
  const choice = pick ?? startingChoice(modelChoicesFor('frame', config), made.made)
  const staleMark = current && (doc.stale ?? []).find((s) => s.target.kind === 'frame' && s.target.id === current.id)
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
  const prevShot = index > 0 ? (doc.shots ?? [])[index - 1] : undefined
  const prevDrawn = !prevShot || !!selectedFrame(doc, prevShot.id)
  const nextShot = (doc.shots ?? [])[index + 1]
  const nextEmpty = !!nextShot && !(doc.frames ?? []).some((f) => f.shot_id === nextShot.id)
  const nextBusy = !!nextShot && isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === nextShot.id))
  const aspect = asset?.w && asset?.h ? asset.w / asset.h : ratioAspect(ui.ratio)

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
        } else {
          mask = await boxMaskRef(relay, current.asset, region) // a box alone: fal edits only inside a mask
        }
        // A region edit keeps the frame in its sequence: shot 1's frame and the one before go too.
        const anchors = await continuity(relay, doc, index)
        await runner.submit('region_edit', { image, region, text: text.trim(), ...(mask ? { mask } : {}), ...anchors }, [current.job_id], { for: 'frame', shotId: shot.id, parentFrameId: current.id, how: 'again' })
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

  const parent = current?.parent ? frames.find((f) => f.id === current.parent) : undefined
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
        <b>{label(shot.composition)}</b>
        <span className="faint">· {label(shot.camera_move)} · {shot.duration_s}s</span>
        <span className="spacer" />
        {/* The mark is on the version on show; while its replacement is drawn, say so instead. */}
        {staleMark && running && <span className="behind updating" title={staleMark.reason}>Updating…</span>}
        {showMock && current?.kind === 'mock' && <span className="mockbadge">MOCK</span>}
        {made.fallback && <span className="madeon" title={`${made.fallback}. ${ui.jobCtx[current?.job_id ?? '']?.fallbackReason ?? ''}`.trim()}>Made on Runway</span>}
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
              label: `Redraw this and the frames after (${after})`, hint: update.cost(afterScope), icon: '⇥',
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
            title={`Redraw this frame and every one after it, then their clips and the ad (${update.size(carryScope)} · ${update.cost(carryScope)})`}
            onClick={() => void start(carryScope)}>Carry the look forward</button>
        </div>
      )}
      <div className="framepic">
        <RegionImage src={url} aspect={aspect} mode={running ? 'none' : mode} region={region} strokes={strokes}
          onRegion={setRegion} onStrokes={setStrokes}>
          {jobId && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <JobNode jobId={jobId} />
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
                  <button className="btn xs" onClick={onDraw} disabled={!doc.refs.length}>{index === 0 ? 'Draw frame 1' : 'Draw this one'}</button>
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
            <span className="faint" title={made.label}>{made.made ? `Made by Dex · ${made.label}` : ''}</span>
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

/** The named refs a shot shows: chips to take off, and a list to add from. */
function ShotRefs({ shot, onChange }: { shot: Shot; onChange: (refs: string[]) => void }) {
  const doc = useDoc()
  const names = shot.refs ?? []
  const free = [...wholeKeys(doc), ...doc.refs.map(nameOf)].filter((n) => !names.includes(n))
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
          <button className="x" aria-label={`Take @${n} off this shot`} onClick={() => onChange(names.filter((x) => x !== n))}>×</button>
        </span>
      ))}
      {free.length > 0 && names.length < 9 && (
        <select className="select xs" aria-label="Add a reference to this shot" value="" onChange={(e) => e.target.value && onChange([...names, e.target.value])}>
          <option value="">+ ref</option>
          {free.map((n) => <option key={n} value={n}>@{n}</option>)}
        </select>
      )}
    </div>
  )
}
