// The script the board rail's Script row opens (stages/scriptToWrite.ts) on our own engine: a blank
// project gets a Script node the way + Node → Script makes one (live test 2026-11-16: it did nothing).
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { MAYA, modelStore } from '../../../test/model'
import { mainScript } from '../../../model/selectors'
import { cardOf } from '../../nodes/nodes'
import { scriptToWrite } from '../../../stages/scriptToWrite'
import { OwnAdapter } from './adapter'

describe('the Script a blank project opens', () => {
  const doc = (s: ReturnType<typeof modelStore>) => s.get() as unknown as ProductionDocument
  it('on a blank project makes a Script node, as + Node → Script does, and gives its id', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Blank', true)
    expect(mainScript(doc(s))).toBeUndefined()
    const a = new OwnAdapter()
    a.resize(1600, 1000, 0, 0)
    const id = await scriptToWrite(doc(s), { canvas: a, doc: s as never })
    expect(id).toBeTruthy()
    expect(doc(s).scripts[id!]).toBeTruthy()
    expect(a.elements().filter((e) => cardOf(e)?.kind === 'script').map((e) => cardOf(e)!.id)).toEqual([id])
    expect(a.view().selectedIds).toHaveLength(1)
  })
  it('opens the project\'s own script when it has one, making nothing', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rain')
    const a = new OwnAdapter()
    expect(await scriptToWrite(doc(s), { canvas: a, doc: s as never })).toBe(mainScript(doc(s))!.id)
    expect(a.elements()).toHaveLength(0)
  })
  it('makes nothing with no canvas that can make nodes', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Blank', true)
    expect(await scriptToWrite(doc(s), null)).toBeUndefined()
    expect(Object.keys(doc(s).scripts)).toHaveLength(0)
  })
})
