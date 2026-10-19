// The ad as the videos it is made of, one row each (features/connected-video.clan; the owner's "One row per
// video", 2026-10-19). A row is one video: several shots made as one, or a single shot. Its header says
// what it is ("One video · shots 1–5 · 8.5 s"), quietly the model and the wait, and has ONE Make button whose
// words carry its state (Make, Make as one video, Making… 0:42, Make again). Between two shots of a row a
// divider offers "Cut here"; between two rows, "Join" where they may be one video, else a muted reason. A
// row Runway refused (that exact set of shots) says so with Try again and Make separately. Selecting cards
// gives a floating bar: One video, or Separately. Each split or join writes the joins (jobs/runView.ts) and
// one History entry. No mode name and no price.

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useDoc, useServices } from '../app/context'
import type { Id, Shot } from '../contracts/types'
import { canJoin, joinBlock } from '../jobs/runs'
import { elapsed, joinHere, joinSelection, rowMakeWords, rowTitle, selectionBlock, separateSelection, splitHere, videoShots, waitWords, type Row } from '../jobs/runView'

/** The timeline: the videos of the ad, numbered, one row each. */
export function VideoRows({ videoId, shots, rows, card, insert, selected, onSelectRow, onMake, onMakeAgain, onMakeSeparately }: {
  videoId: Id
  shots: Shot[]
  rows: Row[]
  /** A shot's thumbnail card in its row. */
  card: (s: Shot, i: number) => ReactNode
  /** What sits before card i (editable shot lists: + Insert). */
  insert?: (i: number) => ReactNode
  /** The first shot of the row the player shows. */
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
  // Making… 0:42 ticks while a row is being made.
  const making = rows.some((r) => r.state === 'making')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!making) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [making])
  return (
    <div className="ve-rows">
      <div className="ve-rowsum"><b>Your ad</b><span className="faint"> · {rows.length} {rows.length === 1 ? 'video' : 'videos'} · {fmtS(total)}</span></div>
      {rows.map((row, k) => {
        const first = index.get(row.shotIds[0])!
        const prev = rows[k - 1]
        const a = prev ? index.get(prev.shotIds.at(-1)!)! : -1
        const joinable = !!prev && !!facts[a] && !!facts[first] && canJoin(facts[a], facts[first])
        const why = prev && !joinable && facts[a] && facts[first] ? joinBlock(facts[a], facts[first], first) : undefined
        const job = row.jobId ? doc.jobs[row.jobId] : undefined
        return (
          <Fragment key={row.shotIds.join()}>
            {prev && (
              <div className="ve-joinrow">
                {joinable
                  ? <button type="button" className="ve-join" aria-label={`Join videos ${k} and ${k + 1} into one video`} onClick={() => void joinHere(docStore, videoId, row.shotIds[0])}>Join</button>
                  : why && <span className="ve-joinwhy">{why}</span>}
              </div>
            )}
            <section className={`ve-row ${row.state} ${selected === row.shotIds[0] ? 'sel' : ''}`} aria-label={`Video ${k + 1}: ${rowTitle(doc, row)}`}>
              <header className="ve-rowhead">
                <span className="ve-rownum" aria-hidden="true">{k + 1}</span>
                <button type="button" className="ve-rowtitle" onClick={() => onSelectRow(row)} title="Play this video">{rowTitle(doc, row)}</button>
                <span className="pt-grow" />
                {row.state !== 'made' && row.state !== 'refused' && (
                  <span className="faint ve-rowmodel" title={row.switched ? `${row.switched}, so ${row.model.label} makes this one.` : undefined}>{row.model.label} · {waitWords(row.model, row.lengthS)}</span>
                )}
                {row.state === 'making'
                  ? <button type="button" className="btn sm" disabled>Making… {elapsed(job?.created_at, now)}</button>
                  : row.state !== 'refused' && (
                    <button type="button" className={`btn sm ${row.state === 'made' ? '' : 'primary'}`} aria-haspopup={row.state === 'made' ? undefined : 'dialog'}
                      onClick={() => (row.state === 'made' ? onMakeAgain(row) : onMake(row))}>{rowMakeWords(row)}</button>
                  )}
              </header>
              {row.state === 'making' && <div className="ve-rowprogress" role="progressbar" aria-label={`Making video ${k + 1}`} />}
              <div className="ve-rowshots">
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
              {row.state === 'refused' && (
                <div className="ve-rowwarn" role="status">
                  <span><span aria-hidden="true">⚠ </span>Runway refused the words.</span>
                  <button type="button" className="btn sm primary" aria-haspopup="dialog" title="Dex rewords anything Runway refuses, once, and tries again" onClick={() => onMake(row)}>Try again</button>
                  {row.shotIds.length > 1 && <button type="button" className="btn sm" aria-haspopup="dialog" onClick={() => onMakeSeparately(row)}>Make separately</button>}
                </div>
              )}
              {row.splitAfter && <div className="ve-rownote faint">Longer than one video can be: the next shots make another.</div>}
            </section>
          </Fragment>
        )
      })}
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
