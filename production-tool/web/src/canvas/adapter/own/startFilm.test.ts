// The Start card's "Write the script" (stages/startFilm.ts; features/production-new-ui.clan, mock canvas-empty):
// on a blank project it lays the film out on our own engine: a Script, the Storyboard it drives at the chosen
// shape, the length on the chain; from a brief, the Brief node linked into the Script too. Through the real
// CLAN store (modelStore), never SnapshotDocumentStore.
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { MAYA, modelStore } from '../../../test/model'
import { cardOf } from '../../nodes/nodes'
import type { BriefSource, OsBriefRead } from '../../../brief/os'
import { startFilm } from '../../../stages/startFilm'
import { briefOfElement, linkBriefLater } from '../../../brief/canvas'
import { OwnAdapter } from './adapter'

const read: OsBriefRead = {
  documentId: 'doc-market', title: 'Colour of the market', appId: 'ie.napkin.brief-maker', dataSha256: `sha256:${'c'.repeat(64)}`,
  data: { single_minded_proposition: 'Every colour has a story.', audience: 'Women 25–45.', tone_and_world: ['Warm'] },
}
const src: BriefSource = { available: async () => true, list: async () => [], read: async () => read, openUrl: () => '' }

async function blank() {
  const s = modelStore()
  await s.create(MAYA, 'Blank', true)
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  return { s, a, env: { canvas: a, doc: s as never } }
}

describe('Start card: Write the script', () => {
  it('on a blank project makes the Script and the Storyboard it drives, at the shape and length picked', async () => {
    const { s, a, env } = await blank()
    const out = await startFilm(env, src, { seconds: 10, ratio: '9:16' })
    const d = s.get() as unknown as ProductionDocument
    expect(d.scripts[out.scriptId].target_s).toBe(10)
    expect(out.storyboardId).toBeTruthy()
    expect(d.storyboards[out.storyboardId!]).toMatchObject({ ratio: '9:16', target_s: 10 })
    expect(Object.values(d.links).some((l) => l.role === 'drives' && l.from.id === out.scriptId && l.to.id === out.storyboardId)).toBe(true)
    const nodes = a.elements().map(cardOf).filter(Boolean).map((c) => c!.kind)
    expect(nodes.sort()).toEqual(['script', 'storyboard'])
    expect(out.briefId).toBeUndefined()
  })

  it('from a brief: the Brief node is linked into the new Script as well', async () => {
    const { s, env } = await blank()
    const out = await startFilm(env, src, { seconds: 15, ratio: '16:9', brief: { documentId: 'doc-market', how: 'spinoff' } })
    const d = s.get() as unknown as ProductionDocument
    expect(d.briefs![out.briefId!]).toMatchObject({ title: 'Colour of the market', source: { how: 'spinoff' } })
    expect(Object.values(d.links).some((l) => l.role === 'brief' && l.to.id === out.scriptId)).toBe(true)
    expect(d.storyboards[out.storyboardId!].target_s).toBe(15)
  })

  it('says so, and makes nothing, on a canvas that cannot make nodes', async () => {
    await expect(startFilm(null, src, { seconds: 10, ratio: '16:9' })).rejects.toThrow(/new canvas/)
  })
})

describe('Link a brief later (Assets › From Napkin; live test 2026-11-18)', () => {
  it('a film started without a brief gets the Brief node beside its Script, linked in, selected; again: the same node', async () => {
    const { s, a, env } = await blank()
    const out = await startFilm(env, src, { seconds: 15, ratio: '16:9' })
    const r = await linkBriefLater(env, read)
    const d = s.get() as unknown as ProductionDocument
    expect(r.scriptId).toBe(out.scriptId)
    expect(d.briefs![r.briefId]).toMatchObject({ title: 'Colour of the market', source: { how: 'link' } })
    expect(Object.values(d.links).filter((l) => l.role === 'brief' && l.from.id === r.briefId && l.to.id === out.scriptId)).toHaveLength(1)
    const el = a.elements().find((e) => briefOfElement(e) === r.briefId)!
    const script = a.elements().find((e) => cardOf(e)?.id === out.scriptId)!
    expect(el.x + el.width).toBeLessThanOrEqual(script.x)
    expect(a.view().selectedIds).toEqual([el.id])
    const again = await linkBriefLater(env, read)
    expect(again.briefId).toBe(r.briefId)
    expect(Object.keys((s.get() as unknown as ProductionDocument).briefs!)).toHaveLength(1)
  })
})
