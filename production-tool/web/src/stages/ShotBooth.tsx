// The Booth on a selected shot (features/production-new-ui.clan; mock production-new-ui-v2 states frame,
// frame-ask, redraw, redraw-result): the shot's versions, Change this frame (Edit parts | Redraw frame, no price)
// with what the Camera agent will send, its question when it asks, the result to Apply, Keep both or Discard;
// then the camera, the words and direction, the length, and the shot's own rows (image editor, script, History,
// insert after, download, delete). With no shot selected there is no Booth (the Booth rule).

import { useEffect, useMemo, useState } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import { CAMERA_ANGLES, CAMERA_MOVEMENTS, CAMERA_SIZES, type Camera, type Frame, type FrameEditMode, type Shot } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { selectFrame } from '../jobs/frames'
import {
  applyClipLine, applyFrameEditStep, cameBackSame, cameraDiff, cameraLabel, changeFrame, discardStep, frameEditCopy, frameEditLines, frameEditMode, frameEditOf,
  keepBothStep,
} from '../jobs/frameEdit'
import { isRunning } from '../jobs/select'
import { editShot } from '../jobs/stale'
import { modelLabel } from '../capabilities'
import { mediaItem } from '../media/names'
import { currentFrame, framesOf, refsList } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { insertShot } from '../script/edits'
import { scriptMentionHooks } from '../script/mentionHooks'
import { ShotEditor } from '../script/ShotEditor'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { placeAsk } from '../ui/askPlaces'
import { Booth } from '../ui/booth/Booth'
import { useBooth } from '../ui/booth/useBooth'
import { DownloadButton } from '../ui/Download'
import { useBlobUrl } from '../ui/hooks'
import { JobSlot } from '../ui/JobSlot'
import { sendRows } from '../ui/sendRows'
import { useProjectName } from '../ui/useDownload'
import { titleOf } from './shotTitle'
import { cameraChips, cap, changeShown, frameChangeOf, recastAsk } from './shotChange'

const MIN_S = 1
const MAX_S = 10

export interface ShotBoothProps {
  shot: Shot
  index: number
  storyboardId?: string
  store: ModelStore | null
  onClose: () => void
  onOpen: () => void
  onScript: () => void
  onDelete: () => void
  onHistory: () => void
}

