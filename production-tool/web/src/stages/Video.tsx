// Stage 3: one clip per frame. A shot strip with versions, a player (one clip,
// or all of them in order as the stitched preview), Frame.io-style comments
// pinned to a timecode (typing pauses the player; draw a box on the paused
// frame), a "change the feel" box, and Render / Export.

import { useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShowMock, useUi } from '../app/context'
import type { Region, Review, Shot, Strength, Take } from '../contracts/types'
import { assetRef } from '../jobs/assets'
import { isRunning, jobAt } from '../jobs/select'
import { makeClip as submitClip, renderAd } from '../jobs/clips'
import { fixInShot, fixProgress } from '../jobs/fix'
import { adStatus, takeStale } from '../jobs/stale'
import { UpdateFollows } from '../ui/Follow'
import { rectToRegion } from '../lib/region'
import { newId } from '../lib/ulid'
import { fmtTime, useBlobUrl } from '../ui/hooks'
import { JobNode } from '../ui/JobNode'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeNote, removeTake, restoreTo } from '../doc/remove'
import { UndoChip } from '../ui/Undo'
import { useUndo } from '../ui/useUndo'

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
  const { controls } = useConfig()
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
  const anyRunning = shots.some((s) => isRunning(doc, clipJob(s.id)))
  const allTaken = shots.length > 0 && shots.every((s) => takesOf(takes, s.id).some((t) => t.selected))
  const stitchJob = jobAt(doc, ui, (c) => c.for === 'stitch')
  const latestAd = (doc.exports ?? []).filter((e) => e.kind === 'ad_mp4').at(-1)

  const makeClip = (s: Shot) => submitClip(deps, s.id)

  const makeAll = async () => {
    setError(null)
    try {
      for (const s of shots) {
        if (takesOf(takes, s.id).length || isRunning(doc, clipJob(s.id))) continue
        await makeClip(s)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

  const render = async () => {
    setError(null)
    try {
      // Each clip is cut to its shot's length (trimS): the ad is the shots plus the 1 s end card.
      await renderAd(deps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

  if (!controls.video) {
    return <div className="panel"><div className="empty-state"><b>Video is off right now.</b>The organisers will switch it on soon.</div></div>
  }
  if (!shots.length) {
    return (
      <div className="panel"><div className="empty-state">
        <b>No shots yet.</b>Plan your shots and draw the frames first.
        <div style={{ marginTop: 14 }}><button className="btn" onClick={() => updateDoc(docStore, (d) => { d.stage.current = 'storyboard' })}>← Back to Storyboard</button></div>
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
          <button className="btn dark" disabled={anyRunning || allTaken} onClick={makeAll}>{anyRunning ? 'Making clips…' : allTaken ? 'All clips made' : 'Make clips'}</button>
          {controls.stitch && (
            <button className="btn primary" disabled={!allTaken || anyRunning || isRunning(doc, stitchJob)} onClick={render} title="Join the clips into one ad with the end card">
              {isRunning(doc, stitchJob) ? 'Rendering…' : 'Render ad'}
            </button>
          )}
        </div>
        <p className="lede">One clip per frame. Pause anywhere to leave a note, then make a new version.</p>
        {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 10 }}>{error}</div>}

        <div className="strip">
          {shots.map((s, i) => (
            <ShotCard key={s.id} shot={s} index={i} selected={mode === 'shot' && s.id === shot?.id} jobId={clipJob(s.id)}
              onSelect={() => { setShotId(s.id); setMode('shot') }}
              onMake={() => makeClip(s).catch((e) => setError(e instanceof Error ? e.message : 'That did not work.'))} />
          ))}
          <button className={`shotcard ${mode === 'all' ? 'sel' : ''}`} style={{ flexBasis: 140 }} disabled={!allTaken} onClick={() => setMode('all')}>
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

function ShotCard({ shot, index, selected, jobId, onSelect, onMake }: { shot: Shot; index: number; selected: boolean; jobId?: string; onSelect: () => void; onMake: () => void }) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const takes = takesOf(doc.takes ?? [], shot.id)
  const sel = takes.find((t) => t.selected)
  const thumb = useBlobUrl(shot.storyboard_frame)
  const showMock = useShowMock()
  const open = (doc.reviews ?? []).filter((r) => r.target.kind === 'take' && takes.some((t) => t.id === r.target.id) && !r.resolved).length
  const [undo, offerUndo, runUndo] = useUndo()
  const selIdx = sel ? takes.indexOf(sel) : -1
  const stale = takeStale(doc, shot.id)
  const adNeeds = adStatus(doc).shotId === shot.id
  return (
    <div className={`shotcard ${selected ? 'sel' : ''}`} role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => e.key === 'Enter' && onSelect()}>
      <div className="thumb">
        {thumb && <img src={thumb} alt="" />}
        {jobId && <div style={{ position: 'absolute', inset: 0 }}><JobNode jobId={jobId} compact /></div>}
      </div>
      <div className="meta">
        <div className="row"><b>Shot {index + 1}</b><span className="faint">{shot.duration_s}s</span><span className="spacer" />{stale && <span className="stale" title={stale.reason}>Out of date</span>}{open > 0 && <span className="mockbadge" title="Open notes">{open} note{open > 1 ? 's' : ''}</span>}</div>
        <div className="row wrap" style={{ gap: 4 }}>
          {takes.map((t, i) => (
            <button key={t.id} className={`vchip ${t.selected ? 'on' : ''}`} title={t.kind === 'mock' ? 'Mock clip' : t.model ?? ''}
              onClick={(e) => {
                e.stopPropagation()
                updateDoc(docStore, (d) => {
                  for (const x of d.takes ?? []) if (x.shot_id === shot.id) x.selected = x.id === t.id
                  const s = d.shots?.find((y) => y.id === shot.id)
                  if (s) s.selected_take = t.id
                }, 'pick take')
              }}>v{i + 1}</button>
          ))}
          {sel && (
            <button className="btn xs icon ghost iconbtn-del" aria-label={`Delete clip v${selIdx + 1}`} disabled={takes.length <= 1}
              title={takes.length <= 1 ? 'Regenerate instead' : `Delete v${selIdx + 1}`}
              onClick={async (e) => {
                e.stopPropagation()
                const r = await deleteFrom(docStore, (d) => removeTake(d, sel.id))
                offerUndo({ label: `v${selIdx + 1} deleted`, undo: () => restoreTo(docStore, r) })
              }}>🗑</button>
          )}
          {undo && <UndoChip label={undo.label} onUndo={runUndo} />}
          {!takes.length && !jobId && <button className="btn xs" onClick={(e) => { e.stopPropagation(); onMake() }}>Make clip</button>}
          {showMock && sel?.kind === 'mock' && <span className="mockbadge">MOCK</span>}
        </div>
        {(stale || adNeeds) && <UpdateFollows size="xs" progress={false} />}
      </div>
    </div>
  )
}

function Player({ mode, shot, take, onPickShot, children }: { mode: 'shot' | 'all'; shot?: Shot; take?: Take; onPickShot: (id: string) => void; children?: React.ReactNode }) {
  const { doc: docStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { controls } = useConfig()
  const video = useRef<HTMLVideoElement>(null)
  const stageBox = useRef<HTMLDivElement>(null)
  const shots = useMemo(() => doc.shots ?? [], [doc.shots])
  const playlist = useMemo(() => shots.map((s) => ({ shot: s, take: (doc.takes ?? []).find((t) => t.shot_id === s.id && t.selected) })).filter((x) => x.take) as { shot: Shot; take: Take }[], [shots, doc.takes])
  const [idx, setIdx] = useState(0)
  const cur = mode === 'all' ? playlist[idx] : take && shot ? { shot, take } : undefined
  const url = useBlobUrl(cur?.take.asset)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [note, setNote] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [region, setRegion] = useState<Region | null>(null)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const [focusPin, setFocusPin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noteUndo, offerNoteUndo, runNoteUndo] = useUndo()
  const pendingSeek = useRef<number | null>(null)

  // New clip: reset the composer bits that belong to the old one.
  const [forTake, setForTake] = useState(cur?.take.id)
  if (forTake !== cur?.take.id) {
    setForTake(cur?.take.id)
    setRegion(null)
    setDrawing(false)
  }

  const reviews = (doc.reviews ?? []).filter((r) => r.target.kind === 'take' && cur && takesOf(doc.takes ?? [], cur.shot.id).some((x) => x.id === r.target.id))
    .sort((a, b) => (a.at_s ?? 0) - (b.at_s ?? 0))
  const openNotes = reviews.filter((r) => !r.resolved && r.target.id === cur?.take.id)
  const fixJob = cur ? jobAt(doc, ui, (c) => (c.for === 'clip' || (c.for === 'frame' && !!c.fixReviewIds?.length)) && c.shotId === cur.shot.id) : undefined
  const fixing = isRunning(doc, fixJob)

  const pause = () => video.current && !video.current.paused && video.current.pause()

  const addNote = () => {
    if (!cur || !note.trim()) return
    const r: Review = { id: newId('pin'), target: { kind: 'take', id: cur.take.id }, comment: note.trim().slice(0, 1000), at_s: Math.round((video.current?.currentTime ?? t) * 100) / 100, resolved: false, created_at: new Date().toISOString() }
    if (region) r.region = region
    updateDoc(docStore, (d) => {
      d.reviews ??= []
      d.reviews.push(r)
    }, 'comment')
    setNote('')
    setRegion(null)
    setDrawing(false)
  }

  const services = useServices()
  const deps = { relay, doc: docStore, ui: services.ui, runner }
  const boxedOpen = openNotes.filter((r) => r.region)
  // A note with a box is fixed in the shot (jobs/fix.ts): the storyboard frame first, then a new clip from it.
  const fixesInShot = boxedOpen.length > 0 && controls.fixInShot
  const progress = cur ? fixProgress(doc, (id) => ui.jobCtx[id], reviews.filter((r) => r.target.id === cur.take.id).map((r) => r.id)) : undefined

  const fix = async () => {
    if (!cur || !openNotes.length) return
    setError(null)
    try {
      const one = openNotes.length === 1 ? openNotes[0] : undefined
      const ids = openNotes.map((r) => r.id)
      if (fixesInShot) {
        await fixInShot(deps, cur.shot.id, openNotes)
      } else if (one?.region && controls.videoRegionEdit) {
        const v = await assetRef(relay, cur.take.asset)
        await runner.submit('clip_edit', { video: v, region: one.region, atS: one.at_s ?? 0, text: one.comment }, [cur.take.job_id], { for: 'clip', shotId: cur.shot.id, parentTakeId: cur.take.id, reviewIds: ids })
      } else {
        const text = openNotes.map((r) => `At ${fmtTime(r.at_s ?? 0)}: ${r.comment}`).join('\n').slice(0, 1000)
        await submitClip(deps, cur.shot.id, { text, reviewIds: ids, parentTake: cur.take })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

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
        {cur && url ? (
          <div className="stagebox" ref={stageBox} style={{ height: '100%' }}>
            <video
              key={cur.take.id}
              ref={video}
              src={url}
              controls={!drawing}
              playsInline
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
              onPlay={() => setFocusPin(null)}
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
            {mode === 'all' ? 'Make a clip for every shot to preview the whole ad.' : fixJob ? <div style={{ width: 260, height: 160 }}><JobNode jobId={fixJob} /></div> : 'No clip for this shot yet. Press Make clip.'}
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
              const st = takeStale(doc, cur.shot.id)
              return st && st.target.id === cur.take.id ? <span className="stale" title={st.reason}>Out of date · {st.reason}</span> : null
            })()}
          </div>
          <textarea className="textarea" rows={2} placeholder="Leave a note at this moment…" maxLength={1000} value={note}
            onFocus={pause} onChange={(e) => { pause(); setNote(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                addNote()
              }
            }} />
          <div className="row">
            <span className="mono" style={{ fontSize: 12, color: 'var(--create)', fontWeight: 600 }}>at {fmtTime(t)}</span>
            <span className="spacer" />
            {/* The box: on clip_edit where the provider edits video regions (flag videoRegionEdit), and
                "Fix it in the shot" everywhere frame region edits are on (decided 2026-10-07). */}
            {(controls.videoRegionEdit || controls.fixInShot) && (
              <button className={`btn sm ${drawing ? 'on' : ''}`} title="Draw a box on the paused frame" onClick={() => { pause(); setDrawing(!drawing) }}>▭ Box</button>
            )}
            <button className="btn sm dark" disabled={!note.trim()} onClick={addNote}>Add note</button>
          </div>
          {region && <div className="faint" style={{ fontSize: 12 }}>Box set on the paused frame.{controls.fixInShot ? ' It is fixed in the shot\'s frame, then the clip is made again.' : ''} <button className="btn xs ghost" onClick={() => setRegion(null)}>Remove box</button></div>}
          {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
          {progress?.running && (
            <div className="faint" role="status" style={{ fontSize: 12.5, fontWeight: 600 }}>{progress.step === 'frame' ? 'Fixing the frame…' : 'Making the clip…'}</div>
          )}
          {fixJob && <div style={{ height: 96, borderRadius: 12, overflow: 'hidden' }}><JobNode jobId={fixJob} /></div>}
          <div className="comments">
            {reviews.flatMap((r, i) => {
              const v = takesOf(doc.takes ?? [], cur.shot.id).findIndex((x) => x.id === r.target.id) + 1
              const row = (
                <div key={r.id} className="comment" onClick={() => jump(r)} style={focusPin === r.id ? { borderColor: 'var(--create)' } : undefined}>
                  <div className="row">
                    <span className="tc">{fmtTime(r.at_s ?? 0)}</span><span className="faint" style={{ fontSize: 11 }}>v{v}{r.region ? ' · box' : ''}</span><span className="spacer" />{r.resolved && <span className="ok">✓ Addressed</span>}
                    <button className="btn xs icon ghost iconbtn-del del" aria-label="Delete note" title="Delete note" onClick={async (e) => {
                      e.stopPropagation()
                      if (focusPin === r.id) setFocusPin(null)
                      const removal = await deleteFrom(docStore, (d) => removeNote(d, r.id))
                      offerNoteUndo({ label: 'Note deleted', key: String(i), undo: () => restoreTo(docStore, removal) })
                    }}>🗑</button>
                  </div>
                  <div>{r.comment}</div>
                </div>
              )
              return noteUndo?.key === String(i) ? [<UndoChip key="undo" label={noteUndo.label} onUndo={runNoteUndo} />, row] : [row]
            })}
            {noteUndo && Number(noteUndo.key) >= reviews.length && <UndoChip label={noteUndo.label} onUndo={runNoteUndo} />}
            {!reviews.length && <div className="faint" style={{ fontSize: 12.5 }}>Pause the clip and type. Your note sticks to that moment.</div>}
          </div>
          {openNotes.length > 0 && (
            <button className="btn primary" disabled={fixing} onClick={fix} title={fixesInShot ? 'Fix the box in the storyboard frame, then make the clip again from it' : undefined}>
              {fixing ? (progress?.step === 'frame' ? 'Fixing the frame…' : 'Making a new version…') : `${fixesInShot ? 'Fix it in the shot' : 'Make a new version'} (${openNotes.length} note${openNotes.length > 1 ? 's' : ''})`}
            </button>
          )}
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
  const apply = async () => {
    setError(null)
    try {
      const video = await assetRef(relay, take.asset)
      await runner.submit('clip_edit', { video, text: text.trim(), ...(controls.feelStrength ? { feel: { strength } } : { feel: {} }) }, [take.job_id], { for: 'clip', shotId: shot.id, parentTakeId: take.id })
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
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
        <button className="btn sm primary" disabled={!text.trim() || running} onClick={apply}>{running ? 'Working…' : 'Apply'}</button>
      </div>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
    </div>
  )
}

function AdResult({ sha }: { sha: string }) {
  const url = useBlobUrl(sha)
  const doc = useDoc()
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
        {status.stale && <span className="stale" title={status.reason}>Out of date</span>}
        {showMock && asset?.origin === 'mock' && <span className="mockbadge">MOCK</span>}
      </div>
      {status.stale && (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="faint" style={{ fontSize: 12 }}>{status.reason}.</span>
          <UpdateFollows size="xs" progress={false} />
        </div>
      )}
      {url && <video src={url} controls playsInline style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 360 }} />}
      {url && <a className="btn sm" href={url} download={`napkin-${doc.participant.handle}-${sha.slice(7, 15)}.${ext}`}>Download</a>}
    </div>
  )
}
