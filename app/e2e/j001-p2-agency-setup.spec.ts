// Phase 2 acceptance, record `agency-setup` (features/j001-phase2-suite.clan): tests 39 and 40 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(agency-setup) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { BAD_ROWS, CLIENTS_CSV, LOGO_SVG, NEW_AGENCY, peopleCsv } from './seed/j001/p2/agency-setup.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(39), async ({ browser }) => {
    // A Napkin admin creates the agency (POST /api/control/agencies), its first admin signs in and does the flow. ADJUST(agency-setup)
    const napkin = await open(browser, size, 'white', { roster: true })
    await signIn(napkin.page, PEOPLE.admin)
    expect((await napkin.page.request.post('/api/control/agencies', { data: NEW_AGENCY })).status()).toBe(201)
    await napkin.ctx.close()
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, { username: NEW_AGENCY.first_admin })
    await page.goto('/'); await page.reload()
    await expect(page.getByTestId('setup-step')).toContainText(/logo/i) // starts with the logo and asks for nothing before it
    await page.getByTestId('setup-logo-input').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(LOGO_SVG) })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByTestId('setup-people-input').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(peopleCsv(120)) })
    await expect(page.getByTestId('import-summary')).toContainText('117')
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByTestId('setup-clients-input').setInputFiles({ name: 'clients.csv', mimeType: 'text/csv', buffer: Buffer.from(CLIENTS_CSV) })
    await page.getByRole('button', { name: 'Import' }).click()
    // An imported person signs in to the right home (their role's).
    const imported = await open(browser, size, 'white', { roster: true })
    await signIn(imported.page, { username: 'person1@cr' })
    await imported.page.goto('/')
    await expect(imported.page.getByTestId('home')).toBeVisible()
    await imported.ctx.close()
    await ctx.close()
  })

  test.fixme(t(40), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, { username: NEW_AGENCY.first_admin }) // ADJUST(agency-setup): the agency made in test 39 or the seed's own
    const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    const dry = await page.request.post(`/api/t/${tenant}/setup/import/people?dry_run=1`, { multipart: { file: { name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(peopleCsv(120)) } } })
    const result = (await dry.json()) as { ok: number; errors: { line: number; reason: string }[] }
    expect(result.ok).toBe(117)
    expect(result.errors.map(e => e.line)).toEqual(BAD_ROWS.map(b => b.line)) // a bad row is listed with its reason
    expect(result.errors.every(e => e.reason.length > 0)).toBe(true)
    // A role change takes effect on the next request.
    expect((await page.request.put(`/api/t/${tenant}/agency/people/person1@cr`, { data: { roles: ['traffic'] } })).status()).toBe(200)
    const person = await open(browser, size, 'white', { roster: true })
    await signIn(person.page, { username: 'person1@cr' })
    const doors = (await (await person.page.request.get(`/api/t/${tenant}/doors`)).json()) as { doors: { name: string }[] }
    expect(doors.doors.map(d => d.name)).toContain('Traffic board')
    await person.ctx.close()
    // A second agency's admin sees none of the first's people.
    await signIn(page, PEOPLE.otherAgencyAdmin)
    const other = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    const people = (await (await page.request.get(`/api/t/${other.tenant}/agency/people`)).json()) as { username: string }[]
    expect(people.filter(p => p.username.endsWith('@cr'))).toEqual([])
    expect((await page.request.get(`/api/t/${tenant}/agency/people`)).status()).toBe(403)
    await ctx.close()
  })
}
