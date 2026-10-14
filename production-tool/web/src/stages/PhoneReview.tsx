// Phone review (ui-behaviour 2.5, 3.14; mock PhoneReview.dc.html): below 600px wide every route shows
// this. Watch the ad, see the notes, leave a note at a moment. No editing controls, hidden or
// disabled; one banner says where to edit. A note on the ad lands on the shot playing at that moment,
// as a note on its take (the Video editor's notes), so Fix this moment there picks it up.

import { useMemo, useRef, useState } from 'react'
import { useDoc, useServices, useShell, useUi } from '../app/context'
import type { Shot, Take } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { personOf } from '../projects/session'
import { currentFrame, currentRender, currentTake, openAsks, reviewsList, shotsOf } from '../model/selectors'
import { useBlobUrl } from '../ui/hooks'
import { Account, MarkTile } from '../ui/chrome/Bar'
import { initials } from '../ui/chrome/panels'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { addTakeNote } from './videoEdits'
import './phone.css'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
/** A note fixes about 2 s round its moment (ui-behaviour 3.13): the window it will change. */
const windowOf = (at: number, len: number) => ({ from: Math.max(0, Math.round(at) - 1), to: Math.min(len, Math.max(0, Math.round(at) - 1) + 2) })

export function PhoneReview() {
  const doc = useDoc()
  const ui = useUi()
  const shell = useShell()
  const { doc: docStore, project } = useServices()
  const name = shell.index.get(project.id)?.name
  const shots = shotsOf(doc)
  const render = currentRender(doc)
  const adUrl = useBlobUrl(render?.asset)
  const video = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  const [note, setNote] = useState('')
  const items = useMemo(() => shots.reduce<{ shot: Shot; take?: Take; start: number; dur: number }[]>((all, shot) => {
    const take = currentTake(doc, shot.id)
    const prev = all.at(-1)
    return [...all, { shot, take, start: prev ? prev.start + prev.dur : 0, dur: take?.duration_s || shot.duration_s }]
  }, []), [doc, shots])
  const total = items.reduce((a, b) => a + b.dur, 0)
  const at = items.find((i) => t >= i.start && t < i.start + i.dur) ?? items.at(-1)
  const local = at ? t - at.start : 0
  const win = at ? windowOf(local, at.dur) : undefined
  const notes = reviewsList(doc).filter((r) => r.target.kind === 'take')
  const where = (takeId: string) => items.find((i) => i.take?.id === takeId)
  const asks = openAsks(doc).length
  const leave = () => {
    if (!at?.take || !note.trim()) return
    const take: Take = at.take
    const by = `human:${personOf(ui.me).id}`
    void updateDoc(docStore, (d) => { addTakeNote(d, { takeId: take.id, shotId: at.shot.id, shotS: at.dur, atS: Math.round(local * 100) / 100, text: note.trim().slice(0, 1000), by }) }, 'comment')
    setNote('')
  }
  return (
    <div className="phone">
      <header className="ph-bar">
        <MarkTile />
        <span className="ph-brand"><b>Production</b><span>{name}</span></span>
        <span className="pt-grow" />
        <Account />
      </header>
      <div className="ph-scroll">
        <div className="ph-banner" role="status">
          <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true"><rect x="1" y="2" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 17h10" stroke="currentColor" strokeWidth="1.4" /><rect x="20" y="6" width="7" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span>You can watch and leave notes here. <b>Open on a laptop or iPad to edit.</b>{asks ? ` ${asks} ${asks === 1 ? 'question' : 'questions'} waiting · answer on a laptop or iPad.` : ''}</span>
        </div>
        <div className="ph-head"><b>The ad</b>{render && <span className="pt-pill">v{render.version}</span>}{render && <span className="faint"><AgentFigure agent="edie" size={18} decorative /> rendered by Edie</span>}</div>
        <div className="ph-player">
          {adUrl ? (
            <video ref={video} src={adUrl} controls playsInline preload="metadata" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
          ) : (
            <div className="ph-noad">No ad rendered yet. Render it on a laptop or iPad, then watch it here.</div>
          )}
          {at && adUrl && <span className="ph-shotlabel">Shot {shots.indexOf(at.shot) + 1}</span>}
          {adUrl && <span className="ph-time">{fmt(t)} / {fmt(total)}</span>}
        </div>
        {adUrl && (
          <div className="ph-scrub" aria-hidden="true">
            <div className="ph-track" />
            {notes.map((r) => {
              const w = where(r.target.id)
              if (!w) return null
              return <span key={r.id} className={`ph-pin ${r.state === 'resolved' ? 'done' : ''}`} style={{ left: `${((w.start + (r.at_s ?? 0)) / Math.max(1, total)) * 100}%` }} />
            })}
            <span className="ph-head-mark" style={{ left: `${(t / Math.max(1, total)) * 100}%` }} />
          </div>
        )}
        <div className="ph-strip">
          {items.map((i, k) => <Thumb key={i.shot.id} shot={i.shot} label={`${k + 1} · ${fmt(i.start)}`} on={i === at && !!adUrl}
            onPick={() => { if (video.current) video.current.currentTime = i.start }} />)}
        </div>
        <div className="ph-head"><b>Notes</b><span className="faint">{notes.filter((r) => r.state !== 'resolved').length} open · {notes.filter((r) => r.state === 'resolved').length} done</span></div>
        <ul className="ph-notes">
          {notes.map((r) => {
            const w = where(r.target.id)
            const who = r.by === `human:${personOf(ui.me).id}` ? (ui.me?.name ?? ui.me?.handle ?? 'You') : r.by.replace(/^human:/, '')
            return (
              <li key={r.id}>
                <span className="ph-tc">{fmt((w?.start ?? 0) + (r.at_s ?? 0))}</span>
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