export function ShotBooth(p: ShotBoothProps) {
  const booth = useBooth('storyboard')
  const { bringIn } = booth
  // Selecting a shot brings the Booth in, even if it was hidden before (a selection earns it).
  useEffect(() => { if (!booth.shown) bringIn() }, [p.shot.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Booth state={booth} earned scoped>
      <ShotBoothBody key={p.shot.id} {...p} />
    </Booth>
  )
}

function ShotBoothBody({ shot, index, storyboardId, store, onClose, onOpen, onScript, onDelete, onHistory }: ShotBoothProps) {
  const doc = useDoc()
  const ui = useUi()
  const { doc: docStore, ui: uiStore, runner, relay, clan } = useServices()
  const projectName = useProjectName()
  const mentions = useMemo(() => (clan ? scriptMentionHooks(clan, undefined) : undefined), [clan])
  const n = index + 1
  const frames = framesOf(doc, shot.id)
  const current = currentFrame(doc, shot) ?? frames.at(-1)
  const idx = current ? frames.indexOf(current) : -1
  const shown = current ? mediaItem(doc, projectName, current.asset, 'frame') : undefined
  const change = frameChangeOf(doc, ui, shot.id)
  const changeRunning = change ? isRunning(doc, change.job.id) : false
  const showChange = changeShown(doc, shot, change)
  const [words, setWords] = useState('')
  const [error, setError] = useState<string | null>(null)
  const attempt = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  // Edit parts | Redraw frame (features/frame-edit-or-redraw.clan): the person's pick, and the job's once it says.
  // The person's pick holds for the job it was made on; a newer job shows its own mode (a redraw it was sent as,
  // or one the Director agent read after "Redraw frame instead").
  const [pick, setPick] = useState<{ mode: FrameEditMode; job?: string }>({ mode: 'edit' })
  const jobMode = change ? frameEditMode(change.job) : undefined
  const mode: FrameEditMode = jobMode && pick.job !== change?.job.id ? jobMode : pick.mode
  const setMode = (m: FrameEditMode) => setPick({ mode: m, job: change?.job.id })
  const recast = recastAsk(doc, change)
  const recastId = recast?.id
  useEffect(() => (recastId ? placeAsk(recastId) : undefined), [recastId])
  const send = (redoOf?: string, as: FrameEditMode = mode) => attempt(async () => {
    setMode(as)
    await changeFrame({ relay, doc: docStore, ui: uiStore, runner }, shot.id, words, { ...(redoOf ? { redoOf } : {}), mode: as })
  })
  const answerRecast = (option: 'redraw' | 'edit') => attempt(async () => {
    if (!change) return
    if (option === 'redraw') setMode('redraw')
    await runner.answer(change.job.id, { optionId: option })
  })
  const chips = cameraChips(shot.camera)
  const changed = change && !changeRunning ? cameraDiff(shot.camera, frameEditOf(change.job)?.camera) : undefined
  const setCamera = (patch: Partial<Camera>) => void attempt(() => updateDoc(docStore, (d) => editShot(d, shot.id, { camera: { ...d.shots[shot.id].camera, ...patch } }), 'edit camera'))
  const setLength = (s: number) => void attempt(() => updateDoc(docStore, (d) => editShot(d, shot.id, { duration_s: Math.max(MIN_S, Math.min(MAX_S, s)) }), 'edit shot'))
  const named = refsList(doc).length
  const sending = sendRows(doc, storyboardId, [
    { key: 'frame', label: current ? `Frame ${n} v${idx + 1}` : `Shot ${n}’s words and camera`, detail: mode === 'edit' ? 'changed only where your words say' : 'drawn again from the shot' },
    { key: 'words', label: 'Your words', detail: words.trim() ? `“${words.trim().slice(0, 80)}”` : 'what you type above' },
    ...(named ? [{ key: 'refs', label: `${named} named ${named === 1 ? 'picture' : 'pictures'}` }] : []),
  ], mode === 'edit' ? frameEditCopy.send.edit : frameEditCopy.send.redraw)

  return (
    <div className="shotbooth" data-shot-booth={shot.id} aria-label={`Shot ${n}`}>
      <div className="sp-crumb"><button type="button" onClick={onClose}>← Storyboard</button><span>›</span><b>Shot {n} · {titleOf(shot)}</b>
        <button type="button" className="x" onClick={onClose} title="Back (Esc)" aria-label="Close the shot">×</button></div>
      {frames.length > 0 && (
        <div className="vers" role="group" aria-label="Versions">
          {frames.map((f, i) => <Version key={f.id} f={f} v={i + 1} on={f.id === current?.id} onPick={() => void attempt(() => selectFrame(docStore, shot.id, f.id))} />)}
        </div>
      )}

      <div className="bsec sb-change">
        <h4>Change this frame</h4>
        {!current ? <p className="sb-modehint">Draw this frame first; then change it here.</p> : (
          <>
            <div className="seg-row sb-mode" role="group" aria-label="How to change it">
              {(['edit', 'redraw'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} disabled={changeRunning} onClick={() => setMode(m)}>{frameEditCopy.mode[m]}</button>
              ))}
            </div>
            <div className="sb-modehint">{mode === 'edit' ? frameEditCopy.hint.edit : frameEditCopy.hint.redraw(n)}</div>
            <div className="row sb-changerow">
              <input className="field" aria-label="What to change in this frame" placeholder={frameEditCopy.placeholder[mode]} value={words} maxLength={1000} disabled={changeRunning && !recast}
                onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && words.trim() && !changeRunning) void send(showChange ? change?.job.id : undefined) }} />
              <button className="sp-btn sb-send" disabled={!words.trim() || changeRunning} onClick={() => void send(showChange ? change?.job.id : undefined)}>{showChange && !recast ? frameEditCopy.redo : frameEditCopy.send[mode]}</button>
            </div>
            <details className="disc-line">
              <summary>What the Camera agent will send</summary>
              <ul>{sending.map((r) => <li key={r.key} className={r.key === 'promise' ? 'promise' : undefined}><b>{r.label}</b>{r.detail && <small> · {r.detail}</small>}</li>)}</ul>
            </details>
          </>
        )}
        {recast && (
          <div className="sb-ask" role="group" aria-label="The Director agent asks">
            <div className="hd"><AgentFigure agent="dex" size={18} state="needs-you" decorative /><span>Director agent · needs your call</span></div>
            <p className="q">{frameEditCopy.recast.title}</p>
            <button type="button" className="opt rec" onClick={() => void answerRecast('redraw')}>
              <b>{frameEditCopy.recast.redraw}<span className="rec-tag">Recommended</span></b>
              <small>{frameEditCopy.hint.redraw(n)}</small>
            </button>
            <button type="button" className="opt" onClick={() => void answerRecast('edit')}>
              <b>{frameEditCopy.recast.edit}</b>
              <small>{frameEditCopy.recast.body.replace(/ Redraw the frame instead\?$/, '')}</small>
            </button>
            <p className="faint">{frameEditCopy.recast.unpaid}</p>
          </div>
        )}
        {change && changeRunning && !recast && (mode === 'redraw' && change.job.state !== 'needs_input'
          ? (
            <div className="sb-running" role="status">
              <div className="row"><AgentFigure agent="dex" size={22} state="working" decorative />
                <div><div>{frameEditCopy.redrawing(n)}</div><div className="faint">{modelLabel(change.job.provider, change.job.model)}</div></div>
              </div>
              <div className="sb-bar"><i /></div>
            </div>
          )
          : <div className="sb-changejob"><JobSlot jobId={change.job.id} compact /></div>)}
        {change && !changeRunning && change.proposal && showChange && (cameBackSame(change.proposal)
          ? (
            <div className="sb-nochange">
              <p><b>{frameEditCopy.unchanged(n)}</b><br /><span className="faint">{frameEditCopy.nothingMade}</span></p>
              <div className="row">
                <button className="btn sm dark" disabled={!words.trim()} onClick={() => void send(change.job.id, 'redraw')}>{frameEditCopy.redrawButton}</button>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => void attempt(() => discardStep(docStore, change.job.id))}>{frameEditCopy.discard}</button>
              </div>
            </div>
          )
          : (
            <div className="sb-result">
              <span>{frameEditOf(change.job)?.reading === 'redraw' ? frameEditCopy.redrew(n) : frameEditOf(change.job)?.reading === 'local' ? frameEditCopy.edited(n) : frameEditLines(change.job)[0]}</span>
              {frameEditLines(change.job).slice(1).map((l) => <span key={l} className="faint">{l}</span>)}
              <div className="sb-diff">
                <ProposalThumb sha={change.proposal.asset} version={change.proposal.version} />
                {frameEditOf(change.job)?.reading === 'redraw'
                  ? (
                    <div className="sb-keeps">
                      <div><b>{frameEditCopy.kept}</b>{frameEditCopy.keptWhat(chips.filter((c) => c.field === 'size' || c.field === 'angle').map((c) => c.label))}</div>
                      <div><b>{frameEditCopy.made}</b>{frameEditCopy.newWhat(frameEditOf(change.job)?.who)}</div>
                    </div>
                  )
                  : (
                    <div>
                      {changed?.rows.map((r) => <div key={r.field} className="sb-diffrow"><span>{r.field.replace('_mm', '')}</span><del>{r.from}</del>→<ins>{r.to}</ins></div>)}
                      {changed?.stay && <div className="faint">{changed.stay}</div>}
                      {frameEditOf(change.job)?.reading === 'local' && (
                        <div className="faint sb-notmeant">{frameEditCopy.notMeant} <button type="button" className="btn link" disabled={!words.trim()} onClick={() => void send(change.job.id, 'redraw')}>{frameEditCopy.redrawLink}</button> {frameEditCopy.withSame}</div>
                      )}
                    </div>
                  )}
              </div>
              <div className="row">
                <button className="btn sm primary" onClick={() => void attempt(() => applyFrameEditStep(docStore, change.job.id, shot.id))}>{frameEditCopy.apply}</button>
                <button className="btn sm" onClick={() => void attempt(() => keepBothStep(docStore, change.job.id, shot.id))}>{frameEditCopy.keepBoth}</button>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => void attempt(() => discardStep(docStore, change.job.id))}>{frameEditCopy.discard}</button>
              </div>
              {applyClipLine(doc, shot.id) && <div className="pt-pill warn sb-applyline">{applyClipLine(doc, shot.id)}</div>}
            </div>
          ))}
        {error && <div role="alert" className="framecard-error">{error}</div>}
      </div>

      <div className="bsec sb-camera">
        <h4>Camera <span className="r faint">{chips.map((c) => c.label).join(' · ')}</span></h4>
        <div className="cam-chips">
          <CamChip label="Size" value={shot.camera.size} options={CAMERA_SIZES} field="size" onPick={(v) => setCamera({ size: v as Camera['size'] })} />
          <CamChip label="Angle" value={shot.camera.angle ?? 'eye_level'} options={CAMERA_ANGLES} field="angle" onPick={(v) => setCamera({ angle: v as Camera['angle'] })} />
          <CamChip label="Move" value={shot.camera.movement ?? 'static'} options={CAMERA_MOVEMENTS} field="movement" onPick={(v) => setCamera({ movement: v as Camera['movement'] })} />
        </div>
        <span className="lbl">Words and direction</span>
        <div className="sb-booth-words">
          {store ? <ShotEditor store={store} shotId={shot.id} name={`Shot ${n}`} mentions={mentions} /> : <div className="script-excerpt">{shot.action ?? ''}</div>}
        </div>
        <div className="sb-length"><span className="lbl">Length</span>
          <button type="button" className="icon-btn" aria-label={`Shot ${n} shorter`} disabled={shot.duration_s <= MIN_S} onClick={() => setLength(shot.duration_s - 0.5)}>−</button>
          <b>{shot.duration_s} s</b>
          <button type="button" className="icon-btn" aria-label={`Shot ${n} longer`} disabled={shot.duration_s >= MAX_S} onClick={() => setLength(shot.duration_s + 0.5)}>+</button>
        </div>
      </div>

      <div className="bsec">
        <h4>This shot</h4>
        <button type="button" className="brow" disabled={!current} onClick={onOpen}><span className="t"><b>Open in image editor</b><small>Mask, fill, remove, upscale</small></span><span className="go">›</span></button>
        <button type="button" className="brow" onClick={onScript}><span className="t"><b>Open in script</b><small>Shot {n}</small></span><span className="go">›</span></button>
        <button type="button" className="brow" onClick={onHistory}><span className="t"><b>History</b><small>{frames.length ? frames.map((_, i) => `v${i + 1}`).join(', ') + ': what was drawn and why' : 'What was decided on this shot'}</small></span><span className="go">›</span></button>
        <button type="button" className="brow" disabled={!store} onClick={() => { if (store) void attempt(() => insertShot(store, { afterShotId: shot.id })) }}>
          <span className="t"><b>Insert a shot after this one</b><small>Empty shot · Bridge (not in this version yet)</small></span><span className="go">›</span></button>
        <div className="sb-shotlinks">
          {shown && <DownloadButton items={[shown]} className="side-link" title={`Download v${idx + 1}`} />}
          <button type="button" className="side-link" onClick={onDelete}>Delete shot</button>
        </div>
      </div>
    </div>
  )
}

function Version({ f, v, on, onPick }: { f: Frame; v: number; on: boolean; onPick: () => void }) {
  const url = useBlobUrl(f.asset)
  return <button type="button" aria-pressed={on} aria-label={`Version ${v}`} onClick={onPick}>{url ? <img src={url} alt="" /> : <i />}<span>v{v}</span></button>
}

function CamChip({ label, value, options, field, onPick }: { label: string; value: string; options: readonly string[]; field: keyof Camera; onPick: (v: string) => void }) {
  return (
    <label className="chip camchip" title={label}>
      <span className="pt-sr">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{cap(cameraLabel(field, o))}</option>)}
      </select>
    </label>
  )
}

function ProposalThumb({ sha, version }: { sha: string; version: number }) {
  const url = useBlobUrl(sha)
  return <span className="sb-proposal">{url && <img src={url} alt="" />}<span>{frameEditCopy.newVersion(version)}</span></span>
}
