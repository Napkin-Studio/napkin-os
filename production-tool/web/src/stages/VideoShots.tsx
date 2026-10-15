// A video's shots on its timeline, made straight from the script (ui-behaviour 3.13, decided 2026-10-15):
// the Video holds its own shot list (no Storyboard node), so the Video editor shows and edits it. The
// selected shot's words and direction (live text, the same editor as the storyboard's), its length, its
// place (earlier, later) and Delete; + between two shots inserts an empty one, + Shot adds one at the end.
// Clips are made from the words through Make clips (the send tray). Each edit is one undo step.

import { useMemo, useRef, useState } from 'react'
import { useDoc, useServices } from '../app/context'
import type { Shot } from '../contracts/types'
import { deleteFrom, removeShot, shotDeleteText, shotNeedsConfirm } from '../doc/remove'
import { updateDoc } from '../doc/store'
import { selectedFrame } from '../jobs/frames'
import { editShot } from '../jobs/stale'
import { MAX_SHOTS } from '../lib/shots'
import { framesOf, takesOf } from '../model/selectors'
import { insertShot } from '../script/edits'
import { scriptMentionHooks } from '../script/mentionHooks'
import { ShotEditor } from '../script/ShotEditor'
import { InlineConfirm } from '../ui/Undo'
import { addShot, moveShot } from './storyboardEdits'

const MIN_S = 1
const MAX_S = 10

/** The selected shot: its words and direction, its length, earlier or later, and Delete. */
export function ShotPanel({ shot, index, count, onGone }: { shot: Shot; index: number; count: number; onGone: () => void }) {
  const { doc: docStore, clan } = useServices()
  const doc = useDoc()
  const mentions = useMemo(() => (clan ? scriptMentionHooks(clan, undefined) : undefined), [clan])
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  const remove = () => attempt(async () => {
    setConfirming(false)
    await deleteFrom(docStore, (d) => removeShot(d, shot.id)) // Undo in the top bar puts it back
    onGone()
  })
  const ask = () => (shotNeedsConfirm(docStore.get(), shot.id) ? setConfirming(true) : void remove())
  return (
    <section className="card section stack ve-shot" aria-label={`Shot ${index + 1}`} data-video-shot={shot.id}>
      <div className="row">
        <h2>Shot {index + 1}</h2>
        <span className="faint" style={{ fontSize: 12 }}>{selectedFrame(doc, shot.id) ? 'its clip is made from its frame' : 'its words make its clip'}</span>
      </div>
      <div className="ve-shotwords">
        {clan
          ? <ShotEditor store={clan} shotId={shot.id} name={`Shot ${index + 1}`} compact mentions={mentions} />
          : <div className="script-excerpt">{shot.action ?? ''}</div>}
      </div>
      <div className="row ve-shotrow">
        <label className="ve-len">Length
          <input className="input" type="number" min={MIN_S} max={MAX_S} step={0.5} aria-label={`Shot ${index + 1} length in seconds`} value={shot.duration_s}
            onChange={(e) => void attempt(() => updateDoc(docStore, (d) => editShot(d, shot.id, { duration_s: Math.max(MIN_S, Math.min(MAX_S, Number(e.target.value) || MIN_S)) }), 'edit shot'))} /> s
        </label>
        <span className="spacer" />
        <button className="btn xs" disabled={index === 0} aria-label={`Move shot ${index + 1} earlier`} title="Earlier"
          onClick={() => void attempt(() => updateDoc(docStore, (d) => moveShot(d, shot.id, -1), 'move shot'))}>←</button>
        <button className="btn xs" disabled={index >= count - 1} aria-label={`Move shot ${index + 1} later`} title="Later"
          onClick={() => void attempt(() => updateDoc(docStore, (d) => moveShot(d, shot.id, 1), 'move shot'))}>→</button>
        <button className="btn xs ghost" aria-label={`Delete shot ${index + 1}`} onClick={ask}>Delete</button>
      </div>
      {confirming && (
        <InlineConfirm text={shotDeleteText(index + 1, framesOf(doc, shot.id).length, takesOf(doc, shot.id).length)} yes="Delete shot"
          onNo={() => setConfirming(false)} onYes={() => void remove()} />
      )}
      {error && <div role="alert" className="ve-error" style={{ margin: 0 }}>{error}</div>}
    </section>
  )
}

/** + between shot `after` and the next: an empty shot there (live text, one undo step). */
export function InsertShot({ after, n, disabled, onMade }: { after: Shot; n: number; disabled: boolean; onMade: (id: string) => void }) {
  const { clan } = useServices()
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button ref={ref} type="button" className="ve-insert" disabled={disabled || busy || !clan} aria-label={`Insert a shot between ${n} and ${n + 1}`} title={`Insert a shot between ${n} and ${n + 1}`}
      onClick={(e) => {
        e.stopPropagation()
        if (!clan) return
        setBusy(true)
        void insertShot(clan, { afterShotId: after.id }).then(onMade).catch(() => {}).finally(() => setBusy(false))
      }}>+</button>
  )
}

/** + Shot at the end of the video's shots. */
export function AddShot({ storyboardId, count, onMade }: { storyboardId: string; count: number; onMade: (id: string) => void }) {
  const { doc: docStore } = useServices()
  return (
    <button type="button" className="ve-addshot" disabled={count >= MAX_SHOTS} title={count >= MAX_SHOTS ? `Use ${MAX_SHOTS} shots or fewer` : 'Add a shot at the end'}
      onClick={() => {
        let id = ''
        void updateDoc(docStore, (d) => { id = addShot(d, storyboardId) }, 'add shot').then(() => onMade(id))
      }}>+ Shot</button>
  )
}
