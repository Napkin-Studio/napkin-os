// Phase 3 acceptance, record `radio-tool` (features/j001-phase3-suite.clan): test 89 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `radio-tool` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(radio-tool) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, mediaJson, secondsOf, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(89), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.copywriter)
    // Send to Radio from the Script editor: the 30 second script of the seed becomes a radio document for the same job, beat ids kept.
    const radio = mediaJson(MEDIA.radio.name) as { beats: { id: string; est_s: number }[]; slot_s: number }
    const sent = await page.request.post(`${job.api}/documents/radio`, { data: { job: job.job, script: radio } }) // ADJUST(radio-core): the hand-off route
    expect(sent.status()).toBe(200)
    const doc = (await sent.json()) as { token: string; path: string }
    await page.goto(doc.path)
    await expect(page.getByTestId('cue-sheet')).toBeVisible() // ADJUST(radio-tool)
    await expect(page.getByTestId('cue-line')).toHaveCount(radio.beats.length)
    await expect(page.getByTestId('time-rail')).toContainText('30') // the slot, in seconds
    // Voice it: on the mock the copywriter hears tones in under 5 seconds, a 30.0 second file and a mix report.
    const started = Date.now()
    await page.getByRole('button', { name: 'Voice it' }).click()
    const audio = page.locator('audio')
    await expect(audio).toHaveCount(1, { timeout: 5000 })
    expect(Date.now() - started).toBeLessThan(5000)
    const src = await audio.getAttribute('src')
    const bytes = Buffer.from(await (await page.request.get(src!)).body())
    expect(await secondsOf(bytes, 'mp3')).toBeCloseTo(30.0, 1)
    await expect(page.getByTestId('mix-report')).toBeVisible()
    await ctx.close()
  })
}
