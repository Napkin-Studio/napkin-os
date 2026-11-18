// The brief a page arrives with (brief/canvas.ts bringBrief) on our own engine (features/production-new-ui.clan,
// owner 2026-11-18: "If we have come from a brief, the brief is just there on the canvas"): its Brief node
// alone, nothing selected; the person links it to the nodes they add later.
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { MAYA, modelStore } from '../../../test/model'
import { cardOf, createNode } from '../../nodes/nodes'
import { bringBrief, linkBrief } from '../../../brief/canvas'
import { briefOf } from '../../../brief/model'
import type { OsBriefRead } from '../../../brief/os'
import { OwnAdapter } from './adapter'

const read = (): OsBriefRead => ({
  documentId: 'doc-first-light', title: 'First Light brief', appId: 'ie.napkin.brief-maker', dataSha256: `sha256:${'b'.repeat(64)}`,
  data: { single_minded_proposition: 'Lumen is what the day starts with.', audience: 'Adults 25 to 40.', tone_and_world: ['Quiet'], confidential_fields: ['audience'] },
})

async function blank() {
  const s = modelStore()
  await s.create(MAYA, 'Blank', true)
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  return { s, a, env: { canvas: a, doc: s as never }, doc: () => s.get() as unknown as ProductionDocument }
}

describe('arriving with a brief', () => {
  it('places only the Brief node (a frozen copy), in view, nothing selected: no Script, no link', async () => {
    const { a, env, doc } = await blank()
    const out = await bringBrief(env, read())
    const d = doc()
    expect(d.briefs![out.briefId]).toMatchObject({ title: 'First Light brief', source: { document_id: 'doc-first-light', taken: 1, how: 'spinoff' }, confidential: ['audience'] })
    expect(Object.keys(d.scripts)).toHaveLength(0)
    expect(Object.keys(d.storyboards)).toHaveLength(0)
    expect(Object.keys(d.videos)).toHaveLength(0)
    expect(Object.values(d.links)).toHaveLength(0)
    const els = a.elements().filter((e) => !e.isDeleted)
    expect(els.map((e) => (e.customData as { kind?: string } | undefined)?.kind)).toEqual(['brief'])
    expect(els.filter((e) => cardOf(e))).toHaveLength(0)
    expect(a.view().selectedIds).toHaveLength(0)
    const v = a.visibleBounds()
    expect(out.el.x).toBeGreaterThanOrEqual(v.minX)
    expect(out.el.x + out.el.width).toBeLessThanOrEqual(v.maxX)
  })

  it('the same brief again keeps the one Brief node', async () => {
    const { env, doc } = await blank()
    const one = await bringBrief(env, read())
    const two = await bringBrief(env, read())
    expect(two.briefId).toBe(one.briefId)
    expect(Object.keys(doc().briefs!)).toHaveLength(1)
  })

  it.each(['script', 'storyboard', 'video'] as const)('links into a %s node added afterwards', async (kind) => {
    const { env, doc } = await blank()
    const { briefId } = await bringBrief(env, read())
    const id = cardOf(await createNode(env, kind))!.id
    const r = await linkBrief(env, briefId, { kind, id })
    expect(r.ok).toBe(true)
    expect(Object.values(doc().links).filter((l) => l.role === 'brief')).toEqual([expect.objectContaining({ from: { kind: 'brief', id: briefId }, to: { kind, id } })])
    if (kind === 'script') expect(briefOf(doc(), id)).toMatchObject({ brief: { id: briefId } })
  })
})
