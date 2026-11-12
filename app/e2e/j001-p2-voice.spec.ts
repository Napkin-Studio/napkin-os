// Phase 2 acceptance, record `voice` (features/j001-phase2-suite.clan): tests 31 and 32 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(voice) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { CLIENT_SEND_TRANSCRIPT, TRANSCRIPT } from './seed/j001/p2/voice.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(31), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto('/'); await page.reload()
    // A spoken command is a fixture transcript (answers/transcribe.json); it does what the typed command does.
    await page.getByTestId('bar-voice').click() // ADJUST(voice): push to talk
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    expect(TRANSCRIPT).toContain('J001')
    // Before anything sent to a client, the bar shows what it heard and waits; Cancel does nothing.
    await page.evaluate(t => (window as unknown as { __napkinVoiceFixture?: string }).__napkinVoiceFixture = t, CLIENT_SEND_TRANSCRIPT) // ADJUST(voice): how a test sets the transcript
    await page.getByTestId('bar-voice').click()
    const heard = page.getByTestId('voice-heard') // ADJUST(voice)
    await expect(heard).toContainText(CLIENT_SEND_TRANSCRIPT)
    await heard.getByRole('button', { name: 'Cancel' }).click()
    const links = await page.request.get(`${job.api}/d/${encodeURIComponent(job.brief.path)}/client-links`)
    expect(await links.json()).toEqual([]) // nothing was sent
    await ctx.close()
  })

  test.fixme(t(32), async ({ browser }) => {
    const { ctx } = await open(browser, size, 'white', { roster: true })
    await ctx.grantPermissions([]) // the microphone is refused
    const page = await ctx.newPage()
    await signIn(page, PEOPLE.planning)
    await page.goto('/'); await page.reload()
    await page.getByTestId('bar-voice').click() // ADJUST(voice)
    const line = page.getByTestId('voice-line') // ADJUST(voice): one plain line
    await expect(line).toBeVisible()
    await expect(line).not.toContainText(/exception|stack|[{}]/i)
    // The bar still takes typing.
    const input = page.getByTestId('bar-search-input') // ADJUST(voice)
    await input.fill('J001 brief')
    await expect(input).toHaveValue('J001 brief')
    await ctx.close()
  })
}
