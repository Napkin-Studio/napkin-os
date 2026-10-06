// Stage 2: script → shot list → one frame per shot. Each frame can be changed
// with a sentence, optionally inside a box (or a painted mask, or a click when
// the provider can segment), and stepped back to an earlier version.

import { useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import type { Composition, CameraMove, Ratio, Region, Shot, View } from '../contracts/types'
import { CAMERA_MOVES, COMPOSITIONS } from '../contracts/types'
import { assetRef } from '../jobs/assets'
import { characterInput, isRunning, jobAt, ratioAspect } from '../jobs/select'
import { putBlob } from '../lib/blobs'
import { checkDurations, MAX_SHOTS, TARGETS } from '../lib/shots'
import { newId } from '../lib/ulid'
import { useBlobUrl } from '../ui/hooks'
import { JobNode } from '../ui/JobNode'
import { RegionImage, type MarkMode, type Stroke } from '../ui/RegionImage'
import { maskPng } from '../lib/mask'
import { updateDoc } from '../doc/store'

const RATIOS: Ratio[] = ['9:16', '1:1', '16:9']
const label = (s: string) => s.replace(/_/g, ' ')
const VIEW_OPTS: View[] = ['front', 'three_quarter', 'side', 'back']

export function Storyboard() {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { controls } = useConfig()
  useJobsTick()
  const [error, setError] = useState<string | null>(null)
  const shots = doc.shots ?? []
  const check = checkDurations(shots, ui.targetS)
  const planJob = jobAt(doc, ui, (c) => c.for === 'shot_list')
  const planning = isRunning(doc, planJob)
  const allFramed = shots.length > 0 && shots.every((s) => (doc.frames ?? []).some((f) => f.shot_id === s.id && f.selected))
  const anyFrameRunning = shots.some((s) => isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === s.id)))

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
    await runner.submit('shot_list', { script: text.slice(0, 600), targetS: ui.targetS }, [], { for: 'shot_list', revId })
  }

  const drawFrames = async (only?: string[]) => {
    setError(null)
    try {
      const character = await characterInput(relay, doc)
      for (const shot of shots) {
        if (only && !only.includes(shot.id)) continue
        if (!only && (doc.frames ?? []).some((f) => f.shot_id === shot.id && f.selected)) continue
        if (isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === shot.id))) continue
        await runner.submit('frame', { shot, character, ratio: ui.ratio }, [], { for: 'frame', shotId: shot.id })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

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
              {!doc.character.views.front && <span className="faint" style={{ fontSize: 12 }}>You need a Front view first.</span>}
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
              {shots.map((s, i) => (
                <div key={s.id} className="shotrow">
                  <span className="num">{i + 1}</span>
                  <div className="stack" style={{ gap: 4 }}>
                    <select className="select" aria-label="Composition" value={s.composition} onChange={(e) => updateShot(s.id, { composition: e.target.value as Composition })}>
                      {COMPOSITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                    </select>
                    <select className="select" aria-label="Character view" value={s.lead_view ?? 'front'} onChange={(e) => updateShot(s.id, { lead_view: e.target.value as View })}>
                      {VIEW_OPTS.map((v) => <option key={v} value={v}>{label(v)} view</option>)}
                    </select>
                  </div>
                  <textarea className="textarea" aria-label="Action" maxLength={300} value={s.action} onChange={(e) => updateShot(s.id, { action: e.target.value })} />
                  <select className="select" aria-label="Camera move" value={s.camera_move} onChange={(e) => updateShot(s.id, { camera_move: e.target.value as CameraMove })}>
                    {CAMERA_MOVES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                  </select>
                  <div className="row" style={{ gap: 4 }}>
                    <input className="input" aria-label="Seconds" type="number" min={1} max={10} step={0.5} value={s.duration_s}
                      onChange={(e) => updateShot(s.id, { duration_s: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
                    <span className="faint">s</span>
                  </div>
                  <button className="btn icon sm ghost" aria-label="Remove shot" title="Remove" disabled={shots.length <= 2}
                    onClick={() => updateDoc(docStore, (d) => {
                      d.shots = (d.shots ?? []).filter((x) => x.id !== s.id).map((x, k) => ({ ...x, order: k + 1 }))
                      d.frames = (d.frames ?? []).filter((f) => f.shot_id !== s.id)
                    }, 'delete shot')}>✕</button>
                </div>
              ))}
            </div>
            {shots.length > 0 && (
              <div className="row">
                <button className="btn sm ghost" disabled={shots.length >= MAX_SHOTS}
                  onClick={() => updateDoc(docStore, (d) => {
                    d.shots ??= []
                    d.shots.push({ id: newId('shot'), order: d.shots.length + 1, duration_s: 5, composition: 'medium', action: '', camera_move: 'static', lead_view: 'front', status: 'planned' })
                  }, 'add shot')}>+ Add shot</button>
                <span className="spacer" />
                <button className="btn dark" disabled={!check.ok || anyFrameRunning || !doc.character.views.front} onClick={() => drawFrames()}>
                  {anyFrameRunning ? 'Drawing…' : allFramed ? 'All frames drawn' : 'Draw frames'}
                </button>
              </div>
            )}
          </div>
        </div>

        {shots.length > 0 && (
          <>
            <div className="row" style={{ margin: '28px 0 12px' }}>
              <h2>Frames</h2>
              {controls.series && <span className="faint" style={{ fontSize: 12 }}>· drawn as one series for consistency</span>}
              <span className="spacer" />
              <button className="btn primary" disabled={!allFramed || anyFrameRunning} onClick={lock} title={allFramed ? '' : 'Every shot needs a frame'}>Lock storyboard → Video</button>
            </div>
            <div className="frames">
              {shots.map((s, i) => <FrameCard key={s.id} shot={s} index={i} onDraw={() => drawFrames([s.id])} />)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FrameCard({ shot, index, onDraw }: { shot: Shot; index: number; onDraw: () => void }) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { controls } = useConfig()
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
  const region = current ? ui.frameRegions[current.id] : undefined
  const stale = current && (doc.stale ?? []).some((s) => s.target.kind === 'frame' && s.target.id === current.id)
  const aspect = asset?.w && asset?.h ? asset.w / asset.h : ratioAspect(ui.ratio)

  const setRegion = (r: Region | null) => current && uiStore.update((u) => { u.frameRegions[current.id] = r ?? undefined })
  const select = (frameId: string) => updateDoc(docStore, (d) => {
    let sha: string | undefined
    for (const f of d.frames ?? []) if (f.shot_id === shot.id) {
      f.selected = f.id === frameId
      if (f.selected) sha = f.asset
    }
    const s = d.shots?.find((x) => x.id === shot.id)
    if (s && sha) s.storyboard_frame = sha
  }, 'select frame')

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
        await runner.submit('region_edit', { image, region, text: text.trim(), ...(mask ? { mask } : {}) }, [current.job_id], { for: 'frame', shotId: shot.id, parentFrameId: current.id })
      } else {
        const character = await characterInput(relay, doc)
        const prevShot = doc.shots?.[index - 1]
        const prevFrame = prevShot?.storyboard_frame ? await assetRef(relay, prevShot.storyboard_frame) : undefined
        await runner.submit('frame', { shot, character, ratio: ui.ratio, ...(text.trim() ? { text: text.trim() } : {}), ...(prevFrame ? { previousFrame: prevFrame } : {}) }, current ? [current.job_id] : [], { for: 'frame', shotId: shot.id, ...(current ? { parentFrameId: current.id } : {}) })
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
        {stale && <span className="stale" title="The character changed after this frame was drawn">Out of date</span>}
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
            <div className="faint">No frame yet</div>
            <button className="btn xs" onClick={onDraw} disabled={!doc.character.views.front}>Draw this one</button>
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
            <div className="versions">
              <button className="btn xs icon ghost" aria-label="Previous version" disabled={idx <= 0} onClick={() => select(frames[idx - 1].id)}>‹</button>
              <span className="mono">v{idx + 1}/{frames.length}</span>
              <button className="btn xs icon ghost" aria-label="Next version" disabled={idx >= frames.length - 1} onClick={() => select(frames[idx + 1].id)}>›</button>
            </div>
          </div>
          <div className="foot">
            <input className="input" placeholder={region ? 'Change what is in the box…' : 'Change this frame…'} maxLength={1000} value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !running && (text.trim() || !region) && regenerate()} />
            <div className="row">
              {parent && <button className="btn xs ghost" onClick={() => select(parent.id)} title="Go back to the version this came from">↶ Revert</button>}
              <span className="spacer" />
              <button className="btn sm primary" disabled={running || (!!region && !text.trim())} onClick={regenerate}>{region ? 'Change the box' : 'Regenerate'}</button>
            </div>
            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>{error}</div>}
          </div>
        </>
      )}
    </div>
  )
}
