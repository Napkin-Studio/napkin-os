// Skye in place (features/script-editor.clan, PR 3): the write request, its landing as
// suggestions, Keep (one step, as Skye, decided by the person, with the length and beats),
// Keep mine (hands_off), stale drafts, and the relay saying no.

import { describe, expect, it } from 'vitest'
import { proseFromLines, StaleSuggestion } from '../../../clan-store/src'
import type { Job } from '../contracts/types'
import { mainScript } from '../model/selectors'
import { MockRelay } from '../relay/mock'
import { mockWrites } from '../relay/mockWrite'
import { addShots, asset, id, MAYA, modelStore, seedStages, SHA } from '../test/model'
import { makeAjv, SCHEMA } from '../test/schemas'
import { discardDraft, DISCARDED_LINE, draftFromBrief, fitSeconds, handsOff, keep, keepMineDraft, landWrites, NEW_SCENE_LINE, neighbours, pickedIdea, proposedOf, sceneForJob, skyeAsks, skyeState, waitingLine, WhichItem, wordDiff, writeInput } from './skye'
import { secondsNow, wholeScope } from './skyeBooth'
import { composeScript } from './compose'

async function project() {
  const store = modelStore()
  await store.create(MAYA, 'First Light')
  await seedStages(store)
  const ref = id('ref')
  await store.change((d) => {
    d.assets[SHA('a')] = asset(SHA('a'))
    const k = id('key')
    d.keys[k] = { id: k, v: 1, field_v: {}, key: 'maya', role: 'character' }
    d.refs[ref] = { id: ref, v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('a') }
    addShots(d, 3, { status: 'planned', duration_s: 3 })
  }, { action: 'create shots' })
  await store.flush()
  const shots = Object.values(store.get().shots).sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((s) => s.id)
  await store.text.replace('shot', shots[1], { type: 'doc', content: [
    { type: 'action', content: [{ type: 'mention', attrs: { id: ref, label: 'maya_front' } }, { type: 'text', text: ' walks the waterline. The light is low and gold.' }] },
    { type: 'direction', content: [{ type: 'text', text: 'Unhurried.' }] },
  ] }, `human:${MAYA.id}`, { undo: false })
  await store.flush()
  return { store, shots, scriptId: mainScript(store.get())!.id }
}

function jobOf(store: ReturnType<typeof modelStore>, writes: Job['writes']): Job {
  const jobId = id('job')
  return {
    contractVersion: '3', jobId, participantId: MAYA.id, tenantId: MAYA.tenant_id, projectId: store.get().project.id, startedBy: `human:${MAYA.id}`,
    crew: 'skye', node: { kind: 'script', id: mainScript(store.get())!.id }, nonce: 'n_x', op: 'write', quotaClass: 'text', state: 'completed',
    inputHashes: [], writes, cost: { estimate: 0, currency: 'USD', unknown: false }, createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:01Z',
  }
}

describe('the write request', () => {
  it('carries the lines with mentions under their names, the prose hash, the rows around it and the refs', async () => {
    const { store, shots, scriptId } = await project()
    const input = await writeInput(store, scriptId, { kind: 'shot', id: shots[1] }, 'fit_seconds', { seconds: fitSeconds(store.get(), scriptId, { kind: 'shot', id: shots[1] }) })
    expect(input.lines).toEqual([
      { type: 'action', text: '@maya_front walks the waterline. The light is low and gold.' },
      { type: 'direction', text: 'Unhurried.' },
    ])
    expect(input.seconds).toBe(5)
    expect(input.base_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    // The whole key first, by its bare name (owner 2026-10-15: @maya stays @maya), then each view.
    expect(input.context.refs).toEqual([{ name: 'maya', role: 'character', label: 'the whole character: front' }, { name: 'maya_front', role: 'character' }])
    expect(input.context.neighbours).toContain('Shot 1:')
    expect(input.context.neighbours).toContain('Shot 3:')
    expect(input.context.neighbours.length).toBeLessThanOrEqual(4000)
    const ajv = makeAjv()
    const req = { contractVersion: '3', jobId: id('job'), op: 'write', projectId: store.get().project.id, nonce: 'n_abcdefgh', node: { kind: 'script', id: scriptId }, parentIds: [], input: { write: input } }
    const ok = ajv.validate(`${SCHEMA('relay-api')}#/$defs/JobRequest`, req)
    expect(ajv.errors ?? []).toEqual([])
    expect(ok).toBe(true)
    expect(neighbours(store.get(), scriptId, { kind: 'shot', id: shots[1] })).not.toContain('walks the waterline')
  })
})

describe('a whole-script ask after Plan shots (UAT round 3, R3-F3)', () => {
  it('reads every shot as its neighbours, and goes to the shot it is about', async () => {
    const { store, shots, scriptId } = await project()
    const sceneId = store.get().shots[shots[0]].scene_id!
    await store.change((d) => {
      d.shots[shots[2]].action = 'Through the thin wall, the snoring carries on.'
    }, { action: 'words' })
    await store.flush()
    // A free ask on the scene, whose own words are empty now: it goes to shot 3, which it is about.
    const input = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'instruct', { instruction: 'Make the snoring line funnier.', mode: 'revise' })
    expect(input.target).toEqual({ kind: 'shot', id: shots[2] })
    expect(input.lines.map((l) => l.text).join(' ')).toContain('snoring')
    // An ask about nothing in particular stays on the scene and reads the whole script.
    const all = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'instruct', { instruction: 'Warmer, please.', mode: 'revise' })
    expect(all.target).toEqual({ kind: 'scene', id: sceneId })
    expect(all.context.neighbours).toContain('Shot 1:')
    expect(all.context.neighbours).toContain('Shot 3: Through the thin wall')
  })
})

