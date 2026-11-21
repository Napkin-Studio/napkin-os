// The take's notes and its Final, in the Change panel (features/production-new-ui.clan P4: the legacy Film
// editor's extras folded into the Rooms). A note sticks to a moment of the take, with a box on the frame when
// one is drawn, and waits: nothing is sent until "Fix it in the shot" (a boxed note: the storyboard frame is
// fixed first, then the clip is made from it) or "Make a new version" (the notes read back as the words).
// A draft take can be made again at Final with its own words, pictures and length.

import { useConfig, useDoc, useServices, useUi } from '../app/context'
import type { Generation } from '../contracts/types'
import { deleteFrom, removeNote } from '../doc/remove'
import { MakeTray } from '../ui/MakeTray'
import { makeClip, remakeAsFinal, shotQuality } from '../jobs/clips'
import { fixesInFrame, fixFrameLanded, fixInShot, fixProgress, remakeFixClip } from '../jobs/fix'
import { ctxReader } from '../jobs/runner'
import { isRunning, jobAt } from '../jobs/select'
import { clipText } from '../lib/guard'
import { fmtTime, useSending } from '../ui/hooks'
import type { Gen } from './model'
import { finalHint, openNotesOf } from './takeNotesModel'

export function TakeNotes({ parent, videoId, shotId }: { parent: Gen; videoId: string; shotId?: string }) {
  const services = useServices()
  const { doc: docStore, relay, runner } = services
  const doc = useDoc()
  const ui = useUi()
  const { controls } = useConfig()
  const [sending, send] = useSending()
  const take = doc.generations[parent.id] as Generation | undefined
  const notes = openNotesOf(doc, parent.id)
  const shot = shotId ?? take?.shot_ids[0]
  if (!take || !shot) return null
  const deps = { relay, doc: docStore, ui: services.ui, runner }
  const boxed = notes.filter((r) => r.region)
  const inShot = fixesInFrame(doc, shot, boxed, controls.fixInShot)
  const fixedFrame = inShot ? fixFrameLanded(doc, ctxReader(doc, ui), notes.map((r) => r.id)) : undefined
  const fixJob = jobAt(doc, ui, (c) => (c.for === 'clip' || (c.for === 'frame' && !!c.fixReviewIds?.length)) && c.shotId === shot)
  const fixing = isRunning(doc, fixJob)
  const progress = fixProgress(doc, ctxReader(doc, ui), notes.map((r) => r.id))
  const quality = shotQuality(doc, shot, videoId)
  const draft = take.inputs?.quality === 'draft'

  const fix = () => send(async () => {
    if (fixedFrame) await remakeFixClip(deps, fixedFrame, undefined, quality)
    else if (inShot) await fixInShot(deps, shot, notes, undefined, quality)
    else {
      const text = clipText(notes.map((r) => `At ${fmtTime(r.at_s ?? 0)}: ${r.text ?? ''}`).join('\n'), 1000)
      await makeClip(deps, shot, { text, reviewIds: notes.map((r) => r.id), parentTake: take, quality, videoId })
    }
  })
  const toFinal = () => send(async () => { await remakeAsFinal(deps, take) })

  if (!notes.length && !draft) return null
  return (
    <div className="rm-takenotes">
      {notes.length > 0 && (
        <>
          <div className="rm-label">Notes on this take · {notes.length}</div>
          <ul className="rm-notelist">
            {notes.map((r) => (
              <li key={r.id}>
                <span className="pt-mono">{fmtTime(r.at_s ?? 0)}</span>
                {r.region && <span className="rm-notebox" title="A box on the frame">▭</span>}
                <span className="rm-clamp2" title={r.text}>{r.text}</span>
                <button type="button" className="rm-iconbtn ghost" aria-label="Delete note" title="Delete note"
                  onClick={() => void deleteFrom(docStore, (d) => removeNote(d, r.id))}>×</button>
              </li>
            ))}
          </ul>
          <p className="rm-note">{fixedFrame ? 'The frame is fixed; the clip is made from it next.'
            : inShot ? 'A boxed note is fixed in the shot: its storyboard frame first, then the clip from it. This take is kept.'
              : 'The notes are read back as the words for a new version; this take is kept.'}</p>
          <MakeTray className="btn rm-wide" busy={sending || fixing} busyLabel={fixing ? (progress?.step === 'frame' ? 'Fixing the frame…' : 'Making a new version…') : 'Sending…'}
            onYes={() => void fix()} yes={fixedFrame ? 'Make the clip' : inShot ? 'Fix it' : 'Make a new version'}
            rows={[
              { key: 'what', label: fixedFrame ? 'A new clip from the fixed frame' : inShot ? 'The frame fixed in the shot, then a new clip from it' : 'A new version of this take, from your notes', detail: `${notes.length} note${notes.length > 1 ? 's' : ''}` },
              { key: 'count', label: '1 new take', detail: 'this take is kept' },
            ]}
            label={`${fixedFrame ? 'Make the clip from the fixed frame' : inShot ? 'Fix it in the shot' : 'Make a new version'} (${notes.length} note${notes.length > 1 ? 's' : ''})`} />
        </>
      )}
      {draft && (
        <MakeTray className="btn ghost rm-wide" busy={sending} busyLabel="Sending…" onYes={() => void toFinal()} title={finalHint(doc, take)} label="Remake as Final" yes="Remake as Final"
          rows={[{ key: 'what', label: 'This take again at Final quality', detail: 'the same shots and words' }, { key: 'count', label: '1 new take', detail: 'the draft is kept' }]} />
      )}
    </div>
  )
}

