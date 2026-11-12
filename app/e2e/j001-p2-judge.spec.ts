// Phase 2 acceptance, record `judge` (features/j001-phase2-suite.clan): tests 58 to 64 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Record `judge` turned these on (features/judge.clan). The stand-in middleware is Judge's fixture backend: it answers from
// seed/j001/p2/answers/judge_work*.json (how many tests of each dimension fail), and the host adds the passes up, so the scores,
// the routing, the verdict and the card run on the real host with no model and no paid provider.
// The client's AI switch is built by no record yet, so test 62 shows Judge's refusals (ai_off, not_eu) as the middleware makes them,
// through the stand-in's refusal answers, not through a switch the page sets.
//
// Judge (features/judge.clan): the verdict is a decision in the file (kind verdict, agent judge, handler judge_work@1) carrying a judge block
// {total, sub{idea, craft, effect}, tests[{id, evidence, reason_code}], advised_route, trust, brief_version}. The fixture answers are
// answers/judge_work*.json, picked with control({ variant: { judge_work: '<name>' } }). A piece is scored with POST /s/{token}/judge {target}.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { asMe, lockBrief, PEOPLE, seedJ001, signBrief } from './seed/j001'
import { chainOf, control, middlewareLog, open, SIZES, sessionOf, signIn, type Decision } from './pilot'
import { CANARY_SENTENCE } from './seed/j001/p2/wall.mjs'
import { OVERRULE_REASON } from './seed/j001/p2/judge.mjs'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP } from './seed/j001/p2/script-editor.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

