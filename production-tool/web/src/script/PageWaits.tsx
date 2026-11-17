// What waits for the person in the Script editor, on the sheet under its head (features/production-new-ui.clan;
// the Booth rule: asks sit where the work is, not in an always-on Booth): the Script agent's questions on her
// drafts, her questions on names, the Director agent's Keep or Remove on shots a re-plan left out, another
// person's draft in progress, and what was just kept or discarded with Undo. Moved from the Script agent's Booth
// (features/script-freeform.clan); the same cards.

import type { ReactNode } from 'react'
import type { Ask, ProductionDocument, Suggestion } from '../contracts/types'
import { askedShot } from '../jobs/plan'
import { openAsks } from '../model/selectors'
import { BoothAsk, ChoiceCard, DoneCard, NoteCard } from '../ui/booth/BoothParts'
import { ago, useLater } from '../ui/booth/hooks'
import type { ComposedScript } from './compose'
import { nameAsks } from './nameAsks'
import { NEW_SCENE_LINE } from './skye'

export interface PageWaitsProps {
  doc: ProductionDocument
  composed: ComposedScript
  /** Her waiting questions on this script (skye.ts skyeAsks). */
  questions: { ask: Ask; jobId: string }[]
  /** Drafts being made for someone else. */
  others: Suggestion[]
  newScene: boolean
  done: { id: string; text: string; undo?: boolean }[]
  onUndo: (id: string) => void
  onNameAnswer: (askId: string, option: 'character' | 'extra' | 'cut') => void
  onShotAsk: (a: Ask, shotId: string, option: 'keep' | 'remove') => void
}

export function PageWaits(p: PageWaitsProps) {
  const { doc, composed } = p
  const { later, order } = useLater()
  const shotAsks = openAsks(doc).filter((a) => !!askedShot(a) && composed.shots.some((s) => s.id === askedShot(a)))
  const names = nameAsks(doc, composed.script.id).filter((a) => a.state === 'open')
  type Wait = { id: string; node: ReactNode }
  const waits: Wait[] = order([
    ...p.questions.map((q): Wait => ({ id: q.ask.id, node: <BoothAsk key={q.ask.id} ask={q.ask} onLater={() => later(q.ask.id)} time={ago(doc.jobs[q.jobId]?.created_at)} /> })),
    ...names.map((a): Wait => ({ id: a.id, node: (
      <ChoiceCard key={a.id} id={a.id} agent="skye" q={a.question.text} body={a.question.why} onLater={() => later(a.id)}
        choices={a.question.options.filter((o) => o.value !== undefined || ['character', 'extra', 'cut'].includes(o.id)).map((o, i) => ({ label: o.label, primary: i === 0, run: () => p.onNameAnswer(a.id, o.id as 'character' | 'extra' | 'cut') }))} />
    ) })),
    ...shotAsks.map((a): Wait => {
      const shotId = askedShot(a)!
      const n = composed.shots.findIndex((s) => s.id === shotId) + 1
      return { id: a.id, node: (
        <ChoiceCard key={a.id} id={a.id} agent="dex" q={a.question.text || `Shot ${n} no longer has a scene.`} body="Keep it, or remove it with its frames and clips?" onLater={() => later(a.id)}
          choices={[{ label: 'Keep', primary: true, run: () => p.onShotAsk(a, shotId, 'keep') }, { label: 'Remove', run: () => p.onShotAsk(a, shotId, 'remove') }]} />
      ) }
    }),
  ], (w) => w.id)
  if (!waits.length && !p.others.length && !p.newScene && !p.done.length) return null
  return (
    <div className="se-waits" role="region" aria-label="Waiting for you" data-count={waits.length}>
      {waits.length > 0 && <div className="se-waits-hd"><span className="tagcall">Needs your call · {waits.length}</span></div>}
      {waits.map((w) => w.node)}
      {p.others.map((s) => <NoteCard key={s.id} agent="skye" label="drafting" body={`The Script agent is drafting for ${s.for.replace(/^human:/, '')}.`} />)}
      {p.newScene && <NoteCard agent="skye" label="note" body={NEW_SCENE_LINE} />}
      {p.done.map((d) => <DoneCard key={d.id} agent="skye" text={d.text} onUndo={d.undo ? () => p.onUndo(d.id) : undefined} />)}
    </div>
  )
}
