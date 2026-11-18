// Phone review (ui-behaviour 2.5, 3.14; mock PhoneReview.dc.html): below 600px wide every route shows
// this. Watch the ad, see the notes, leave a note at a moment. No editing controls, hidden or
// disabled; one banner says where to edit. A note on the ad lands on the shot playing at that moment,
// as a note on its take (the Film editor's notes), so Fix this moment there picks it up.

import { useMemo, useRef, useState } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import type { Shot, Generation } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { personOf } from '../projects/session'
import { currentFrame, currentRender, currentTake, mainVideo, openAsks, reviewsList, shotsOf } from '../model/selectors'
import { compileFor } from '../rooms/timeline'
import { useBlobUrl } from '../ui/hooks'
import { CanvasBar } from '../ui/chrome/TopBars'
import { initials } from '../ui/chrome/panels'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { addTakeNote } from './videoEdits'
import './phone.css'

interface Item { shot: Shot; take?: Generation; start: number; dur: number; inS: number }
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
/** A note fixes about 2 s round its moment (ui-behaviour 3.13): the window it will change. */
const windowOf = (at: number, len: number) => ({ from: Math.max(0, Math.round(at) - 1), to: Math.min(len, Math.max(0, Math.round(at) - 1) + 2) })

export function PhoneReview() {
  const doc = useDoc()
  const ui = useUi()
  const { doc: docStore } = useServices()
  const shots = shotsOf(doc)
  const render = currentRender(doc)
  const adUrl = useBlobUrl(render?.asset)
  const video = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  const [note, setNote] = useState('')
  // The ad's times come from its cut (Playwright live test 2026-11-18: one 6 s take of four joined shots was
  // counted once per shot, so the strip read 0:24 for an 8.5 s ad and shots started at 0, 6, 12, 18 s). Each
  // item is where its clip plays in the ad and which stretch of its take (inS); with no cut, shot after shot.
  const videoId = mainVideo(doc)?.id
  const plan = useMemo(() => (videoId ? compileFor(doc, videoId) : null), [doc, videoId])
  const items = useMemo((): Item[] => {
    const v = videoId ? doc.videos[videoId] : undefined
    const cut = (plan?.clips ?? []).flatMap((c): Item[] => {
      const shot = doc.shots[v?.timeline[c.item_id]?.follows?.shot_id ?? '']
      const take = c.generation_id ? doc.generations[c.generation_id] : undefined
      return shot ? [{ shot, take, start: c.startS, dur: c.durS, inS: c.inS }] : []
    })
    if (cut.length) return cut
    return shots.reduce<Item[]>((all, shot) => {
      const take = currentTake(doc, shot.id)
      const prev = all.at(-1)
      return [...all, { shot, take, start: prev ? prev.start + prev.dur : 0, dur: take?.duration_s || shot.duration_s, inS: 0 }]
    }, [])
  }, [doc, shots, plan, videoId])
  // One length, the ad's own (re-test 7h: the player said 0:08 for an 8.46 s render while the strip said 0:05 from
  // the cut, which leaves out the end card and the studio card): the video's once it has loaded, else its asset's.
  const [played, setPlayed] = useState<number | null>(null)
  const cutS = plan?.clips.length ? plan.lengthS : items.reduce((a, b) => a + b.dur, 0)
  const total = played ?? (render ? doc.assets[render.asset]?.duration_s : undefined) ?? cutS
  // Past the last shot the end card plays: no shot to leave a note on.
  const shotsEnd = items.reduce((a, i) => Math.max(a, i.start + i.dur), 0)
  const at = items.find((i) => t >= i.start && t < i.start + i.dur) ?? (t < shotsEnd || !adUrl ? items.at(-1) : undefined)
  const local = at ? t - at.start : 0
  const win = at ? windowOf(local, at.dur) : undefined
  const notes = reviewsList(doc).filter((r) => r.target.kind === 'generation')
  // A note's take and its moment in the take: the item that plays that stretch, and its time in the ad.
  const where = (takeId: string, atS = 0) => items.find((i) => i.take?.id === takeId && atS >= i.inS && atS <= i.inS + i.dur) ?? items.find((i) => i.take?.id === takeId)
  const adTime = (takeId: string, atS = 0) => { const w = where(takeId, atS); return w ? w.start + Math.max(0, atS - w.inS) : 0 }
  const asks = openAsks(doc).length
  const leave = () => {
    if (!at?.take || !note.trim()) return
    const take: Generation = at.take
    const by = `human:${personOf(ui.me).id}`
    void updateDoc(docStore, (d) => { addTakeNote(d, { takeId: take.id, shotId: at.shot.id, shotS: at.dur, atS: Math.round((at.inS + local) * 100) / 100, text: note.trim().slice(0, 1000), by }) }, 'comment')
    setNote('')
  }
  return (
    <div className="phone">
      {/* The shell bar in its phone cut (mock phone): the medallion, the document, theme, you and Decisions. */}
      <CanvasBar phone />
      <div className="ph-scroll">
        <div className="ph-banner" role="status">
          <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true"><rect x="1" y="2" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 17h10" stroke="currentColor" strokeWidth="1.4" /><rect x="20" y="6" width="7" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span>You can watch and leave notes here. <b>Open on a laptop or iPad to edit.</b>{asks ? ` ${asks} ${asks === 1 ? 'question' : 'questions'} waiting · answer on a laptop or iPad.` : ''}</span>
        </div>
        <div className="ph-head"><b>The ad</b>{render && <span className="pt-pill">v{render.version}</span>}{render && <span className="faint"><AgentFigure agent="edie" size={18} decorative /> rendered by the Edit agent</span>}</div>
        <div className="ph-player">
          {adUrl ? (
            <video ref={video} src={adUrl} controls playsInline preload="metadata" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => { const d = e.currentTarget.duration; setPlayed(Number.isFinite(d) && d > 0 ? d : null) }} />
          ) : (
            <div className="ph-noad">No ad rendered yet. Render it on a laptop or iPad, then watch it here.</div>
          )}
          {adUrl && <span className="ph-shotlabel">{at ? `Shot ${shots.indexOf(at.shot) + 1}` : 'End card'}</span>}
          {adUrl && <span className="ph-time">{fmt(t)} / {fmt(total)}</span>}
        </div>
        {adUrl && (
          <div className="ph-scrub" aria-hidden="true">
            <div className="ph-track" />
            {notes.map((r) => {
              if (!where(r.target.id)) return null
              return <span key={r.id} className={`ph-pin ${r.state === 'resolved' ? 'done' : ''}`} style={{ left: `${(adTime(r.target.id, r.at_s) / Math.max(1, total)) * 100}%` }} />
            })}
            <span className="ph-head-mark" style={{ left: `${(t / Math.max(1, total)) * 100}%` }} />
          </div>
        )}
        <div className="ph-strip">
          {items.map((i, k) => <Thumb key={`${i.shot.id}:${k}`} shot={i.shot} label={`${k + 1} · ${fmt(i.start)}`} on={i === at && !!adUrl}
            onPick={() => { if (video.current) video.current.currentTime = i.start }} />)}
        </div>
        <div className="ph-head"><b>Notes</b><span className="faint">{notes.filter((r) => r.state !== 'resolved').length} open · {notes.filter((r) => r.state === 'resolved').length} done</span></div>
        <ul className="ph-notes">
          {notes.map((r) => {
            const who = r.by === `human:${personOf(ui.me).id}` ? (ui.me?.name ?? ui.me?.handle ?? 'You') : r.by.replace(/^human:/, '')
            return (
              <li key={r.id}>
                <span className="ph-tc">{fmt(adTime(r.target.id, r.at_s))}</span>
                <span className="ph-av">{initials(who)}</span>
                <span className="ph-text"><span>{r.text}</span><small>{who}</small></span>
                <span className={`pt-pill ${r.state === 'resolved' ? 'ok' : 'warn'}`}>{r.state === 'resolved' ? 'Done' : 'Open'}</span>
              </li>
            )
          })}
          {!notes.length && <li className="ph-empty">No notes yet. Pause the ad and say what should change at that moment.</li>}
        </ul>
      </div>
      {adUrl && at?.take && (
        <div className="ph-compose">
          <div className="ph-composehead"><span>Leave a note at <b>{fmt(t)}</b></span>{win && <span className="pt-mono">changes only Shot {shots.indexOf(at.shot) + 1} · {fmt(win.from)}–{fmt(win.to)}</span>}</div>
          <textarea className="textarea" aria-label="Your note" placeholder="What should change at this moment?" value={note} maxLength={1000} onFocus={() => video.current?.pause()} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn primary ph-leave" disabled={!note.trim()} onClick={leave}>Leave note at {fmt(t)}</button>
        </div>
      )}
    </div>
  )
}

function Thumb({ shot, label, on, onPick }: { shot: Shot; label: string; on: boolean; onPick: () => void }) {
  const doc = useDoc()
  const url = useBlobUrl(currentFrame(doc, shot)?.asset)
  return (
    <button type="button" className={`ph-thumb ${on ? 'on' : ''}`} onClick={onPick} aria-label={`Shot ${label}`}>
      <span className="ph-thumbimg">{url && <img src={url} alt="" />}</span>
      <span className="pt-mono">{label}</span>
    </button>
  )
}
