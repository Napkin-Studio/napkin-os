// Phase 3 acceptance, record `elevenlabs-provider` (features/j001-phase3-suite.clan): test 110 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `elevenlabs-provider` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(elevenlabs-provider) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, bodyText, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(110), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.admin)
    // The stack starts with fake provider keys that are one canary string (NAPKIN_E2E_CANARY_KEY, for ElevenLabs and Black Forest Labs). ADJUST(elevenlabs-provider): stack.mjs
    const canary = process.env.NAPKIN_E2E_CANARY_KEY ?? 'napkin-canary-key-0000'
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    await runOp(page, doc, { op: 'generate', tier: 'sketch', inputs: [photo.id] })
    await runOp(page, doc, { op: 'voice', tier: 'sketch', params: { script: MEDIA.radio.name, slot_s: 30 } })
    const urls = [`${job.api}/jobs/${job.job}`, `${job.api}/dashboard`, `${job.api}/ledger?job=${job.job}`, `${job.api}/judge/telemetry`, '/api/session', '/production/api/providers', `/s/${doc.token}/chain`]
    for (const u of urls) expect(await bodyText(page, u), u).not.toContain(canary)
    // No export holds it, and the run log shows no provider call.
    const exported = await page.request.post(`/production/api/assets/${photo.id}/export`, { data: { label: 'persistent' } })
    expect((await exported.body()).toString('latin1')).not.toContain(canary)
    expect(await bodyText(page, '/production/api/test/transport-log')).not.toContain(canary) // ADJUST(spend-guard-unified)
    // No retrieval trace holds a hit from Cannes, Effie or WARC.
    expect(await bodyText(page, `${job.api}/retrieval-trace?job=${job.job}`)).not.toMatch(/cannes|effie|warc/i) // ADJUST(j001-phase3-suite): the trace route phase 2's test 73 reads
    await ctx.close()
  })
}
