// Live text (contracts/collab.md §2-6): checkpoint and hydrate for the four
// fragment kinds, mentions, overflow, last_writer, suggestions, the plan move,
// convergence and the 60 s attribution window.
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  checkpoint, hydrate, keepMine, keepSuggestion, landPlan, LocalPatchBus, LocalTextBus, LocalUndo, markStale, proseFromLines, proseHash,
  proseOf, StaleSuggestion, type Prose,
} from '../src/index'
import { AT, MAYA, defaults, id, jobValue, sha, shotValue, store } from './fixtures'

const t = (text: string) => ({ type: 'text', text })
const mention = (refId: string, label: string) => ({ type: 'mention', attrs: { id: refId, label } })
const SAMPLES: Record<'shot' | 'scene' | 'beat' | 'review', Prose> = {
  shot: { type: 'doc', content: [{ type: 'action', content: [mention(id('ref', 1), 'maya_front'), t(' walks the '), { type: 'hardBreak' }, t('waterline.')] }, { type: 'direction', content: [t('Unhurried.')] }] },
  scene: { type: 'doc', content: [{ type: 'action', content: [t('Maya laughs at the sea.')] }, { type: 'character', content: [t('MAYA')] }, { type: 'parenthetical', content: [t('quietly')] }, { type: 'dialogue', content: [t('Again.')] }] },
  beat: { type: 'doc', content: [{ type: 'dialogue', content: [t("It's perfect!")] }] },
  review: { type: 'doc', content: [{ type: 'action', content: [t('Her hand blurs here.')] }, { type: 'action' }] },
}
const refs = { [id('ref', 1)]: { key: 'maya', variant: 'front' } }

describe('checkpoint and hydrate', () => {
  for (const [kind, prose] of Object.entries(SAMPLES) as [keyof typeof SAMPLES, Prose][]) {
    it(`a ${kind} fragment round-trips through a fresh Y.Doc (Tiptap parity)`, () => {
      const doc = new Y.Doc()
      const f = doc.getXmlFragment(`x/${kind}`)
      doc.transact(() => hydrate(f, prose))
      expect(proseOf(f)).toEqual(prose)
      // and through an update, as another device gets it
      const other = new Y.Doc()
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
      expect(proseOf(other.getXmlFragment(`x/${kind}`))).toEqual(prose)
      expect(checkpoint(kind, proseOf(other.getXmlFragment(`x/${kind}`)), { refs }).fields.prose).toEqual(prose)
    })
  }

  it('writes the flat fields: action, direction and refs of a shot; a scene as screenplay', () => {
    const shot = checkpoint('shot', SAMPLES.shot, { refs, lastWriter: 'human:p_maya001' }).fields
    expect(shot.action).toBe('@maya_front walks the \nwaterline.')
    expect(shot.direction).toBe('Unhurried.')
    expect(shot.refs).toEqual([id('ref', 1)])
    expect(shot.text_problem).toBeNull()
    expect(shot.last_writer).toBe('human:p_maya001')
    expect(checkpoint('scene', SAMPLES.scene, { refs }).fields.text).toBe('Maya laughs at the sea.\nMAYA\n(quietly)\nAgain.')
  })

  it('a renamed ref renames every mention; a deleted one shows as unknown', () => {
    const renamed = checkpoint('shot', SAMPLES.shot, { refs: { [id('ref', 1)]: { key: 'maya', variant: 'beach' } } })
    expect(renamed.fields.action).toMatch(/^@maya_beach walks/)
    const gone = checkpoint('shot', SAMPLES.shot, { refs: {} })
    expect(gone.fields.action).toMatch(/^@maya_front walks/)
    expect(gone.unknown).toEqual(['maya_front'])
    expect(gone.fields.refs).toEqual([])
  })

  it('an overflowing field keeps its last valid value and sets text_problem', () => {
    const long: Prose = { type: 'doc', content: [{ type: 'action', content: [t('x'.repeat(601))] }] }
    const r = checkpoint('shot', long, { refs, previous: { action: 'the old action' } })
    expect(r.fields.action).toBe('the old action')
    expect(r.fields.text_problem).toMatchObject({ field: 'action', length: 601, limit: 600 })
    expect(String((r.fields.text_problem as { message: string }).message)).toMatch(/Shorten it to start a job/)
  })

  it('refuses a shape the kind may not hold', () => {
    expect(() => checkpoint('beat', SAMPLES.scene, { refs })).toThrow(/a beat holds/)
    expect(() => checkpoint('shot', { type: 'doc', content: [{ type: 'direction' }, { type: 'action' }] }, { refs })).toThrow(/direction is one block/)
  })
})

