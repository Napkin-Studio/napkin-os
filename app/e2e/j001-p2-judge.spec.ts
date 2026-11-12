// Phase 2 acceptance, record `judge` (features/j001-phase2-suite.clan): tests 58 to 64 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(judge) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.
//
// Judge (features/judge.clan): the verdict is a decision in the file (kind verdict, agent judge, handler judge_work@1) carrying a judge block
// {total, sub{idea, craft, effect}, tests[{id, evidence, reason_code}], advised_route, trust, brief_version}. The fixture answers are
// answers/judge_work*.json, picked with control({ variant: { judge_work: '<name>' } }). ADJUST(judge): the route that scores a piece
// (here POST /s/{token}/judge {target}) and the telemetry route are the record's.

import { expect, test, type Page } from '@playwright/test'
import { asMe, lockBrief, PEOPLE, seedJ001, signBrief } from './seed/j001'
import { chainOf, control, middlewareLog, open, SIZES, sessionOf, signIn, type Decision } from './pilot'
import { CANARY_SENTENCE } from './seed/j001/p2/wall.mjs'
import { OVERRULE_REASON } from './seed/j001/p2/judge.mjs'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP } from './seed/j001/p2/script-editor.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Seeded = Awaited<ReturnType<typeof seedJ001>>
type Verdict = Decision & { reason_code?: string; rationale?: string; judge?: { total: number; sub: { idea: number }; tests: { id: string; evidence: string; reason_code?: string }[]; advised_route: string; brief_version?: string; trust?: string }; handler?: string }

