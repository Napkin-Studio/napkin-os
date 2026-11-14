// Phase 3 acceptance, record `production-line-merge` (features/j001-phase3-suite.clan): test 74 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Turned on by production-line-merge: the routes and selectors are what the merge gives (docs/production-tool/merge-2026-11.md). The stack
// (stack.mjs) serves the Production Tool's build at /production on the roster server, in front of the line's local relay with the mock
// provider, the passthrough director and the spend cap at 0.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.
//
// Not proven here, and why: "sees J001's Production document". The merge brings the tool, not a link from a job to a Production
// document: no job lists an `ie.napkin.production` document yet (phase3/support.ts productionDoc). That link is a later Phase 3 record's
// (phase3-doors, the film and format pack records); this test checks the tool opens for the job's producer, in the job's agency.

import { expect, test } from '@playwright/test'
import { SIZES, open, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test(t(74), async ({ browser }) => {
    const { ctx, page } = await startJ001(browser, size, PEOPLE.producer)
    // The shell's session says Production is here for this person (their role has a Production door).
    const session = (await (await page.request.get('/api/session')).json()) as { tenant: string; production?: boolean }
    expect(session.production).toBe(true)
    // The tool opens inside the shell's server, at /production, as its own page.
    const answer = await page.goto('/production/')
    expect(answer?.status()).toBe(200)
    await expect(page).toHaveTitle(/Production/)
    await expect(page.locator('#root > *').first()).toBeVisible({ timeout: 30_000 })
    // Its API answers through napkin-web's proxy, as this person, in their agency's workspace (the signed X-Napkin-Identity).
    const me = await page.request.get('/production/api/me')
    expect(me.status()).toBe(200)
    const who = (await me.json()) as { handle: string; workspace: string }
    expect(who.handle).toBe(PEOPLE.producer.username.split('@')[0])
    expect(who.workspace).toBe(session.tenant)

    // An account with no agency (nobody signed in) gets 401, on the API and on the page.
    const anon = await open(browser, size, 'white', { roster: true })
    expect((await anon.page.request.get('/production/api/jobs')).status()).toBe(401)
    expect((await anon.page.goto('/production'))?.status()).toBe(401)
    // A person whose role has no Production door (planning) gets 403, and the tool's build is not sent.
    await signIn(anon.page, PEOPLE.planning)
    expect((await anon.page.request.get('/production/api/me')).status()).toBe(403)
    const refused = await anon.page.goto('/production/')
    expect(refused?.status()).toBe(403)
    await anon.ctx.close()
    await ctx.close()
  })
}
