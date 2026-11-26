import { describe, expect, it, vi } from 'vitest'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { mainStoryboard, openAsks, shotsOf } from '../model/selectors'
import { MockRelay, type MockRenderer } from '../relay/mock'
import { addScene, snapshotDoc } from '../test/jobFixtures'
import { makeAjv, SCHEMA } from '../test/schemas'
import type { FrameDeps } from './frames'
import { planShots } from './plan'
import { ASK_POLL_S, JobRunner, askOf } from './runner'
import { wireJobs } from './wire'

// A job that asks instead of guessing (ui-behaviour 3.17, 5.2): its question becomes the document's
// ask, the job waits at needs_input (asked about every 5 s: someone else may answer), an answer
// resumes the same job, the second answer gets the winner's, and Change is a new job.

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r))
}

async function setup() {
  let t = 1_000_000
  const renderer: MockRenderer = { async render() { return [] } }
  const relay = new MockRelay({ renderer, now: () => t, delayMs: 2000, persistKey: null })
  const doc = snapshotDoc()
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, doc, ui)
  const deps: FrameDeps = { relay, doc, ui, runner }
  wireJobs(deps)
  await updateDoc(doc, (d) => { addScene(d, 'It rains on a city street. Our hero opens a yellow umbrella. She grins.') })
  const step = async (ms = 5000) => {
    t += ms
    await runner.pollNow()
    await relay.settled()
    await runner.pollNow()
    await flush()
  }
  /** A plan that asks, waiting at its question. */
  const asking = async () => {
    const id = await planShots(deps, { text: 'Plan it [ask]' })
    await step(1000)
    expect(doc.get().jobs[id].state).toBe('needs_input')
    return id
  }
  return { relay, doc, ui, runner, deps, step, asking, advance: (ms: number) => { t += ms } }
}

describe('a job that asks', () => {
  it('writes its question as an open ask once, and keeps asking the relay', async () => {
    const s = await setup()
    const id = await s.asking()
    const d = s.doc.get()
    const ask = askOf(d, id)!
    expect(ask).toMatchObject({
      id: ask.question.id, node: { kind: 'storyboard', id: mainStoryboard(d)!.id }, job_id: id, crew: 'dex', state: 'open', answers: [],
      question: { kind: 'nudge', recommended_option_id: 'wide' },
    })
    expect(d.jobs[id].ask_id).toBe(ask.id)
    expect(openAsks(d)).toHaveLength(1)
    expect(makeAjv().compile({ $ref: SCHEMA('document') + '#/$defs/ask' })(ask)).toBe(true)
    expect(s.runner.liveInfo(id)?.state).toBe('needs_input')
    await s.step(1000)
    expect(Object.keys(s.doc.get().asks)).toEqual([ask.id]) // once
    expect(ASK_POLL_S).toBe(5)
  })

  it('polls a waiting job every 5 s', async () => {
    vi.useFakeTimers()
    try {
      const s = await setup()
      const id = await planShots(s.deps, { text: 'Plan it [ask]' })
      const spy = vi.spyOn(s.relay, 'getJob')
      s.advance(1000) // by the mock's clock, it asks now
      await vi.advanceTimersByTimeAsync(1100) // the mock's first answer said to ask again in 1 s
      expect(s.doc.get().jobs[id].state).toBe('needs_input')
      spy.mockClear()
      await vi.advanceTimersByTimeAsync(4800) // it was asked at 1 s: the next ask is at 6 s
      expect(spy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)
      expect(spy).toHaveBeenCalledWith(id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an answer is the person\'s decision, never an undo step, and resumes the same job', async () => {
    const s = await setup()
    const id = await s.asking()
    const change = vi.spyOn(s.doc, 'change')
    const q = askOf(s.doc.get(), id)!.question
    expect(await s.runner.answer(id, { optionId: 'close' })).toEqual({ ok: true })
    expect(change).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ action: `answer ${q.text}`, undo: false }))
    const ask = askOf(s.doc.get(), id)!
    expect(ask.state).toBe('answered')
    expect(ask.answers).toEqual([{ option_id: 'close', by: 'human:p_local', at: expect.any(String) }])
    expect(s.doc.get().jobs[id].state).not.toBe('needs_input')
    await s.step()
    await vi.waitFor(() => expect(shotsOf(s.doc.get()).length).toBeGreaterThan(0), { timeout: 2000, interval: 5 })
    expect(s.doc.get().jobs[id].state).toBe('completed') // the same job, not a new one
    expect(Object.keys(s.doc.get().jobs)).toEqual([id])
  })

  it('someone answered first: the 409 writes their answer, and the person\'s own is not applied', async () => {
    const s = await setup()
    const id = await s.asking()
    const q = askOf(s.doc.get(), id)!.question
    await s.relay.answerJob(id, { contractVersion: '3', questionId: q.id, optionId: 'wide' }, 'human:p_sai0001')
    const r = await s.runner.answer(id, { optionId: 'close' })
    expect(r).toEqual({ conflict: expect.objectContaining({ answeredBy: 'human:p_sai0001', answer: { option_id: 'wide' } }) })
    const ask = askOf(s.doc.get(), id)!
    expect(ask.state).toBe('answered')
    expect(ask.answers).toEqual([{ option_id: 'wide', by: 'human:p_sai0001', at: expect.any(String) }])
    await s.step() // polling learns nothing new about the ask
    expect(askOf(s.doc.get(), id)!.answers).toHaveLength(1)
  })

  it('an answer given elsewhere reaches this document when the job is polled', async () => {
    const s = await setup()
    const id = await s.asking()
    const q = askOf(s.doc.get(), id)!.question
    await s.relay.answerJob(id, { contractVersion: '3', questionId: q.id, text: 'Start on the umbrella' }, 'human:p_sai0001')
    await s.step(1000)
    const ask = askOf(s.doc.get(), id)!
    expect(ask).toMatchObject({ state: 'answered', answers: [{ text: 'Start on the umbrella', by: 'human:p_sai0001' }] })
  })

  it('Change sends a new job of the same op, node and purpose, with the answer and the asking job as its parent', async () => {
    const s = await setup()
    const id = await s.asking()
    await s.runner.answer(id, { optionId: 'close' })
    await s.step()
    const q = askOf(s.doc.get(), id)!.question
    const change = vi.spyOn(s.doc, 'change')
    const next = await s.runner.change(id, { text: 'Open on the umbrella' })
    expect(next).not.toBe(id)
    const [was, now] = [s.doc.get().jobs[id], s.doc.get().jobs[next]]
    expect(now).toMatchObject({ op: 'shot_list', node: was.node, purpose: was.purpose, parent_ids: [id], crew: 'dex' })
    const request = s.ui.get().jobs[next].request!
    expect(request.parentIds).toEqual([id])
    expect(request.input.answer).toEqual({ contractVersion: '3', questionId: q.id, text: 'Open on the umbrella' })
    expect(makeAjv().compile({ $ref: SCHEMA('relay-api') + '#/$defs/JobRequest' })(request)).toBe(true)
    expect(change).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ action: `change_answer ${q.text}`, undo: false }))
    expect(askOf(s.doc.get(), id)!.answers.map((a) => a.option_id ?? a.text)).toEqual(['close', 'Open on the umbrella'])
    await s.step()
    expect(s.doc.get().jobs[next].state).toBe('completed') // the new answer is not asked again
  })
})
