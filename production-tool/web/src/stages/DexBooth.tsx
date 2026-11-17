// Dex's Booth in the Storyboard editor (features/script-freeform.clan; mock script-freeform-v1 state
// storyboard). What waits for the person here, as the Storyboard already knows it: Dex's questions on shots a
// re-plan left out, a plan or frame job's question, a plan or frame that failed and was not cleared; and Dex's
// recent notes on this storyboard from the decision chain. No box: no action here takes words for the shots.

import { useDoc, useServices, useUi } from '../app/context'
import type { Ask, DocJob, Id } from '../contracts/types'
import { plainJobError } from '../jobs/errorWords'
import { askedShot } from '../jobs/plan'
import { jobCtx } from '../jobs/runner'
import { mainStoryboard, openAsks, shotNumber, shotsOf } from '../model/selectors'
import { Booth } from '../ui/booth/Booth'
import { BoothAgent, BoothAsk, BoothSection, ChoiceCard, NoteCard } from '../ui/booth/BoothParts'
import { ago, useChain, useLater } from '../ui/booth/hooks'
import { agentNotes, groupFailures, stageWaiting, storyboardAddresses, triesWords } from '../ui/booth/notes'
import { useBooth } from '../ui/booth/useBooth'

export const DEX_LINE = 'My notes and questions on the shots and frames wait here.'

export function DexBooth({ storyboardId, onShotAsk }: { storyboardId: Id | undefined; onShotAsk: (a: Ask, shotId: string, option: 'keep' | 'remove') => void }) {
  const { clan, runner, ui: uiStore } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const booth = useBooth('storyboard')
  const chain = useChain(clan)
  const { later, order } = useLater()
  const shots = shotsOf(doc, storyboardId)
  const ids = new Set(shots.map((s) => s.id))
  const mainSb = mainStoryboard(doc)?.id
  const docId = (() => { try { return clan?.documentId() ?? '' } catch { return '' } })()

  const shotAsks = openAsks(doc).filter((a) => ids.has(askedShot(a) ?? ''))
  const waiting = stageWaiting(doc, 'storyboard', (id) => jobCtx(doc, ui, id), (id) => runner.liveInfo(id),
    (job, ctx) => (ctx?.for === 'frame' && ids.has(ctx.shotId)) || (ctx?.for === 'shot_list' && (ctx.storyboardId ?? mainSb) === storyboardId)
      || (job.node.kind === 'storyboard' && job.node.id === storyboardId) || (job.node.kind === 'shot' && ids.has(job.node.id)))
  const failedWords = (j: DocJob) => {
    const ctx = jobCtx(doc, ui, j.id)
    const n = ctx?.for === 'frame' ? shotNumber(doc, ctx.shotId) : 0
    return { q: j.op === 'shot_list' ? 'The plan did not work.' : n ? `Shot ${n}’s frame did not draw.` : 'That did not work.', body: j.error ? plainJobError(j.error, j.op).message : undefined }
  }
  const clear = (jobIds: string[]) => uiStore.update((u) => { for (const id of jobIds) u.jobs[id] = { ...u.jobs[id], dismissed: true } })

  type Item = { id: string; node: React.ReactNode }
  const items: Item[] = order([
    ...waiting.asks.map(({ job, ask }): Item => ({ id: ask.id, node: <BoothAsk key={ask.id} ask={ask} onLater={() => later(ask.id)} time={ago(job.created_at)} /> })),
    ...shotAsks.map((a): Item => {
      const shotId = askedShot(a)!
      return { id: a.id, node: (
        <ChoiceCard key={a.id} id={a.id} agent="dex" q={a.question.text || `Shot ${shotNumber(doc, shotId)} no longer has a scene.`} body="Keep it, or remove it with its frames and clips?"
          onLater={() => later(a.id)} choices={[{ label: 'Keep', primary: true, run: () => onShotAsk(a, shotId, 'keep') }, { label: 'Remove', run: () => onShotAsk(a, shotId, 'remove') }]} />
      ) }
    }),
    ...groupFailures(waiting.failed, failedWords).map((g): Item => ({ id: g.id, node: <ChoiceCard key={g.id} id={g.id} agent={"dex"} label="stopped" q={g.q}
        body={g.jobs.length > 1 ? <>{g.body}{g.body ? ' ' : ''}<span className="bc-tries">{triesWords(g.jobs.length)}</span></> : g.body}
        time={ago(g.at)} onLater={() => later(g.id)} choices={[{ label: 'Clear', primary: true, run: () => clear(g.jobs.map((j) => j.id)) }]} /> })),
  ], (x) => x.id)
  const notes = agentNotes(chain, 'dex', storyboardAddresses(doc, docId, storyboardId), doc)
  const count = items.length
  return (
    <Booth state={booth} count={count} asks={waiting.asks.length + shotAsks.length}>
      <BoothAgent agent="dex" line={DEX_LINE} needsYou={count > 0} />
      {count > 0 && <BoothSection label="Waiting for you" count={count} />}
      {items.map((x) => x.node)}
      {notes.length > 0 && <BoothSection label="Notes" />}
      {notes.map((n) => <NoteCard key={n.id} agent="dex" label={n.label} body={n.body} time={ago(n.at)} />)}
      {!count && !notes.length && <p className="bt-quiet">Nothing waiting. The Director agent’s questions and notes on these shots come here.</p>}
    </Booth>
  )
}
