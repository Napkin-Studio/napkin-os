// The Image editor (ui-behaviour 3.12; mock ImageEditor): one frame full screen over the storyboard,
// opened from a shot card. What it can do today is what the frame card could: mark an area (a box, a
// painted mask, or a click where the provider segments) and fill it with words (Rhea retouches, a
// region edit on Runway), change the whole frame (Change this frame, Dex reads camera or local), step
// through the versions, download and delete one. Cut-outs, layers, text and upscale have no backing
// feature yet and show as not yet (features/production-ui.clan open questions).

import { useEffect, useState } from 'react'
import { useConfig, useDoc, useServices, useUi } from '../app/context'
import type { ModelChoice, Region, Shot } from '../contracts/types'
import { choiceToSend, modelChoicesFor, modelWhere } from '../capabilities'
import { assetRef } from '../jobs/assets'
import { continuity, drawFrame, ownAspect, selectFrame } from '../jobs/frames'
import { isRunning, jobAt, ratioAspect } from '../jobs/select'
import { putBlob } from '../lib/blobs'
import { maskPng } from '../lib/mask'
import { currentFrame, framesOf, mainStoryboard, shotsOf } from '../model/selectors'
import { deleteFrom, removeFrame } from '../doc/remove'
import { errorShown } from '../dogfood/recorder'
import { useBlobUrl } from '../ui/hooks'
import { JobSlot } from '../ui/JobSlot'
import { ModelPick } from '../ui/ModelPick'
import { madeWith, startingChoice } from '../ui/modelChoice'
import { RegionImage, type MarkMode, type Stroke } from '../ui/RegionImage'
import { DownloadButton } from '../ui/Download'
import { useProjectName } from '../ui/useDownload'
import { mediaItem } from '../media/names'
import { EditorBar } from '../ui/chrome/TopBars'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { croppedCaption } from '../canvas/core/sketch'
import './image-editor.css'

const TOOL_ICON: Record<'none' | 'box' | 'brush' | 'click', React.ReactNode> = {
  none: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2 L13 8 L8 9 L6 14 Z" fill="currentColor" /></svg>,
  box: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.5 2" /></svg>,
  brush: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2.5 L13.5 6 L7 12.5 L3.5 13 L4 9.5 Z" fill="currentColor" /></svg>,
  click: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>,
}