const shots = process.env.NAPKIN_E2E_SHOTS // NAPKIN_E2E_SHOTS=docs/design/judge npm run e2e -- j001-p2-judge
async function shot(page: Page, name: string, size: { tag: string; width: number }) {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await page.waitForTimeout(400)
  // The roster agency wears a real agency's name: it is masked, never shown.
  await page.screenshot({ path: join(shots, `${name}-${size.tag}.png`), fullPage: size.width < 1000, mask: [page.getByTestId('agency-pill')], maskColor: '#C8CBFF' })
}

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

  test(t(58), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning, then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
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
    await expect(page.getByTestId('score-card')).toContainText('22')
    await shot(page, 'judge-card', size)
    await page.getByTestId('judge-why').click()
    await expect(page.getByTestId('judge-test').first()).toHaveAttribute('data-value', 'fail') // the failed tests come first
    await expect(page.getByTestId('judge-test').first()).toContainText('Fixture evidence')
    await shot(page, 'judge-card-why', size)
    await ctx.close()
  })

  test(t(59), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning, then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score22-idea9' } })
    await score(page, doc.token)
    expect((await verdicts(page, doc.token))[0].judge?.advised_route).toBe('cd_brave')
    await signIn(page, PEOPLE.creativeDirector)
    await page.goto('/'); await page.reload()
    await expect(page.getByTestId('need').filter({ hasText: 'Brave, fix the craft' })).toBeVisible()
    await shot(page, 'judge-need-brave', size)
    await page.goto('/#door-judge-scores'); await page.reload()
    await expect(page.getByTestId('judge-piece').first()).toBeVisible()
    await expect(page.getByTestId('js-calibration')).toContainText('advice until Judge has earned trust')
    await shot(page, 'judge-scores-door', size)
    await control(page, { variant: { judge_work: 'score24' } }) // a score of 24 or more goes to the creative director
    await signIn(page, PEOPLE.copywriter)
    const second = await piece(page, job)
    await score(page, second.token)
    expect((await verdicts(page, second.token))[0].judge?.advised_route).toBe('cd')
    await ctx.close()
  })

  test(t(60), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning, then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score22-idea7' } })
    await score(page, doc.token)
    const overrule = (token: string, reason: string) => page.request.post(`/s/${token}/judge/overrule`, { data: { reason } })
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

  test(t(61), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning, then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const doc = await piece(page, job)
    await control(page, { variant: { judge_work: 'score22-idea7' } })
    await score(page, doc.token)
    await signIn(page, PEOPLE.management)
    await page.goto('/#door-agency-dashboard'); await page.reload()
    await expect(page.getByTestId('tile-scores')).toContainText('22', { timeout: 10_000 }) // the dashboard's Judge tile, within 10 seconds
    await shot(page, 'judge-tile', size)
    // No screen and no response scores a person.
    for (const url of [`${job.api}/dashboard`, `${job.api}/jobs`, `${job.api}/judge/telemetry`]) {
      expect(await (await page.request.get(url)).text()).not.toMatch(/per_person|by_person|per_writer|by_author/i)
    }
    await ctx.close()
  })

  test(t(62), async ({ browser }) => {
    // What leaves the vault holds numbers, codes and ids only: a canary sentence in the work is in no telemetry row.
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning, then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const planted = { ...RADIO_SCRIPT, script: { ...RADIO_SCRIPT.script, beats: [{ ...RADIO_SCRIPT.script.beats[0], text: CANARY_SENTENCE }] } }
    const doc = await piece(page, job, planted)
    await score(page, doc.token)
    await signIn(page, PEOPLE.management)
    const telemetry = await (await page.request.get(`${job.api}/judge/telemetry`)).text()
    expect(telemetry).not.toContain(CANARY_SENTENCE)
    expect(telemetry).not.toContain('Tonight')
    // The request that left to the middleware held no more than the work and the approved brief fields; the log holds task names only.
    expect((await middlewareLog(page)).some(e => e.task === 'judge_work')).toBe(true)
    // Judge refuses, with the middleware's own words, when the client's AI switch is off and on a route that is not EU-pinned
    // (the stand-in makes the refusal the real handler makes; nothing is written, and the credits come back).
    await signIn(page, PEOPLE.copywriter)
    const before = (await verdicts(page, doc.token)).length
    const credits = (await sessionOf(page)).quota.used
    await control(page, { variant: { judge_work: 'ai-off' } })
    const refused = await score(page, doc.token)
    expect(refused.status()).toBe(403)
    expect(await refused.text()).toMatch(/ai_off/)
    await control(page, { variant: { judge_work: 'not-eu' } })
    const notEu = await score(page, doc.token)
    expect(notEu.status()).toBe(403)
    expect(await notEu.text()).toMatch(/not_eu/)
    expect((await verdicts(page, doc.token)).length, 'a refusal writes nothing').toBe(before)
    expect((await sessionOf(page)).quota.used, 'a refusal returns its credit').toBe(credits)
    await ctx.close()
  })

  test(t(63), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning, then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    const doc = await piece(page, job)
    const credits = (await sessionOf(page)).quota.used
    await control(page, { fail: 'judge_work' })
    await open1(page, job)
    await page.getByRole('button', { name: 'Send to Judge' }).click()
    const failed = page.locator('[data-state="run-failed"]')
    await expect(failed).toBeVisible()
    expect((await failed.locator('.ns-line').allInnerTexts()).filter(Boolean)).toHaveLength(1)
    expect((await sessionOf(page)).quota.used).toBe(credits) // the credits come back
    await shot(page, 'judge-run-failed', size)
    // The creative director can still decide.
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: doc.path, id: '' })
    expect((await page.request.post(`/s/${cd.token}/approve`, { data: { rationale: 'Approved without a score.' } })).status()).toBe(200)
    // A score from a rubric that is not yet trusted says so.
    await control(page, { variant: { judge_work: 'score24' } })
    await score(page, doc.token)
    expect((await verdicts(page, doc.token))[0].judge?.trust).not.toBe('earned')
    await expect(page.getByTestId('score-card')).toContainText(/not yet trusted/i)
    await shot(page, 'judge-not-trusted', size)
    await ctx.close()
  })

  test(t(64), async ({ browser }) => {
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
    const edit = await page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: { script: { beats: [{ ...RADIO_SCRIPT.script.beats[0], text: 'A new first line.' }] } }, agent: 'human', action: 'edit a line' } })
    expect(edit.status(), await edit.text()).toBe(200)
    await score(page, doc.token)
    const all = await verdicts(page, doc.token)
    expect(all).toHaveLength(2)
    expect(all[0].version).not.toBe(first.version)
    // A new brief version marks the old score as out of date.
    await signIn(page, PEOPLE.planning)
    await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A newer line.' }, agent: 'human', action: 'edit the proposition' } })
    await signIn(page, PEOPLE.copywriter)
    await open1(page, job)
    await expect(page.getByTestId('score-card')).toContainText(/out of date/i)
    await shot(page, 'judge-out-of-date', size)
    await ctx.close()
  })
}

async function open1(page: Page, job: Seeded) { await page.goto(`/#tool-${job.client}-script`); await page.reload(); await page.getByTestId('work-item').first().click() }
