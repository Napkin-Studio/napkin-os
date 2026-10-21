// New take ready (board Edit room): bring a new take into the cut without losing its trims, fades or place. Old
// and new side by side over the clip's window, with one scrub; the change it makes; what the lengths do. Use this
// take changes only the source (the same slot: start, fades and transitions stay); a shorter take holds its last
// frame up to 0.5 s, and past that the person chooses (hold, fit the speed, or shorten the slot, which ripples and
// is never chosen for them). For a box made together it can swap every clip of the box. Keep both keeps the new
// take in the Bin (on V2 once V2 comes, P3). Not now hides the badge. Undo takes a swap back.

import { useState } from 'react'
import { useServices } from '../app/context'
import { clipLen, HOLD_MAX_S, type Cut, type CutClip, type SwapChoice } from './cut'
import { editCut, swapPlanFor } from './editOps'
import { boxName, shotWindow, type Gen } from './model'
import { tc } from './media'
import { Poster } from './Poster'
import type { RoomData } from './Rooms'
import { notNow } from './timeline'

export function NewTakeSheet({ data, cut, clip, take, onClose, onError }: {
  data: RoomData; cut: Cut; clip: CutClip; take: Gen; onClose: () => void; onError: (m: string) => void
}) {
  const { doc: docStore } = useServices()
  const old = data.gens.find((g) => g.id === clip.genId)
  const box = old ? data.boxes.find((b) => b.key === old.boxKey) : undefined
  const siblings = cut.v1.filter((c) => c.genId === clip.genId)
  const [all, setAll] = useState(siblings.length > 1)
  const ids = all ? siblings.map((c) => c.id) : [clip.id]
  const plan = old ? swapPlanFor(cut, take, old, ids) : undefined
  const mine = plan?.clips.find((p) => p.id === clip.id)
  const [choice, setChoice] = useState<SwapChoice | null>(plan && plan.shortBy > 0 && !plan.ask ? 'hold' : plan && plan.shortBy > 0 ? null : 'hold')
  const [k, setK] = useState(0)
  const [busy, setBusy] = useState(false)
  if (!old || !plan || !mine) return null
  const oldLen = clipLen(clip) - clip.holdS
  const newLen = mine.outS - mine.inS
  const newSeg = shotWindow(take, clip.follows?.shotId)
  const needsChoice = plan.shortBy > 0
  const use = async () => {
    setBusy(true)
    try {
      await editCut.swap(docStore, data.videoId, take, old, ids, choice ?? 'hold')
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rm-sheetwrap" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="rm-sheet" role="dialog" aria-label="New take ready">
        <header className="rm-changehead">
          <b className="rm-clamp2">New take ready · {box ? boxName(box) : 'Take'} v{take.version}</b>
          <button type="button" className="rm-iconbtn ghost" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="rm-sheetpair">
          <figure>
            <Poster sha={old.asset} atS={clip.inS + k * oldLen} />
            <figcaption className="rm-clamp2" title={`v${old.version} · ${old.label}`}>Now: v{old.version} · {old.label}</figcaption>
          </figure>
          <figure>
            <Poster sha={take.asset} atS={mine.inS + k * newLen} />
            <figcaption className="rm-clamp2" title={`v${take.version} · ${take.label}`}>New: v{take.version} · {take.label}</figcaption>
          </figure>
        </div>
        <label className="rm-fieldlabel">Scrub both over the clip
          <input type="range" min={0} max={1} step={0.01} value={k} onChange={(e) => setK(Number(e.target.value))} />
        </label>
        <p className="rm-note">The clip's window {oldLen.toFixed(1)} s · the new take has {newLen.toFixed(1)} s for this shot ({tc(newSeg.inS)}-{tc(newSeg.outS)} of it).</p>
        {needsChoice && (
          <fieldset className="rm-field">
            <legend className="rm-label">The new take is {plan.shortBy.toFixed(1)} s shorter</legend>
            <div className="rm-radios" role="radiogroup" aria-label="How to fit it">
              <label className={choice === 'hold' ? 'on' : ''}><input type="radio" name="fit" checked={choice === 'hold'} onChange={() => setChoice('hold')} /> Hold the last frame{plan.shortBy <= HOLD_MAX_S + 1e-6 ? ' (default)' : ''}</label>
              <label className={choice === 'fit' ? 'on' : ''}><input type="radio" name="fit" checked={choice === 'fit'} disabled={!plan.fitSpeed} onChange={() => setChoice('fit')} /> Fit the speed{plan.fitSpeed ? ` (${(1 / plan.fitSpeed).toFixed(2)}× slower)` : ' (too slow)'}</label>
              <label className={choice === 'shorten' ? 'on' : ''}><input type="radio" name="fit" checked={choice === 'shorten'} onChange={() => setChoice('shorten')} /> Shorten the slot (what follows moves up)</label>
            </div>
          </fieldset>
        )}
        {!needsChoice && <p className="rm-faint">Same length or longer: nothing in your cut moves.</p>}
        {siblings.length > 1 && (
          <label className="rm-check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Use v{take.version} for all {siblings.length} clips of {box ? boxName(box) : 'this box'}</label>
        )}
        <div className="rm-row end wrap">
          <button type="button" className="btn" onClick={() => { notNow(clip, take); onClose() }}>Not now</button>
          <button type="button" className="btn" onClick={() => { notNow(clip, take); onError(`v${take.version} is kept in the Bin. Laying it over the cut on V2 comes next.`); onClose() }}>Keep both</button>
          <button type="button" className="btn primary" disabled={busy || (needsChoice && !choice)} onClick={() => void use()}>{busy ? 'Using…' : 'Use this take'}</button>
        </div>
        <p className="rm-faint">Start, trims, fades and joins stay. Undo puts v{old.version} back.</p>
      </section>
    </div>
  )
}
