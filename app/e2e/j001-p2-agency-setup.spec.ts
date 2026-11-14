// Phase 2 acceptance, record `agency-setup` (features/j001-phase2-suite.clan): tests 39 and 40 of docs/design/phase2-acceptance.md, run at 390 and 1440 px,
// rewritten for the one People screen of features/align-needs-lock-people.clan (stage 4): the People page, the dialog from the account menu.
// Test 39: the Napkin admin adds the agency on the People page with its look and logo; its admin imports 120 people from the fixture file with their
// roles (seed/j001/p2/agency-setup.mjs), the bad rows listed by line; adds two clients on the desk; an imported person signs in and sees their role's
// pages row. Test 40 reads the facts through the People page's routes: a bad row listed by line with its reason and the rest imported, a role change
// on the person's very next request, and the wall between two agencies.
// Each width has its own agency (cr at 390, cs at 1440), so each run starts from nothing. No model and no paid provider.

import { expect, test, type Page } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { AGENCIES, BAD_ROWS, LOGO_SVG, peopleCsv } from './seed/j001/p2/agency-setup.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

/** The People page, from the account menu. */
async function openPeople(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('desk')).toBeVisible()
  await page.getByTestId('account-button').click()
  await page.getByRole('menuitem', { name: /^People/ }).click()
  await expect(page.getByTestId('people-page')).toBeVisible()
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`
  const agency = AGENCIES[size.tag as '390' | '1440']
  const csv = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })
  const person = (i: number) => `person${i}@${agency.slug}`

  test(t(39), async ({ browser }) => {
    test.setTimeout(180_000)
    // The Napkin admin adds the agency on the People page: its name, its two colours and its logo, then Publish.
    const napkin = await open(browser, size, 'white', { roster: true })
    await signIn(napkin.page, PEOPLE.peopleAdmin)
    await openPeople(napkin.page)
    await napkin.page.getByRole('tab', { name: /^Agencies/ }).click()
    await napkin.page.getByRole('button', { name: 'New agency', exact: true }).click()
    await napkin.page.locator('#ag-name').fill(agency.name)
    await napkin.page.locator('#ag-base').fill('#0F6B5C')
    await napkin.page.locator('#ag-accent').fill('#9FE6D8')
    await napkin.page.getByLabel('Wordmark SVG file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(LOGO_SVG) })
    await napkin.page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect.poll(async () => {
      const rows = (await (await napkin.page.request.get('/api/admin/agencies')).json()) as { id: string; published?: boolean; wordmark?: string | null }[]
      const row = rows.find(r => r.id === agency.slug)
      return !!row?.published && !!row?.wordmark
    }, { timeout: 15_000 }).toBe(true)
    await napkin.ctx.close()

    // Its admin imports the people: checked first and nothing saved, the three bad rows listed by line, then the 117 imported.
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, { username: agency.first_admin })
    await openPeople(page)
    await expect(page.getByRole('tab', { name: /^Agencies/ })).toHaveCount(0) // an agency's admin manages their own people
    await page.getByTestId('people-import-open').click()
    await page.getByTestId('people-import-input').setInputFiles(csv('people.csv', peopleCsv(120, agency.slug)))
    await expect(page.getByTestId('import-summary')).toContainText('117')
    await expect(page.getByTestId('import-first-list')).toContainText(/first people list/i)
    await expect(page.getByTestId('import-error')).toHaveCount(3)
    for (const b of BAD_ROWS) await expect(page.locator(`[data-testid="import-error"][data-line="${b.line}"]`)).toContainText(new RegExp(b.reason.split(' ')[0], 'i'))
    await page.getByRole('button', { name: 'Import 117 people' }).click()
    await expect(page.getByTestId('import-done')).toContainText('117')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    // the list shows them with their roles: person1 is a creative director
    const row = page.getByTestId('people-list').locator('tr', { hasText: person(1) })
    await expect(row.getByTestId('person-roles')).toContainText('Creative director')
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    // Two clients on the desk.
    await page.goto('/')
    for (const name of ['Client C1', 'Client C2']) {
      await page.getByTestId('add-client').click()
      await page.getByLabel('Client name').fill(name)
      await page.getByRole('button', { name: 'Add client', exact: true }).click()
    }
    await expect(page.getByTestId('client-circle')).toHaveCount(2)
    await ctx.close()

    // An imported person signs in to their role's pages row: person1 is a creative director.
    const imported = await open(browser, size, 'white', { roster: true })
    await signIn(imported.page, { username: person(1) })
    await imported.page.goto('/')
    await expect(imported.page.getByTestId('desk')).toBeVisible()
    await expect(imported.page.getByTestId('page-door').first()).toHaveText('Ready for review')
    await imported.ctx.close()
  })

  test(t(40), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, { username: agency.first_admin })
    const file = (text: string) => ({ multipart: { file: { name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(text) } } })
    // A bad row is listed with its line and reason, and nothing is written by the check.
    const dry = await page.request.post('/api/admin/people/import?dry_run=1', file(peopleCsv(120, agency.slug)))
    const result = (await dry.json()) as { ok: number; errors: { line: number; reason: string }[] }
    expect(result.ok).toBe(117)
    expect(result.errors.map(e => e.line)).toEqual(BAD_ROWS.map(b => b.line))
    expect(result.errors.every(e => e.reason.length > 0)).toBe(true)
    // The rest import (a run of test 39 in the same agency has already done it; the import is the same file again).
    const done = await page.request.post('/api/admin/people/import', file(peopleCsv(120, agency.slug)))
    expect(done.status()).toBe(200)
    const listed = ((await (await page.request.get('/api/admin/people')).json()) as { people: { id: string; email?: string; removed_at?: string }[] }).people
    expect(listed.filter(p => p.id.endsWith(`@${agency.slug}`) && !p.removed_at).length).toBe(118)
    expect(listed.filter(p => p.id.startsWith('person')).every(p => typeof p.email === 'string')).toBe(true) // an admin reads the emails
    // A role change takes effect on the next request, with no new sign-in.
    const who = await open(browser, size, 'white', { roster: true })
    await signIn(who.page, { username: person(1) })
    const { tenant: theirs } = (await (await who.page.request.get('/api/session')).json()) as { tenant: string }
    const doorsOf = async () => ((await (await who.page.request.get(`/api/t/${theirs}/doors`)).json()) as { pages: { name: string }[] }).pages.map(d => d.name)
    expect(await doorsOf()).not.toContain('Traffic board')
    expect((await who.page.request.get('/api/admin/people')).status()).toBe(403) // a member never reads the list, nor an email
    expect((await who.page.request.put(`/api/admin/people/${person(2)}/roles`, { data: { roles: ['traffic'] } })).status()).toBe(403) // and cannot change anyone
    expect((await page.request.put(`/api/admin/people/${person(1)}/roles`, { data: { roles: ['traffic'] } })).status()).toBe(200)
    expect(await doorsOf()).toContain('Traffic board')
    // A removed person is signed out on their next request.
    expect((await page.request.delete(`/api/admin/people/${person(1)}`)).status()).toBe(200)
    expect((await who.page.request.get(`/api/t/${theirs}/doors`)).status()).toBe(401)
    await who.ctx.close()
    // The change is in the audit view, attributed to the admin, and the log's chain holds.
    const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    const view = (await (await page.request.get(`/api/t/${tenant}/audit?kind=permission`)).json()) as { lines: { who: string; what: string }[] }
    expect(view.lines.some(l => l.who === agency.first_admin && /traffic/.test(l.what))).toBe(true)
    expect((await page.request.get(`/api/t/${tenant}/audit/verify`)).status()).toBe(200)
    // The last admin stays.
    expect((await page.request.delete(`/api/admin/people/${agency.first_admin}`)).status()).toBe(409)
    // A second agency's admin sees none of the first's people, cannot name its tenant, and cannot reach its people.
    await signIn(page, PEOPLE.otherAgencyAdmin)
    const people = ((await (await page.request.get('/api/admin/people')).json()) as { people: { id: string }[] }).people
    expect(people.filter(p => p.id.endsWith(`@${agency.slug}`))).toEqual([])
    expect((await page.request.get(`/api/t/${tenant}/audit`)).status()).toBe(403)
    expect((await page.request.put(`/api/admin/people/${person(3)}/roles`, { data: { roles: ['traffic'] } })).status()).toBe(404)
    const own = (await (await page.request.post('/api/admin/people/import?dry_run=1', file(peopleCsv(3, agency.slug)))).json()) as { results: { label: string; status: string }[] }
    expect(own.results.filter(r => r.status !== 'error').every(r => r.label.endsWith('@bq'))).toBe(true) // into their own agency, never the other
    await ctx.close()
  })
}