/** A script to score, made as the signed-in person. */
async function piece(page: Page, job: Seeded, data: object = RADIO_SCRIPT) {
  const made = await page.request.post(`${job.api}/documents`, { data: { app_id: SCRIPT_EDITOR_APP, title: 'J001 radio script', client_id: job.client, job: job.job } })
  expect(made.status(), 'the Script editor app is installed').toBe(200)
  const body = (await made.json()) as { token: string; path: string }
  await page.request.post(`/s/${body.token}/patch-data`, { data: { patch: data, agent: 'j001-seed', action: 'seed: radio script' } })
  return body
}
const score = (page: Page, token: string) => page.request.post(`/s/${token}/judge`, { data: { target: 'script' } })
const verdicts = async (page: Page, token: string) => (await chainOf(page, token)).filter(d => d.kind === 'verdict') as Verdict[]

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(58), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score22-idea7' } })
    expect((await score(page, doc.token)).status()).toBe(200)
    const [v] = await verdicts(page, doc.token)
    expect(v.judge?.total).toBe(22)
    expect(v.judge?.sub.idea).toBe(7)
    expect(v.judge?.advised_route).toBe('team') // returns to the team with notes
    expect(v.reason_code).toBe('judge.return')
    expect(v.judge?.tests.every(x => x.evidence.length > 0)).toBe(true) // each sub-score names its evidence
    expect(v.handler).toMatch(/^judge_work@/) // the Judge version
    await open1(page, job)
    await expect(page.getByTestId('score-card')).toContainText('22') // ADJUST(judge)
    await ctx.close()
  })

  test.fixme(t(59), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score22-idea9' } })
    await score(page, doc.token)
    expect((await verdicts(page, doc.token))[0].judge?.advised_route).toBe('cd_brave')
    await signIn(page, PEOPLE.creativeDirector)
    await page.goto('/'); await page.reload()
    await expect(page.getByTestId('need').filter({ hasText: 'Brave, fix the craft' })).toBeVisible() // ADJUST(judge)
    await control(page, { variant: { judge_work: 'score24' } }) // a score of 24 or more goes to the creative director
    await signIn(page, PEOPLE.copywriter)
    const second = await piece(page, job)
    await score(page, second.token)
    expect((await verdicts(page, second.token))[0].judge?.advised_route).toBe('cd')
    await ctx.close()
  })

  test.fixme(t(60), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score22-idea7' } })
    await score(page, doc.token)
    const overrule = (token: string, reason: string) => page.request.post(`/s/${token}/judge/overrule`, { data: { reason } }) // ADJUST(judge)
    expect((await overrule(doc.token, OVERRULE_REASON)).status()).toBe(403) // a copywriter cannot overrule
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: doc.path, id: '' })
    expect((await overrule(cd.token, '')).status()).toBe(400) // with no written reason it is refused
    expect((await overrule(cd.token, OVERRULE_REASON)).status()).toBe(200)
    const all = await verdicts(page, cd.token)
    expect(all).toHaveLength(2) // their own verdict answers Judge's, and Judge's stays
    expect(all.some(v => v.agent === 'judge')).toBe(true)
    expect(all.some(v => (v.actor ?? '').includes(PEOPLE.creativeDirector.username) && v.rationale === OVERRULE_REASON)).toBe(true)
    await ctx.close()
  })

  test.fixme(t(61), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score22-idea7' } })
    await score(page, doc.token)
    await signIn(page, PEOPLE.management)
    await page.goto('/'); await page.reload()
    await expect(page.getByTestId('tile-judge')).toContainText('22', { timeout: 10_000 }) // ADJUST(judge): the dashboard's Judge tile, within 10 seconds
    // No screen and no response scores a person.
    for (const url of [`${job.api}/dashboard`, `${job.api}/jobs`, `${job.api}/judge/telemetry`]) {
      expect(await (await page.request.get(url)).text()).not.toMatch(/per_person|by_person|per_writer|by_author/i)
    }
    await ctx.close()
  })

  test.fixme(t(62), async ({ browser }) => {
    // What leaves the vault holds numbers, codes and ids only: a canary sentence in the work is in no telemetry row.
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const planted = { ...RADIO_SCRIPT, script: { ...RADIO_SCRIPT.script, beats: [{ ...RADIO_SCRIPT.script.beats[0], text: CANARY_SENTENCE }] } }
    const doc = await piece(page, job, planted)
    await score(page, doc.token)
    await signIn(page, PEOPLE.management)
    const telemetry = await (await page.request.get(`${job.api}/judge/telemetry`)).text() // ADJUST(judge)
    expect(telemetry).not.toContain(CANARY_SENTENCE)
    expect(telemetry).not.toContain('Tonight')
    // The request that left to the middleware held no more than the work and the approved brief fields; the log holds task names only.
    expect((await middlewareLog(page)).some(e => e.task === 'judge_work')).toBe(true)
    // Judge refuses when the client's AI switch is off, and on a route that is not EU-pinned.
    await signIn(page, PEOPLE.accountService)
    expect((await page.request.put(`${job.api}/clients/${job.client}/ai`, { data: { on: false } })).status()).toBe(200) // ADJUST(judge): the client's AI switch
    await signIn(page, PEOPLE.copywriter)
    const refused = await score(page, doc.token)
    expect(refused.status()).toBe(403)
    expect(await refused.text()).toMatch(/ai_off/)
    await control(page, { variant: { judge_work: 'not-eu' } }) // ADJUST(judge): a fixture answer that reports a route outside the EU
    await ctx.close()
  })

  test.fixme(t(63), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const doc = await piece(page, job)
    const credits = (await sessionOf(page)).quota.used
    await control(page, { fail: 'judge_work' })
    await open1(page, job)
    await page.getByRole('button', { name: 'Send to Judge' }).click() // ADJUST(judge)
    const failed = page.locator('[data-state="run-failed"]')
    await expect(failed).toBeVisible()
    expect((await failed.locator('.ns-line').allInnerTexts()).filter(Boolean)).toHaveLength(1)
    expect((await sessionOf(page)).quota.used).toBe(credits) // the credits come back
    // The creative director can still decide.
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: doc.path, id: '' })
    expect((await page.request.post(`/s/${cd.token}/approve`, { data: { rationale: 'Approved without a score.' } })).status()).toBe(200)
    // A score from a rubric that is not yet trusted says so.
    await control(page, { variant: { judge_work: 'score24' } })
    await score(page, doc.token)
    expect((await verdicts(page, doc.token))[0].judge?.trust).not.toBe('earned')
    await expect(page.getByTestId('score-card')).toContainText(/not yet trusted/i) // ADJUST(judge)
    await ctx.close()
  })

  test.fixme(t(64), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signBrief(page, job.brief)
    await signIn(page, PEOPLE.creativeDirector)
    await lockBrief(page, await asMe(page, job.api, job.brief))
    await signIn(page, PEOPLE.copywriter)
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score24' } })
    await score(page, doc.token)
    const first = (await verdicts(page, doc.token))[0]
    // A new version gets a new score; the old one stays on the old version.
    await page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: { script: { beats: [{ id: 'beat_1', text: 'A new first line.' }] } }, agent: 'human', action: 'edit a line' } })
    await score(page, doc.token)
    const all = await verdicts(page, doc.token)
    expect(all).toHaveLength(2)
    expect(all[0].version).not.toBe(first.version)
    // A new brief version marks the old score as out of date.
    await signIn(page, PEOPLE.planning)
    await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A newer line.' }, agent: 'human', action: 'edit the proposition' } })
    await signIn(page, PEOPLE.copywriter)
    await open1(page, job)
    await expect(page.getByTestId('score-card')).toContainText(/out of date/i) // ADJUST(judge)
    await ctx.close()
  })
}

async function open1(page: Page, job: Seeded) { await page.goto(`/#tool-${job.client}-script-editor`); await page.reload(); await page.getByTestId('work-item').first().click() } // ADJUST(judge): where the score card shows
