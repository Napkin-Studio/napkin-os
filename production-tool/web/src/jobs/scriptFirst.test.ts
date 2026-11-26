// UAT round 5, S3-4 (features/pt-canvas-r5.clan): "Draft a script from the brief, a script you check before shots are
// planned" planned six shots straight away. The live repro: a brief storyboard (not the main one; the main script has
// words), Dex's plan asks with a write_script route, the person picks it.
import { describe, expect, it, vi } from 'vitest'
import type { Ask, Id, JobInput, Op, ProductionDocument } from '../contracts/types'
import { systemUpdate, updateDoc } from '../doc/store'
import { newBrief } from '../brief/model'
import { briefOf } from '../brief/model'
import { newId } from '../lib/ulid'
import { mainScript, scenesOf, scriptOfStoryboard } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { MockRelay } from '../relay/mock'
import { addScene } from '../script/edits'
import { job, MAYA, modelStore, seedStages } from '../test/model'
import type { FrameDeps } from './frames'
import type { JobPurpose } from '../model/purpose'
import { fromBriefWords } from './prompt'
import type { SubmitExtras } from './runner'
import { scriptFirst, scriptFirstPick } from './scriptFirst'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const doc = (s: ModelStore) => s.get() as unknown as ProductionDocument

async function project() {
  const store = modelStore()
  await store.create(MAYA, 'UAT-R5 images A')
  await store.flush()
  await seedStages(store)
  // The main script has words (the round's other tests): it must not be the brief's script.
  const main = mainScript(doc(store))!.id
  const scene = await addScene(store, main)
  await updateDoc(store, (d) => { d.scenes[scene].text = 'Leo cycles to work.' }, 'edit')
  const brief = newBrief({ documentId: 'doc-quietboil', title: 'Let Them Sleep (Quietboil launch film)', appId: 'ie.napkin.brief-maker', dataSha256: SHA('b'), version: 1,
    data: { title: 'Let Them Sleep', proposition: 'The kettle that lets the house sleep.' } } as never, 'link')
  const sb = newId('storyboard')
  const planJob = newId('job')
  const qid = newId('q')
  await systemUpdate(store, (d) => {
    d.briefs ??= {}
    d.briefs[brief.id] = brief
    d.storyboards[sb] = { id: sb, v: 1, field_v: {}, title: 'Storyboard 2', ratio: '16:9', target_s: 15 }
    const l = newId('link')
    d.links[l] = { id: l, v: 1, field_v: {}, from: { kind: 'brief', id: brief.id }, to: { kind: 'storyboard', id: sb }, role: 'brief' }
    const j = job(d, 'shot_list', [], null, { node: { kind: 'storyboard', id: sb }, state: 'needs_input' })
    j.id = planJob
    d.jobs[planJob] = j
    d.asks[qid] = {
      id: qid, v: 1, field_v: {}, job_id: planJob, crew: 'dex', state: 'open', answers: [], node: { kind: 'storyboard', id: sb },
      question: {
        id: qid, kind: 'block', text: "There's no script yet. How should we get the 15-second film started?",
        options: [
          { id: 'draft_script', label: 'Draft a script from the brief', value: { route: 'write_script' }, detail: 'A short late-night flat script you check before shots are planned' },
          { id: 'own_idea', label: "I'll describe the scene", detail: 'Type the story in your own words' },
          { id: 'something_else', label: 'Something else' },
        ],
        allow_text: true,
      },
    } as Ask
  }, 'seed')
  await store.flush()
  const sent: { op: Op; input: JobInput }[] = []
  const runner = {
    submit: vi.fn(async (op: Op, input: JobInput, _p: string[], _purpose: JobPurpose, jobId?: string, _m?: unknown, extras?: SubmitExtras) => {
      sent.push({ op, input })
      const j = job(store.get(), op, [], null, { ...(extras?.node ? { node: extras.node } : {}) })
      if (jobId) j.id = jobId
      await systemUpdate(store, (d) => { d.jobs[j.id] = j }, 'sync')
      return j.id
    }),
    cancel: vi.fn(async (id: string) => { await systemUpdate(store, (d) => { d.jobs[id].state = 'cancelled' }, 'cancel') }),
    answer: vi.fn(),
  }
  const deps = { relay: new MockRelay({ renderer: { async render() { return [] } }, persistKey: null }), doc: store, ui: { get: () => ({ jobs: {} }) }, runner } as unknown as FrameDeps
  return { store, deps, runner, sent, sb, planJob, ask: () => doc(store).asks[qid], briefId: brief.id as Id, main }
}

describe('a plan\'s "draft a script from the brief" drafts a script to check (S3-4)', () => {
  it('only a write-script route on a plan counts', async () => {
    const p = await project()
    expect(scriptFirstPick(doc(p.store), p.ask(), { optionId: 'draft_script' })).toEqual({ storyboardId: p.sb })
    expect(scriptFirstPick(doc(p.store), p.ask(), { optionId: 'own_idea' })).toBeUndefined()
    expect(scriptFirstPick(doc(p.store), p.ask(), { text: 'a kettle at 1am' })).toBeUndefined()
  })

  it('stops the plan, gives the storyboard its own script with the brief, and the Script agent drafts it', async () => {
    const p = await project()
    const r = await scriptFirst(p.deps, p.store, p.ask(), { optionId: 'draft_script' }, 'human:p1', p.sb)
    // The plan never goes ahead: no answer to Dex, the job stopped (a job waiting on a question is not charged).
    expect(p.runner.answer).not.toHaveBeenCalled()
    expect(p.runner.cancel).toHaveBeenCalledWith(p.planJob)
    expect(p.ask()).toMatchObject({ state: 'answered', answers: [{ option_id: 'draft_script', by: 'human:p1' }] })
    // Its own script, not the main one with Leo's words; it drives the storyboard and has the brief.
    expect(r.scriptId).not.toBe(p.main)
    expect(scriptOfStoryboard(doc(p.store), p.sb)?.id).toBe(r.scriptId)
    expect(briefOf(doc(p.store), r.scriptId)?.brief.id).toBe(p.briefId)
    // One write job: Skye's draft from the brief, into the script's first scene. No shot_list.
    expect(p.sent.map((s) => s.op)).toEqual(['write'])
    const w = p.sent[0].input.write!
    expect([w.intent, w.mode, w.instruction]).toEqual(['draft', 'draft', fromBriefWords('Let Them Sleep (Quietboil launch film)')])
    expect(w.target).toEqual({ kind: 'scene', id: scenesOf(doc(p.store), r.scriptId)[0].id })
  })
})