async function project() {
  const s = store()
  await s.create({ person: MAYA })
  const bus = new LocalPatchBus(s)
  const undo = new LocalUndo()
  let clock = 0
  const text = new LocalTextBus(bus, { clock: () => clock })
  undo.bind(bus, text)
  const { storyboard, script } = defaults(s)
  return { s, bus, text, undo, storyboard, script, tick: (ms: number) => { clock += ms } }
}

describe('LocalTextBus', () => {
  it('last_writer comes from the transaction origin', async () => {
    const { bus, text, storyboard } = await project()
    const shot = id('shot', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(storyboard, 'a0'), base_version: 0 }], why: { action: 'create shot' } })
    await text.replace('shot', shot, proseFromLines('action', ['Dex wrote this.']), 'dex')
    expect(bus.doc().shots[shot].last_writer).toBe('dex')
    await text.replace('shot', shot, proseFromLines('action', ['Maya wrote this.']), 'human:p_maya001')
    expect(bus.doc().shots[shot].last_writer).toBe('human:p_maya001')
  })

  it('100 checkpoints in 60 s are one attributed entry, written when the window closes', async () => {
    const { s, bus, text, storyboard, tick } = await project()
    const shot = id('shot', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(storyboard, 'a0'), base_version: 0 }], why: { action: 'create shot' } })
    const n = (await s.chain()).length
    for (let i = 0; i < 100; i++) {
      text.ydoc.transact(() => hydrate(text.fragment('shot', shot), proseFromLines('action', [`take ${i}`])), 'human:p_maya001')
      await text.checkpoint()
      tick(500)
    }
    expect(await s.chain()).toHaveLength(n) // quiet so far: the window is open
    expect(text.openWindows()).toHaveLength(1)
    tick(10_000)
    await text.checkpoint()
    const chain = await s.chain()
    expect(chain).toHaveLength(n + 1)
    expect(chain[0]).toMatchObject({ agent: 'human:p_maya001', action: `write shots[${shot}]`, targets: [`${s.documentId()}#shots[${shot}]`] })
    expect(bus.doc().shots[shot].action).toBe('take 99')
  })

  it('leaving closes the window at once', async () => {
    const { s, bus, text, storyboard } = await project()
    const shot = id('shot', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(storyboard, 'a0'), base_version: 0 }], why: { action: 'create shot' } })
    await text.replace('shot', shot, proseFromLines('action', ['hello']), 'human:p_maya001')
    await text.leave()
    expect((await s.chain())[0].action).toBe(`write shots[${shot}]`)
  })

  it('two Y.Docs typing into one shot converge, and the checkpoint sees both', async () => {
    const { bus, text, storyboard } = await project()
    const shot = id('shot', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(storyboard, 'a0'), base_version: 0 }], why: { action: 'create shot' } })
    await text.replace('shot', shot, proseFromLines('action', ['the sea']), 'human:p_maya001')
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(text.ydoc))
    const typeAt0 = (d: Y.Doc, s: string, who: string) => d.transact(() => (((d.getXmlFragment(`shots/${shot}`).get(0) as Y.XmlElement).get(0)) as Y.XmlText).insert(0, s), who)
    typeAt0(text.ydoc, 'calm ', 'human:p_maya001')
    typeAt0(other, 'grey ', 'human:p_sai0001')
    Y.applyUpdate(other, Y.encodeStateAsUpdate(text.ydoc))
    Y.applyUpdate(text.ydoc, Y.encodeStateAsUpdate(other), 'human:p_sai0001')
    expect(proseOf(other.getXmlFragment(`shots/${shot}`))).toEqual(text.prose('shot', shot))
    await text.checkpoint()
    expect(bus.doc().shots[shot].action).toMatch(/calm|grey/)
    expect(String(bus.doc().shots[shot].action)).toContain('the sea')
  })
})

