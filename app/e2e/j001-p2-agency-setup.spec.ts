// Phase 2 acceptance, record `agency-setup` (features/j001-phase2-suite.clan): tests 39 and 40 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Test 39 does the flow as a new agency's admin would: the logo, the name, 120 people, 8 clients and 30 jobs from the fixture files (seed/j001/p2/agency-setup.mjs),
// then an imported person signs in to the home of their role. Test 40 reads the facts through the API: a bad row listed by line with its reason and the rest
// imported, a role change on the person's very next request, and the wall between two agencies.
// Each width has its own agency (cr at 390, cs at 1440), so each run starts from nothing. The control list that makes an agency (stage 4 of the record) is not
// built yet, so the first admin is on the roster stack's roster (seed/j001/people.mjs) and the agency has no directory until the admin imports people.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { AGENCIES, BAD_ROWS, CLIENTS_CSV, JOBS_CSV, LOGO_SVG, peopleCsv } from './seed/j001/p2/agency-setup.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`
  const agency = AGENCIES[size.tag as '390' | '1440']
  const csv = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })
  const person = (i: number) => `person${i}@${agency.slug}`

  test(t(39), async ({ browser }) => {
    test.setTimeout(180_000)
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, { username: agency.first_admin })
    await page.goto('/'); await page.reload()
    // A new agency's admin is offered the setup first, and it starts with the logo and asks for nothing before it.
    await expect(page.getByTestId('setup-card')).toContainText(/logo/i)
    await page.getByTestId('setup-open').click()
    await expect(page.getByTestId('setup-step')).toContainText(/logo/i)
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
    await page.getByTestId('setup-logo-input').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(LOGO_SVG) })
    await expect(page.getByTestId('setup-logo-note')).toContainText('Saved')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    // The name.
    await page.getByTestId('setup-name').fill(agency.name)
    await page.getByTestId('setup-name-save').click()
    await expect(page.getByTestId('setup-name-saved')).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    // People: checked first and nothing saved, then imported; the three bad rows are listed with their lines.
    await page.getByTestId('setup-people-input').setInputFiles(csv('people.csv', peopleCsv(120, agency.slug)))
    await expect(page.getByTestId('import-summary')).toContainText('117')
    await expect(page.getByTestId('import-directory-note')).toContainText(/first people list/i)
    await expect(page.getByTestId('import-error')).toHaveCount(3)
    for (const b of BAD_ROWS) await expect(page.locator(`[data-testid="import-error"][data-line="${b.line}"]`)).toContainText(new RegExp(b.reason.split(' ')[0], 'i'))
    await page.getByRole('button', { name: 'Import 117 people' }).click()
    await expect(page.getByTestId('import-done')).toContainText('117')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    // Clients, then jobs.
    await page.getByTestId('setup-clients-input').setInputFiles(csv('clients.csv', CLIENTS_CSV))
    await expect(page.getByTestId('import-summary')).toContainText('8')
    await page.getByRole('button', { name: 'Import 8 clients' }).click()
    await expect(page.getByTestId('import-done')).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByTestId('setup-jobs-input').setInputFiles(csv('jobs.csv', JOBS_CSV))
    await expect(page.getByTestId('import-summary')).toContainText('30')
    await page.getByRole('button', { name: 'Import 30 jobs' }).click()
    await expect(page.getByTestId('import-done')).toBeVisible()
    await page.getByTestId('setup-finish').click()
    // Home: no more setup card, and the jobs are in the job index.
    await expect(page.getByTestId('home')).toBeVisible()
    await expect(page.getByTestId('setup-card')).toHaveCount(0)
    const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    const jobs = (await (await page.request.get(`/api/t/${tenant}/jobs`)).json()) as unknown[]
    expect(jobs).toHaveLength(30)
    // An imported person signs in to the right home (their role's): person1 is a creative director.
    const imported = await open(browser, size, 'white', { roster: true })
    await signIn(imported.page, { username: person(1) })
    await imported.page.goto('/')
    await expect(imported.page.getByTestId('home')).toBeVisible()
    await expect(imported.page.getByTestId('home-eyebrow')).toContainText(/creative director/i)
    await imported.ctx.close()
    await ctx.close()
  })

  test(t(40), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, { username: agency.first_admin })
    const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    const file = (text: string) => ({ multipart: { file: { name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(text) } } })
    // A bad row is listed with its line and reason, and nothing is written by the check.
    const dry = await page.request.post(`/api/t/${tenant}/setup/import/people?dry_run=1`, file(peopleCsv(120, agency.slug)))
    const result = (await dry.json()) as { ok: number; errors: { line: number; reason: string }[] }
    expect(result.ok).toBe(117)
    expect(result.errors.map(e => e.line)).toEqual(BAD_ROWS.map(b => b.line))
    expect(result.errors.every(e => e.reason.length > 0)).toBe(true)
    // The rest import (a run of test 39 in the same agency has already done it; the import is the same file again).
    const done = await page.request.post(`/api/t/${tenant}/setup/import/people`, file(peopleCsv(120, agency.slug)))
    expect(done.status()).toBe(200)
    const listed = (await (await page.request.get(`/api/t/${tenant}/agency/people`)).json()) as { username: string; email?: string }[]
    expect(listed.filter(p => p.username.endsWith(`@${agency.slug}`)).length).toBe(118)
    expect(listed.every(p => typeof p.email === 'string')).toBe(true) // an admin reads the emails
    // A role change takes effect on the person's next request, with no new sign-in.
    const who = await open(browser, size, 'white', { roster: true })
    await signIn(who.page, { username: person(1) })
    const doorsOf = async () => ((await (await who.page.request.get(`/api/t/${tenant}/doors`)).json()) as { doors: { name: string }[] }).doors.map(d => d.name)
    expect(await doorsOf()).not.toContain('Traffic board')
    const members = (await (await who.page.request.get(`/api/t/${tenant}/agency/people`)).json()) as { username: string; email?: string }[]
    expect(members.some(m => 'email' in m)).toBe(false) // a member never reads an email
    expect((await who.page.request.put(`/api/t/${tenant}/agency/people/${person(2)}`, { data: { roles: ['traffic'] } })).status()).toBe(403) // and cannot change anyone
    expect((await page.request.put(`/api/t/${tenant}/agency/people/${person(1)}`, { data: { roles: ['traffic'] } })).status()).toBe(200)
    expect(await doorsOf()).toContain('Traffic board')
    // A removed person is signed out on their next request.
    expect((await page.request.delete(`/api/t/${tenant}/agency/people/${person(1)}`)).status()).toBe(200)
    expect((await who.page.request.get(`/api/t/${tenant}/doors`)).status()).toBe(401)
    await who.ctx.close()
    // The last admin stays.
    expect((await page.request.delete(`/api/t/${tenant}/agency/people/${agency.first_admin}`)).status()).toBe(409)
    // A second agency's admin sees none of the first's people, and cannot name its tenant.
    await signIn(page, PEOPLE.otherAgencyAdmin)
    const other = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    const people = (await (await page.request.get(`/api/t/${other.tenant}/agency/people`)).json()) as { username: string }[]
    expect(people.filter(p => p.username.endsWith(`@${agency.slug}`))).toEqual([])
    expect((await page.request.get(`/api/t/${tenant}/agency/people`)).status()).toBe(403)
    expect((await page.request.put(`/api/t/${tenant}/agency/people/${person(3)}`, { data: { roles: ['traffic'] } })).status()).toBe(403)
    expect((await page.request.post(`/api/t/${tenant}/setup/import/people?dry_run=1`, file(peopleCsv(3, agency.slug)))).status()).toBe(403)
    await ctx.close()
  })
}
