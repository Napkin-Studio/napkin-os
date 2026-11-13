// Phase 2 acceptance, record `sso` (features/j001-phase2-suite.clan): tests 41 and 42 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(sso) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES } from './pilot'
import { NOT_ON_LIST_LINE, SSO_AGENCY, SSO_BUTTON, SSO_PERSON, UNKNOWN_DOMAIN_PERSON } from './seed/j001/p2/sso.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

// The stack starts a fake identity provider when NAPKIN_E2E_SSO=1 (the record adds it to stack.mjs). ADJUST(sso): the fake's control
// address, and how a test chooses which person it signs in.
const idp = `http://127.0.0.1:${process.env.NAPKIN_E2E_IDP_PORT || '18083'}`

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(41), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await page.request.post(`${idp}/control`, { data: { sign_in_as: SSO_PERSON } })
    await page.goto('/')
    await page.getByTestId('sign-in-agency').fill(SSO_AGENCY) // ADJUST(sso)
    await page.getByRole('button', { name: SSO_BUTTON }).click()
    await expect(page.getByTestId('desk')).toBeVisible()
    const session = (await (await page.request.get('/api/session')).json()) as { username: string; roles: string[] }
    expect(session.roles).toEqual(SSO_PERSON.roles)
    // A person from an unknown domain is refused with one line.
    const other = await open(browser, size, 'white', { roster: true })
    await other.page.request.post(`${idp}/control`, { data: { sign_in_as: UNKNOWN_DOMAIN_PERSON } })
    await other.page.goto('/')
    await other.page.getByTestId('sign-in-agency').fill(SSO_AGENCY)
    await other.page.getByRole('button', { name: SSO_BUTTON }).click()
    await expect(other.page.getByTestId('sign-in-line')).toHaveText(NOT_ON_LIST_LINE) // ADJUST(sso)
    await other.ctx.close()
    await ctx.close()
  })

  test.fixme(t(42), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await page.request.post(`${idp}/control`, { data: { fail: true } }) // the identity provider fails
    await page.goto('/')
    await page.getByTestId('sign-in-agency').fill(SSO_AGENCY)
    await page.getByRole('button', { name: SSO_BUTTON }).click()
    const line = page.getByTestId('sign-in-line')
    await expect(line).toBeVisible() // one plain line
    await expect(line).not.toContainText(/exception|stack|[{}]/i)
    // No half session is left.
    expect((await page.request.get('/api/session')).status()).toBe(401)
    // Try again works once the provider is back.
    await page.request.post(`${idp}/control`, { data: { fail: false, sign_in_as: SSO_PERSON } })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('desk')).toBeVisible()
    await ctx.close()
  })
}
