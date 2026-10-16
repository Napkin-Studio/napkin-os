// Stage 3: one clip per frame. A shot strip with versions, a player (one clip,
// or all of them in order as the stitched preview), Frame.io-style comments
// pinned to a timecode (typing pauses the player; draw a box on the paused
// frame), a "change the feel" box, and Render / Export.
//
// Contract 3: the clips of a shot are its takes; the one in the cut is the main video's edl item pick;
// notes are reviews with a window; the ad is the video's picked render.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import type { ClipQuality, ModelChoice, Region, Review, Shot, Strength, Take } from '../contracts/types'
import { assetRef, remoteUrl } from '../jobs/assets'
import { isMoving, isRunning, jobAt } from '../jobs/select'
import { changeFeel, editQuality, makeClip as submitClip, remakeAsFinal, renderAd, shotQuality, videoQuality } from '../jobs/clips'
import { fixesInFrame, fixFrameLanded, fixInShot, fixProgress, remakeFixClip, shotsBeingFixed } from '../jobs/fix'
import { lastWorkedModel } from '../jobs/follow'
import { adStatus, takeStale } from '../jobs/stale'
import { adBehindLabel, behindLabel } from '../ui/behind'
import { rectToRegion } from '../lib/region'
import { fmtTime, useBlobUrl, useSending } from '../ui/hooks'
import { clipText } from '../lib/guard'
import { JobSlot } from '../ui/JobSlot'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeNote, removeTake } from '../doc/remove'
import { ModelItems, ModelPick } from '../ui/ModelPick'
import { Float, MenuItem } from '../ui/Float'
import { useUpdate } from '../ui/useUpdate'
import { SplitButton } from '../ui/SplitButton'
import type { FollowScope } from '../jobs/follow'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { madeWith, startingChoice } from '../ui/modelChoice'
import { choiceToSend, modelChoicesFor, modelLabel, QUALITY_NAMES, qualityLabel } from '../capabilities'
import { SHEETS } from '../contracts/load'
import { QualityPick } from '../ui/QualityPick'
import { Thumbs } from '../dogfood/Dogfood'
import { DownloadButton } from '../ui/Download'
import { downloadLabel, useDownload, useProjectName } from '../ui/useDownload'
import { mediaItem } from '../media/names'
import { ctxReader } from '../jobs/runner'
import { personOf } from '../projects/session'
import { currentRender, currentTake, isImplicit, mainVideo, openVideo, reviewsList, shotFrameAsset, shotNumber, shotsOf, storyboardOfVideo, takesOf } from '../model/selectors'
import { EditorBar } from '../ui/chrome/TopBars'
import { CopyLinkLater } from '../ui/chrome/MoreMenu'
import { nodeTitle } from '../ui/chrome/panels'
import './video.css'
import { SoundView } from './SoundView'
import { addTakeNote, pickTake } from './videoEdits'
import { PromptStart } from '../ui/prompt/PromptStart'
import { answerScriptVideo, clipMode, STRAIGHT, storyboardFromShots, waitsOnScriptAsk } from '../jobs/scriptVideo'
import { LOCAL_PERSON } from '../jobs/runner'
import { AddShot, InsertShot, ShotPanel } from './VideoShots'
import { runningPlan } from '../jobs/plan'
import { ClipTray } from './ClipTray'
import { ClipChoice } from './ClipChoice'
import { selectedFrame } from '../jobs/frames'
import { RemakeBar } from '../ui/Follow'
import { MAX_SHOTS } from '../lib/shots'

const STRENGTHS: { id: Strength; label: string; hint: string }[] = [
  { id: 'adhere', label: 'Adhere', hint: 'Small change, keeps the clip' },
  { id: 'flex', label: 'Flex', hint: 'Noticeable change' },
  { id: 'reimagine', label: 'Reimagine', hint: 'Big change' },
]

