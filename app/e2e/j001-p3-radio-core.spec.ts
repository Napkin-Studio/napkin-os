// Phase 3 acceptance, record `radio-core` (features/j001-phase3-suite.clan): test 90 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `radio-core` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(radio-core) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, middlewareLog } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, mediaJson, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(90), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.copywriter)
    // The seed's 30 second script, with one voice line lengthened so the read comes to 34 seconds.
    const radio = mediaJson(MEDIA.radio.name) as { beats: { id: string; kind: string; text: string; est_s: number }[] }
    const long = { ...radio, beats: radio.beats.map(b => (b.id === 'r2' ? { ...b, text: `${b.text} ${'It is very late and still you stay. '.repeat(2)}`.trim(), est_s: b.est_s + 4 } : b)) }
    const sent = await page.request.post(`${job.api}/documents/radio`, { data: { job: job.job, script: long } }) // ADJUST(radio-core)
    expect(sent.status()).toBe(200)
    await page.goto(((await sent.json()) as { path: string }).path)
    // Timing is worked out before anything is voiced: the total, the slot and the over-run per line.
    await expect(page.getByTestId('time-rail')).toContainText('34')
    await expect(page.getByTestId('overrun')).toBeVisible() // ADJUST(radio-core)
    await expect(page.locator('[data-testid="cue-line"][data-over="true"]').first()).toBeVisible()
    // Voice it is not offered, so nothing is voiced and nothing is paid for.
    await expect(page.getByRole('button', { name: 'Voice it' })).toHaveCount(0)
    expect(await middlewareLog(page)).toHaveLength(0)
    await ctx.close()
  })
}
