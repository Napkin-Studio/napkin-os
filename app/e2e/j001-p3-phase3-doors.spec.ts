// Phase 3 acceptance, record `phase3-doors` (features/j001-phase3-suite.clan): test 107 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `phase3-doors` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(phase3-doors) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(107), async ({ browser }) => {
    const { ctx, page } = await startJ001(browser, size, PEOPLE.producer)
    // Each door and the roles that have it (the v2 doors table); a role without the door gets 403 or the Empty state, never the tool.
    const doors = [
      { door: 'stills', roles: [PEOPLE.artDirector], target: /\/production.*open=image/ },
      { door: 'video-motion', roles: [PEOPLE.artDirector, PEOPLE.producer], target: /\/production.*open=video/ },
      { door: 'radio', roles: [PEOPLE.copywriter, PEOPLE.producer], target: /\/radio|door-radio/ },
      { door: 'formats-in-situ', roles: [PEOPLE.artDirector, PEOPLE.producer], target: /\/production.*open=(formats|outdoor)/ },
      { door: 'scope-estimates', roles: [PEOPLE.producer, PEOPLE.accountService], target: /scope/ },
      { door: 'traffic-board', roles: [PEOPLE.traffic], target: /\/traffic/ },
      { door: 'craft-review', roles: [PEOPLE.creativeDirector], target: /craft-review/ },
    ]
    for (const d of doors) {
      for (const who of d.roles) {
        await signIn(page, who)
        await page.goto(`/#door-${d.door}`); await page.reload()
        await expect(page.getByTestId('door-page').or(page.getByTestId('tool')).first()).toBeVisible() // ADJUST(phase3-doors)
        expect(page.url() + (await page.getByTestId('door-target').first().getAttribute('href').catch(() => '') ?? '')).toMatch(d.target)
      }
    }
    // A role without the door gets the Empty state.
    await signIn(page, PEOPLE.copywriter)
    await page.goto('/#door-traffic-board'); await page.reload()
    await expect(page.getByTestId('state-empty')).toBeVisible()
    await ctx.close()
  })
}
