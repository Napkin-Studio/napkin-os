// Stage 3: one clip per frame. A shot strip with versions, a player (one clip,
// or all of them in order as the stitched preview), Frame.io-style comments
// pinned to a timecode (typing pauses the player; draw a box on the paused
// frame), a "change the feel" box, and Render / Export.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import type { ModelChoice, Region, Review, Shot, Strength, Take } from '../contracts/types'
import { assetRef, remoteUrl } from '../jobs/assets'
import { isMoving, isRunning, jobAt } from '../jobs/select'
import { makeClip as submitClip, renderAd } from '../jobs/clips'
import { fixFrameLanded, fixInShot, fixProgress, remakeFixClip, shotsBeingFixed } from '../jobs/fix'
import { lastWorkedModel } from '../jobs/follow'
import { adStatus, takeStale } from '../jobs/stale'
import { adBehindLabel, behindLabel } from '../ui/behind'
import { rectToRegion } from '../lib/region'
import { newId } from '../lib/ulid'
import { fmtTime, useBlobUrl, useSending } from '../ui/hooks'
import { clipText } from '../lib/guard'
import { JobNode } from '../ui/JobNode'
import { systemUpdate, updateDoc } from '../doc/store'
import { deleteFrom, removeNote, removeTake } from '../doc/remove'
import { ModelItems, ModelPick } from '../ui/ModelPick'
import { Float, MenuItem } from '../ui/Float'
import { useUpdate } from '../ui/useUpdate'
import { SplitButton } from '../ui/SplitButton'
import type { FollowScope } from '../jobs/follow'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { madeWith, startingChoice } from '../ui/modelChoice'
import { choiceToSend, modelChoicesFor, modelLabel } from '../capabilities'

const STRENGTHS: { id: Strength; label: string; hint: string }[] = [
  { id: 'adhere', label: 'Adhere', hint: 'Small change, keeps the clip' },
  { id: 'flex', label: 'Flex', hint: 'Noticeable change' },
  { id: 'reimagine', label: 'Reimagine', hint: 'Big change' },
]

function takesOf(takes: Take[], shotId: string) {
  return takes.filter((t) => t.shot_id === shotId)
}

