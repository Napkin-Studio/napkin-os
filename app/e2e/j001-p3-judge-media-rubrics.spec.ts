// Phase 3 acceptance, record `judge-media-rubrics` (features/j001-phase3-suite.clan): tests 94 to 98 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `judge-media-rubrics` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(judge-media-rubrics) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { type Decision, SIZES, chainOf, control } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, VERDICT_VARIANT, addAsset, productionDoc, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(94), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.creativeDirector)
    const doc = await productionDoc(page, job)
    const piece = await addAsset(page, doc, MEDIA.bottle.name, 'still')
    await control(page, { variant: { judge_work: VERDICT_VARIANT } })
    const scored = await page.request.post(`/s/${doc.token}/judge`, { data: { target: piece.sha256, work_kind: 'still' } })
    expect(scored.status()).toBe(200)
    const [v] = (await chainOf(page, doc.token)).filter(d => d.kind === 'verdict') as (Decision & { judge?: { total: number; sub: { idea: number; craft: number; effect: number }; work_kind: string; tests: { id: string; value: string }[]; target?: string } })[]
    // Out of 30: the host's sum of three sub-scores of 10, and the total is the sum of the tests.
    expect(v.judge?.work_kind).toBe('still')
    expect(v.judge?.target).toContain(piece.sha256.slice(0, 12))
    const sub = v.judge!.sub
    expect(sub.idea + sub.craft + sub.effect).toBe(v.judge!.total)
    expect(v.judge!.total).toBeLessThanOrEqual(30)
    expect(v.judge!.tests).toHaveLength(30)
    expect(v.judge!.tests.filter(x => x.value === 'pass').length).toBe(v.judge!.total)
    // Judge scores the piece, never who made it.
    expect(JSON.stringify(v)).not.toMatch(/made_by|per_person|by_person/)
    await ctx.close()
  })

  test.fixme(t(95), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.creativeDirector)
    const doc = await productionDoc(page, job)
    const piece = await addAsset(page, doc, MEDIA.tv.name, 'film')
    await control(page, { variant: { judge_work: VERDICT_VARIANT } })
    const scored = await page.request.post(`/s/${doc.token}/judge`, { data: { target: piece.sha256, work_kind: 'film' } })
    expect(scored.status()).toBe(200)
    const [v] = (await chainOf(page, doc.token)).filter(d => d.kind === 'verdict') as (Decision & { judge?: { total: number; sub: { idea: number; craft: number; effect: number }; work_kind: string; tests: { id: string; value: string }[]; target?: string } })[]
    // Out of 30: the host's sum of three sub-scores of 10, and the total is the sum of the tests.
    expect(v.judge?.work_kind).toBe('film')
    expect(v.judge?.target).toContain(piece.sha256.slice(0, 12))
    const sub = v.judge!.sub
    expect(sub.idea + sub.craft + sub.effect).toBe(v.judge!.total)
    expect(v.judge!.total).toBeLessThanOrEqual(30)
    expect(v.judge!.tests).toHaveLength(30)
    expect(v.judge!.tests.filter(x => x.value === 'pass').length).toBe(v.judge!.total)
    // Judge scores the piece, never who made it.
    expect(JSON.stringify(v)).not.toMatch(/made_by|per_person|by_person/)
    await ctx.close()
  })

  test.fixme(t(96), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.creativeDirector)
    const doc = await productionDoc(page, job)
    const piece = await addAsset(page, doc, MEDIA.radio.name, 'radio_spot')
    await control(page, { variant: { judge_work: VERDICT_VARIANT } })
    const scored = await page.request.post(`/s/${doc.token}/judge`, { data: { target: piece.sha256, work_kind: 'radio_spot' } })
    expect(scored.status()).toBe(200)
    const [v] = (await chainOf(page, doc.token)).filter(d => d.kind === 'verdict') as (Decision & { judge?: { total: number; sub: { idea: number; craft: number; effect: number }; work_kind: string; tests: { id: string; value: string }[]; target?: string } })[]
    // Out of 30: the host's sum of three sub-scores of 10, and the total is the sum of the tests.
    expect(v.judge?.work_kind).toBe('radio_spot')
    expect(v.judge?.target).toContain(piece.sha256.slice(0, 12))
    const sub = v.judge!.sub
    expect(sub.idea + sub.craft + sub.effect).toBe(v.judge!.total)
    expect(v.judge!.total).toBeLessThanOrEqual(30)
    expect(v.judge!.tests).toHaveLength(30)
    expect(v.judge!.tests.filter(x => x.value === 'pass').length).toBe(v.judge!.total)
    // Judge scores the piece, never who made it.
    expect(JSON.stringify(v)).not.toMatch(/made_by|per_person|by_person/)
    await ctx.close()
  })

  test.fixme(t(97), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.creativeDirector)
    const doc = await productionDoc(page, job)
    const piece = await addAsset(page, doc, MEDIA.sheet48.name, 'poster')
    await control(page, { variant: { judge_work: VERDICT_VARIANT } })
    const scored = await page.request.post(`/s/${doc.token}/judge`, { data: { target: piece.sha256, work_kind: 'poster' } })
    expect(scored.status()).toBe(200)
    const [v] = (await chainOf(page, doc.token)).filter(d => d.kind === 'verdict') as (Decision & { judge?: { total: number; sub: { idea: number; craft: number; effect: number }; work_kind: string; tests: { id: string; value: string }[]; target?: string } })[]
    // Out of 30: the host's sum of three sub-scores of 10, and the total is the sum of the tests.
    expect(v.judge?.work_kind).toBe('poster')
    expect(v.judge?.target).toContain(piece.sha256.slice(0, 12))
    const sub = v.judge!.sub
    expect(sub.idea + sub.craft + sub.effect).toBe(v.judge!.total)
    expect(v.judge!.total).toBeLessThanOrEqual(30)
    expect(v.judge!.tests).toHaveLength(30)
    expect(v.judge!.tests.filter(x => x.value === 'pass').length).toBe(v.judge!.total)
    // Judge scores the piece, never who made it.
    expect(JSON.stringify(v)).not.toMatch(/made_by|per_person|by_person/)
    await ctx.close()
  })

  test.fixme(t(98), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.creativeDirector)
    const doc = await productionDoc(page, job)
    const piece = await addAsset(page, doc, MEDIA.layout.name, 'format_pack')
    await control(page, { variant: { judge_work: VERDICT_VARIANT } })
    const scored = await page.request.post(`/s/${doc.token}/judge`, { data: { target: piece.sha256, work_kind: 'format_pack' } })
    expect(scored.status()).toBe(200)
    const [v] = (await chainOf(page, doc.token)).filter(d => d.kind === 'verdict') as (Decision & { judge?: { total: number; sub: { idea: number; craft: number; effect: number }; work_kind: string; tests: { id: string; value: string }[]; target?: string } })[]
    // Out of 30: the host's sum of three sub-scores of 10, and the total is the sum of the tests.
    expect(v.judge?.work_kind).toBe('format_pack')
    expect(v.judge?.target).toContain(piece.sha256.slice(0, 12))
    const sub = v.judge!.sub
    expect(sub.idea + sub.craft + sub.effect).toBe(v.judge!.total)
    expect(v.judge!.total).toBeLessThanOrEqual(30)
    expect(v.judge!.tests).toHaveLength(30)
    expect(v.judge!.tests.filter(x => x.value === 'pass').length).toBe(v.judge!.total)
    // Judge scores the piece, never who made it.
    expect(JSON.stringify(v)).not.toMatch(/made_by|per_person|by_person/)
    await ctx.close()
  })
}
