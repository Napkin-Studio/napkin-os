// Phase 2 acceptance, record `script-editor` (features/script-editor.clan): tests 53 to 57 of docs/design/phase2-acceptance.md, run at 390
// and 1440 px. Tests 53, 54, 55 and 56 are live: the editor, the live check, tracked changes as human patches, versions and the undo, and the
// hand-offs (test 56 is counted by record `judge`, which built the scoring route: a draft goes to Judge and comes back with its score). Send to
// Radio, Send to Film with its beat ids and Send to Judge recording the version have their own live tests below. Test 57 stays `test.fixme`:
// it is the rewrite run, behind NAPKIN_SCRIPT_AI, which this stage does not build (the model part of the record).
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/, and nothing here calls it (tests 53 asserts that).
//
//   NAPKIN_E2E_SHOTS=docs/design/script-editor npm run e2e -- j001-p2-script-editor

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { barOffers, wideBeside } from './boothFolds'
import { asMe, PEOPLE, seedJ001 } from './seed/j001'
import { chainOf, control, middlewareLog, open, SIZES, sessionOf, signIn, type Size } from './pilot'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP, TV_SCRIPT } from './seed/j001/p2/script-editor.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short
const shots = process.env.NAPKIN_E2E_SHOTS

type Seeded = Awaited<ReturnType<typeof seedJ001>>