export function Video() {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { controls, config } = useConfig()
  useJobsTick()
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const shots = doc.shots ?? []
  const takes = doc.takes ?? []
  const [shotId, setShotId] = useState<string | null>(shots[0]?.id ?? null)
  const [mode, setMode] = useState<'shot' | 'all'>('shot')
  const [error, setError] = useState<string | null>(null)
  const shot = shots.find((s) => s.id === shotId) ?? shots[0]
  const take = shot ? takesOf(takes, shot.id).find((t) => t.selected) : undefined
  const clipJob = (id: string) => jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === id)
  // An "uncertain" job is waiting on the participant (Stop waiting / Try again on its card), not on
  // the relay: it locks nothing (features/video-stage-findings.clan).
  const anyRunning = shots.some((s) => isMoving(doc, clipJob(s.id)))
  const taken = shots.filter((s) => takesOf(takes, s.id).some((t) => t.selected)).length
  const allTaken = shots.length > 0 && taken === shots.length
  const stitchJob = jobAt(doc, ui, (c) => c.for === 'stitch')
  const latestAd = (doc.exports ?? []).filter((e) => e.kind === 'ad_mp4').at(-1)
  // One send per click burst: a double click paid twice (2026-10-09).
  const [makingAll, sendAll] = useSending()
  const [rendering, sendRender] = useSending()

  const makeClip = (s: Shot, opts: { text?: string; modelChoice?: ModelChoice } = {}) => submitClip(deps, s.id, opts)

  /** A clip for every shot without one. A shot that cannot be made (no frame yet) does not stop the
   *  others; each one that failed is named. */
  const makeAll = () => sendAll(async () => {
    setError(null)
    const failed: string[] = []
    for (const [i, s] of shots.entries()) {
      if (takesOf(takes, s.id).length || isRunning(doc, clipJob(s.id))) continue
      try {
        await makeClip(s, { modelChoice: choiceToSend('clip', config, lastWorkedModel(doc, 'clip', config)) })
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
      await renderAd(deps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  // Why Render ad is off, said on the button (a disabled button never said why).
  const renderBlocked = !allTaken ? `Make a clip for every shot first (${taken} of ${shots.length} done)`
    : anyRunning ? 'Wait for the clips being made' : isMoving(doc, stitchJob) ? 'The ad is rendering' : undefined

  if (!controls.video) {
    return <div className="panel"><div className="empty-state"><b>Video is off right now.</b>The organisers will switch it on soon.</div></div>
  }
  if (!shots.length) {
    return (
      <div className="panel"><div className="empty-state">
        <AgentFigure agent="dex" size={64} decorative />
        <span className="sayer">{sayer('dex')}</span>
        <b>No shots yet.</b>Plan your shots and draw the frames first; I make one clip per frame.
        <div style={{ marginTop: 14 }}><button className="btn" onClick={() => systemUpdate(docStore, (d) => { d.stage.current = 'storyboard' })}>← Back to Storyboard</button></div>
      </div></div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-inner">
        <div className="eyebrow">Step 3</div>
        <div className="row">
          <h1>Video</h1>
          <span className="spacer" />
          <button className="btn dark" disabled={makingAll || anyRunning || allTaken} onClick={() => void makeAll()}>{makingAll ? 'Preparing…' : anyRunning ? 'Making clips…' : allTaken ? 'All clips made' : 'Make clips'}</button>
          {controls.stitch && (
            <button className="btn primary" disabled={rendering || !!renderBlocked} onClick={() => void render()} title={renderBlocked ?? 'Join the clips into one ad with the end card'}>
              {rendering ? 'Sending…' : isMoving(doc, stitchJob) ? 'Rendering…' : 'Render ad'}
            </button>
          )}
        </div>
        <p className="lede">One clip per frame. Pause anywhere to leave a note, then make a new version.</p>
        {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 10 }}>{error}</div>}

        <div className="strip">
          {shots.map((s, i) => (
            <ShotCard key={s.id} shot={s} index={i} selected={mode === 'shot' && s.id === shot?.id} jobId={clipJob(s.id)}
              onSelect={() => { setShotId(s.id); setMode('shot') }}
              onMake={(opts) => makeClip(s, opts)} />
          ))}
          <button className={`shotcard ${mode === 'all' ? 'sel' : ''}`} style={{ flexBasis: 140 }} disabled={!allTaken} onClick={() => setMode('all')}
            title={allTaken ? 'Play every shot in order' : `Make a clip for every shot first (${taken} of ${shots.length} done)`}>
            <div className="thumb" style={{ display: 'grid', placeItems: 'center', fontWeight: 700, color: 'var(--ink2)' }}>▶ All shots</div>
            <div className="meta"><span className="faint">Stitched preview</span></div>
          </button>
        </div>

        <div style={{ marginTop: 20 }}>
          <Player mode={mode} shot={shot} take={take} onPickShot={setShotId}>
            {stitchJob && <div className="card" style={{ height: 120, overflow: 'hidden' }}><JobNode jobId={stitchJob} /></div>}
            {latestAd && <AdResult sha={latestAd.asset} />}
            {controls.feelEdit && take && shot && <FeelBox shot={shot} take={take} />}
          </Player>
        </div>
      </div>
    </div>
  )
}

/** Make clip's box (like the update box): words for this clip only, the model, "Make it". */
function MakeClipBox({ index, onMake }: { index: number; onMake: (opts: { text?: string; modelChoice?: ModelChoice }) => Promise<unknown> }) {
  const doc = useDoc()
  const { config } = useConfig()
  const [text, setText] = useState('')
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const [busy, send] = useSending()
  const [error, setError] = useState<string | null>(null)
  const choice = pick ?? lastWorkedModel(doc, 'clip', config)
  const make = () => send(async () => {
    setError(null)
    try {
      await onMake({ ...(text.trim() ? { text: text.trim() } : {}), modelChoice: choiceToSend('clip', config, choice) })
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
      <ModelPick op="clip" value={choice} onChange={setPick} />
      {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm primary" disabled={busy} onClick={() => void make()}>{busy ? 'Sending…' : 'Make it'}</button>
      </div>
    </div>
  )
}

function ShotCard({ shot, index, selected, jobId, onSelect, onMake }: {
  shot: Shot; index: number; selected: boolean; jobId?: string; onSelect: () => void
  onMake: (opts: { text?: string; modelChoice?: ModelChoice }) => Promise<unknown>
}) {
  const makeRef = useRef<HTMLButtonElement>(null)
  const [making, setMaking] = useState(false)
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const takes = takesOf(doc.takes ?? [], shot.id)
  const sel = takes.find((t) => t.selected)
  const thumb = useBlobUrl(shot.storyboard_frame)
  const showMock = useShowMock()
  const open = (doc.reviews ?? []).filter((r) => r.target.kind === 'take' && takes.some((t) => t.id === r.target.id) && !r.resolved).length
  const selIdx = sel ? takes.indexOf(sel) : -1
  const ui = useUi()
  // A fix that is redoing this shot's clip replaces it: not "out of date" meanwhile.
  const stale = shotsBeingFixed(doc, (id) => ui.jobCtx[id]).has(shot.id) ? undefined : takeStale(doc, shot.id)
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
        {thumb && <img src={thumb} alt="" />}
        {jobId && <div style={{ position: 'absolute', inset: 0 }}><JobNode jobId={jobId} compact /></div>}
      </div>
      {sel && <ShotMenu shot={shot} take={sel} n={selIdx + 1} only={takes.length <= 1} busy={isRunning(doc, jobId)} onDelete={remove} onError={setError} />}
      <div className="meta">
        <div className="row"><b>Shot {index + 1}</b><span className="faint">{shot.duration_s}s</span></div>
        <div className="row wrap" style={{ gap: 4 }}>
          {takes.map((t, i) => (
            <button key={t.id} className={`vchip ${t.selected ? 'on' : ''}`} title={t.kind === 'mock' ? 'Mock clip' : t.model ? `${modelLabel(t.provider, t.model)} (${t.provider})` : ''}
              onClick={(e) => {
                e.stopPropagation()
                updateDoc(docStore, (d) => {
                  for (const x of d.takes ?? []) if (x.shot_id === shot.id) x.selected = x.id === t.id
                  const s = d.shots?.find((y) => y.id === shot.id)
                  if (s) s.selected_take = t.id
                }, 'pick take')
              }}>v{i + 1}</button>
          ))}
          {!takes.length && !jobId && <button ref={makeRef} className="btn xs" aria-haspopup="dialog" aria-expanded={making} onClick={(e) => { e.stopPropagation(); setMaking(!making) }}>Make clip</button>}
          <Float anchor={makeRef} open={making} onClose={() => setMaking(false)} role="dialog" label={`Make the clip for shot ${index + 1}`} className="clipbox">
            {making && <MakeClipBox index={index} onMake={async (opts) => { await onMake(opts); setMaking(false) }} />}
          </Float>
          {showMock && sel?.kind === 'mock' && <span className="mockbadge">MOCK</span>}
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
                label: `Remake this and the clips after (${after})`, hint: update.cost(afterScope), icon: '⇥',
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
  // Its error shows under the card, like Make clip's (it failed silently before, 2026-10-09).
  const newTake = (choice: ModelChoice | undefined) => {
    close()
    void send(async () => {
      onError(null)
      try {
        await submitClip({ relay, doc: docStore, ui: uiStore, runner }, shot.id, { parentTake: take, modelChoice: choiceToSend('clip', config, choice) })
      } catch (e) {
        onError(e instanceof Error ? e.message : 'That did not work.')
      }
    })
  }
  return (
    <>
      <button ref={ref} className={`shotmore ${open ? 'open' : ''}`} aria-label={`Shot ${shot.order} options`} aria-haspopup="menu" aria-expanded={!!open}
        onClick={(e) => { e.stopPropagation(); setOpen(open ? false : 'main') }}>⋯</button>
      <Float anchor={ref} open={!!open} onClose={close} align="end" label={`Shot ${shot.order}, clip v${n}`} className={open === 'models' ? 'modelmenu' : ''}>
        {open === 'models' ? (
          <>
            <div className="fhead">New take of shot {shot.order} with</div>
            <ModelItems options={options} current={start} onPick={(o) => newTake(o)} />
          </>
        ) : (
          <>
            <div className="fhead">Shot {shot.order} · clip v{n}</div>
            <MenuItem icon="▶" disabled={busy || sending} onSelect={() => newTake(start)}>{sending ? 'Sending…' : 'New take'}</MenuItem>
            {options.length > 1 && <MenuItem icon="⇄" disabled={busy || sending} hint="▸" onSelect={() => setOpen('models')}>New take on another model</MenuItem>}
            <div className="fsep" />
            {/* A shot needs one clip: remaking the only one costs a video job (2026-10-09). */}
            <MenuItem icon="🗑" danger disabled={busy || only} hint={only ? 'a shot needs one clip' : undefined} onSelect={() => { close(); onDelete() }}>Delete v{n}</MenuItem>
          </>
        )}
      </Float>
    </>
  )
}

function Player({ mode, shot, take, onPickShot, children }: { mode: 'shot' | 'all'; shot?: Shot; take?: Take; onPickShot: (id: string) => void; children?: React.ReactNode }) {
  const { doc: docStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config, controls } = useConfig()
  const video = useRef<HTMLVideoElement>(null)
  const stageBox = useRef<HTMLDivElement>(null)
  const shots = useMemo(() => doc.shots ?? [], [doc.shots])
  const playlist = useMemo(() => shots.map((s) => ({ shot: s, take: (doc.takes ?? []).find((t) => t.shot_id === s.id && t.selected) })).filter((x) => x.take) as { shot: Shot; take: Take }[], [shots, doc.takes])
  const [idx, setIdx] = useState(0)
  const cur = mode === 'all' ? playlist[idx] : take && shot ? { shot, take } : undefined
  // Not in this browser (another device, cleared storage): the relay's copy (2026-10-09).
  const url = useBlobUrl(cur?.take.asset) ?? remoteUrl(doc, cur?.take.asset)
  // The relay's mock makes a still for a clip, not a video: it shows as the picture it is.
  const still = !!doc.assets.find((a) => a.sha256 === cur?.take.asset)?.mime.startsWith('image/')
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

  // New clip: reset the composer bits that belong to the old one, and the model picked and the
  // error left from it (another shot's pick and error stayed on screen, 2026-10-09).
  const [forTake, setForTake] = useState(cur?.take.id)
  if (forTake !== cur?.take.id) {
    setForTake(cur?.take.id)
    setRegion(null)
    setDrawing(false)
    setPick(undefined)
    setError(null)
  }

  const reviews = (doc.reviews ?? []).filter((r) => r.target.kind === 'take' && cur && takesOf(doc.takes ?? [], cur.shot.id).some((x) => x.id === r.target.id))
    .sort((a, b) => (a.at_s ?? 0) - (b.at_s ?? 0))
  const openNotes = reviews.filter((r) => !r.resolved && r.target.id === cur?.take.id)
  const fixJob = cur ? jobAt(doc, ui, (c) => (c.for === 'clip' || (c.for === 'frame' && !!c.fixReviewIds?.length)) && c.shotId === cur.shot.id) : undefined
  const fixing = isRunning(doc, fixJob)
  // A shot's first clip, being made or failed: its card (Cancel, Retry, Model) in the empty player.
  const firstJob = !cur && mode === 'shot' && shot ? jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === shot.id) : undefined
  const [sending, send] = useSending()
  const made = madeWith(doc, ui, cur?.take.job_id)
  const choice = pick ?? startingChoice(modelChoicesFor('clip', config), made.made)

  const services = useServices()
  const deps = { relay, doc: docStore, ui: services.ui, runner }

  /** Make the shot again from its frame, as a new take of this one. */
  const again = () => send(async () => {
    if (!cur) return
    setError(null)
    try {
      await submitClip(deps, cur.shot.id, { parentTake: cur.take, modelChoice: choiceToSend('clip', config, choice) })
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
    const r: Review = { id: newId('pin'), target: { kind: 'take', id: cur.take.id }, comment: clipText(note.trim(), 1000), at_s: Math.round((video.current?.currentTime ?? t) * 100) / 100, resolved: false, created_at: new Date().toISOString() }
    if (region) r.region = region
    updateDoc(docStore, (d) => {
      d.reviews ??= []
      d.reviews.push(r)
    }, 'comment')
    setNote('')
    setRegion(null)
    setDrawing(false)
  }

  const boxedOpen = openNotes.filter((r) => r.region)
  // A note with a box is fixed in the shot (jobs/fix.ts): the storyboard frame first, then a new clip from it.
  const fixesInShot = boxedOpen.length > 0 && controls.fixInShot
  const progress = cur ? fixProgress(doc, (id) => ui.jobCtx[id], reviews.filter((r) => r.target.id === cur.take.id).map((r) => r.id)) : undefined
  // The fix's frame already landed and only its clip failed: Fix makes only the clip, from the fixed frame.
  const fixedFrame = cur && fixesInShot ? fixFrameLanded(doc, (id) => ui.jobCtx[id], openNotes.map((r) => r.id)) : undefined

  const fix = () => send(async () => {
    if (!cur || !openNotes.length) return
    setError(null)
    try {
      const one = openNotes.length === 1 ? openNotes[0] : undefined
      const ids = openNotes.map((r) => r.id)
      if (fixedFrame) {
        await remakeFixClip(deps, fixedFrame, choiceToSend('clip', config, choice))
      } else if (fixesInShot) {
        await fixInShot(deps, cur.shot.id, openNotes, choiceToSend('clip', config, choice))
      } else if (one?.region && controls.videoRegionEdit) {
        const v = await assetRef(relay, cur.take.asset, docStore.get())
        await runner.submit('clip_edit', { video: v, region: one.region, atS: one.at_s ?? 0, text: one.comment }, [cur.take.job_id], { for: 'clip', shotId: cur.shot.id, parentTakeId: cur.take.id, reviewIds: ids })
      } else {
        const text = clipText(openNotes.map((r) => `At ${fmtTime(r.at_s ?? 0)}: ${r.comment}`).join('\n'), 1000)
        await submitClip(deps, cur.shot.id, { text, reviewIds: ids, parentTake: cur.take, modelChoice: choiceToSend('clip', config, choice) })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  const jump = (r: Review) => {
    const target = (doc.takes ?? []).find((x) => x.id === r.target.id)
    if (target && cur && target.id !== cur.take.id) {
      updateDoc(docStore, (d) => {
        for (const x of d.takes ?? []) if (x.shot_id === target.shot_id) x.selected = x.id === target.id
      })
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
            <img src={url} alt={`Shot ${cur.shot.order}`} style={{ height: '100%' }} />
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
            {mode === 'all' ? 'Make a clip for every shot to preview the whole ad.' : (fixJob ?? firstJob) ? <div style={{ width: 260, height: 160 }}><JobNode jobId={(fixJob ?? firstJob)!} /></div> : 'No clip for this shot yet. Press Make clip.'}
          </div>
        )}
      </div>

      {mode === 'all' && segs.length > 0 ? (
        <div className="timeline" title="Click a shot to jump">
          {playlist.map((p, i) => (
            <div key={p.take.id} className={`seg ${i === idx ? 'cur' : ''}`} style={{ width: `${(segs[i] / segTotal) * 100}%` }} onClick={() => setIdx(i)}>Shot {p.shot.order}</div>
          ))}
        </div>
      ) : cur && dur > 0 ? (
        <div className="timeline" onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          if (video.current) video.current.currentTime = ((e.clientX - b.left) / b.width) * dur
        }}>
          <div className="head" style={{ left: `${(t / dur) * 100}%` }} />
          {reviews.filter((r) => r.target.id === cur.take.id).map((r) => (
            <span key={r.id} className={`mark ${r.resolved ? 'done' : ''}`} style={{ left: `${Math.min(100, ((r.at_s ?? 0) / dur) * 100)}%` }} title={r.comment} onClick={(e) => { e.stopPropagation(); jump(r) }} />
          ))}
        </div>
      ) : null}
    </div>

    <div className="stack" style={{ gap: 14 }}>
      {cur && mode === 'shot' && (
        <div className="card section stack notes-panel">
          <div className="row">
            <h2>Notes</h2>
            <span className="faint" style={{ fontSize: 12 }}>Shot {cur.shot.order} · v{takesOf(doc.takes ?? [], cur.shot.id).indexOf(cur.take) + 1}</span>
            {(() => {
              const st = shotsBeingFixed(doc, (id) => ui.jobCtx[id]).has(cur.shot.id) ? undefined : takeStale(doc, cur.shot.id)
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
          {fixJob && <div style={{ minHeight: 96, borderRadius: 12, overflow: 'hidden', display: 'flex' }}><JobNode jobId={fixJob} /></div>}
          <div className="comments">
            {reviews.flatMap((r) => {
              const v = takesOf(doc.takes ?? [], cur.shot.id).findIndex((x) => x.id === r.target.id) + 1
              const row = (
                <div key={r.id} className="comment" onClick={() => jump(r)} style={focusPin === r.id ? { borderColor: 'var(--create)' } : undefined}>
                  <div className="row">
                    <span className="tc">{fmtTime(r.at_s ?? 0)}</span><span className="faint" style={{ fontSize: 11 }}>v{v}{r.region ? ' · box' : ''}</span><span className="spacer" />{r.resolved && <span className="ok">✓ Addressed</span>}
                    <button className="btn xs icon ghost iconbtn-del del" aria-label="Delete note" title="Delete note" onClick={async (e) => {
                      e.stopPropagation()
                      if (focusPin === r.id) setFocusPin(null)
                      await deleteFrom(docStore, (d) => removeNote(d, r.id)) // Undo in the top bar puts it back
                    }}>🗑</button>
                  </div>
                  <div>{r.comment}</div>
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
          <div className="row" title={made.label}>
            <ModelPick op="clip" value={choice} onChange={setPick} />
            <span className="spacer" />
            <button className="btn sm" disabled={fixing || sending} onClick={() => void again()} title="Make this shot again from its frame">{sending ? 'Sending…' : 'New take'}</button>
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
  const { runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { controls } = useConfig()
  const [text, setText] = useState('')
  const [strength, setStrength] = useState<Strength>('flex')
  const [error, setError] = useState<string | null>(null)
  const running = isRunning(doc, jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === shot.id))
  const [sending, send] = useSending()
  const apply = () => send(async () => {
    setError(null)
    try {
      const video = await assetRef(relay, take.asset, doc)
      await runner.submit('clip_edit', { video, text: text.trim(), ...(controls.feelStrength ? { feel: { strength } } : { feel: {} }) }, [take.job_id], { for: 'clip', shotId: shot.id, parentTakeId: take.id })
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  return (
    <div className="card section stack">
      <h2>Change the feel</h2>
      <div className="faint" style={{ fontSize: 12.5 }}>Changes the whole clip for shot {shot.order}.</div>
      <textarea className="textarea" rows={3} maxLength={1000} placeholder="e.g. golden hour, slower, more dreamy" value={text} onChange={(e) => setText(e.target.value)} />
      {controls.feelStrength && (
        <div className="strengths" role="radiogroup" aria-label="How much to change">
          {STRENGTHS.map((s) => (
            <button key={s.id} role="radio" aria-checked={strength === s.id} className={strength === s.id ? 'on' : ''} title={s.hint} onClick={() => setStrength(s.id)}>{s.label}</button>
          ))}
        </div>
      )}
      <div className="row">
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
  const asset = doc.assets.find((a) => a.sha256 === sha)
  const ext = asset?.mime.includes('webm') ? 'webm' : 'mp4'
  const status = adStatus(doc)
  const len = asset?.duration_s
  return (
    <div className="card section stack">
      <div className="row">
        <h2>Your ad</h2>
        {len ? <span className="faint" style={{ fontSize: 12 }}>{Math.round(len * 10) / 10} s</span> : null}
        <span className="spacer" />
        {status.stale && <span className="behind" title={status.reason}>{adBehindLabel(status.reason)}</span>}
        {showMock && asset?.origin === 'mock' && <span className="mockbadge">MOCK</span>}
      </div>
      {status.stale && <span className="faint" style={{ fontSize: 12 }}>{status.reason}. Remake it from the bar at the top.</span>}
      {url && <video src={url} controls playsInline style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 360 }} />}
      {url && <a className="btn sm" href={url} download={`napkin-${doc.participant.handle}-${sha.slice(7, 15)}.${ext}`}>Download</a>}
    </div>
  )
}

/** What Ellis says over open notes: built from the notes, never sent anywhere. */
function ellisLine(n: number, boxed: number, inShot: boolean, frameFixed: boolean): string {
  const notes = `${n} note${n > 1 ? 's' : ''} on this take${boxed ? `, ${boxed === n ? (n > 1 ? 'all boxed' : 'boxed') : `${boxed} boxed`}` : ''}.`
  if (frameFixed) return `${notes} The frame is fixed; Dex makes the clip from it next.`
  if (inShot) return `${notes} The box is fixed in the shot's frame first, then Dex makes the clip again.`
  return `${notes} Dex makes a new version from them; this one is kept.`
}
