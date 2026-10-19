// Shots that will be one video, as strips (features/connected-video.clan; the owner's "Strips + select",
// 2026-10-19). On the Video timeline the shots a run makes as one video sit joined as one strip under a
// header ("One video · 9 s", the model and a rough wait at the right, one "Make as one video"); separate
// shots are their own cards. Between two shots of a strip, ✂ splits it; between two neighbours that may be
// one video, 🔗 joins them. A selection of cards gets a floating bar: One video, or Separately. Each writes
// the joins (jobs/runView.ts) and one History entry. No mode name and no price.

import { Fragment, useEffect, type ReactNode } from 'react'
import { useDoc, useServices } from '../app/context'
import type { Id, Shot } from '../contracts/types'
import { canJoin } from '../jobs/runs'
import { joinHere, joinSelection, selectionBlock, separateSelection, splitHere, videoShots, waitWords, type Unit } from '../jobs/runView'
import { JobSlot } from '../ui/JobSlot'

/** The timeline's units: strips of cards and separate cards, with ✂ and 🔗 between them. */
export function StripTrack({ videoId, shots, units, card, insert, onMakeStrip, onPlayStrip }: {
  videoId: Id
  shots: Shot[]
  units: Unit[]
  /** A shot's card; `inStrip`: its strip has the make action and the progress. */
  card: (s: Shot, i: number, inStrip: boolean) => ReactNode
  /** What sits before card i (editable shot lists: + Insert). */
  insert?: (i: number) => ReactNode
  onMakeStrip: (shotIds: Id[]) => void
  onPlayStrip: (shotId: Id) => void
}) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const facts = videoShots(doc, videoId)
  const index = new Map(shots.map((s, i) => [s.id, i]))
  const link = (i: number) => i > 0 && facts[i - 1] && facts[i] && canJoin(facts[i - 1], facts[i])
    ? <button type="button" className="ve-link" aria-label={`Join shot ${i} and shot ${i + 1} into one video`} title="Join into one video"
      onClick={(e) => { e.stopPropagation(); void joinHere(docStore, videoId, shots[i].id) }}><span aria-hidden="true">🔗</span></button>
    : i > 0 ? <span className="ve-apart" aria-hidden="true" /> : null
  return (
    <>
      {units.map((u) => {
        if (u.kind === 'shot') {
          const i = index.get(u.shotId)!
          return <Fragment key={u.shotId}>{insert?.(i)}{link(i)}{card(shots[i], i, false)}</Fragment>
        }
        const first = index.get(u.shotIds[0])!
        const r = u.run
        return (
          <Fragment key={u.shotIds.join()}>
            {insert?.(first)}{link(first)}
            <section className={`ve-strip ${u.state}`} aria-label={`One video: shots ${first + 1} to ${first + u.shotIds.length}`}>
              <header className="ve-striphead">
                <b>One video · {fmtS(u.lengthS)}</b>
                {u.state === 'separate' && <span className="faint">Made as separate clips</span>}
                <span className="pt-grow" />
                {u.state !== 'made' && <span className="faint ve-stripmodel" title={r.switched ? `${r.switched}, so ${r.model.label} makes this one.` : undefined}>{r.model.label} · {waitWords(r.model, u.lengthS)}</span>}
                {(u.state === 'new' || u.state === 'separate') && (
                  <button type="button" className="btn sm primary" aria-haspopup="dialog" onClick={() => onMakeStrip(u.shotIds)}>Make as one video</button>
                )}
                {u.state === 'made' && <button type="button" className="btn sm" onClick={() => onPlayStrip(u.shotIds[0])}>▶ Play</button>}
              </header>
              {u.state === 'making' && u.jobId && <div className="ve-stripjob"><JobSlot jobId={u.jobId} compact /></div>}
              <div className="ve-stripcards">
                {u.shotIds.map((id, k) => {
                  const i = index.get(id)!
                  return (
                    <Fragment key={id}>
                      {k > 0 && (
                        <button type="button" className="ve-cut" aria-label={`Split here, between shot ${i} and shot ${i + 1}`} title="Split here"
                          onClick={(e) => { e.stopPropagation(); void splitHere(docStore, videoId, id) }}>
                          <span aria-hidden="true">✂</span><span className="ve-cont">continues</span>
                        </button>
                      )}
                      {card(shots[i], i, true)}
                    </Fragment>
                  )
                })}
              </div>
              {r.splitAfter && <div className="ve-stripnote faint">Longer than one video can be: the next shots make another.</div>}
            </section>
          </Fragment>
        )
      })}
    </>
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
