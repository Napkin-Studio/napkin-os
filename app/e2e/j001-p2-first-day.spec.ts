// Phase 2 acceptance, record `first-day` (features/j001-phase2-suite.clan): tests 28 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(first-day) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { INVITED, POINTERS } from './seed/j001/p2/first-day.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(28), async ({ browser }) => {
    // An admin of the agency invites a copywriter (agency-setup's people route); the invited person signs in for the first time.
    const admin = await open(browser, size, 'white', { roster: true })
    await signIn(admin.page, PEOPLE.planning)
    const job = await seedJ001(admin.page, { ready: true, fresh: true })
    await signIn(admin.page, PEOPLE.copywriter) // ADJUST(first-day): the invitation is the record's; the roster's copywriter stands in for the invited person
    await admin.page.goto('/'); await admin.page.reload()
    await expect(admin.page.getByTestId('home')).toBeVisible() // lands in their own home
    const pointers = admin.page.getByTestId('pointer') // ADJUST(first-day)
    await expect(pointers).toHaveCount(POINTERS) // three pointers, once
    await pointers.first().getByRole('button', { name: 'Got it' }).click()
    // Their first Needs you item is a real J001 task and it opens.
    const first = admin.page.getByTestId('need').first() // ADJUST(first-day)
    await expect(first).toContainText(job.job)
    await first.click()
    await expect(admin.page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    // The second visit: the pointers do not show.
    await admin.page.goto('/'); await admin.page.reload()
    await expect(admin.page.getByTestId('pointer')).toHaveCount(0)
    expect(INVITED.roles).toEqual(['copywriter'])
    await admin.ctx.close()
  })
}