export function ImageEditor({ shotId, onBack, onShot }: { shotId: string; onBack: () => void; onShot: (id: string) => void }) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config, controls } = useConfig()
  // The shot's own storyboard (more than one per project; features/canvas-nodes.clan).
  const sbId = doc.shots[shotId]?.storyboard_id
  const shots = shotsOf(doc, sbId)
  const index = shots.findIndex((s) => s.id === shotId)
  const shot: Shot | undefined = shots[index]
  const frames = shot ? framesOf(doc, shot.id) : []
  const current = shot ? currentFrame(doc, shot) ?? frames.at(-1) : undefined
  const idx = current ? frames.indexOf(current) : -1
  const url = useBlobUrl(current?.asset)
  const asset = current ? doc.assets[current.asset] : undefined
  const jobId = shot ? jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === shot.id) : undefined
  const running = isRunning(doc, jobId)
  const [mode, setMode] = useState<MarkMode>('none')
  const [fill, setFill] = useState('')
  const [whole, setWhole] = useState('')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const region = current ? ui.frameRegions[current.id] : undefined
  useEffect(() => { if (error) errorShown('frame', error, { shot: index + 1 }) }, [error, index])
  const made = madeWith(doc, ui, current?.job_id)
  const choice = pick ?? startingChoice(modelChoicesFor('frame', config), made.made)
  const project = useProjectName()
  const shown = current ? mediaItem(doc, project, current.asset, 'frame') : undefined
  const ratio = (sbId && doc.storyboards[sbId]?.ratio) || mainStoryboard(doc)?.ratio || '16:9'
  const aspect = asset?.w && asset?.h ? asset.w / asset.h : ratioAspect(ratio)
  if (!shot) return null

  const setRegion = (r: Region | null) => current && uiStore.update((u) => { u.frameRegions[current.id] = r ?? undefined })
  const select = (frameId: string) => selectFrame(docStore, shot.id, frameId)
  const marked = !!region || strokes.length > 0
  const attempt = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  // Fill area: a region edit on the marked area, in sequence with frame 1 and the one before.
  const fillArea = () => attempt(async () => {
    if (!current || !region) return
    const image = await assetRef(relay, current.asset)
    let mask
    if (strokes.length && controls.maskBrush && asset?.w && asset?.h) mask = await assetRef(relay, await putBlob(await maskPng(strokes, asset.w, asset.h)))
    const anchors = await continuity(relay, doc, index, false, sbId)
    const own = ownAspect(doc, current.asset)
    await runner.submit('region_edit', { image, region, text: fill.trim(), ...(mask ? { mask } : {}), ...anchors, ...(own ? { aspect: own } : {}) }, current.job_id ? [current.job_id] : [], { for: 'frame', shotId: shot.id, parentFrameId: current.id, how: 'again' })
    setFill('')
    setStrokes([])
    setMode('none')
    setRegion(null)
  })
  // Change whole frame: drawn again with the words (or the first draw when there is none yet).
  const changeWhole = () => attempt(async () => {
    const modelChoice = current ? choiceToSend('frame', config, choice) : undefined
    await drawFrame({ relay, doc: docStore, ui: uiStore, runner }, index, current ? 'again' : index === 0 ? 'first' : 'next', { text: whole, storyboardId: sbId, ...(current ? { parent: current } : {}), ...(modelChoice ? { modelChoice } : {}) })
    setWhole('')
  })
  const deleteVersion = () => attempt(async () => { if (current) await deleteFrom(docStore, (d) => removeFrame(d, current.id)) })
  const tools: { id: MarkMode; label: string; show: boolean }[] = [
    { id: 'none', label: 'Select', show: true },
    { id: 'box', label: 'Box an area', show: controls.regionEditFrames },
    { id: 'brush', label: 'Brush mask', show: controls.maskBrush },
    { id: 'click', label: 'Click a thing', show: controls.clickSelect },
  ]
  const prev = shots[index - 1]
  const next = shots[index + 1]
  const title = `Frame ${index + 1} · ${(shot.camera.size ?? 'shot').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}`

  return (
    <div className="editor image-editor">
      <EditorBar back="Storyboard" onBack={onBack} icon="frame" title={title}
        meta={<span className="pt-mono">{ratio} locked{asset?.w && asset?.h ? ` · ${asset.w} × ${asset.h}` : ''}</span>}
        right={frames.length > 0 ? (
          <span className="pt-pair ie-versions" role="group" aria-label="Versions">
            <button type="button" aria-label="Previous version" disabled={idx <= 0} onClick={() => select(frames[idx - 1].id)}>‹</button>
            <span className="pt-mono">v{idx + 1} of {frames.length}</span>
            <button type="button" aria-label="Next version" disabled={idx >= frames.length - 1} onClick={() => select(frames[idx + 1].id)}>›</button>
          </span>
        ) : undefined}
        primary={<button type="button" className="btn primary" disabled={running || !marked || !fill.trim()} onClick={() => void fillArea()}
          title={marked ? 'Fill the marked area as a new version' : 'Mark an area first, then say what goes there'}>Apply as new version</button>} />
      <div className="ie-body pt-grid">
        <div className="ie-tools pt-panel" role="toolbar" aria-label="Image tools" aria-orientation="vertical">
          {tools.filter((t) => t.show).map((t) => (
            <button key={t.id} type="button" className={mode === t.id ? 'on' : ''} aria-pressed={mode === t.id} aria-label={t.label} title={t.label}
              disabled={running} onClick={() => setMode(t.id)}>{TOOL_ICON[t.id]}</button>
          ))}
        </div>
        <div className="ie-stage">
          {mode !== 'none' && (
            <div className="ie-toolbar pt-panel" role="group" aria-label="The marked area">
              <b>{mode === 'box' ? 'Box' : mode === 'brush' ? 'Mask' : 'Click'}</b>
              <span className="faint">{mode === 'box' ? 'Drag over what to change' : mode === 'brush' ? 'Paint over what to change' : 'Click the thing to change'}</span>
              <button type="button" className="btn sm ghost" disabled={!marked} onClick={() => { setRegion(null); setStrokes([]) }}>Clear mask</button>
            </div>
          )}
          <div className="ie-frame" style={{ aspectRatio: String(aspect) }}>
            <RegionImage src={url} aspect={aspect} mode={running ? 'none' : mode} region={region} strokes={strokes} onRegion={setRegion} onStrokes={setStrokes}>
              {jobId && running && <div style={{ position: 'absolute', inset: 0 }}><JobSlot jobId={jobId} /></div>}
              {!current && !running && <div className="pending idle" style={{ position: 'absolute', inset: 0 }}><div className="faint">No frame yet</div></div>}
            </RegionImage>
          </div>
          <div className="ie-under">
            {made.made && (
              <span className="ie-said"><AgentFigure agent={current?.crew === 'rhea' ? 'rhea' : 'wren'} size={18} decorative />
                <b>{sayer(current?.crew === 'rhea' ? 'rhea' : 'wren')}:</b> {made.label}</span>
            )}
            {current?.cropped_to && asset?.w && asset?.h && <span className="pt-mono">{croppedCaption({ w: asset.w, h: asset.h }, current.cropped_to.to)}</span>}
            <span className="pt-grow" />
            <span className="pt-mono">Mask: blue paint marks what changes</span>
          </div>
          <div className="ie-edits pt-card">
            <div className="ie-edithead"><span className="pt-label">Versions</span><span className="faint">Nothing changes until you run an action. v{idx + 1} is never changed.</span></div>
            <div className="ie-vstrip">
              {frames.map((f, i) => <VersionTile key={f.id} sha={f.asset} n={i + 1} on={f.id === current?.id} onPick={() => select(f.id)} />)}
              {!frames.length && <span className="faint">No versions yet.</span>}
            </div>
            <div className="ie-edithead">
              {prev ? <button type="button" className="btn link" onClick={() => onShot(prev.id)}>← Frame {index}</button> : <span />}
              <span className="faint">Applying makes a new version and updates shot {index + 1} on the storyboard</span>
              {next ? <button type="button" className="btn link" onClick={() => onShot(next.id)}>Frame {index + 2} →</button> : <span />}
            </div>
          </div>
        </div>
        <aside className="ie-side">
          <section className="pt-panel ie-panel">
            <div className="pt-label ie-panelhead"><span>Layers</span><span>top is front</span></div>
            <div className="ie-layer"><span className="ie-layerthumb">{url && <img src={url} alt="" />}</span><span><b>Frame</b><br /><span className="pt-mono">v{idx + 1} · locked</span></span></div>
            <p className="faint ie-note">Text and cut-out layers are not in this version yet.</p>
          </section>
          <section className="pt-panel ie-panel">
            <div className="pt-label ie-panelhead"><span>Actions</span></div>
            <div className={`ie-action ${marked ? 'on' : ''}`}>
              <div className="row"><b>Fill area</b>{marked && <span className="pt-pill blue">Marked</span>}</div>
              <span className="faint">Fill with…</span>
              <textarea className="textarea" aria-label="Fill the marked area with" placeholder={marked ? 'add condensation drops' : 'Mark an area on the frame first'} disabled={!marked || running}
                value={fill} maxLength={1000} onChange={(e) => setFill(e.target.value)} />
              <div className="row"><span className="faint">Only the marked area changes</span><span className="spacer" />
                <button type="button" className="btn sm dark" disabled={!marked || !fill.trim() || running} onClick={() => void fillArea()}>Fill area</button></div>
            </div>
            <div className="ie-action">
              <b>Change whole frame</b>
              <div className="row">
                <input className="input" aria-label="Change the whole frame" placeholder="e.g. warmer light, keep the bottle" value={whole} maxLength={1000}
                  onChange={(e) => setWhole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !running) void changeWhole() }} />
                <button type="button" className="btn sm" disabled={running} onClick={() => void changeWhole()}>{current ? 'Change' : 'Draw'}</button>
              </div>
              {current && <div className="row"><ModelPick op="frame" value={choice} onChange={setPick} /><span className="faint">{choice ? modelWhere(choice.provider, choice.model) : ''}</span></div>}
            </div>
            <div className="ie-action">
              <b>Remove background</b>
              <span className="faint">Not in this version yet.</span>
            </div>
            <div className="ie-action">
              <div className="row"><b>Upscale</b><span className="spacer" /><button type="button" className="btn sm" disabled title="Not in this version yet">Upscale</button></div>
            </div>
            <div className="row ie-foot">
              {shown && <DownloadButton items={[shown]} className="btn sm ghost" title={`Download v${idx + 1}`} />}
              <span className="spacer" />
              <button type="button" className="btn sm ghost" disabled={!current || running} onClick={() => void deleteVersion()}>Delete v{idx + 1}</button>
            </div>
            {error && <div role="alert" className="ie-error">{error}</div>}
          </section>
        </aside>
      </div>
    </div>
  )
}

function VersionTile({ sha, n, on, onPick }: { sha: string; n: number; on: boolean; onPick: () => void }) {
  const url = useBlobUrl(sha)
  return (
    <button type="button" className={`ie-vtile ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`Version ${n}`} onClick={onPick}>
      <span className="ie-vthumb">{url && <img src={url} alt="" />}</span>
      <span>v{n}</span>
    </button>
  )
}
