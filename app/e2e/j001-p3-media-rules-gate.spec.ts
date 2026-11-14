// Phase 3 acceptance, record `media-rules-gate` (features/j001-phase3-suite.clan): test 84 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `media-rules-gate` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(media-rules-gate) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(84), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.accountService)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    // The client is an Irish whiskey: a person marks it restricted for alcohol.
    expect((await page.request.patch(`${job.api}/clients/${job.client}`, { data: { restrictions: ['alcohol'] } })).status()).toBe(200) // ADJUST(media-rules-gate)
    await signIn(page, PEOPLE.producer)
    const ugc = { op: 'generate', tier: 'standard', inputs: [photo.id], params: { tags: ['ugc', 'real_face'] } } as const
    // Refused with neither decision.
    const refused = await runOp(page, doc, ugc)
    expect(refused.job.reason).toBe('rules_gate')
    // Allowed with both: the legal sign-off and the consent record.
    await signIn(page, PEOPLE.accountService)
    const consent = { subject: 'placeholder performer', document: 'consent-001', expires: '2099-01-01' }
    for (const d of [{ kind: 'legal_signoff', by: PEOPLE.accountService.name, reference: 'LEGAL-001' }, { kind: 'consent_record', ...consent }]) {
      expect((await page.request.post(`/s/${doc.token}/decision`, { data: d })).status()).toBe(200) // ADJUST(media-rules-gate)
    }
    await signIn(page, PEOPLE.producer)
    expect((await runOp(page, doc, ugc)).status).toBe(200)
    // Refused again once the consent has expired.
    await signIn(page, PEOPLE.accountService)
    await page.request.post(`/s/${doc.token}/decision`, { data: { kind: 'consent_record', ...consent, expires: '2020-01-01' } })
    await signIn(page, PEOPLE.producer)
    expect((await runOp(page, doc, ugc)).job.reason).toBe('rules_gate')
    // Words to be drawn never go to an image model: a headline in the prompt is refused with the line.
    const typed = await runOp(page, doc, { op: 'generate', tier: 'sketch', inputs: [photo.id], params: { prompt: 'a bottle on a table with the headline "The night can wait" across the top' } })
    expect(typed.job.message).toBe('Type is set in the layout, not made in the picture.')
    await ctx.close()
  })
}
