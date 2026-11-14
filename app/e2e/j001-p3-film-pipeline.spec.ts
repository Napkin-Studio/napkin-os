// Phase 3 acceptance, record `film-pipeline` (features/j001-phase3-suite.clan): test 87 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `film-pipeline` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(film-pipeline) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, mediaJson, productionDoc, runOp, secondsOf, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(87), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.copywriter)
    // The TV script (10 seconds, beat ids t1 to t3) is the one the seed made; Send to Film hands it on from the Script editor.
    const tv = mediaJson(MEDIA.tv.name) as { beats: { id: string }[]; slot_s: number }
    const sent = await page.request.post('/production/api/spin-in/script', { data: { job: job.job, script: tv } }) // ADJUST(film-pipeline): the document id and revision of a Script editor document
    expect(sent.status()).toBe(200)
    await signIn(page, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const node = await (await page.request.get(`/production/api/documents/${doc.id}/nodes?type=script`)).json() as { nodes: { beats: { id: string }[] }[] } // ADJUST(film-pipeline)
    expect(node.nodes[0].beats.map(b => b.id)).toEqual(tv.beats.map(b => b.id))
    // A rough film is the shots' clips on the timeline at the script's slot, with sound.
    const film = await runOp(page, doc, { op: 'rough_film', tier: 'sketch', params: { script: node.nodes[0] } })
    expect(film.status).toBe(200)
    const bytes = Buffer.from(await (await page.request.get(`/production/api/assets/${film.job.outputs![0].id}/file`)).body())
    expect(await secondsOf(bytes, 'mp4')).toBeCloseTo(tv.slot_s, 2) // 10.000 seconds
    const streams = await (await page.request.get(`/production/api/assets/${film.job.outputs![0].id}/streams`)).json() as { audio: number } // ADJUST(film-pipeline)
    expect(streams.audio).toBeGreaterThan(0)
    await ctx.close()
  })
}