describe('script asks after Plan shots carry the real lines (UAT round 4, R4-F3)', () => {
  /** Round 4's film: the scene's words made into shots, a spoken line, a sound beat and the brief's end line as a VO. */
  async function round4() {
    const p = await project()
    const sceneId = id('scene')
    await p.store.change((d) => {
      d.scenes[sceneId] = { id: sceneId, v: 1, field_v: {}, script_id: p.scriptId, rank: 'a0', heading: '' } as never
      for (const sh of p.shots) d.shots[sh].scene_id = sceneId
      d.shots[p.shots[0]].action = 'Insert on the kettle on the counter: the switch goes down.'
      d.shots[p.shots[1]].action = '@maya_front whispers to the kettle.'
      d.shots[p.shots[2]].action = 'Behind the thin wall, a flatmate keeps snoring, undisturbed.'
      const beat = (bid: string, shot: string, kind: string, text: string, speaker?: string) => {
        d.beats[bid] = { id: bid, v: 1, field_v: {}, shot_id: shot, kind, at_s: 0.5, text, rank: 'a0', ...(speaker ? { speaker } : {}) } as never
      }
      beat(id('beat'), p.shots[1], 'line', 'Good boy.', 'MAYA')
      beat(id('beat'), p.shots[2], 'sound', 'Steady snoring through the wall.')
      beat(id('beat'), p.shots[2], 'vo', 'Quietboil. Let them sleep.', 'NARRATOR')
    }, { action: 'plan shots' })
    await p.store.flush()
    return { ...p, sceneId }
  }

  it('"Make it 8 seconds" sends the shots, "Good boy." and the end line, not an empty action', async () => {
    const { store, scriptId, sceneId } = await round4()
    const input = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'fit_seconds', { seconds: 8 })
    expect(input.target).toEqual({ kind: 'scene', id: sceneId })
    expect(input.lines).not.toEqual([{ type: 'action', text: '' }])
    expect(input.lines).toContainEqual({ type: 'dialogue', text: 'Good boy.' })
    expect(input.lines).toContainEqual({ type: 'character', text: 'MAYA' })
    expect(input.lines).toContainEqual({ type: 'character', text: 'NARRATOR (V.O.)' })
    expect(input.lines).toContainEqual({ type: 'dialogue', text: 'Quietboil. Let them sleep.' })
    expect(input.lines[0]).toEqual({ type: 'action', text: 'Insert on the kettle on the counter: the switch goes down.' })
  })

  it('a free ask goes to the shot that shares the most; a tie asks which shot', async () => {
    const { store, scriptId, sceneId, shots } = await round4()
    // "snoring" is in shot 3's words and its sound: shot 3 (round 4's repro fell back to the scene).
    const snore = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'instruct', { instruction: 'Make the snoring line funnier', mode: 'revise' })
    expect(snore.target).toEqual({ kind: 'shot', id: shots[2] })
    // "kettle" is in shots 1 and 2 alike: the Booth asks which one, nothing is sent blind for the scene.
    const tie = writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'instruct', { instruction: 'Make the kettle bit funnier', mode: 'revise' })
    await expect(tie).rejects.toBeInstanceOf(WhichItem)
    const err = (await tie.catch((e: unknown) => e)) as WhichItem
    expect(err.choices.map((c) => c.target)).toEqual([{ kind: 'shot', id: shots[0] }, { kind: 'shot', id: shots[1] }])
    expect(err.choices[0].label).toMatch(/^Shot 1 \(Insert on the kettle/)
  })

  it('a whole-script ask after Plan shots goes to the planned scene, never as a new draft (no heading, no words)', async () => {
    const { store, scriptId, sceneId } = await round4()
    const scope = wholeScope(store.get(), composeScript(store.get(), scriptId)!, (k, id) => store.text.prose(k, id))
    expect(scope.target).toEqual({ kind: 'scene', id: sceneId })
  })

  it("the card's seconds before are the scene's shots, not its empty words", async () => {
    const { store, sceneId } = await round4()
    const sug = { target: { kind: 'scene', id: sceneId } } as never
    expect(secondsNow(store.get(), sug, [{ kind: 'action', text: '' }])).toBe(9)
    expect(secondsNow(store.get(), sug, [{ kind: 'dialogue', text: 'Good boy.' }], true)).toBe(9)
  })
})

