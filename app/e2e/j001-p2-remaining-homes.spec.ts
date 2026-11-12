// Phase 2 acceptance, record `remaining-homes` (features/j001-phase2-suite.clan): tests 19 and 20 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// These two tests already pass on this branch: roles.rs holds the five homes (v2 section 4) and the shell draws them, so they run
// (`test(`), not `test.fixme(`. The remaining-homes record keeps them passing and adds what it builds (the doors' own screens).
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PHASE2 } from './phase2/tests.mjs'
import { PEOPLE } from './seed/j001'
import { PHASE2_DOORS, PHASE2_MORE } from './seed/j001/p2/remaining-homes.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test(t(19), async ({ browser }) => {
    for (const role of ['artDirector', 'copywriter', 'producer', 'agencyBrain', 'traffic'] as const) {
      const { ctx, page } = await open(browser, size, 'white', { roster: true })
      await signIn(page, PEOPLE[role])
      await page.goto('/')
      await expect(page.getByTestId('home')).toBeVisible()
      const doors = page.getByTestId('door')
      await expect(doors).toHaveCount(5)
      expect(await doors.allInnerTexts()).toEqual([...PHASE2_DOORS[role]])
      // More tools: the list under the doors (src/shell/home/Home.tsx), each tool a button.
      await expect(page.getByTestId('more-tool')).toHaveCount(PHASE2_MORE[role].length)
      expect(await page.getByTestId('more-tool').allInnerTexts()).toEqual([...PHASE2_MORE[role]])
      await ctx.close()
    }
  })

  test(t(20), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    // Proprietary data is the Agency Brain's alone (roles.rs Group::Proprietary).
    expect((await page.request.get(`/api/t/${tenant}/proprietary`)).status()).toBe(403)
    await ctx.close()
    // A Phase 1 role and a Phase 2 role: one merged home of five doors, planning's first, then the copywriter's not already there.
    const merged = await open(browser, size, 'white', { roster: true })
    await signIn(merged.page, PEOPLE.planningAndCopywriter)
    await merged.page.goto('/')
    const doors = merged.page.getByTestId('door')
    await expect(doors).toHaveCount(5)
    const names = await doors.allInnerTexts()
    expect(new Set(names).size, 'no door twice').toBe(5)
    expect(names.slice(0, 5)).toEqual(expect.arrayContaining(['Brief']))
    await merged.ctx.close()
  })
}