export function Video() {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  /** Picture or Sound (ui-behaviour 3.21): Sound is a shell until the audio features land. */
  const projectName = useProjectName()
  const [view, setView] = useState<'picture' | 'sound'>('picture')
  const doc = useDoc()
  const ui = useUi()
  const { controls, config } = useConfig()
  useJobsTick()
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  // The video opened on the canvas (ui.openNode), else the main one, with the storyboard that renders it
  // (features/canvas-nodes.clan). Its clips and its ad land in it.
  const video = openVideo(doc, ui.openNode)
  const sb = storyboardOfVideo(doc, video?.id)
  const isMain = !video || video.id === mainVideo(doc)?.id
  const shots = sb ? shotsOf(doc, sb.id) : []
  const [shotId, setShotId] = useState<string | null>(shots[0]?.id ?? null)
  const [mode, setMode] = useState<'shot' | 'all'>('shot')
  const [error, setError] = useState<string | null>(null)
  const shot = shots.find((s) => s.id === shotId) ?? shots[0]
  const take = shot ? currentTake(doc, shot.id, video?.id) : undefined
  const clipJob = (id: string) => jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === id)
  // An "uncertain" job is waiting on the participant (Stop waiting / Try again on its card), not on
  // the relay: it locks nothing (features/video-stage-findings.clan).
  const anyRunning = shots.some((s) => isMoving(doc, clipJob(s.id)))
  const taken = shots.filter((s) => !!currentTake(doc, s.id, video?.id)).length
  const allTaken = shots.length > 0 && taken === shots.length
  const stitchJob = jobAt(doc, ui, (c) => c.for === 'stitch' && (c.videoId ?? mainVideo(doc)?.id) === video?.id)
  const latestAd = currentRender(doc, video?.id)
  // One send per click burst: a double click paid twice (2026-10-09).
  const [makingAll, sendAll] = useSending()
  const [rendering, sendRender] = useSending()

  // Straight from the script (ui-behaviour 3.5): a shot with no frame yet makes its clip from its words, and
  // the shots are edited here, on the timeline (decided 2026-10-15). `own`: they are the video's own shot
  // list, with no Storyboard node; Make a storyboard from these shots shows them as one.
  const fromWords = clipMode(doc, video?.id) === 'straight'
  const own = isImplicit(sb)
  const editable = fromWords && !!sb
  const me = ui.me?.participantId ? `human:${ui.me.participantId}` : LOCAL_PERSON
  const [shaping, sendShape] = useSending()
  /** Dex plans the shots into the video again (its answer, straight from the script, once more). */
  const planHere = () => sendShape(async () => {
    setError(null)
    try {
      if (video) await answerScriptVideo(deps, video.id, STRAIGHT, me)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  /** Make a storyboard from these shots: a node on the canvas beside the video (one undo step there). */
  const showAsStoryboard = () => sendShape(async () => {
    setError(null)
    try {
      if (!video) return
      await storyboardFromShots(video.id)
      uiStore.update((u) => { u.stage = 'character' }, 'stage')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  const makeClip = (s: Shot, opts: { text?: string; modelChoice?: ModelChoice; quality?: ClipQuality } = {}) => submitClip(deps, s.id, { ...opts, videoId: video?.id, fromWords })
  // Make clips opens the send tray first (3.16): nothing paid starts until its Make clips.
  const [tray, setTray] = useState(false)
  const trayRef = useRef<HTMLButtonElement>(null)
  const toMake = shots.map((s, i) => ({ shot: s, n: i + 1 })).filter(({ shot: s }) => !takesOf(doc, s.id).length && !isRunning(doc, clipJob(s.id)))

  /** A clip for every shot picked in the tray. A shot that cannot be made does not stop the others; each
   *  one that failed is named. */
  const makeAll = (ids: string[], modelChoice?: ModelChoice, quality?: ClipQuality) => sendAll(async () => {
    setError(null)
    setTray(false)
    const failed: string[] = []
    for (const [i, s] of shots.entries()) {
      if (!ids.includes(s.id) || takesOf(doc, s.id).length || isRunning(doc, clipJob(s.id))) continue
      try {
        await makeClip(s, { modelChoice: modelChoice ?? choiceToSend('clip', config, lastWorkedModel(doc, 'clip', config)), ...(quality ? { quality } : {}) })
      } catch (e) {
        failed.push(`Shot ${i + 1}: ${e instanceof Error ? e.message : 'that did not work.'}`)
      }
    }
    if (failed.length) setError(failed.join(' '))
  })

  const render = () => sendRender(async () => {
    setError(null)
    try {
      // Each clip is cut to its shot's length (trimS): the ad is the shots plus the 2.5 s end card.
      await renderAd(deps, { videoId: video?.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  // Why Render ad is off, said on the button (a disabled button never said why).
  const renderBlocked = (!allTaken ? `Make a clip for every shot first (${taken} of ${shots.length} done)`
    : anyRunning ? 'Wait for the clips being made' : isMoving(doc, stitchJob) ? 'The ad is rendering' : undefined)

  if (!controls.video) {
    return <div className="panel"><div className="empty-state"><b>Video is off right now.</b></div></div>
  }
  // The approved editor top bar (mock VideoEditor), empty or not: ← Canvas, the node, its actions.
  const empty = !shots.length
  const bar = (
    <EditorBar back="Canvas" onBack={() => uiStore.update((u) => { u.stage = 'character' }, 'stage')} icon="video"
      title={`Video · ${isMain && !own ? nodeTitle(sb?.title, 'Storyboard', projectName) : nodeTitle(video?.title, 'Video', projectName)}`}
      meta={<><span className="pt-ratio">{sb?.ratio ?? video?.ratio ?? '16:9'} · {Math.round(sb?.target_s ?? video?.target_s ?? 15)} s</span>
        {video && <QualityDefault videoId={video.id} />}</>}
      view={{ label: 'View', value: view, onPick: (v) => setView(v as typeof view), options: [{ id: 'picture', label: 'Picture' }, { id: 'sound', label: 'Sound' }] }}
      more={() => <CopyLinkLater />}
      right={<>
        <button ref={trayRef} className="btn" aria-haspopup="dialog" aria-expanded={tray} disabled={empty || makingAll || anyRunning || allTaken} title={empty ? 'Plan the shots first' : undefined} onClick={() => setTray(!tray)}>{makingAll ? 'Preparing…' : anyRunning ? 'Making clips…' : allTaken ? 'All clips made' : 'Make clips'}</button>
        {tray && <ClipTray anchor={trayRef} open={tray} onClose={() => setTray(false)} shots={toMake} fromWords={fromWords} ratio={sb?.ratio ?? video?.ratio ?? '16:9'}
          quality={videoQuality(doc, video?.id)} onMake={(ids, m, q) => void makeAll(ids, m, q)} />}
      </>}
      primary={controls.stitch ? (
        <button className="btn primary" disabled={empty || rendering || !!renderBlocked} onClick={() => void render()} title={empty ? 'Plan the shots first' : renderBlocked ?? 'Join the clips into one ad with the end card'}>
          {rendering ? 'Sending…' : isMoving(doc, stitchJob) ? 'Rendering…' : 'Render ad'}
        </button>
      ) : undefined} />
  )
  const planning = sb ? runningPlan(doc, sb.id) : undefined
  if (empty) {
    return (
      <div className="editor">
        {bar}
        {video && <ClipChoice videoId={video.id} />}
        <div className="panel"><div className="empty-state">
          <AgentFigure agent="dex" size={64} state={planning ? 'working' : 'idle'} decorative />
          <span className="sayer">{sayer('dex')}</span>
          {planning
            ? <div className="ve-planning" role="status"><span>I'm planning the shots from the script. {fromWords ? 'They land on this video\'s timeline; then Make clips makes them straight from their words.' : 'Then draw and check their frames in the storyboard.'}</span></div>
            : fromWords
              ? <><b>No shots yet.</b>I plan the shots from the script into this video; you edit them here, then Make clips makes each one from its words.
                <div style={{ marginTop: 14 }}><button className="btn primary" disabled={shaping} onClick={() => void planHere()}>{shaping ? 'Sending…' : 'Plan the shots'}</button></div></>
              : video && waitsOnScriptAsk(doc, video.id) ? null
                : <><b>No shots yet.</b>{sb ? 'Plan your shots and draw the frames first; I make one clip per frame.' : 'Link a storyboard to this video on the canvas; I make one clip per frame.'}</>}
          {error && <div role="alert" className="ve-error">{error}</div>}
          {video && !fromWords && <PromptStart kind="video" nodeId={video.id} place="editor" />}
          {sb && !own && <div style={{ marginTop: 14 }}><button className="btn" onClick={() => uiStore.update((u) => { u.openNode = { ...u.openNode, storyboard: sb.id }; u.stage = 'storyboard' })}>Open the storyboard</button></div>}
        </div></div>
      </div>
    )
  }

  return (
    <div className="editor">
      {bar}
      {video && <ClipChoice videoId={video.id} />}
      <div className="panel ve-body pt-grid">
        {error && <div role="alert" className="ve-error">{error}</div>}
        {view === 'sound' ? <SoundView shots={shots} /> : <Player mode={mode} shot={shot} take={take} shots={shots} videoId={video?.id} onPickShot={setShotId}
          strip={(
            <div className="ve-timeline pt-card">
              <div className="ve-tlhead"><b>Timeline</b><span className="pt-pill ok">{taken} of {shots.length} clips</span><span className="pt-grow" />
                <RemakeBar dock="inline" />
                {own && <button className="btn sm" disabled={shaping} onClick={() => void showAsStoryboard()} title="Show these shots as a Storyboard node on the canvas, driving this video, to draw and check their frames. Undo on the canvas puts them back here.">Make a storyboard from these shots</button>}
                <button className={`btn sm ${mode === 'all' ? 'on' : ''}`} disabled={!allTaken} onClick={() => setMode('all')}
                  title={allTaken ? 'Play every shot in order' : `Make a clip for every shot first (${taken} of ${shots.length} done)`}>▶ All shots</button>
              </div>
              <div className="ve-track"><span className="ve-lane"><b>Shots</b><span>main track</span></span>
                <div className={`strip ${editable ? 'editable' : ''}`}>
                  {shots.map((s, i) => (
                    <Fragment key={s.id}>
                      {editable && i > 0 && <InsertShot after={shots[i - 1]} n={i} disabled={shots.length >= MAX_SHOTS} onMade={(id) => { setShotId(id); setMode('shot') }} />}
                      <ShotCard shot={s} index={i} videoId={video?.id} selected={mode === 'shot' && s.id === shot?.id} jobId={clipJob(s.id)}
                        onSelect={() => { setShotId(s.id); setMode('shot') }}
                        onMake={(opts) => makeClip(s, opts)} />
                    </Fragment>
                  ))}
                  {editable && sb && <AddShot storyboardId={sb.id} count={shots.length} onMade={(id) => { setShotId(id); setMode('shot') }} />}
                </div>
              </div>
              <div className="ve-tlfoot faint">Pause anywhere to leave a note. A note at a moment fixes the shot it is in.</div>
            </div>
          )}>
          {editable && mode === 'shot' && shot && <ShotPanel key={shot.id} shot={shot} index={shots.indexOf(shot)} count={shots.length} onGone={() => setShotId(null)} />}
          {stitchJob && <div className="card" style={{ height: 120, overflow: 'hidden' }}><JobSlot jobId={stitchJob} /></div>}
          {latestAd && <AdResult sha={latestAd.asset} />}
          {controls.feelEdit && take && shot && <FeelBox shot={shot} take={take} />}
        </Player>}
      </div>
    </div>
  )
}

/** Make clip's box (like the update box): words for this clip only, the model, "Make it". */
function MakeClipBox({ index, quality: start, onMake }: { index: number; quality: ClipQuality; onMake: (opts: { text?: string; modelChoice?: ModelChoice; quality?: ClipQuality }) => Promise<unknown> }) {
  const doc = useDoc()
  const { config } = useConfig()
  const [text, setText] = useState('')
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const [quality, setQuality] = useState<ClipQuality>(start)
  const [busy, send] = useSending()
  const [error, setError] = useState<string | null>(null)
  const choice = pick ?? lastWorkedModel(doc, 'clip', config)
  const make = () => send(async () => {
    setError(null)
    try {
      await onMake({ ...(text.trim() ? { text: text.trim() } : {}), modelChoice: choiceToSend('clip', config, choice), quality })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  return (
    <div className="stack clipbox-body" onClick={(e) => e.stopPropagation()}>
      <div className="fhead">Shot {index + 1} · clip</div>
      <textarea className="textarea" rows={2} maxLength={1000} autoFocus value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy && void make()}
        placeholder="Add words for this clip only (optional)" />
      <div className="row wrap" style={{ gap: 6 }}>
        <ModelPick op="clip" value={choice} onChange={setPick} />
        <QualityPick op="clip" choice={choice} value={quality} onChange={setQuality} />
      </div>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm primary" disabled={busy} onClick={() => void make()}>{busy ? 'Sending…' : 'Make it'}</button>
      </div>
    </div>
  )
}

function ShotCard({ shot, index, videoId, selected, jobId, onSelect, onMake }: {
  shot: Shot; index: number; videoId?: string; selected: boolean; jobId?: string; onSelect: () => void
  onMake: (opts: { text?: string; modelChoice?: ModelChoice; quality?: ClipQuality }) => Promise<unknown>
}) {
  const makeRef = useRef<HTMLButtonElement>(null)
  const [making, setMaking] = useState(false)
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const takes = takesOf(doc, shot.id)
  const sel = currentTake(doc, shot.id, videoId)
  const thumb = useBlobUrl(shotFrameAsset(doc, shot))
  const showMock = useShowMock()
  const open = reviewsList(doc).filter((r) => r.target.kind === 'take' && takes.some((t) => t.id === r.target.id) && r.state !== 'resolved').length
  const selIdx = sel ? takes.findIndex((t) => t.id === sel.id) : -1
  const ui = useUi()
  const selMade = madeWith(doc, ui, sel?.job_id)
  // A fix that is redoing this shot's clip replaces it: not "out of date" meanwhile.
  const stale = shotsBeingFixed(doc, ctxReader(doc, ui)).has(shot.id) ? undefined : takeStale(doc, shot.id)
  // Remake: this clip only; ▾ this and the clips after it (features/one-to-one-updates.clan).
  const update = useUpdate()
  const [error, setError] = useState<string | null>(null)
  const afterScope = { kind: 'after', item: { kind: 'clip', shotId: shot.id } } as const
  const after = update.size(afterScope)
  const start = async (scope: FollowScope) => {
    setError(null)
    try {
      await update.start(scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  const remove = async () => {
    if (!sel) return
    await deleteFrom(docStore, (d) => removeTake(d, sel.id)) // Undo in the top bar puts it back
  }
  return (
    <div className={`shotcard ${selected ? 'sel' : ''}`} data-shot-card={shot.id} role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
        e.preventDefault() // Space would scroll the page
        onSelect()
      }
    }}>
      <div className="thumb">
        {thumb ? <img src={thumb} alt="" /> : shot.action ? <span className="ve-thumbwords">{shot.action}</span> : null}
        {jobId && <div style={{ position: 'absolute', inset: 0 }}><JobSlot jobId={jobId} compact /></div>}
      </div>
      {sel && <ShotMenu shot={shot} take={sel} n={selIdx + 1} only={takes.length <= 1} busy={isRunning(doc, jobId)} onDelete={remove} onError={setError} />}
      <div className="meta">
        <div className="row"><b>Shot {index + 1}</b><span className="faint">{shot.duration_s}s</span></div>
        <div className="row wrap" style={{ gap: 4 }}>
          {takes.map((t, i) => (
            <button key={t.id} className={`vchip ${t.id === sel?.id ? 'on' : ''}`} title={[t.kind === 'mock' ? 'Mock clip' : t.model ? `${modelLabel(t.provider, t.model)} (${t.provider})` : '', qualityLabel(t.quality, t.size)].filter(Boolean).join(' · ')}
              onClick={(e) => {
                e.stopPropagation()
                void updateDoc(docStore, (d) => pickTake(d, shot.id, t.id, videoId), 'pick take')
              }}>v{i + 1}</button>
          ))}
          {!takes.length && !jobId && <button ref={makeRef} className="btn xs" aria-haspopup="dialog" aria-expanded={making} onClick={(e) => { e.stopPropagation(); setMaking(!making) }}>Make clip</button>}
          <Float anchor={makeRef} open={making} onClose={() => setMaking(false)} role="dialog" label={`Make the clip for shot ${index + 1}`} className="clipbox">
            {making && <MakeClipBox index={index} quality={shotQuality(doc, shot.id, videoId)} onMake={async (opts) => { await onMake(opts); setMaking(false) }} />}
          </Float>
          {sel?.quality && <TakeQuality take={sel} />}
          {showMock && sel?.kind === 'mock' && <span className="mockbadge">MOCK</span>}
          {selMade.fallback && <span className="madeon" title={`${selMade.fallback}. ${ui.jobs[sel?.job_id ?? '']?.fallbackReason ?? ''}`.trim()}>Made on Runway</span>}
        </div>
        {(stale || open > 0) && (
          <div className="badges">
            {stale && <span className={`behind ${isRunning(doc, jobId) ? 'updating' : ''}`} title={stale.reason}>{isRunning(doc, jobId) ? 'Updating…' : behindLabel(doc, stale)}</span>}
            {open > 0 && <span className="notechip" title="Open notes">{open} note{open > 1 ? 's' : ''}</span>}
          </div>
        )}
        {stale && !isRunning(doc, jobId) && (
          <div className="row" style={{ gap: 4 }}>
            <SplitButton kind="dark" size="xs" menuLabel={`More ways to remake clip ${index + 1}`} disabled={update.running}
              title={`Remake clip ${index + 1} only, from its frame and shot as they are now`}
              onClick={() => void start({ kind: 'one', item: { kind: 'clip', shotId: shot.id } })}
              items={after > 1 ? [{
                label: `Remake this and the clips after (${after})`, icon: '⇥',
                onSelect: () => void start(afterScope),
              }] : []}>
              Remake
            </SplitButton>
          </div>
        )}
        {error && <div role="alert" className="framecard-error" style={{ padding: 0 }}>{error}</div>}
      </div>
    </div>
  )
}

/** A shot card's ⋯ menu: a new take (on the model that made this one, or another), and delete. */
function ShotMenu({ shot, take, n, only, busy, onDelete, onError }: {
  shot: Shot; take: Take; n: number; only: boolean; busy: boolean; onDelete: () => void; onError: (message: string | null) => void
}) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<false | 'main' | 'models'>(false)
  const close = useCallback(() => setOpen(false), [])
  const options = modelChoicesFor('clip', config)
  const start = startingChoice(options, madeWith(doc, ui, take.job_id).made)
  const [sending, send] = useSending()
  const project = useProjectName()
  const clip = mediaItem(doc, project, take.asset, 'clip')
  const [saving, save] = useDownload()
  // Its error shows under the card, like Make clip's (it failed silently before, 2026-10-09).
  const newTake = (choice: ModelChoice | undefined) => {
    close()
    void send(async () => {
      onError(null)
      try {
        await submitClip({ relay, doc: docStore, ui: uiStore, runner }, shot.id, { parentTake: take, modelChoice: choiceToSend('clip', config, choice), quality: take.quality ?? shotQuality(doc, shot.id) })
      } catch (e) {
        onError(e instanceof Error ? e.message : 'That did not work.')
      }
    })
  }
  return (
    <>
      <button ref={ref} className={`shotmore ${open ? 'open' : ''}`} aria-label={`Shot ${shotNumber(doc, shot.id)} options`} aria-haspopup="menu" aria-expanded={!!open}
        onClick={(e) => { e.stopPropagation(); setOpen(open ? false : 'main') }}>⋯</button>
      <Float anchor={ref} open={!!open} onClose={close} align="end" label={`Shot ${shotNumber(doc, shot.id)}, clip v${n}`} className={open === 'models' ? 'modelmenu' : ''}>
        {open === 'models' ? (
          <>
            <div className="fhead">New take of shot {shotNumber(doc, shot.id)} with</div>
            <ModelItems options={options} current={start} onPick={(o) => newTake(o)} />
          </>
        ) : (
          <>
            <div className="fhead">Shot {shotNumber(doc, shot.id)} · clip v{n}</div>
            <MenuItem icon="▶" disabled={busy || sending} onSelect={() => newTake(start)}>{sending ? 'Sending…' : 'New take'}</MenuItem>
            {options.length > 1 && <MenuItem icon="⇄" disabled={busy || sending} hint="▸" onSelect={() => setOpen('models')}>New take on another model</MenuItem>}
            {take.quality === 'draft' && (
              <MenuItem icon="★" disabled={busy || sending} hint={finalHint(doc, take)} onSelect={() => { close(); void send(async () => {
                onError(null)
                try {
                  await remakeAsFinal({ doc: docStore, ui: uiStore, runner }, take)
                } catch (e) {
                  onError(e instanceof Error ? e.message : 'That did not work.')
                }
              }) }}>Remake as Final</MenuItem>
            )}
            {clip && (
              <MenuItem icon="↓" disabled={saving === 'busy'} hint={saving === 'idle' ? clip.name.split('.').pop() : undefined}
                onSelect={() => void save([clip]).then((ok) => ok && close())}>{downloadLabel(saving, `Download v${n}`)}</MenuItem>
            )}
            <div className="fsep" />
            {/* A shot needs one clip: remaking the only one costs a video job (2026-10-09). */}
            <MenuItem icon="🗑" danger disabled={busy || only} hint={only ? 'a shot needs one clip' : undefined} onSelect={() => { close(); onDelete() }}>Delete v{n}</MenuItem>
          </>
        )}
      </Float>
    </>
  )
}

/** `shots`: the video's shots in order; `videoId`: the video whose cut plays (another video's cut played
 *  the main video's takes, 2026-10-15). */
function Player({ mode, shot, take, shots, videoId, onPickShot, strip, children }: { mode: 'shot' | 'all'; shot?: Shot; take?: Take; shots: Shot[]; videoId?: string; onPickShot: (id: string) => void; strip?: React.ReactNode; children?: React.ReactNode }) {
  const { doc: docStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config, controls } = useConfig()
  const video = useRef<HTMLVideoElement>(null)
  const stageBox = useRef<HTMLDivElement>(null)
  const playlist = useMemo(() => shots.map((s) => ({ shot: s, take: currentTake(doc, s.id, videoId) })).filter((x) => x.take) as { shot: Shot; take: Take }[], [shots, doc, videoId])
  const [idx, setIdx] = useState(0)
  const cur = mode === 'all' ? playlist[idx] : take && shot ? { shot, take } : undefined
  // Not in this browser (another device, cleared storage): the relay's copy (2026-10-09).
  const url = useBlobUrl(cur?.take.asset) ?? remoteUrl(doc, cur?.take.asset)
  // The relay's mock makes a still for a clip, not a video: it shows as the picture it is.
  const still = !!(cur && doc.assets[cur.take.asset]?.mime.startsWith('image/'))
  const stillS = cur ? cur.take.duration_s ?? cur.shot.duration_s : 0
  useEffect(() => {
    if (!still || mode !== 'all' || !stillS) return
    const id = setTimeout(() => setIdx((i) => (i + 1 < playlist.length ? i + 1 : 0)), stillS * 1000)
    return () => clearTimeout(id)
  }, [still, mode, stillS, idx, playlist.length])
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [note, setNote] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [region, setRegion] = useState<Region | null>(null)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const [focusPin, setFocusPin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingSeek = useRef<number | null>(null)

  // The regenerate menu (features/model-choice.clan): starts on the model that made this take.
  const [pick, setPick] = useState<ModelChoice | undefined>()
  // Quality beside it (features/clip-quality.clan): the video's default unless picked for this clip.
  const [qPick, setQPick] = useState<ClipQuality | undefined>()

  // New clip: reset the composer bits that belong to the old one, and the model picked and the
  // error left from it (another shot's pick and error stayed on screen, 2026-10-09).
  const [forTake, setForTake] = useState(cur?.take.id)
  if (forTake !== cur?.take.id) {
    setForTake(cur?.take.id)
    setRegion(null)
    setDrawing(false)
    setPick(undefined)
    setQPick(undefined)
    setError(null)
  }

  const reviews = reviewsList(doc).filter((r) => r.target.kind === 'take' && cur && takesOf(doc, cur.shot.id).some((x) => x.id === r.target.id))
    .sort((a, b) => (a.at_s ?? 0) - (b.at_s ?? 0))
  const openNotes = reviews.filter((r) => r.state !== 'resolved' && r.target.id === cur?.take.id)
  const fixJob = cur ? jobAt(doc, ui, (c) => (c.for === 'clip' || (c.for === 'frame' && !!c.fixReviewIds?.length)) && c.shotId === cur.shot.id) : undefined
  const fixing = isRunning(doc, fixJob)
  // A shot's first clip, being made or failed: its card (Cancel, Retry, Model) in the empty player.
  const firstJob = !cur && mode === 'shot' && shot ? jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === shot.id) : undefined
  const [sending, send] = useSending()
  const made = madeWith(doc, ui, cur?.take.job_id)
  const choice = pick ?? startingChoice(modelChoicesFor('clip', config), made.made)
  const quality = qPick ?? (cur ? shotQuality(doc, cur.shot.id, videoId) : 'standard')
  const project = useProjectName()
  const playing = cur ? mediaItem(doc, project, cur.take.asset, 'clip') : undefined

  const services = useServices()
  const deps = { relay, doc: docStore, ui: services.ui, runner }

  /** Make the shot again from its frame, as a new take of this one. */
  const again = () => send(async () => {
    if (!cur) return
    setError(null)
    try {
      await submitClip(deps, cur.shot.id, { parentTake: cur.take, modelChoice: choiceToSend('clip', config, choice), quality })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  /** Remake as Final: this draft at Final, its own words, pictures and length (features/clip-quality.clan). */
  const toFinal = () => send(async () => {
    if (!cur) return
    setError(null)
    try {
      await remakeAsFinal(deps, cur.take)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  const pause = () => video.current && !video.current.paused && video.current.pause()

  /** A first play could stall with no data until the play mark was moved (2026-10-09). Moving it makes the
   *  browser read the file again at that point, so the player does the same: still playing but with no
   *  frame to show a moment later, it seeks to where it is. */
  const unstick = (v: HTMLVideoElement) => {
    window.setTimeout(() => {
      if (v.paused || v.ended || v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return
      const at = v.currentTime
      v.currentTime = at
    }, 700)
  }

  const addNote = () => {
    if (!cur || !note.trim()) return
    const atS = Math.round((video.current?.currentTime ?? t) * 100) / 100
    const by = `human:${personOf(ui.me).id}`
    const take = cur.take
    const shotS = take.duration_s || cur.shot.duration_s
    void updateDoc(docStore, (d) => {
      addTakeNote(d, { takeId: take.id, shotId: cur.shot.id, shotS, atS, text: clipText(note.trim(), 1000), region, by, videoId })
    }, 'comment')
    setNote('')
    setRegion(null)
    setDrawing(false)
  }

  const boxedOpen = openNotes.filter((r) => r.region)
  // A note with a box is fixed in the shot (jobs/fix.ts): the storyboard frame first, then a new clip from it.
  const fixesInShot = !!cur && fixesInFrame(doc, cur.shot.id, boxedOpen, controls.fixInShot)
  const progress = cur ? fixProgress(doc, ctxReader(doc, ui), reviews.filter((r) => r.target.id === cur.take.id).map((r) => r.id)) : undefined
  // The fix's frame already landed and only its clip failed: Fix makes only the clip, from the fixed frame.
  const fixedFrame = cur && fixesInShot ? fixFrameLanded(doc, ctxReader(doc, ui), openNotes.map((r) => r.id)) : undefined

  const fix = () => send(async () => {
    if (!cur || !openNotes.length) return
    setError(null)
    try {
      const one = openNotes.length === 1 ? openNotes[0] : undefined
      const ids = openNotes.map((r) => r.id)
      if (fixedFrame) {
        await remakeFixClip(deps, fixedFrame, choiceToSend('clip', config, choice), quality)
      } else if (fixesInShot) {
        await fixInShot(deps, cur.shot.id, openNotes, choiceToSend('clip', config, choice), quality)
      } else if (one?.region && controls.videoRegionEdit) {
        const v = await assetRef(relay, cur.take.asset, docStore.get())
        await runner.submit('clip_edit', { video: v, region: one.region, atS: one.at_s ?? 0, text: one.text ?? '' }, [cur.take.job_id], { for: 'clip', shotId: cur.shot.id, parentTakeId: cur.take.id, reviewIds: ids })
      } else {
        const text = clipText(openNotes.map((r) => `At ${fmtTime(r.at_s ?? 0)}: ${r.text ?? ''}`).join('\n'), 1000)
        await submitClip(deps, cur.shot.id, { text, reviewIds: ids, parentTake: cur.take, modelChoice: choiceToSend('clip', config, choice), quality })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  const jump = (r: Review) => {
    const target = r.target.kind === 'take' ? doc.takes[r.target.id] : undefined
    if (target && cur && target.id !== cur.take.id) {
      void updateDoc(docStore, (d) => pickTake(d, target.shot_id, target.id, videoId), 'pick take')
    }
    if (target && mode === 'all') onPickShot(target.shot_id)
    pendingSeek.current = r.at_s ?? 0
    if (video.current) {
      video.current.pause()
      video.current.currentTime = r.at_s ?? 0
    }
    setFocusPin(r.id)
  }

  const local = (e: React.PointerEvent) => {
    const b = stageBox.current!.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top, w: b.width, h: b.height }
  }

  const focused = reviews.find((r) => r.id === focusPin)
  const shownRegion = drag
    ? { left: Math.min(drag.a.x, drag.b.x), top: Math.min(drag.a.y, drag.b.y), width: Math.abs(drag.b.x - drag.a.x), height: Math.abs(drag.b.y - drag.a.y) }
    : region
      ? { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }
      : focused?.region
        ? { left: `${focused.region.x * 100}%`, top: `${focused.region.y * 100}%`, width: `${focused.region.w * 100}%`, height: `${focused.region.h * 100}%` }
        : null

  // Timeline: one segment per shot in "all" mode.
  const segs = mode === 'all' ? playlist.map((p) => p.take.duration_s ?? p.shot.duration_s) : []
  const segTotal = segs.reduce((a, b) => a + b, 0)

  return (
    <div className="video-layout">
    <div className="stack" style={{ gap: 0 }}>
      <div className="player">
        {cur && url && still ? (
          <div className="stagebox still" style={{ height: '100%' }}>
            <img src={url} alt={`Shot ${shotNumber(doc, cur.shot.id)}`} style={{ height: '100%' }} />
            <div className="stillnote">A still from the mock: no video was made for this shot.</div>
          </div>
        ) : cur && url ? (
          <div className="stagebox" ref={stageBox} style={{ height: '100%' }}>
            <video
              key={cur.take.id}
              ref={video}
              src={url}
              controls={!drawing}
              playsInline
              preload="auto"
              autoPlay={mode === 'all' && idx > 0}
              style={{ height: '100%' }}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration
                setDur(Number.isFinite(d) && d > 0 ? d : cur.take.duration_s ?? cur.shot.duration_s)
                if (pendingSeek.current !== null) {
                  e.currentTarget.currentTime = pendingSeek.current
                  pendingSeek.current = null
                }
              }}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
              onPlay={(e) => { setFocusPin(null); unstick(e.currentTarget) }}
              onWaiting={(e) => unstick(e.currentTarget)}
              onEnded={() => mode === 'all' && setIdx((i) => (i + 1 < playlist.length ? i + 1 : 0))}
            />
            {drawing && (
              <div className="drawlayer"
                onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = local(e); setDrag({ a: p, b: p }) }}
                onPointerMove={(e) => drag && setDrag({ ...drag, b: local(e) })}
                onPointerUp={(e) => { if (drag) { const p = local(e); setRegion(rectToRegion(drag.a, p, { w: p.w, h: p.h })); setDrag(null) } }} />
            )}
            {shownRegion && <div className="regionbox" style={shownRegion} />}
          </div>
        ) : (
          <div className="empty">
            {mode === 'all' ? 'Make a clip for every shot to preview the whole ad.' : (fixJob ?? firstJob) ? <div style={{ width: 260, height: 160 }}><JobSlot jobId={(fixJob ?? firstJob)!} /></div> : 'No clip for this shot yet. Press Make clip.'}
          </div>
        )}
        {/* The clip on show, as one file (in All shots: the one playing). */}
        {cur && url && playing && !drawing && (
          <div className="player-dl">
            <DownloadButton items={[playing]} className="btn xs" title={`Download shot ${shotNumber(doc, cur.shot.id)}, v${takesOf(doc, cur.shot.id).findIndex((x) => x.id === cur.take.id) + 1} (${playing.name})`} />
          </div>
        )}
      </div>

      {mode === 'all' && segs.length > 0 ? (
        <div className="timeline" title="Click a shot to jump">
          {playlist.map((p, i) => (
            <div key={p.take.id} className={`seg ${i === idx ? 'cur' : ''}`} style={{ width: `${(segs[i] / segTotal) * 100}%` }} onClick={() => setIdx(i)}>Shot {shotNumber(doc, p.shot.id)}</div>
          ))}
        </div>
      ) : cur && dur > 0 ? (
        <div className="timeline" onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          if (video.current) video.current.currentTime = ((e.clientX - b.left) / b.width) * dur
        }}>
          <div className="head" style={{ left: `${(t / dur) * 100}%` }} />
          {reviews.filter((r) => r.target.id === cur.take.id).map((r) => (
            <span key={r.id} className={`mark ${r.state === 'resolved' ? 'done' : ''}`} style={{ left: `${Math.min(100, ((r.at_s ?? 0) / dur) * 100)}%` }} title={r.text} onClick={(e) => { e.stopPropagation(); jump(r) }} />
          ))}
        </div>
      ) : null}
      {strip}
    </div>

    <div className="stack" style={{ gap: 14 }}>
      {cur && mode === 'shot' && (
        <div className="card section stack notes-panel">
          <div className="row">
            <h2>Notes</h2>
            <span className="faint" style={{ fontSize: 12 }}>Shot {shotNumber(doc, cur.shot.id)} · v{takesOf(doc, cur.shot.id).findIndex((x) => x.id === cur.take.id) + 1}</span>
            {cur.take.quality && <TakeQuality take={cur.take} />}
            <Thumbs key={cur.take.id} compact target={{
              kind: 'clip', id: cur.take.id, jobId: cur.take.job_id, shot: shotNumber(doc, cur.shot.id), provider: cur.take.provider, model: cur.take.model,
            }} />
            {(() => {
              const st = shotsBeingFixed(doc, ctxReader(doc, ui)).has(cur.shot.id) ? undefined : takeStale(doc, cur.shot.id)
              return st && st.target.id === cur.take.id ? <span className="behind" title={st.reason}>{behindLabel(doc, st)}</span> : null
            })()}
          </div>
          <div className="composer">
          <textarea className="composer-input" rows={2} aria-label="Note at this moment" placeholder="Leave a note at this moment…" maxLength={1000} value={note}
            onFocus={pause} onChange={(e) => { pause(); setNote(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                addNote()
              }
            }} />
          <div className="row">
            <span className="tc" title="Where the note sticks">{fmtTime(t)}</span>
            {/* The box: on clip_edit where the provider edits video regions (flag videoRegionEdit), and
                "Fix it in the shot" everywhere frame region edits are on (decided 2026-10-07). */}
            {(controls.videoRegionEdit || controls.fixInShot) && (
              <button className={`btn xs ${drawing ? 'on' : ''}`} title="Draw a box on the paused frame" onClick={() => { pause(); setDrawing(!drawing) }}>▭ Box</button>
            )}
            <span className="spacer" />
            <button className="btn sm dark" disabled={!note.trim()} onClick={addNote}>Add note</button>
          </div>
          </div>
          {region && <div className="faint" style={{ fontSize: 12 }}>Box set on the paused frame.{controls.fixInShot ? ' It is fixed in the shot\'s frame, then the clip is made again.' : ''} <button className="btn xs ghost" onClick={() => setRegion(null)}>Remove box</button></div>}
          {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
          {progress?.running && (
            <div className="faint" role="status" style={{ fontSize: 12.5, fontWeight: 600 }}>{progress.step === 'frame' ? 'Fixing the frame…' : 'Making the clip…'}</div>
          )}
          {fixJob && <div style={{ minHeight: 96, borderRadius: 12, overflow: 'hidden', display: 'flex' }}><JobSlot jobId={fixJob} /></div>}
          <div className="comments">
            {reviews.flatMap((r) => {
              const v = takesOf(doc, cur.shot.id).findIndex((x) => x.id === r.target.id) + 1
              const row = (
                <div key={r.id} className="comment" onClick={() => jump(r)} style={focusPin === r.id ? { borderColor: 'var(--create)' } : undefined}>
                  <div className="row">
                    <span className="tc">{fmtTime(r.at_s ?? 0)}</span><span className="faint" style={{ fontSize: 11 }}>v{v}{r.region ? ' · box' : ''}</span><span className="spacer" />{r.state === 'resolved' && <span className="ok">✓ Addressed</span>}
                    <button className="btn xs icon ghost iconbtn-del del" aria-label="Delete note" title="Delete note" onClick={async (e) => {
                      e.stopPropagation()
                      if (focusPin === r.id) setFocusPin(null)
                      await deleteFrom(docStore, (d) => removeNote(d, r.id)) // Undo in the top bar puts it back
                    }}>🗑</button>
                  </div>
                  <div>{r.text}</div>
                </div>
              )
              return [row]
            })}
            {!reviews.length && (
              <div className="notes-empty">
                <AgentFigure agent="ellis" size={44} decorative />
                <div><span className="sayer">{sayer('ellis')}</span>Pause the clip and type. Your note sticks to that moment, and I read them all back before anything is made again.</div>
              </div>
            )}
          </div>
          {openNotes.length > 0 && !fixing && (
            <div className="cameo">
              <AgentFigure agent="ellis" size={40} decorative />
              <div><span className="sayer">{sayer('ellis')}</span>{ellisLine(openNotes.length, boxedOpen.length, fixesInShot, !!fixedFrame)}</div>
            </div>
          )}
          <div className="notes-actions">
          {openNotes.length > 0 && (
            <button className="btn primary" disabled={fixing || sending} onClick={() => void fix()}
              title={fixedFrame ? 'The frame is already fixed: make the clip from it' : fixesInShot ? 'Fix the box in the storyboard frame, then make the clip again from it' : undefined}>
              {sending ? 'Sending…' : fixing ? (progress?.step === 'frame' ? 'Fixing the frame…' : 'Making a new version…') : `${fixedFrame ? 'Make the clip from the fixed frame' : fixesInShot ? 'Fix it in the shot' : 'Make a new version'} (${openNotes.length} note${openNotes.length > 1 ? 's' : ''})`}
            </button>
          )}
          <div className="row wrap" title={made.label} style={{ gap: 6 }}>
            <ModelPick op="clip" value={choice} onChange={setPick} />
            <QualityPick op="clip" choice={choice} value={quality} onChange={setQPick} />
            <span className="spacer" />
            {cur.take.quality === 'draft' && (
              <button className="btn sm" disabled={fixing || sending} onClick={() => void toFinal()} title={finalHint(doc, cur.take)}>Remake as Final</button>
            )}
            <button className="btn sm" disabled={fixing || sending} onClick={() => void again()} title={selectedFrame(doc, cur.shot.id) ? 'Make this shot again from its frame' : 'Make this shot again from its words'}>{sending ? 'Sending…' : 'New take'}</button>
          </div>
          </div>
        </div>
      )}
      {children}
    </div>
    </div>
  )
}

function FeelBox({ shot, take }: { shot: Shot; take: Take }) {
  const { runner, relay, doc: docStore } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { controls, config } = useConfig()
  const [text, setText] = useState('')
  // Which model makes the change (features/runway-video-models.clan): Aleph 2 by default, or one that
  // edits with the pictures the words name.
  const [pick, setPick] = useState<ModelChoice | undefined>(undefined)
  const [qPick, setQPick] = useState<ClipQuality | undefined>(undefined)
  const shown = pick ?? modelChoicesFor('clip_edit', config)[0]
  const quality = editQuality(take, shown, qPick ?? shotQuality(doc, shot.id))
  const [strength, setStrength] = useState<Strength>('flex')
  const [error, setError] = useState<string | null>(null)
  const running = isRunning(doc, jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === shot.id))
  const [sending, send] = useSending()
  const apply = () => send(async () => {
    setError(null)
    try {
      await changeFeel({ relay, doc: docStore, runner }, shot.id, take, text.trim(), controls.feelStrength ? { strength } : {},
        choiceToSend('clip_edit', config, pick), quality)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  return (
    <div className="card section stack">
      <h2>Change the feel</h2>
      <div className="faint" style={{ fontSize: 12.5 }}>Changes the whole clip for shot {shotNumber(doc, shot.id)}.</div>
      <textarea className="textarea" rows={3} maxLength={1000} placeholder="e.g. golden hour, slower, more dreamy" value={text} onChange={(e) => setText(e.target.value)} />
      {controls.feelStrength && (
        <div className="strengths" role="radiogroup" aria-label="How much to change">
          {STRENGTHS.map((s) => (
            <button key={s.id} role="radio" aria-checked={strength === s.id} className={strength === s.id ? 'on' : ''} title={s.hint} onClick={() => setStrength(s.id)}>{s.label}</button>
          ))}
        </div>
      )}
      <div className="row">
        <ModelPick op="clip_edit" value={pick} onChange={setPick} />
        <QualityPick op="clip_edit" choice={shown} value={quality} onChange={setQPick} />
        <span className="spacer" />
        <button className="btn sm primary" disabled={!text.trim() || running || sending} onClick={() => void apply()}>{sending ? 'Sending…' : running ? 'Working…' : 'Apply'}</button>
      </div>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
    </div>
  )
}

function AdResult({ sha }: { sha: string }) {
  const doc = useDoc()
  const url = useBlobUrl(sha) ?? remoteUrl(doc, sha)
  const showMock = useShowMock()
  const asset = doc.assets[sha]
  // Named like every other download (media/names.ts): <project>-ad.mp4.
  const ad = mediaItem(doc, useProjectName(), sha, 'ad')
  const status = adStatus(doc)
  const len = asset?.duration_s
  return (
    <div className="card section stack">
      <div className="row">
        <h2>Your ad</h2>
        {len ? <span className="faint" style={{ fontSize: 12 }}>{Math.round(len * 10) / 10} s</span> : null}
        <Thumbs key={sha} compact target={{ kind: 'ad', id: sha, asset: sha, jobId: Object.values(doc.renders).find((x) => x.asset === sha)?.job_id }} />
        <span className="spacer" />
        {status.stale && <span className="behind" title={status.reason}>{adBehindLabel(status.reason)}</span>}
        {showMock && asset?.origin === 'mock' && <span className="mockbadge">MOCK</span>}
      </div>
      {status.stale && <span className="faint" style={{ fontSize: 12 }}>{status.reason}. Remake it from the bar at the top.</span>}
      {url && <video src={url} controls playsInline style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 360 }} />}
      {ad && <DownloadButton items={[ad]} className="btn sm" />}
    </div>
  )
}

/** What Nell says over open notes: built from the notes, never sent anywhere. */
function ellisLine(n: number, boxed: number, inShot: boolean, frameFixed: boolean): string {
  const notes = `${n} note${n > 1 ? 's' : ''} on this take${boxed ? `, ${boxed === n ? (n > 1 ? 'all boxed' : 'boxed') : `${boxed} boxed`}` : ''}.`
  if (frameFixed) return `${notes} The frame is fixed; Dex makes the clip from it next.`
  if (inShot) return `${notes} The box is fixed in the shot's frame first, then Dex makes the clip again.`
  return `${notes} Dex makes a new version from them; this one is kept.`
}

/** A take's level and size on its card (features/clip-quality.clan): "Draft 360p", "Final 1080p", so a draft
 *  and a final are never confused. */
function TakeQuality({ take }: { take: Take }) {
  return <span className={`qchip ${take.quality ?? ''}`} title={take.quality === 'draft' ? 'A draft: Remake as Final makes it at full size' : undefined}>{qualityLabel(take.quality, take.size)}</span>
}

/** What Remake as Final will do with this draft: Runway makes a Seedance 2.5 draft final itself within
 *  7 days; any other is made again at Final with its own words, pictures and length. */
function finalHint(doc: ReturnType<typeof useDoc>, take: Take): string {
  const job = doc.jobs[take.job_id]
  const fresh = job?.created_at ? Date.now() - Date.parse(job.created_at) < 7 * 24 * 3600 * 1000 : false
  if (take.provider === 'runway' && SHEETS.runway?.models[take.model]?.draftPromote && fresh) return 'Runway makes this draft at 1080p, without making it again'
  return `Makes it again at Final on ${modelLabel(take.provider, take.model)}: the same words, pictures and length`
}

/** The video's default quality for its clips (features/clip-quality.clan), in the editor's bar. A send can
 *  pick another beside its model. */
function QualityDefault({ videoId }: { videoId: string }) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const value = videoQuality(doc, videoId)
  return (
    <label className="qdefault" title="The quality new clips are made at. Pick another beside the model for one clip.">
      Clips at
      <select aria-label="Default clip quality" value={value} onChange={(e) => {
        const q = e.target.value as ClipQuality
        void updateDoc(docStore, (d) => { const v = d.videos[videoId]; if (v) v.quality = q }, 'clip quality')
      }}>
        {(['draft', 'standard', 'final'] as const).map((q) => <option key={q} value={q}>{QUALITY_NAMES[q]}</option>)}
      </select>
    </label>
  )
}