describe('drafts land as suggestions, and Keep is one step', () => {
  it('Keep writes the words as the Script agent, decided by the person, with the length; Undo takes all of it back', async () => {
    const { store, shots, scriptId } = await project()
    const input = await writeInput(store, scriptId, { kind: 'shot', id: shots[1] }, 'fit_seconds', { seconds: 1.6 })
    const [sug] = await landWrites(store, jobOf(store, mockWrites(input)))
    await store.flush()
    const s = store.get().suggestions[sug]
    expect(s).toMatchObject({ crew: 'skye', for: `human:${MAYA.id}`, state: 'open', note: 'I tightened it to fit 1.6 s.', base_hash: input.base_hash })
    expect(s.proposed.duration_s).toBe(1.6)
    // Nothing changed until Keep.
    expect(store.get().shots[shots[1]].action).toBe('@maya_front walks the waterline. The light is low and gold.')
    const chain = await store.chain()
    expect(chain[0]).toMatchObject({ agent: 'skye' })
    const r = await keep(store, sug)
    expect(r.line).toBe("Kept the Script agent's draft. Shot 2 now runs 1.6 s.")
    const shot = store.get().shots[shots[1]]
    expect(shot).toMatchObject({ action: '@maya_front walks the waterline.', duration_s: 1.6, last_writer: 'skye', refs: [Object.keys(store.get().refs)[0]] })
    expect(store.get().suggestions[sug]).toMatchObject({ state: 'kept', decided_by: `human:${MAYA.id}` })
    await store.undo()
    expect(store.get().shots[shots[1]]).toMatchObject({ action: '@maya_front walks the waterline. The light is low and gold.', duration_s: 3 })
    expect(store.get().suggestions[sug].state).toBe('open')
  })

  it('Add a beat and Write the VO keep their beats inside the shot', async () => {
    const { store, shots, scriptId } = await project()
    const input = await writeInput(store, scriptId, { kind: 'shot', id: shots[1] }, 'write_vo')
    const [sug] = await landWrites(store, jobOf(store, mockWrites(input)))
    await keep(store, sug)
    const beats = Object.values(store.get().beats).filter((b) => b.shot_id === shots[1])
    expect(beats).toHaveLength(1)
    expect(beats[0]).toMatchObject({ kind: 'vo', at_s: 0, last_writer: 'skye' })
    expect(beats[0].text).toMatch(/^VO: /)
  })

  it('Keep mine drops it and the Script agent leaves the shot alone', async () => {
    const { store, shots, scriptId } = await project()
    const input = await writeInput(store, scriptId, { kind: 'shot', id: shots[1] }, 'rephrase')
    const [sug] = await landWrites(store, jobOf(store, mockWrites(input)))
    const r = await keepMineDraft(store, sug)
    expect(r.line).toBe('Kept yours. The Script agent will leave this shot alone.')
    expect(store.get().suggestions[sug].state).toBe('dropped')
    expect(handsOff(store.get(), { kind: 'shot', id: shots[1] })).toBe(true)
    // On a hands_off item a press is an explicit request.
    const again = await writeInput(store, scriptId, { kind: 'shot', id: shots[1] }, 'tighten', { explicit: true })
    expect(again.explicit).toBe(true)
  })

  it('a draft whose words moved underneath goes stale and cannot be kept', async () => {
    const { store, shots, scriptId } = await project()
    const input = await writeInput(store, scriptId, { kind: 'shot', id: shots[1] }, 'tighten')
    const [sug] = await landWrites(store, jobOf(store, mockWrites(input)))
    await store.text.replace('shot', shots[1], proseFromLines('action', ['Someone typed since.']), `human:${MAYA.id}`)
    await expect(keep(store, sug)).rejects.toBeInstanceOf(StaleSuggestion)
    expect(store.get().suggestions[sug].state).toBe('stale')
    expect(new StaleSuggestion().message).toBe('The text changed since the Script agent wrote this, so it no longer fits. Ask it again.')
  })

  it('a draft that does not fit its item (two blocks for a beat) is left out', async () => {
    const { store, shots } = await project()
    const beat = id('beat')
    expect(proposedOf(store.get(), { target: { kind: 'beat', id: beat }, base_hash: SHA('b'), note: 'n', lines: [{ type: 'action', text: 'a' }, { type: 'action', text: 'b' }] })).toBeNull()
    expect(proposedOf(store.get(), { target: { kind: 'shot', id: shots[0] }, base_hash: SHA('b'), note: 'n', lines: [{ type: 'character', text: 'MAYA' }] })).toBeNull()
  })
})