describe('the plan move', () => {
  it('moves the planned span out of the scene into the shot and beat, as one undo step', async () => {
    const { bus, text, undo, storyboard, script } = await project()
    const scene = id('scene', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'scenes', id: scene, value: { script_id: script, rank: 'a0', heading: 'EXT. BEACH - DAWN' }, base_version: 0 }], why: { action: 'create scene' } })
    await text.replace('scene', scene, SAMPLES.scene, 'human:p_maya001')
    expect(bus.doc().scenes[scene].text).toContain('Maya laughs at the sea.')
    const job = id('job', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'jobs', id: job, value: jobValue(1, { op: 'shot_list', crew: 'dex' }), base_version: 0 }], why: { action: 'start plan', quiet: true } }, { undo: false })
    const shot = id('shot', 1)
    const beat = id('beat', 1)
    const r = await landPlan(bus, text, {
      scenes: [{ id: scene, remainder: { type: 'doc', content: [] } }],
      shots: [{ id: shot, value: shotValue(storyboard, 'a0', { scene_id: scene }), prose: proseFromLines('action', ['Maya laughs at the sea.']) }],
      beats: [{ id: beat, value: { shot_id: shot, rank: 'a0', at_s: 1, kind: 'line', speaker: 'MAYA', parenthetical: 'quietly' }, prose: proseFromLines('dialogue', ['Again.']) }],
    }, { action: 'plan 1 shot', agent: 'dex', cites: [`doc#jobs[${job}]`].map((c) => c.replace('doc', bus.store.documentId())) })
    expect(r.applied).toBe(true)
    const d = bus.doc()
    expect(d.scenes[scene].text).toBe('')
    expect(d.shots[shot].action).toBe('Maya laughs at the sea.')
    expect(d.beats[beat].text).toBe('Again.')
    expect(d.shots[shot].last_writer).toBe('dex')
    // One step: undo puts the text back in the scene and the shot and beat go.
    expect(await undo.undo()).toMatchObject({ done: true, label: 'plan 1 shot' })
    expect(bus.doc().shots[shot]).toBeUndefined()
    expect(bus.doc().beats[beat]).toBeUndefined()
    expect(text.prose('scene', scene)).toEqual(SAMPLES.scene)
    expect(bus.doc().scenes[scene].text).toContain('Maya laughs at the sea.')
  })
})

describe('suggestions', () => {
  async function withSuggestion() {
    const p = await project()
    const scene = id('scene', 1)
    await p.bus.apply({ patches: [{ op: 'create', entity: 'scenes', id: scene, value: { script_id: p.script, rank: 'a0', heading: 'EXT. BEACH' }, base_version: 0 }], why: { action: 'create scene' } })
    await p.text.replace('scene', scene, SAMPLES.scene, 'human:p_maya001')
    const job = id('job', 2)
    const sug = id('sug', 1)
    await p.bus.apply({ patches: [
      { op: 'create', entity: 'jobs', id: job, value: jobValue(2, { op: 'write', crew: 'skye', node: { kind: 'script', id: p.script } }), base_version: 0 },
      { op: 'create', entity: 'suggestions', id: sug, value: {
        target: { kind: 'scene', id: scene }, crew: 'skye', job_id: job, for: 'human:p_maya001', base_hash: await proseHash(p.text.prose('scene', scene)),
        proposed: { prose: proseFromLines('action', ['Maya laughs, once.']), text: 'Maya laughs, once.' }, note: 'I tightened it to fit 1.6 s.', state: 'open' }, base_version: 0 },
    ], why: { action: 'write a suggestion', agent: 'skye' } }, { undo: false })
    return { ...p, scene, sug }
  }

  it('Keep applies the words and marks it kept, as one undo step', async () => {
    const { bus, text, undo, scene, sug } = await withSuggestion()
    await keepSuggestion(bus, text, sug)
    expect(bus.doc().scenes[scene].text).toBe('Maya laughs, once.')
    expect(bus.doc().suggestions[sug]).toMatchObject({ state: 'kept', decided_by: 'human:p_maya001' })
    expect(await undo.undo()).toMatchObject({ done: true })
    expect(bus.doc().scenes[scene].text).toContain('Again.')
    expect(bus.doc().suggestions[sug].state).toBe('open')
  })

  it('Keep mine drops it and Skye leaves the scene alone', async () => {
    const { bus, scene, sug } = await withSuggestion()
    await keepMine(bus, sug)
    expect(bus.doc().suggestions[sug].state).toBe('dropped')
    expect(bus.doc().scenes[scene].hands_off).toEqual(['skye'])
  })

  it('a suggestion whose text changed underneath goes stale and cannot be kept', async () => {
    const { bus, text, scene, sug } = await withSuggestion()
    await text.replace('scene', scene, proseFromLines('action', ['Sai rewrote it.']), 'human:p_sai0001')
    expect(await markStale(bus, undefined, text)).toEqual([sug])
    expect(bus.doc().suggestions[sug].state).toBe('stale')
    await bus.apply({ patches: [{ op: 'set', entity: 'suggestions', id: sug, path: 'state', value: 'open', base_version: bus.doc().suggestions[sug].v }], why: { action: 'reopen', quiet: true } })
    await expect(keepSuggestion(bus, text, sug)).rejects.toBeInstanceOf(StaleSuggestion)
    void AT
    void sha
  })
})
