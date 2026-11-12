// The Idea room's pages for the suite's axe, 44 px and em dash checks (tests 72 and 73), read as the creative director: the room with
// its cards and gate, and the room with three merged routes. A room is made from a signed, confirmed brief, as a person does it.
import { expect } from '@playwright/test'
import { asMe, lockBrief, PEOPLE, recordClientConfirmation, seedJ001, signBrief } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

async function room(page: import('@playwright/test').Page, routes: boolean) {
  await page.request.post('/api/auth/sign-in', { data: { username: PEOPLE.planning.username } })
  const job = await seedJ001(page, { ready: true, fresh: true })
  await signBrief(page, job.brief)
  await page.request.post('/api/auth/sign-in', { data: { username: PEOPLE.creativeDirector.username } })
  await lockBrief(page, await asMe(page, job.api, job.brief))
  await recordClientConfirmation(page, await asMe(page, job.api, job.brief))
  const made = await page.request.post(`${job.api}/d/${encodeURIComponent(job.brief.path)}/spinoff`, { data: { app_id: 'ie.napkin.idea-room', title: 'J001 idea room' } })
  expect(made.status()).toBe(200)
  const me = (await made.json()) as { token: string }
  for (const text of ['One song of silence, once a night.', 'The first pour takes a minute.', 'A coaster that says how to start.']) {
    await page.request.post(`/s/${me.token}/ideas/card`, { data: { text } })
  }
  if (routes) {
    await page.request.post(`/s/${me.token}/ideas/open-early`, { data: { rationale: 'The team asked for help.' } })
    await page.request.post(`/s/${me.token}/ideas/routes/start`, { data: { routes: [{ name: 'One song', bet: 'A bar goes quiet.', cards: ['c1'] }, { name: 'The long pour', bet: 'A slow first pour.', cards: ['c2'] }] } })
    await page.request.post(`/s/${me.token}/merge`, { data: {} })
  }
  await page.goto(`/#tool-${job.client}-idea`)
  await page.reload()
  await page.getByTestId('work-item').first().click()
  await expect(page.frameLocator('iframe').first().locator('[data-where="idea-room"]')).toBeVisible({ timeout: 30_000 })
}

export const PAGES: Phase2Page[] = [
  { name: 'idea room', as: PEOPLE.creativeDirector, show: page => room(page, false) },
  { name: 'idea room with merged routes', as: PEOPLE.creativeDirector, show: page => room(page, true) },
]