describe('a draft from a brief (owner bug 2026-11-03)', () => {
  // The draft deps mirror ScriptEditor's skyeDeps: a recording runner over the real store.
  function draftDeps(store: ReturnType<typeof modelStore>) {
    const sent: { mode?: string; instruction?: string; intent: string }[] = []
    const runner = {
      submit: async (_op: string, input: { write?: { intent: string; mode?: string; instruction?: string } }) => {
        const w = input.write!
        sent.push({ intent: w.intent, mode: w.mode, instruction: w.instruction })
        const jobId = id('job')
        await store.change((d) => { d.jobs[jobId] = { id: jobId, v: 1, field_v: {}, op: 'write', state: 'submitted', node: { kind: 'script', id: mainScript(store.get())!.id }, started_by: `human:${MAYA.id}`, tenant_id: MAYA.tenant_id, nonce: 'n_draft01', crew: 'skye', parent_ids: [], input_hashes: [], created_at: '2026-10-13T10:00:00Z' } as never }, { action: 'sync', quiet: true, undo: false })
        return jobId
      },
    }
    return { deps: { runner, doc: store } as never, sent }
  }

  it('carries the brief as the instruction and never plants it in the scene', async () => {
    const { store, scriptId } = await project()
    const sceneId = id('scene')
    await store.change((d) => { d.scenes[sceneId] = { id: sceneId, v: 1, field_v: {}, script_id: scriptId, rank: 'a0', heading: '' } as never }, { action: 'add scene' })
    await store.flush()
    const { deps, sent } = draftDeps(store)
    await draftFromBrief(deps, store, scriptId, sceneId, 'A runner drinks Lumen water at dawn.')
    expect(sent).toEqual([{ intent: 'draft', mode: 'draft', instruction: 'A runner drinks Lumen water at dawn.' }])
    // The scene is never given the prompt as its prose.
    expect((store.text.prose('scene', sceneId).content ?? [])).toEqual([])
  })

  it('clears a typed brief out of the scene before drafting (the Enter path), in one undo step', async () => {
    const { store, scriptId } = await project()
    const sceneId = id('scene')
    await store.change((d) => { d.scenes[sceneId] = { id: sceneId, v: 1, field_v: {}, script_id: scriptId, rank: 'a0', heading: '' } as never }, { action: 'add scene' })
    await store.text.replace('scene', sceneId, proseFromLines('action', ['A runner drinks Lumen water at dawn.']), `human:${MAYA.id}`)
    await store.flush()
    const { deps, sent } = draftDeps(store)
    await draftFromBrief(deps, store, scriptId, sceneId, 'A runner drinks Lumen water at dawn.')
    expect(sent[0].instruction).toContain('A runner drinks Lumen water')
    expect((store.text.prose('scene', sceneId).content ?? [])).toEqual([])
  })

  it('refuses an empty brief', async () => {
    const { store, scriptId } = await project()
    const sceneId = id('scene')
    await store.change((d) => { d.scenes[sceneId] = { id: sceneId, v: 1, field_v: {}, script_id: scriptId, rank: 'a0', heading: '' } as never }, { action: 'add scene' })
    await store.flush()
    const { deps } = draftDeps(store)
    await expect(draftFromBrief(deps, store, scriptId, sceneId, '   ')).rejects.toThrow(/idea in a line/)
  })

  it('a draft lands with mode draft, shown whole, and Discard drops it with no hands_off', async () => {
    const { store, scriptId } = await project()
    const sceneId = id('scene')
    await store.change((d) => { d.scenes[sceneId] = { id: sceneId, v: 1, field_v: {}, script_id: scriptId, rank: 'a0', heading: '' } as never }, { action: 'add scene' })
    await store.flush()
    const input = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'draft', { mode: 'draft', instruction: 'A runner at dawn.' })
    expect(input.mode).toBe('draft')
    expect(input.instruction).toBe('A runner at dawn.')
    const [sug] = await landWrites(store, jobOf(store, mockWrites(input)))
    await store.flush()
    expect(store.get().suggestions[sug]).toMatchObject({ mode: 'draft', state: 'open' })
    // Discard drops it without putting skye in hands_off (unlike Keep mine).
    const r = await discardDraft(store, sug)
    expect(r.line).toBe(DISCARDED_LINE)
    expect(store.get().suggestions[sug].state).toBe('dropped')
    expect(handsOff(store.get(), { kind: 'scene', id: sceneId })).toBe(false)
    // One undo step brings the draft back.
    await store.undo()
    expect(store.get().suggestions[sug].state).toBe('open')
  })
})

