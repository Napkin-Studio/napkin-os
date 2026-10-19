// The ad on ONE horizontal track (features/connected-video.clan; the owner's choice, 2026-10-20: "keep the
// single time line ... adding them to a single box, to showcase we are making a single video there"). Every
// shot sits on the track in storyboard order; it scrolls sideways, never wraps. Shots made as one video sit
// in ONE box: its header ("One video · shots 1–5 · 8.5 s"), quietly the model and the wait, and its single
// Make, whose words carry the state (Make, Make as one video, Making… 0:42, Make again); between its cards a
// "Cut here" divider splits it; a refusal of exactly its shots shows under its cards (Try again, Make
// separately); made as one take, a thin beat ruler runs under them. A separate shot is a card with its own
// small Make. Between two separate neighbours that may be one video, "Join"; where they may not, only a
// muted dot whose title says why. Selecting cards gives a floating bar: One video, or Separately. Each split
// or join writes the joins (jobs/runView.ts) and one History entry. No mode name and no price.

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useDoc, useServices } from '../app/context'
import type { Id, Shot } from '../contracts/types'
import { canJoin, joinBlock } from '../jobs/runs'
import { elapsed, joinHere, joinSelection, rowMakeWords, rowTitle, selectionBlock, separateSelection, splitHere, videoShots, waitWords, type Row } from '../jobs/runView'
import { currentTake } from '../model/selectors'

