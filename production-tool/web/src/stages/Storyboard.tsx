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
import { continuity, drawFrame, drawTheRest, firstUndrawn, selectFrame, selectedFrame } from '../jobs/frames'
import { putBlob } from '../lib/blobs'
import { checkDurations, MAX_SHOTS, TARGETS } from '../lib/shots'
import { newId } from '../lib/ulid'
import { useBlobUrl } from '../ui/hooks'
import { JobNode } from '../ui/JobNode'
import { RegionImage, type MarkMode, type Stroke } from '../ui/RegionImage'
import { maskPng } from '../lib/mask'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeFrame, removeShot, restoreTo, shotDeleteText } from '../doc/remove'
import { InlineConfirm, UndoChip } from '../ui/Undo'
import { ModelPick } from '../ui/ModelPick'
import { choiceToSend, modelChoicesFor } from '../capabilities'
import { madeWith, startingChoice } from '../ui/modelChoice'
import { useUndo } from '../ui/useUndo'
import { UpdateFollows } from '../ui/Follow'

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
  const [shotUndo, offerShotUndo, runShotUndo] = useUndo()
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
      d.script.revisions.push({ id: revId, created_at: new Date().toISOString(), imported_text: text.slice(0, 600), target_s: ui.targetS, status: 'draft', ...(d.script.current ? { parent: d.script.current } : {}) })
      d.script.current = revId
    }, 'script revision')
    // The named refs go along, so each shot can name the ones it shows (@maya_front, @lamp_on).
    const refs = await allNamed(relay, docStore.get())
    await runner.submit('shot_list', { script: text.slice(0, 600), targetS: ui.targetS, ...(refs.length ? { refs } : {}) }, [], { for: 'shot_list', revId })
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

  const updateShot = (id: string, patch: Partial<Shot>) => updateDoc(docStore, (d) => {
    const s = d.shots?.find((x) => x.id === id)
    if (s) Object.assign(s, patch)
  }, 'edit shot')

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
            <div className="row"><h2>Script</h2><span className="spacer" /><span className="counter">{ui.scriptDraft.length}/600</span></div>
            <textarea
              className="textarea"
              rows={6}
              maxLength={600}
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
              <button className="btn primary" disabled={planning || !ui.scriptDraft.trim()} onClick={plan}>{planning ? 'Planning…' : shots.length ? 'Plan again' : 'Plan shots'}</button>
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
            {!shots.length && <div className="faint" style={{ padding: '18px 0' }}>Your shots show up here. You can change every one.</div>}
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
                      const r = await deleteFrom(docStore, (d) => removeShot(d, s.id))
                      offerShotUndo({ label: `Shot ${i + 1} deleted`, key: String(i), undo: () => restoreTo(docStore, r) })
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
                </div>
              )).flatMap((row, i) => (shotUndo && shotUndo.key === String(i) ? [<UndoRow key="undo" label={shotUndo.label} onUndo={runShotUndo} />, row] : [row]))}
              {shotUndo && Number(shotUndo.key) >= shots.length && <UndoRow label={shotUndo.label} onUndo={runShotUndo} />}
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

