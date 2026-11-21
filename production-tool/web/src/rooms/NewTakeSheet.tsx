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
import { boxName, coversShot, inBox, type Gen } from './model'
import { tc } from './media'
import { Poster } from './Poster'
import type { RoomData } from './Rooms'
import { notNow } from './timeline'

export function NewTakeSheet({ data, cut, clip, take, onClose, onError }: {
  data: RoomData; cut: Cut; clip: CutClip; take: Gen; onClose: () => void; onError: (m: string) => void
}) {
  const { doc: docStore } = useServices()
  const old = data.gens.find((g) => g.id === clip.genId)
  // The box is the new take's (the clip's shot's box): a joined take cut apart since is a take of each of its shots'
  // boxes, and its first was named for shot 2's card (UAT 2026-11-21, F2: "Box 1 v1" on Box 2's take).
  const box = data.boxes.find((b) => !!clip.follows?.shotId && b.shotIds.includes(clip.follows.shotId) && inBox(take, b.key))
    ?? data.boxes.find((b) => b.key === take.boxKey)
  // Only the clips of the old take whose shot the new take has footage for (F2: a shot-1 take was put over shot 2's
  // clip as well, so shot 2 played shot 1's footage and its own card went).
  const siblings = cut.v1.filter((c) => c.genId === clip.genId && (c.id === clip.id || (!!c.follows?.shotId && coversShot(take, c.follows.shotId))))
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
        {/* One window in one sentence (UAT round 3, R3-F11: "has 1.5 s for this shot (0:00.0-0:03.0 of it)"). */}
        <p className="rm-note">The clip plays {oldLen.toFixed(1)} s now · the new take would play {newLen.toFixed(1)} s of it, {tc(mine.inS)}-{tc(mine.outS)} of its {take.durationS.toFixed(1)} s.</p>
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