/** The timeline: one track of every shot, joined shots boxed as one video. */
export function VideoRows({ videoId, shots, rows, card, insert, selected, onSelectRow, onMake, onMakeAgain, onMakeSeparately }: {
  videoId: Id
  shots: Shot[]
  rows: Row[]
  /** A shot's thumbnail card. */
  card: (s: Shot, i: number) => ReactNode
  /** What sits before card i (editable shot lists: + Insert). */
  insert?: (i: number) => ReactNode
  /** The first shot of the video the player shows. */
  selected?: Id
  onSelectRow: (row: Row) => void
  /** Make, Make as one video and Try again: the send tray for these shots. */
  onMake: (row: Row) => void
  onMakeAgain: (row: Row) => void
  /** A refused video: split into single shots and make each (the tray first). */
  onMakeSeparately: (row: Row) => void
}) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const facts = videoShots(doc, videoId)
  const index = new Map(shots.map((s, i) => [s.id, i]))
  const total = rows.reduce((a, r) => a + r.lengthS, 0)
  // Making… 0:42 ticks while a video is being made.
  const making = rows.some((r) => r.state === 'making')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!making) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [making])
  /** A video's one Make, its words its state; a refused one's actions are under its cards instead. */
  const make = (row: Row, small: boolean) => {
    const job = row.jobId ? doc.jobs[row.jobId] : undefined
    if (row.state === 'making') return <button type="button" className={`btn ${small ? 'xs' : 'sm'} ve-make`} disabled>Making… {elapsed(job?.created_at, now)}</button>
    if (row.state === 'refused') return null
    return (
      <button type="button" className={`btn ${small ? 'xs' : 'sm'} ve-make ${row.state === 'made' ? '' : 'primary'}`} aria-haspopup={row.state === 'made' ? undefined : 'dialog'}
        onClick={() => (row.state === 'made' ? onMakeAgain(row) : onMake(row))}>{rowMakeWords(row)}</button>
    )
  }
  const refusal = (row: Row) => row.state === 'refused' && (
    <div className="ve-refusal" role="status">
      <span><span aria-hidden="true">⚠ </span>Runway refused the words.</span>
      <button type="button" className="btn xs primary" aria-haspopup="dialog" title="Dex rewords anything Runway refuses, once, and tries again" onClick={() => onMake(row)}>Try again</button>
      {row.shotIds.length > 1 && <button type="button" className="btn xs" aria-haspopup="dialog" onClick={() => onMakeSeparately(row)}>Make separately</button>}
    </div>
  )
  return (
    <div className="ve-track1wrap">
      <div className="ve-rowsum"><b>Your ad</b><span className="faint"> · {rows.length} {rows.length === 1 ? 'video' : 'videos'} · {fmtS(total)}</span></div>
      <div className="ve-track1" role="list" aria-label="The shots of the ad, in order">
        {rows.map((row, k) => {
          const first = index.get(row.shotIds[0])!
          const prev = rows[k - 1]
          const a = prev ? index.get(prev.shotIds.at(-1)!)! : -1
          const joinable = !!prev && !!facts[a] && !!facts[first] && canJoin(facts[a], facts[first])
          const why = prev && !joinable && facts[a] && facts[first] ? joinBlock(facts[a], facts[first], first) : undefined
          const gap = prev && (joinable
            ? <button type="button" className="ve-joingap" aria-label={`Join shot ${first} and shot ${first + 1} into one video`} onClick={() => void joinHere(docStore, videoId, row.shotIds[0])}>Join</button>
            : <span className="ve-nogap" role="img" aria-label={why ?? 'These are separate videos'} title={why}>·</span>)
          if (row.kind !== 'video') {
            return (
              <Fragment key={row.shotIds.join()}>
                {gap}
                <div className={`ve-solo ${row.state}`} role="listitem" aria-label={rowTitle(doc, row)}>
                  {insert?.(first)}
                  {card(shots[first], first)}
                  <div className="ve-solofoot">{make(row, true)}</div>
                  {refusal(row)}
                </div>
              </Fragment>
            )
          }
          // Made as one take: each shot's window of the one file, for the beat ruler under the cards.
          const windows = row.state === 'made' ? row.shotIds.map((id) => currentTake(doc, id, videoId)?.segments[0]) : []
          return (
            <Fragment key={row.shotIds.join()}>
              {gap}
              <section className={`ve-box ${row.state} ${selected === row.shotIds[0] ? 'sel' : ''}`} role="listitem" aria-label={`One video: ${rowTitle(doc, row)}`}>
                <header className="ve-boxhead">
                  <button type="button" className="ve-boxtitle" onClick={() => onSelectRow(row)} title="Play this video">{rowTitle(doc, row)}</button>
                  <span className="pt-grow" />
                  {row.state !== 'made' && row.state !== 'refused' && (
                    <span className="faint ve-boxmodel" title={row.switched ? `${row.switched}, so ${row.model.label} makes this one.` : undefined}>{row.model.label} · {waitWords(row.model, row.lengthS)}</span>
                  )}
                  {make(row, false)}
                </header>
                {row.state === 'making' && <div className="ve-rowprogress" role="progressbar" aria-label={`Making ${rowTitle(doc, row)}`} />}
                <div className="ve-boxcards">
                  {row.shotIds.map((id, j) => {
                    const i = index.get(id)!
                    return (
                      <Fragment key={id}>
                        {insert?.(i)}
                        {j > 0 && (
                          <button type="button" className="ve-cuthere" aria-label={`Cut here, between shot ${i} and shot ${i + 1}`}
                            onClick={(e) => { e.stopPropagation(); void splitHere(docStore, videoId, id) }}>
                            <span className="ve-cutpill">Cut here</span>
                          </button>
                        )}
                        {card(shots[i], i)}
                      </Fragment>
                    )
                  })}
                </div>
                {windows.length > 0 && windows.every(Boolean) && (
                  <div className="ve-ruler" aria-hidden="true">
                    {/* One beat per card, under it: where its shot sits in the one take. */}
                    {windows.map((w, j) => <span key={j}>{w!.in_s.toFixed(1)}–{w!.out_s.toFixed(1)} s</span>)}
                  </div>
                )}
                {refusal(row)}
                {row.splitAfter && <div className="ve-rownote faint">Longer than one video can be: the next shots make another.</div>}
              </section>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

const fmtS = (s: number) => `${Math.round(s * 10) / 10} s`

/** The floating bar over a selection of cards: "3 shots · 5 s  [One video] [Separately]". Escape clears. */
export function SelectionBar({ videoId, ids, onClear }: { videoId: Id; ids: Id[]; onClear: () => void }) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClear() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClear])
  const total = ids.reduce((a, id) => a + (doc.shots[id]?.duration_s ?? 0), 0)
  const why = selectionBlock(doc, videoId, ids)
  return (
    <div className="ve-selbar" role="toolbar" aria-label="Selected shots">
      <span><b>{ids.length} {ids.length === 1 ? 'shot' : 'shots'}</b> · {fmtS(total)}</span>
      <button type="button" className="btn sm primary" disabled={!!why} aria-describedby={why ? 've-selwhy' : undefined}
        onClick={() => void joinSelection(docStore, videoId, ids).then(onClear)}>One video</button>
      <button type="button" className="btn sm" onClick={() => void separateSelection(docStore, videoId, ids).then(onClear)}>Separately</button>
      <button type="button" className="btn sm ghost" aria-label="Clear the selection" onClick={onClear}>×</button>
      {why && <span id="ve-selwhy" className="ve-selwhy">{why}</span>}
    </div>
  )
}
