// Phase 2 acceptance, record `script-editor` (features/script-editor.clan): tests 53 to 57 of docs/design/phase2-acceptance.md, run at 390
// and 1440 px. Tests 53, 54 and 55 are live: the editor, the live check, tracked changes as human patches, versions and the undo. Test 56 stays
// `test.fixme` for one reason: its Judge half (a draft goes to Judge and comes back with its score) needs the scoring route of record `judge`,
// which is not on this branch. What of it is built (Send to Radio, Send to Film with its beat ids, Send to Judge recording the version and saying
// Judge is not open yet) has its own live tests below, titled apart so the counter does not count them as test 56. Test 57 stays `test.fixme`:
// it is the rewrite run, behind NAPKIN_SCRIPT_AI, which this stage does not build (the model part of the record).
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/, and nothing here calls it (tests 53 asserts that).
//
//   NAPKIN_E2E_SHOTS=docs/design/script-editor npm run e2e -- j001-p2-script-editor

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
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
  await page.screenshot({ path: join(shots, `${name}-${size.tag}.png`), fullPage: size.width < 1000 })
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test(t(53), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    const before = (await middlewareLog(page)).length
    await open1(page, job)
    const app = frameOf(page)
    await expect(app.getByTestId('read-seconds')).toContainText(/\d+ s/) // read time in seconds, against the slot
    await expect(app.getByTestId('read-time')).toContainText('of 30 s')
    const check = app.getByTestId('check') // the live check, with no model call
    await expect(check).toContainText('Drink responsibly') // the mandatory line missing from the beats
    await expect(check.locator('[data-testid="mandatory"][data-state="missing"]')).toHaveCount(2)
    await expect(app.locator('[data-hints="b3"]')).toContainText('smooth') // a banned word, with its line
    await shot(page, 'script-radio', size)
    // Typing a mandatory line into the script turns it present, and the page never changes the words.
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
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
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
    await expect(app.getByTestId('mark')).toHaveCount(2)
    await expect(app.getByTestId('mark').first()).toContainText('suggests')
    await shot(page, 'script-markup', size)
    await app.locator('[data-accept]').first().click()
    await expect(app.locator('[data-proposal][data-status="accepted"]')).toHaveCount(1)
    await app.locator('[data-reject]').first().click()
    await expect(app.locator('[data-proposal][data-status="rejected"]')).toHaveCount(1)
    await expect(app.locator('textarea[data-id="b1"][data-field="text"]')).toHaveValue('Tonight, pour the first one.')
    await expect(app.locator('textarea[data-id="b3"][data-field="text"]')).toHaveValue(RADIO_SCRIPT.script.beats[2].text)
    await expect(app.getByTestId('mark-answer').first()).toContainText('Accepted by')
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
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
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
    await expect(app.getByTestId('locked-stamp')).toContainText('version 2')
    await expect(app.locator('textarea[data-id="b1"][data-field="text"]')).toHaveAttribute('readonly', '')
    await shot(page, 'script-locked', size)
    // Start a new version and restore v1: a new edit, and v2 stays.
    await app.locator('#newv').click()
    await expect(app.locator('#stamp')).toHaveCount(0)
    await page.getByRole('button', { name: 'Version history' }).click()
    await expect(page.getByTestId('version-row')).toHaveCount(3) // the draft, v2, v1
    await page.locator('[data-testid="version-row"][data-version="1"]').getByRole('button', { name: 'Restore' }).click()
    await expect(app.locator('textarea[data-id="b1"][data-field="text"]')).toHaveValue(RADIO_SCRIPT.script.beats[0].text)
    await expect(page.locator('[data-testid="version-row"][data-version="2"]')).toBeVisible()
    await expect(page.getByTestId('version-row')).toHaveCount(3)
    await shot(page, 'script-versions', size)
    // At desktop width Cmd Z undoes the last edit and it can be brought back.
    if (size.width >= 1024) {
      const line = app.locator('textarea[data-id="b1"][data-field="text"]')
      await line.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
      await line.pressSequentially(' more')
      await expect.poll(async () => (await dataOf(page, job, doc.path)).includes('Tonight, try something new. more')).toBe(true)
      await expect(page.getByTestId('undo')).toBeEnabled()
      await page.keyboard.press('ControlOrMeta+z')
      await expect(line).not.toHaveValue(/more/)
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(line).toHaveValue(/more$/)
    }
    await ctx.close()
  })

  // Test 56 waits on record `judge`: the scoring route and its score card. Radio and Film, and Judge's record of the version, are below.
  test.fixme(t(56), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await control(page, { variant: { judge_work: 'score24' } })
    await open1(page, job)
    const app = frameOf(page)
    await app.getByRole('button', { name: 'Send to Judge' }).click()
    await expect(app.getByTestId('judge-score')).toContainText('24') // ADJUST(judge): the shared score card the Judge record builds
    await ctx.close()
  })

  test(`script editor: Send to Radio records this version and says what happens, ${size.tag} px`, async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const radio = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await open1(page, job)
    const app = frameOf(page)
    await app.getByRole('button', { name: 'Send to Radio' }).click()
    await expect(app.getByTestId('send-line')).toHaveText('Radio comes in Phase 3. This script, version 1, is waiting for it.')
    const data = await dataOf(page, job, radio.path)
    expect(data).toMatch(/handoffs:\s+radio:/)
    expect(data).toMatch(/content_hash: [0-9a-f]{64}/)
    expect((await chainOf(page, radio.token)).some(d => d.action === 'send version 1 to Radio' && d.actor === `human:${PEOPLE.copywriter.username}`)).toBe(true)
    await shot(page, 'script-sent-radio', size)
    // Judge: the draft is recorded and the page says plainly that Judge is not open yet. No dead button.
    await app.getByRole('button', { name: 'Send to Judge' }).click()
    await expect(app.getByTestId('send-line')).toHaveText('Judge is not open yet. This script, version 1, is ready for it.')
    await ctx.close()
  })

  test(`script editor: Send to Film opens Advertising Studio with the same beat ids, ${size.tag} px`, async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await script(page, job, TV_SCRIPT, 'J001 TV script')
    await open1(page, job, 'J001 TV script')
    const app = frameOf(page)
    await expect(app.locator('.beat.tv')).toHaveCount(3)
    await shot(page, 'script-tv', size)
    await app.getByRole('button', { name: 'Send to Film' }).click()
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

  // Test 57 is the rewrite run, behind NAPKIN_SCRIPT_AI. Not built at this stage: the editor has no Rewrite button and the host has no task.
  test.fixme(t(57), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
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
