// Start from a brief (brief/canvas.ts startFromBrief) on our own engine (features/brief-node.clan): the
// empty canvas's Start card places the Brief node, a new Script beside it, and the brief linked into it.
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { MAYA, modelStore } from '../../../test/model'
import { cardOf } from '../../nodes/nodes'
import { startFromBrief } from '../../../brief/canvas'
import type { OsBriefRead } from '../../../brief/os'
import { OwnAdapter } from './adapter'

const read = (): OsBriefRead => ({
  documentId: 'doc-first-light', title: 'First Light brief', appId: 'ie.napkin.brief-maker', dataSha256: `sha256:${'b'.repeat(64)}`,
  data: { single_minded_proposition: 'Lumen is what the day starts with.', audience: 'Adults 25 to 40.', tone_and_world: ['Quiet'], confidential_fields: ['audience'] },
})

describe('Start from a brief', () => {
  it('places the Brief node, a new Script beside it, and the brief linked into the Script', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Blank', true)
    const a = new OwnAdapter()
    a.resize(1600, 1000, 0, 0)
    const env = { canvas: a, doc: s as never }
    const out = await startFromBrief(env, read())
    const d = s.get() as unknown as ProductionDocument
    expect(d.briefs![out.briefId]).toMatchObject({ title: 'First Light brief', source: { document_id: 'doc-first-light', taken: 1, how: 'link' }, confidential: ['audience'] })
    expect(d.scripts[out.scriptId]).toBeTruthy()
    expect(Object.values(d.links).filter((l) => l.role === 'brief')).toEqual([expect.objectContaining({ from: { kind: 'brief', id: out.briefId }, to: { kind: 'script', id: out.scriptId } })])
    const els = a.elements()
    const card = els.find((e) => (e.customData as { kind?: string } | undefined)?.kind === 'brief')!
    const script = els.find((e) => cardOf(e)?.id === out.scriptId)!
    expect(card.x + card.width).toBeLessThan(script.x)
    // The same brief again: the same Brief node, a second Script.
    const again = await startFromBrief(env, read())
    expect(again.briefId).toBe(out.briefId)
    expect(Object.keys((s.get() as unknown as ProductionDocument).briefs!)).toHaveLength(1)
    const chain = (await s.chain()).map((e) => e.action)
    expect(chain.filter((x) => x.startsWith('link the brief'))).toEqual(['link the brief “First Light brief” v1'])
  })
})