describe('Write with the Script agent: a real script from an idea (urgent P0 2026-11-04)', () => {
  it('drafts a short screenplay (slugline + action, not one empty line) and Keep applies it to the scene', async () => {
    const { store, scriptId } = await project()
    // A non-empty script (project already has shots); add the scene the draft lands on.
    const sceneId = id('scene')
    await store.change((d) => { d.scenes[sceneId] = { id: sceneId, v: 1, field_v: {}, script_id: scriptId, rank: 'a0', heading: '' } as never }, { action: 'add scene' })
    await store.flush()
    const input = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'draft', { mode: 'draft', instruction: 'a man putting in work at the gym' })
    expect(input.instruction).toBe('a man putting in work at the gym')
    const writes = mockWrites(input)
    // A real short screenplay: a slugline, then more lines — never one echoed line.
    expect(writes[0].lines.length).toBeGreaterThanOrEqual(2)
    expect(writes[0].lines[0].text).toBe('INT. GYM - DAY')
    const [sug] = await landWrites(store, jobOf(store, writes))
    await store.flush()
    expect(store.get().suggestions[sug]).toMatchObject({ mode: 'draft', state: 'open' })
    // Keep applies the drafted screenplay to the scene (nothing changed until Keep).
    await keep(store, sug)
    await store.flush()
    // The draft's slugline is the scene's heading (the scene had none), the rest its words (finding 27).
    expect(store.get().scenes[sceneId].heading).toBe('INT. GYM - DAY')
    const text = store.get().scenes[sceneId].text ?? ''
    expect(text).not.toContain('INT. GYM - DAY')
    expect(text.toLowerCase()).toContain('gym')
  })

  it('pickedIdea returns the idea the writer already typed, not a heading', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Gym')
    await seedStages(store)
    const scriptId = mainScript(store.get())!.id
    const sceneId = id('scene')
    await store.change((d) => {
      d.scenes[sceneId] = { id: sceneId, v: 1, field_v: {}, script_id: scriptId, rank: 'a0', heading: 'INT. GYM - DAY', text: 'Write a script for a man putting in work at the gym' } as never
    }, { action: 'typed idea' })
    await store.flush()
    expect(pickedIdea(store.get(), scriptId)).toBe('Write a script for a man putting in work at the gym')
  })
})

