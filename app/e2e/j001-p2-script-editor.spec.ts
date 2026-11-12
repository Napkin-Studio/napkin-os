// Phase 2 acceptance, record `script-editor` (features/j001-phase2-suite.clan): tests 53 to 57 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(script-editor) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test, type Page } from '@playwright/test'
import { asMe, PEOPLE, seedJ001 } from './seed/j001'
import { chainOf, control, middlewareLog, open, SIZES, sessionOf, signIn } from './pilot'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP, TV_SCRIPT } from './seed/j001/p2/script-editor.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Seeded = Awaited<ReturnType<typeof seedJ001>>

async function script(page: Page, job: Seeded, data: object, title: string) {
  const made = await page.request.post(`${job.api}/documents`, { data: { app_id: SCRIPT_EDITOR_APP, title, client_id: job.client, job: job.job } })
  expect(made.status(), 'the Script editor app is installed').toBe(200)
  const body = (await made.json()) as { token: string; path: string }
  expect((await page.request.post(`/s/${body.token}/patch-data`, { data: { patch: data, agent: 'j001-seed', action: `seed: ${title}` } })).status()).toBe(200)
  return body
}
const open1 = async (page: Page, job: Seeded) => { await page.goto(`/#tool-${job.client}-script-editor`); await page.reload(); await page.getByTestId('work-item').first().click() } // ADJUST(script-editor)

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(53), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    const before = (await middlewareLog(page)).length
    await open1(page, job)
    await expect(page.getByTestId('read-time')).toContainText(/\d+ s/) // read time in seconds
    const check = page.getByTestId('live-check') // the live check, with no model call
    await expect(check).toContainText('Drink responsibly') // the mandatory line missing from the beats
    await expect(check).toContainText('smooth') // a banned word
    expect((await middlewareLog(page)).length).toBe(before)
    await ctx.close()
  })

  test.fixme(t(54), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await script(page, job, { ...RADIO_SCRIPT, script: { ...RADIO_SCRIPT.script, proposals: [] } }, 'J001 radio script')
    // The creative director marks up two lines, each mark a human patch in their name.
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: doc.path, id: '' })
    for (const [i, text] of ['Tonight, pour the first one.', 'A bar goes quiet for a song.'].entries()) {
      const mark = { script: { proposals: [{ id: `prop_${i}`, beat: `beat_${i + 1}`, text, kind: 'markup', note: 'Shorter.', by: 'dara@wk', at: '2026-11-12T11:00:00Z', status: 'open' }] } }
      expect((await page.request.post(`/s/${cd.token}/patch-data`, { data: { patch: mark, agent: 'human', action: 'mark up the script' } })).status()).toBe(200)
    }
    // The writer accepts one change and rejects one, each answer a human patch under the writer's name.
    await signIn(page, PEOPLE.copywriter)
    await open1(page, job)
    await page.getByTestId('proposal').first().getByRole('button', { name: 'Accept' }).click() // ADJUST(script-editor)
    await page.getByTestId('proposal').last().getByRole('button', { name: 'Reject' }).click()
    const chain = await chainOf(page, (await asMe(page, job.api, { path: doc.path, id: '' })).token)
    const humans = chain.filter(d => d.agent === 'human')
    expect(humans.filter(d => d.action === 'mark up the script')).toHaveLength(2)
    expect(humans.filter(d => /accept|reject/.test(d.action ?? ''))).toHaveLength(2)
    for (const d of humans) expect(d.actor ?? '').toMatch(/@wk$/) // a human patch names its person (the chain's `actor`)
    await ctx.close()
  })

  test.fixme(t(55), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    const edit = (text: string) => page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: { script: { beats: [{ id: 'beat_1', text }] } }, agent: 'human', action: 'edit a line' } })
    await edit('A second version.')
    await open1(page, job)
    // Restore v1 makes a new version and v2 stays.
    await page.getByRole('button', { name: 'Versions' }).click() // ADJUST(script-editor): as the Brief's versions panel (brief-versions-undo)
    await page.getByTestId('version-row').last().getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByTestId('version-row')).toHaveCount(3)
    // An approved version is locked.
    expect((await page.request.post(`/s/${doc.token}/approve`, { data: { rationale: 'Approved.' } })).status()).toBe(200)
    expect((await edit('After approval.')).status()).toBe(200) // an edit after approval makes a new version; the approved one is unchanged
    // At desktop width Cmd Z undoes the last edit and it can be brought back.
    if (size.width >= 1024) {
      const line = page.getByTestId('beat-text').first()
      await line.click(); await page.keyboard.type(' more')
      await page.keyboard.press('Meta+z')
      await expect(line).not.toContainText('more')
      await page.keyboard.press('Meta+Shift+z')
      await expect(line).toContainText('more')
    }
    await ctx.close()
  })

  test.fixme(t(56), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const radio = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await script(page, job, TV_SCRIPT, 'J001 TV script')
    await control(page, { variant: { judge_work: 'score24' } })
    await open1(page, job)
    // One click each: Radio, Film (with its beat ids) and Judge (and back with its score).
    await page.getByRole('button', { name: 'Send to Radio' }).click() // ADJUST(script-editor)
    await expect(page.getByTestId('sent-to-radio')).toBeVisible()
    await page.getByRole('button', { name: 'Send to Film' }).click()
    await expect(page.getByTestId('sent-to-film')).toContainText('beat_1')
    await page.getByRole('button', { name: 'Send to Judge' }).click()
    await expect(page.getByTestId('judge-score')).toContainText('24')
    expect((await chainOf(page, radio.token)).some(d => /radio|film|judge/i.test(d.action ?? ''))).toBe(true)
    await ctx.close()
  })

  test.fixme(t(57), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await script(page, job, RADIO_SCRIPT, 'J001 radio script')
    await open1(page, job)
    const quotaBefore = (await sessionOf(page)).quota.used
    const chainBefore = (await chainOf(page, doc.token)).length
    await page.getByTestId('beat-text').first().click()
    await control(page, { fail: 'rewrite_line' }) // a rewrite run fails
    await page.getByRole('button', { name: 'Rewrite' }).click()
    const failed = page.locator('[data-state="run-failed"]')
    await expect(failed).toBeVisible()
    expect((await failed.locator('.ns-line').allInnerTexts()).filter(Boolean)).toHaveLength(1) // one plain line
    expect((await sessionOf(page)).quota.used, 'the credits come back').toBe(quotaBefore)
    // The selection and the page are as they were, and nothing reached the page without Keep.
    await expect(page.getByTestId('beat-text').first()).toContainText('Tonight, try something new.')
    expect((await chainOf(page, doc.token)).length).toBe(chainBefore)
    await ctx.close()
  })
}