function UndoRow({ label, onUndo }: { label: string; onUndo: () => void }) {
  return <div className="shotrow undo"><UndoChip label={label} onUndo={onUndo} /></div>
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
  const [undo, offerUndo, runUndo] = useUndo()
  const region = current ? ui.frameRegions[current.id] : undefined
  const made = madeWith(doc, ui, current?.job_id)
  const choice = pick ?? startingChoice(modelChoicesFor('frame', config), made.made)
  const staleMark = current && (doc.stale ?? []).find((s) => s.target.kind === 'frame' && s.target.id === current.id)
  // This frame made something after it out of date (the next frame, or this shot's clip).
  const madeStale = !!current && (doc.stale ?? []).some((s) => s.caused_by.kind === 'frame' && s.caused_by.id === current.id)
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
  const tools: { id: MarkMode; label: string; show: boolean; title: string }[] = [
    { id: 'box', label: '▭ Box', show: controls.regionEditFrames, title: 'Draw a box around what to change' },
    { id: 'brush', label: '✎ Brush', show: controls.maskBrush, title: 'Paint over what to change' },
    { id: 'click', label: '◎ Click', show: controls.clickSelect, title: 'Click the thing to change' },
  ]

  return (
    <div className="framecard">
      <div className="head">
        <b>Shot {index + 1}</b>
        <span className="faint">{label(shot.composition)} · {label(shot.camera_move)} · {shot.duration_s}s</span>
        <span className="spacer" />
        {staleMark && <span className="stale" title={staleMark.reason}>Out of date</span>}
        {showMock && current?.kind === 'mock' && <span className="mockbadge">MOCK</span>}
      </div>
      <RegionImage src={url} aspect={aspect} mode={running ? 'none' : mode} region={region} strokes={strokes}
        onRegion={setRegion} onStrokes={setStrokes}>
        {jobId && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <JobNode jobId={jobId} />
          </div>
        )}
        {!current && !jobId && (
          <div className="pending" style={{ animation: 'none', position: 'absolute', inset: 0 }}>
            {ui.drawingRest && !prevDrawn ? (
              <div className="faint">Waiting for shot {index}</div>
            ) : prevDrawn ? (
              <>
                <div className="faint">No frame yet</div>
                <button className="btn xs" onClick={onDraw} disabled={!doc.refs.length}>{index === 0 ? 'Draw frame 1' : 'Draw this one'}</button>
              </>
            ) : (
              <div className="faint">Draw shot {index} first</div>
            )}
          </div>
        )}
      </RegionImage>
      {current && (
        <>
          <div className="tools">
            {tools.filter((t) => t.show).map((t) => (
              <button key={t.id} className={`btn xs ${mode === t.id ? 'on' : ''}`} title={t.title} disabled={running} onClick={() => setMode(mode === t.id ? 'none' : t.id)}>{t.label}</button>
            ))}
            {(region || strokes.length > 0) && <button className="btn xs ghost" onClick={() => { setRegion(null); setStrokes([]) }}>Clear</button>}
            <span className="spacer" />
            {undo && <UndoChip label={undo.label} onUndo={runUndo} />}
            <div className="versions">
              <button className="btn xs icon ghost" aria-label="Previous version" disabled={idx <= 0} onClick={() => select(frames[idx - 1].id)}>‹</button>
              <span className="mono" title={made.label}>v{idx + 1}/{frames.length}</span>
              <button className="btn xs icon ghost" aria-label="Next version" disabled={idx >= frames.length - 1} onClick={() => select(frames[idx + 1].id)}>›</button>
              <button className="btn xs icon ghost iconbtn-del" aria-label={`Delete version ${idx + 1}`} disabled={frames.length <= 1 || running}
                title={frames.length <= 1 ? 'Regenerate instead' : `Delete v${idx + 1}`}
                onClick={async () => {
                  setError(null)
                  try {
                    const r = await deleteFrom(docStore, (d) => removeFrame(d, current.id))
                    offerUndo({ label: `v${idx + 1} deleted`, undo: () => restoreTo(docStore, r) })
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'That did not work.')
                  }
                }}>🗑</button>
            </div>
          </div>
          <div className="foot">
            <input className="input" placeholder={region ? 'Change what is in the box…' : 'Change this frame…'} maxLength={1000} value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !running && (text.trim() || !region) && regenerate()} />
            <div className="row">
              {parent && <button className="btn xs ghost" onClick={() => select(parent.id)} title="Go back to the version this came from">↶ Revert</button>}
              {!region && <ModelPick op="frame" value={choice} onChange={setPick} />}
              <span className="spacer" />
              {madeStale && <UpdateFollows size="xs" progress={false} />}
              {onNext && nextEmpty && !ui.drawingRest && (
                <button className="btn sm" disabled={running || nextBusy} onClick={onNext} title={`Draw shot ${index + 2}, continuing from this frame`}>Next frame →</button>
              )}
              <button className="btn sm primary" disabled={running || (!!region && !text.trim())} onClick={regenerate}>{region ? 'Change the box' : 'Regenerate'}</button>
            </div>
            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>{error}</div>}
          </div>
        </>
      )}
    </div>
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
