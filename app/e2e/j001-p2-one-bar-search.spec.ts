// Phase 2 acceptance, record `one-bar-search` (features/j001-phase2-suite.clan): tests 26 and 27 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(one-bar-search) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { QUERY, SCOPE_QUERY } from './seed/j001/p2/one-bar-search.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(26), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    for (const from of ['/', '/#clients', `/#client-${job.client}`]) { // from any screen
      await page.goto('/'); await page.goto(from); await page.reload()
      // Cmd K at 1440, the bar button at 390.
      if (size.width >= 1024) await page.keyboard.press('Meta+k')
      else await page.getByTestId('bar-search-button').click() // ADJUST(one-bar-search)
      const input = page.getByTestId('bar-search-input') // ADJUST(one-bar-search)
      await expect(input).toBeFocused()
      await input.fill(QUERY)
      await input.press('Enter')
      await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 }) // the brief opens
      await expect(page.getByTestId('os-bar')).toContainText('brief', { ignoreCase: true })
    }
    // The ? key lists the shortcuts (a keyboard; at 390 the list is on the bar's menu).
    if (size.width >= 1024) {
      await page.locator('body').press('?')
      await expect(page.getByTestId('shortcuts')).toBeVisible() // ADJUST(one-bar-search)
    }
    await ctx.close()
  })

  test.fixme(t(27), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const search = async (q: string) => (await (await page.request.get(`${job.api}/search?q=${encodeURIComponent(q)}`)).json()) as { results: { title: string; kind: string }[] } // ADJUST(one-bar-search)
    expect((await search(QUERY)).results.length).toBeGreaterThan(0)
    // A person in a second agency finds nothing of J001 (their own workspace is another tenant).
    await signIn(page, PEOPLE.otherAgency)
    const other = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    const found = (await (await page.request.get(`/api/t/${other.tenant}/search?q=${encodeURIComponent(QUERY)}`)).json()) as { results: { title: string }[] }
    expect(found.results.filter(r => /J001|Client A/.test(r.title))).toEqual([])
    // A role that cannot open money gets no Scope result: planning has no Scope and estimates.
    await signIn(page, PEOPLE.planning)
    expect((await search(SCOPE_QUERY)).results.filter(r => /scope/i.test(r.title))).toEqual([])
    await signIn(page, PEOPLE.accountService)
    expect((await search(SCOPE_QUERY)).results.some(r => /scope/i.test(r.title))).toBe(true)
    await ctx.close()
  })
}