describe("the 'Tell the Script agent' free instruction", () => {
  it('carries the typed words as the instruction on a revise, and the mock echoes the mode', async () => {
    const { store, shots, scriptId } = await project()
    const input = await writeInput(store, scriptId, { kind: 'shot', id: shots[1] }, 'instruct',
      { mode: 'revise', instruction: 'make her sound colder', selection: { from: 0, to: 5, text: 'walks' } })
    expect(input.intent).toBe('instruct')
    expect(input.mode).toBe('revise')
    expect(input.instruction).toBe('make her sound colder')
    // The item's own lines still travel (a revise rewrites them); the mock echoes the mode and a note.
    const [w] = mockWrites(input)
    expect(w.mode).toBe('revise')
    expect(w.note).toBe('I did what you asked.')
  })
})

describe('when the relay says no', () => {
  it('a relay without the Script agent answers 422 capability_missing; the last write job failing so turns her bar off', async () => {
    const relay = new MockRelay({ renderer: { async render() { return [] } }, persistKey: null, writeOff: true })
    await expect(relay.createJob({ contractVersion: '3', jobId: id('job'), op: 'write', projectId: 'proj_x', nonce: 'n_x', node: { kind: 'script', id: 'script_x' }, parentIds: [], input: {} }))
      .rejects.toMatchObject({ status: 422, error: { code: 'capability_missing' } })
    const { store, scriptId } = await project()
    const jobId = id('job')
    await store.change((d) => {
      d.jobs[jobId] = { id: jobId, v: 1, field_v: {}, op: 'write', state: 'failed', node: { kind: 'script', id: scriptId }, started_by: `human:${MAYA.id}`, tenant_id: MAYA.tenant_id, nonce: 'n_yyyyyyyy', crew: 'skye', parent_ids: [], input_hashes: [], created_at: '2026-10-13T10:00:00Z', error: { code: 'capability_missing', message: "The Script agent isn't available here yet.", retryable: false } } as never
    }, { action: 'submit write', quiet: true, undo: false })
    await store.flush()
    expect(skyeState(store.get(), scriptId)).toMatchObject({ off: true, quota: false })
  })
})

describe('wordDiff', () => {
  it('strikes the old words and underlines the new ones', () => {
    expect(wordDiff('She walks the length of the beach.', 'She walks the beach.')).toEqual([
      { kind: 'same', text: 'She walks the ' }, { kind: 'gone', text: 'length of the ' }, { kind: 'same', text: 'beach.' },
    ])
  })
})

describe('a write waiting on her question (owner 2026-10-15)', () => {
  async function asking(state: 'needs_input' | 'submitted' = 'needs_input') {
    const p = await project()
    const jobId = id('job')
    const q = id('q')
    await p.store.change((d) => {
      d.jobs[jobId] = { id: jobId, v: 1, field_v: {}, op: 'write', state, node: { kind: 'script', id: p.scriptId }, started_by: `human:${MAYA.id}`, tenant_id: MAYA.tenant_id, nonce: 'n_yyyyyyyy', crew: 'skye', parent_ids: [], input_hashes: [], created_at: '2026-10-13T10:00:00Z', ask_id: q } as never
      d.asks[q] = { id: q, v: 1, field_v: {}, node: { kind: 'script', id: p.scriptId }, job_id: jobId, crew: 'skye', state: 'open', answers: [],
        question: { id: q, kind: 'nudge', text: 'Open wide or close?', options: [{ id: 'wide', label: 'Wide', value: 'wide' }, { id: 'close', label: 'Close', value: 'close' }], allow_text: true } }
    }, { action: 'sync', quiet: true, undo: false })
    await p.store.flush()
    return { ...p, jobId, askId: q }
  }

  it('is waiting for you with the question, not writing', async () => {
    const { store, scriptId, jobId, askId } = await asking()
    const s = skyeState(store.get(), scriptId)
    expect(s.working).toBeUndefined()
    expect(s.waiting).toMatchObject({ jobId, ask: { id: askId } })
    expect(waitingLine(s.waiting!.ask)).toBe('Waiting for you: Open wide or close?')
    // The runner's live state goes first: still writing until it says needs_input.
    expect(skyeState(store.get(), scriptId, () => 'submitted')).toMatchObject({ working: jobId })
  })

  it('shows on its item while that is on the page; a beat on its shot; anything else at the top', async () => {
    const { store, scriptId, shots, jobId, askId } = await asking()
    const at = (t?: { kind: 'scene' | 'shot' | 'beat'; id: string }) => skyeAsks(store.get(), scriptId, (j) => (j === jobId ? t : undefined))[0].at
    expect(skyeAsks(store.get(), scriptId, () => undefined)).toEqual([expect.objectContaining({ jobId, at: null, ask: expect.objectContaining({ id: askId }) })])
    expect(at({ kind: 'shot', id: shots[0] })).toEqual({ kind: 'shot', id: shots[0] })
    expect(at({ kind: 'scene', id: id('scene') })).toBeNull()
    const beat = id('beat')
    await store.change((d) => { d.beats[beat] = { id: beat, v: 1, field_v: {}, shot_id: shots[2], kind: 'moment', at_s: 0.5, rank: 'a0' } as never }, { action: 'add beat' })
    await store.flush()
    expect(at({ kind: 'beat', id: beat })).toEqual({ kind: 'shot', id: shots[2] })
  })

  it('a job still writing has no question to show', async () => {
    const { store, scriptId } = await asking('submitted')
    expect(skyeAsks(store.get(), scriptId, () => undefined)).toEqual([])
    expect(skyeState(store.get(), scriptId).waiting).toBeUndefined()
  })
})

