// Phase 2 acceptance, record `needs-you-full` (features/j001-phase2-suite.clan): tests 23 to 25 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(needs-you-full) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { chainOf, open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { ALERTS } from './seed/j001/p2/needs-you-full.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Need = { id: string; kind: string; title: string; due?: string; job?: string }
const needsOf = async (page: import('@playwright/test').Page, api: string) => (await (await page.request.get(`${api}/needs`)).json()) as Need[]

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(23), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto('/')
    const items = page.getByTestId('need') // ADJUST(needs-you-full)
    // Soonest deadline first, five and then Show all.
    await expect(items).toHaveCount(5)
    const due = await items.evaluateAll(els => els.map(e => e.getAttribute('data-due') ?? '')) // ADJUST(needs-you-full)
    expect(due).toEqual([...due].sort())
    await page.getByRole('button', { name: 'Show all' }).click()
    expect(await items.count()).toBeGreaterThan(5)
    // Only this person's items: another person's item is on the API for them and not for this one.
    const mine = await needsOf(page, job.api)
    await signIn(page, PEOPLE.copywriter)
    const theirs = await needsOf(page, job.api)
    expect(theirs.filter(n => mine.some(m => m.id === n.id))).toEqual([])
    // An empty list names the next deadline.
    await signIn(page, PEOPLE.traffic)
    await page.goto('/'); await page.reload()
    await expect(page.getByTestId('needs-empty')).toContainText(/next deadline/i) // ADJUST(needs-you-full)
    await ctx.close()
  })

  test.fixme(t(24), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto('/')
    const before = await needsOf(page, job.api)
    const first = page.getByTestId('need').first()
    const id = await first.getAttribute('data-id') // ADJUST(needs-you-full)
    await first.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator(`[data-id="${id}"]`)).toHaveCount(0)
    // Five seconds to undo: Undo brings it back.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator(`[data-id="${id}"]`)).toHaveCount(1)
    // Done again and left: after five seconds it is gone, and a reload keeps it gone.
    await page.locator(`[data-id="${id}"]`).getByRole('button', { name: 'Done' }).click()
    await page.waitForTimeout(5500)
    await page.reload()
    await expect(page.locator(`[data-id="${id}"]`)).toHaveCount(0)
    expect((await needsOf(page, job.api)).length).toBe(before.length - 1)
    await ctx.close()
  })

  test.fixme(t(25), async ({ browser }) => {
    // One event at a time is made through the document's own writes (a changed brief, a late approval ...) and the item is read off the API
    // for each person. ADJUST(needs-you-full): the way each event is caused is the record's; the rule tested is the v2 alerts table.
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const cause = async (event: string) => {
      const r = await page.request.post(`${job.api}/test-events`, { data: { event, job: job.job } }) // ADJUST(needs-you-full): the stack's event hook
      expect(r.status(), `cause "${event}"`).toBe(200)
    }
    for (const { event, lands, not } of ALERTS) {
      await signIn(page, PEOPLE.planning)
      await cause(event)
      for (const who of lands) {
        await signIn(page, PEOPLE[who as keyof typeof PEOPLE])
        expect((await needsOf(page, job.api)).some(n => n.title.includes(event) || n.kind === event), `${event} lands with ${who}`).toBe(true)
      }
      for (const who of not) {
        await signIn(page, PEOPLE[who as keyof typeof PEOPLE])
        expect((await needsOf(page, job.api)).some(n => n.title.includes(event) || n.kind === event), `${event} is not for ${who}`).toBe(false)
      }
    }
    expect((await chainOf(page, job.brief.token)).length).toBeGreaterThan(0)
    await ctx.close()
  })
}
