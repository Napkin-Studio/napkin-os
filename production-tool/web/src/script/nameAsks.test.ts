// @vitest-environment happy-dom
// Unknown names become Skye's asks (features/script-editor.clan): one per name, closed quietly
// when the name resolves, answered locally as one undo step. (Her words on a selection are the Booth's: SkyeBooth.test.tsx.)

import { describe, expect, it } from 'vitest'
import { proseFromLines } from '../../../clan-store/src'
import { mainScript } from '../model/selectors'
import { addShots, asset, id, MAYA, modelStore, SHA } from '../test/model'
import { answerLocalAsk, askedName, askPlan, nameAsks, settleNameAsks } from './nameAsks'

async function project() {
  const store = modelStore()
  await store.create(MAYA, 'Asks')
  await store.change((d) => {
    d.assets[SHA('a')] = asset(SHA('a'))
    const k = id('key')
    d.keys[k] = { id: k, v: 1, field_v: {}, key: 'maya', role: 'character' }
    const r = id('ref')
    d.refs[r] = { id: r, v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('a') }
    addShots(d, 2, { status: 'planned' })
  }, { action: 'create' })
  await store.flush()
  const shots = Object.values(store.get().shots).sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((s) => s.id)
  return { store, shots, scriptId: mainScript(store.get())!.id }
}

describe('name asks', () => {
  it('typing @jo, @jog, @jogger, then leaving the shot raises exactly one ask; the same name in two shots, still one', async () => {
    const { store, shots, scriptId } = await project()
    for (const w of ['A @jo', 'A @jog', 'A @jogger runs past far behind @maya_front.']) {
      await store.text.replace('shot', shots[0], proseFromLines('action', [w]), `human:${MAYA.id}`, { undo: false })
    }
    await store.flush()
    await settleNameAsks(store, scriptId, shots[0])
    await store.text.replace('shot', shots[1], proseFromLines('action', ['@jogger again.']), `human:${MAYA.id}`, { undo: false })
    await store.flush()
    await settleNameAsks(store, scriptId, shots[1])
    await store.flush()
    const asks = nameAsks(store.get(), scriptId)
    expect(asks.map(askedName)).toEqual(['jogger'])
    const [a] = asks
    expect(a.question.text).toBe("Who is the jogger? There's no ref called @jogger, so I can't tell Dex how to show them.")
    expect(a.question.why).toBe("Shot 1 · 'A @jogger runs past far behind @maya_front.'")
    expect(a.question.options.map((o) => o.label)).toEqual(['A character', 'An extra', 'Cut them'])
    expect(a).toMatchObject({ crew: 'skye', state: 'open', node: { kind: 'script', id: scriptId } })
    expect(a.question.address).toBe(`${store.documentId()}#shots[${shots[0]}].action`)
  })

  it('fixing the name closes the ask quietly', async () => {
    const { store, shots, scriptId } = await project()
    await store.text.replace('shot', shots[0], proseFromLines('action', ['@maya_frnt waves.']), `human:${MAYA.id}`, { undo: false })
    await store.flush()
    await settleNameAsks(store, scriptId, shots[0])
    await store.flush()
    expect(nameAsks(store.get(), scriptId).filter((a) => a.state === 'open')).toHaveLength(1)
    await store.text.replace('shot', shots[0], proseFromLines('action', ['@maya_front waves.']), `human:${MAYA.id}`, { undo: false })
    await store.flush()
    expect(askPlan(store.get(), scriptId, shots[0]).close).toHaveLength(1)
    await settleNameAsks(store, scriptId, shots[0])
    await store.flush()
    expect(nameAsks(store.get(), scriptId).map((a) => a.state)).toEqual(['withdrawn'])
  })

  it('A character makes a key, as one undo step with the answer; Cut them starts a cut job', async () => {
    const { store, shots, scriptId } = await project()
    await store.text.replace('shot', shots[0], proseFromLines('action', ['A @jogger runs.']), `human:${MAYA.id}`, { undo: false })
    await store.flush()
    await settleNameAsks(store, scriptId, shots[0])
    await store.flush()
    const [a] = nameAsks(store.get(), scriptId)
    await answerLocalAsk(store, a.id, 'character', `human:${MAYA.id}`)
    expect(store.get().asks[a.id]).toMatchObject({ state: 'answered', answers: [{ option_id: 'character', by: `human:${MAYA.id}` }] })
    expect(Object.values(store.get().keys).some((k) => k.key === 'jogger')).toBe(true)
    await store.undo()
    expect(store.get().asks[a.id].state).toBe('open')
    expect(Object.values(store.get().keys).some((k) => k.key === 'jogger')).toBe(false)
    const cuts: [string, string][] = []
    await answerLocalAsk(store, a.id, 'cut', `human:${MAYA.id}`, async (shot, name) => { cuts.push([shot, name]) })
    expect(cuts).toEqual([[shots[0], 'jogger']])
  })
})