describe('a scene draft whose scene was undone while the Script agent asked (owner 2026-10-15)', () => {
  it('lands as a new first scene in her words, one undo step, and her line says so', async () => {
    const { store, scriptId } = await project()
    const first = Object.values(store.get().scenes).find((x) => x.script_id === scriptId)
    const gone = id('scene')
    const job = jobOf(store, [{ target: { kind: 'scene', id: gone }, base_hash: SHA('b'), note: 'I drafted it from your line.',
      lines: [{ type: 'action', text: 'Maya runs for the last ferry.' }, { type: 'character', text: 'MAYA' }, { type: 'dialogue', text: 'Wait!' }] }])
    await store.change((d) => {
      d.jobs[job.jobId] = { id: job.jobId, v: 1, field_v: {}, op: 'write', state: 'completed', node: { kind: 'script', id: scriptId }, started_by: `human:${MAYA.id}`, tenant_id: MAYA.tenant_id, nonce: 'n_yyyyyyyy', crew: 'skye', parent_ids: [], input_hashes: [], created_at: '2026-10-13T10:00:00Z' } as never
    }, { action: 'sync', quiet: true, undo: false })
    await store.flush()
    const before = Object.keys(store.get().scenes).length

    const ids = await landWrites(store, job)
    const sceneId = sceneForJob(job.jobId)
    expect(ids).toEqual([sceneId])
    const d = store.get()
    expect(Object.keys(d.suggestions)).toHaveLength(0)
    expect(Object.keys(d.scenes)).toHaveLength(before + 1)
    const scene = d.scenes[sceneId]
    expect(scene).toMatchObject({ script_id: scriptId, heading: '', last_writer: 'skye' })
    expect(scene.text).toBe('Maya runs for the last ferry.\nMAYA\nWait!')
    expect((store.text.prose('scene', sceneId).content ?? []).map((b) => b.type)).toEqual(['action', 'character', 'dialogue'])
    if (first) expect(scene.rank < first.rank).toBe(true)  // first in the script
    expect(skyeState(d, scriptId)).toMatchObject({ newScene: sceneId })
    expect(NEW_SCENE_LINE).toBe('That scene was gone, so I put my draft in a new first scene. Undo takes it back.')
    expect((await store.chain())[0]).toMatchObject({ agent: 'skye' })

    // Landing again (a reload) makes no second scene.
    expect(await landWrites(store, job)).toEqual([])
    expect(Object.keys(store.get().scenes)).toHaveLength(before + 1)

    // One undo step takes the scene and its words back, and the line goes with it.
    await store.undo()
    expect(store.get().scenes[sceneId]).toBeUndefined()
    expect(Object.keys(store.get().scenes)).toHaveLength(before)
    expect(skyeState(store.get(), scriptId).newScene).toBeUndefined()
  })

  it('a shot draft whose shot is gone still lands nowhere', async () => {
    const { store } = await project()
    const ids = await landWrites(store, jobOf(store, [{ target: { kind: 'shot', id: id('shot') }, base_hash: SHA('b'), note: 'n', lines: [{ type: 'action', text: 'a' }] }]))
    expect(ids).toEqual([])
    expect(Object.keys(store.get().suggestions)).toHaveLength(0)
  })
})