async function script(page: Page, job: Seeded, data: object, title: string) {
  const made = await page.request.post(`${job.api}/documents`, { data: { app_id: SCRIPT_EDITOR_APP, title, client_id: job.client, job: job.job } })
  expect(made.status(), 'the Script editor app is installed').toBe(200)
  const body = (await made.json()) as { token: string; path: string }
  expect((await page.request.post(`/s/${body.token}/patch-data`, { data: { patch: data, agent: 'j001-seed', action: `seed: ${title}` } })).status()).toBe(200)
  return body
}
const frameOf = (page: Page): FrameLocator => page.frameLocator('iframe').first()
/** The Booth: the margin of the script editor (shared/booth.html), where the check, tracked changes and the sends are. */
const boothOf = (page: Page) => frameOf(page).locator('#side')
/** The client's scripts, then the one whose title is given, open in the app's frame. */
const open1 = async (page: Page, job: Seeded, title = 'J001 radio script') => {
  await page.goto(`/#tool-${job.client}-script`); await page.reload()
  await page.getByTestId('work-item').filter({ hasText: title }).first().click()
  await expect(frameOf(page).locator('[data-where="script-editor"]')).toBeVisible()
}
const dataOf = async (page: Page, job: Seeded, path: string) => (await page.request.get(`${job.api}/d/${encodeURIComponent(path)}/entry/data`)).text()
async function shot(page: Page, name: string, size: Size) {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await page.waitForTimeout(400)
  // The roster agency wears a real agency's name: it is masked, never shown.
  await page.screenshot({ path: join(shots, `${name}-${size.tag}.png`), fullPage: size.width < 1000, mask: [page.getByTestId('agency-pill')], maskColor: '#C8CBFF' })
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test(t(53), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning (the job page's roles), then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    const before = (await middlewareLog(page)).length
    await open1(page, job)
    const app = frameOf(page)
    const booth = boothOf(page)
    await expect(booth.getByTestId('read-seconds')).toContainText(/\d+ s/) // read time in seconds, against the slot, in the Booth
    await expect(booth.getByTestId('read-time')).toContainText('of 30 s')
    const check = booth.getByTestId('check') // the live check, with no model call
    await expect(check).toContainText('Drink responsibly') // the mandatory line missing from the beats
    await expect(check.locator('[data-testid="mandatory"][data-state="missing"]')).toHaveCount(2)
    await expect(app.locator('[data-hints="b3"]')).toContainText('smooth') // a banned word, with its line
    await shot(page, 'script-radio', size)
    // Typing a mandatory line into the script turns it present, and the page never changes the words.
    await page.waitForTimeout(600) // the page's first reads of the host redraw the lines once; type after that
    const line = app.locator('textarea[data-id="b3"][data-field="text"]')
    await line.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }) // the caret at the end of the text, wrapped or not
    await line.pressSequentially(' Drink responsibly.')
    await expect(check.locator('[data-testid="mandatory"][data-state="present"]')).toHaveCount(1)
    await expect(line).toHaveValue(/Drink responsibly\.$/)
    expect((await middlewareLog(page)).length, 'the check called no model').toBe(before)
    await ctx.close()
  })

  test(t(54), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning (the job page's roles), then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const doc = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    // The creative director marks up two lines, each mark a human patch in their name.
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: doc.path, id: '' })
    for (const [beat, text] of [['b1', 'Tonight, pour the first one.'], ['b3', 'The first pour is easy.']]) {
      const r = await page.request.post(`/s/${cd.token}/script/propose`, { data: { beat, text, note: 'Shorter.' } })
      expect(r.status(), await r.text()).toBe(200)
    }
    // The writer accepts one change and rejects one, in the page; each answer is a human patch under the writer's name.
    await signIn(page, PEOPLE.copywriter)
    await open1(page, job)
    const app = frameOf(page)
    const booth = boothOf(page)
    await expect(booth.getByTestId('mark')).toHaveCount(2) // a colleague's tracked changes are in the Booth
    await expect(booth.getByTestId('mark').first()).toContainText('suggests')
    await expect(app.locator('#sheet').getByTestId('mark')).toHaveCount(0)
    await expect(booth.getByRole('button', { name: 'Accept' })).toHaveCount(2)
    await expect(booth.getByRole('button', { name: 'Reject' })).toHaveCount(2) // Accept and Reject; Keep mine is for an agent's proposal
    await expect(booth.getByRole('button', { name: 'Keep mine' })).toHaveCount(0)
    await shot(page, 'script-markup', size)
    await booth.getByRole('button', { name: 'Accept' }).first().click()
    await expect(booth.locator('[data-proposal][data-status="accepted"]')).toHaveCount(1)
    await booth.getByRole('button', { name: 'Reject' }).first().click()
    await expect(booth.locator('[data-proposal][data-status="rejected"]')).toHaveCount(1)
    await expect(app.locator('textarea[data-id="b1"][data-field="text"]')).toHaveValue('Tonight, pour the first one.')
    await expect(app.locator('textarea[data-id="b3"][data-field="text"]')).toHaveValue(RADIO_SCRIPT.script.beats[2].text)
    await expect(booth.getByTestId('mark-answer').first()).toContainText('Accepted by')
    const chain = await chainOf(page, (await asMe(page, job.api, { path: doc.path, id: '' })).token)
    const humans = chain.filter(d => d.agent === 'human')
    const marks = humans.filter(d => /^mark up beat/.test(d.action ?? ''))
    const answers = humans.filter(d => /^(accept|reject) proposal/.test(d.action ?? ''))
    expect(marks).toHaveLength(2)
    expect(answers).toHaveLength(2)
    for (const d of marks) expect(d.actor, 'a mark-up is the creative director\'s').toBe(`human:${PEOPLE.creativeDirector.username}`)
    for (const d of answers) expect(d.actor, 'an answer is the writer\'s').toBe(`human:${PEOPLE.copywriter.username}`)
    expect(answers.map(d => d.action?.split(' ')[0]).sort()).toEqual(['accept', 'reject'])
    expect(chain.filter(d => /process:|handler/.test(d.actor ?? '') && /proposal|mark up/.test(d.action ?? '')), 'nothing by a handler').toHaveLength(0)
    await ctx.close()
  })

  test(t(55), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning (the job page's roles), then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const doc = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    const post = (path: string, data: object) => page.request.post(`/s/${doc.token}/${path}`, { data })
    const edit = (text: string) => post('patch-data', { patch: { script: { beats: RADIO_SCRIPT.script.beats.map(b => (b.id === 'b1' ? { ...b, text } : b)) } }, agent: 'human', action: 'edit a line' })
    // Two approved versions: v1 says the first line one way, v2 another.
    expect((await post('approve', { rationale: 'Approved version 1.' })).status()).toBe(200)
    expect((await post('unapprove', { rationale: 'Starting version 2.' })).status()).toBe(200)
    expect((await edit('A second version.')).status()).toBe(200)
    expect((await post('approve', { rationale: 'Approved version 2.' })).status()).toBe(200)
    // An approved version is locked: a write is refused, and the page says so.
    expect((await edit('After approval.')).status()).toBe(409)
    await open1(page, job)
    const app = frameOf(page)
    await expect(boothOf(page).getByTestId('locked-stamp')).toContainText('version 2')
    await expect(app.locator('textarea[data-id="b1"][data-field="text"]')).toHaveAttribute('readonly', '')
    await shot(page, 'script-locked', size)
    // Start a new version and restore v1: a new edit, and v2 stays.
    await boothOf(page).locator('#newv').click()
    await expect(boothOf(page).locator('#stamp')).toHaveCount(0)
    // Versions live in the Booth (features/align-booth.clan): the whole script's Versions fold.
    await boothOf(page).getByTestId('versions-fold').locator('summary').click()
    await expect(boothOf(page).getByTestId('version-row')).toHaveCount(3) // the draft, v2, v1
    // Two compared side by side: the Booth widens to 744 px beside the script, never over it.
    await boothOf(page).locator('[data-testid="version-row"][data-version="1"]').getByRole('button', { name: 'Compare' }).click()
    await boothOf(page).locator('[data-testid="version-row"][data-version="2"]').getByRole('button', { name: 'Compare' }).click()
    await expect(boothOf(page).getByTestId('version-compare')).toContainText('A second version.')
    if (size.width >= 1440) await wideBeside(app, '#sheet')
    await shot(page, 'script-versions-compare', size)
    await boothOf(page).getByRole('button', { name: 'Close the compare' }).click()
    await boothOf(page).locator('[data-testid="version-row"][data-version="1"]').getByRole('button', { name: 'Restore' }).click()
    await expect(app.locator('textarea[data-id="b1"][data-field="text"]')).toHaveValue(RADIO_SCRIPT.script.beats[0].text)
    await expect(boothOf(page).locator('[data-testid="version-row"][data-version="2"]')).toBeVisible()
    await expect(boothOf(page).getByTestId('version-row')).toHaveCount(3)
    await expect(boothOf(page).getByTestId('version-row').first()).toContainText('Restored from v1') // the page has read the restore back
    await shot(page, 'script-versions', size)
    // At desktop width Cmd Z undoes the last edit and it can be brought back.
    if (size.width >= 1024) {
      const line = app.locator('textarea[data-id="b1"][data-field="text"]')
      await line.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
      await line.pressSequentially(' more')
      await expect.poll(async () => (await dataOf(page, job, doc.path)).includes('Tonight, try something new. more')).toBe(true)
      await expect.poll(() => barOffers(page, 'Undo')).toBe(true)
      await page.keyboard.press('ControlOrMeta+z')
      await expect(line).not.toHaveValue(/more/)
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(line).toHaveValue(/more$/)
    }
    await ctx.close()
  })

  // Test 56: record `judge` turned on the scoring route and its score card. Radio and Film, and Judge's record of the version, are below.
  test(t(56), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning (the job page's roles), then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await control(page, { variant: { judge_work: 'score24' } })
    await open1(page, job)
    await boothOf(page).getByRole('button', { name: 'Send to Judge' }).click()
    await expect(boothOf(page).getByTestId('judge-score')).toContainText('24')
    await expect(boothOf(page).getByTestId('score-card')).toContainText('24') // Judge's score card, in the Booth's Judge fold
    await ctx.close()
  })

  test(`script editor: Send to Radio records this version and says what happens, ${size.tag} px`, async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning (the job page's roles), then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const radio = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await open1(page, job)
    await boothOf(page).getByRole('button', { name: 'Send to Radio' }).click()
    await expect(boothOf(page).getByTestId('send-line')).toHaveText('Radio comes in Phase 3. This script, version 1, is waiting for it.')
    const data = await dataOf(page, job, radio.path)
    expect(data).toMatch(/handoffs:\s+radio:/)
    expect(data).toMatch(/content_hash: [0-9a-f]{64}/)
    expect((await chainOf(page, radio.token)).some(d => d.action === 'send version 1 to Radio' && d.actor === `human:${PEOPLE.copywriter.username}`)).toBe(true)
    await shot(page, 'script-sent-radio', size)
    // Judge: the draft is recorded, scored by the fixture backend, and the page says so. No dead button.
    await control(page, { variant: { judge_work: 'score24' } })
    await boothOf(page).getByRole('button', { name: 'Send to Judge' }).click()
    await expect(boothOf(page).getByTestId('send-line')).toHaveText('Judge scored version 1: 24 of 30. The card is above the page.')
    await ctx.close()
  })

  test(`script editor: Send to Film opens Advertising Studio with the same beat ids, ${size.tag} px`, async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning (the job page's roles), then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    await script(page, job, TV_SCRIPT, 'J001 TV script')
    await open1(page, job, 'J001 TV script')
    const app = frameOf(page)
    await expect(app.locator('.beat.tv')).toHaveCount(3)
    await shot(page, 'script-tv', size)
    await boothOf(page).getByRole('button', { name: 'Send to Film' }).click()
    // The shell opens the new Film document.
    await expect.poll(async () => {
      const listing = (await (await page.request.get(`${job.api}/library`)).json()) as { items: { path: string; app_id: string | null }[] }
      return listing.items.some(i => i.app_id === 'ie.napkin.film')
    }, { timeout: 30_000 }).toBe(true)
    const listing = (await (await page.request.get(`${job.api}/library`)).json()) as { items: { path: string; app_id: string | null }[] }
    const film = listing.items.find(i => i.app_id === 'ie.napkin.film')!
    const data = await dataOf(page, job, film.path)
    for (const id of ['b1', 'b2', 'b3']) expect(data, `Film keeps beat ${id}`).toContain(`id: ${id}`)
    expect(data).toContain('A bar, late. The door half shut.')
    await ctx.close()
  })

  // The Booth (features/align-booth.clan, stage 2): the margin is the shared Booth, as Brief Maker's is.
  test(`script editor: the Booth is the margin and never overlaps the page, ${size.tag} px`, async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await open1(page, job)
    const app = frameOf(page), booth = boothOf(page)
    const apart = async () => {
      const a = (await app.locator('#sheet').boundingBox())!, b = (await booth.boundingBox())!
      expect(a && b, 'both are on screen').toBeTruthy()
      return a.x + a.width <= b.x + 1 || a.y + a.height <= b.y + 1 // beside it, or under it in the one column
    }
    await expect(booth.locator('.booth-nm')).toHaveText('Booth')
    // On a phone each primary button the shell draws is 44 px tall (suite test 72's rule): the Booth holds the primary action, the bar's copy is not marked primary.
    if (size.width === 390) for (const b of await page.locator('.ch-btn-primary, .ns-primary, [data-primary]').all()) if (await b.isVisible()) expect((await b.boundingBox())!.height, await b.innerText()).toBeGreaterThanOrEqual(43.5)
    await expect(booth.getByTestId('check')).toBeVisible()
    await expect(booth.getByTestId('sends')).toBeVisible()
    expect(await apart(), 'the Booth does not lie over the page').toBe(true)
    if (size.width < 1100) {
      // one column: the Booth follows the page, and cannot be hidden
      await expect(booth.locator('.booth-hide')).toBeHidden()
      await expect(app.locator('#boothEdge')).toBeHidden()
      const a = (await app.locator('#sheet').boundingBox())!, b = (await booth.boundingBox())!
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1)
      await shot(page, 'script-booth-whole', size)
      await app.locator('textarea[data-id="b3"][data-field="text"]').click()
      await expect(booth.getByTestId('crumb')).toContainText('Line 3')
      await shot(page, 'script-booth-part', size)
      await ctx.close(); return
    }
    await shot(page, 'script-booth-whole', size)
    await page.setViewportSize({ width: 1100, height: size.height })
    expect(await apart(), 'nor at 1100 px').toBe(true)
    await expect(booth.locator('.booth-hide')).toBeHidden() // nothing hides at 1100 and below
    await page.setViewportSize({ width: size.width, height: size.height })
    // a click on a line selects it: the Booth shows that line
    await app.locator('textarea[data-id="b3"][data-field="text"]').click()
    await expect(booth.getByTestId('crumb')).toContainText('Line 3')
    await shot(page, 'script-booth-part', size)
    // Hide: the page recentres, and the edge tab (38 px, BOOTH written down it) is the way back
    await booth.locator('.booth-hide').click()
    const edge = app.locator('#boothEdge')
    await expect(edge).toBeVisible()
    await expect(booth).toBeHidden()
    const w = (await edge.boundingBox())!
    expect(Math.round(w.width)).toBe(38)
    await expect(app.locator('.booth-lb')).toHaveText('Booth')
    const sheet = (await app.locator('#sheet').boundingBox())!, frame = (await page.locator('iframe').first().boundingBox())!
    expect(Math.abs(sheet.x + sheet.width / 2 - (frame.x + frame.width / 2)), 'the page recentres alone').toBeLessThan(40)
    await shot(page, 'script-booth-hidden', size)
    // ] brings it back; ] again hides it; no shortcut is written anywhere
    await app.locator('#sheet .title').click()
    await page.keyboard.press(']')
    await expect(booth).toBeVisible()
    await expect.poll(apart, { message: 'the Booth comes in beside the page, never over it' }).toBe(true)
    await page.keyboard.press(']')
    await expect(booth).toBeHidden()
    expect(await booth.locator('.booth-hd').evaluate(el => el.textContent), 'no hint of the key').not.toContain(']')
    // a click on a line while it is hidden brings the whole Booth back on that line
    await app.locator('[data-beat="b1"]').click({ position: { x: 20, y: 10 } })
    await expect(booth).toBeVisible()
    await expect(booth.getByTestId('crumb')).toContainText('Line 1')
    await expect.poll(apart).toBe(true)
    // the shell remembers the choice across a reload
    await booth.locator('.booth-hide').click()
    await expect(edge).toBeVisible()
    await page.reload()
    await expect(frameOf(page).locator('[data-where="script-editor"]')).toBeVisible()
    await expect(frameOf(page).locator('#boothEdge')).toBeVisible()
    await ctx.close()
  })

  // Test 57 is the rewrite run, behind NAPKIN_SCRIPT_AI. Not built at this stage: the editor has no Rewrite button and the host has no task.
  test.fixme(t(57), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning (the job page's roles), then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const doc = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await open1(page, job)
    const quotaBefore = (await sessionOf(page)).quota.used
    const chainBefore = (await chainOf(page, doc.token)).length
    const app = frameOf(page)
    await app.locator('textarea[data-id="b1"][data-field="text"]').click()
    await control(page, { fail: 'rewrite_line' }) // a rewrite run fails
    await app.getByRole('button', { name: 'Rewrite' }).click() // ADJUST(script-editor, model stage): the margin's button
    const failed = page.locator('[data-state="run-failed"]')
    await expect(failed).toBeVisible()
    expect((await failed.locator('.ns-line').allInnerTexts()).filter(Boolean)).toHaveLength(1) // one plain line
    expect((await sessionOf(page)).quota.used, 'the credits come back').toBe(quotaBefore)
    await expect(app.locator('textarea[data-id="b1"][data-field="text"]')).toHaveValue('Tonight, try something new.')
    expect((await chainOf(page, doc.token)).length).toBe(chainBefore)
    await ctx.close()
  })
}
