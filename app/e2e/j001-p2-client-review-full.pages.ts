// The client review's screens for the suite's axe, 44 px and em dash checks (tests 72 and 73): the reviewer's page, the code screen,
// and the agency's job page with a round on it. The client's screens are phone screens and open with no account, but the suite
// opens a page as a placeholder person, so each `show` makes the round as account service and opens the link.
import { expect, type Page } from '@playwright/test'
import { asMe, PEOPLE, type SeededJob } from './seed/j001'
import { CLIENT_REVIEWERS } from './seed/j001/p2/reviewers.mjs'
import { chainOf, signIn, signOff } from './pilot'
import type { Phase2Page } from './phase2/pages'

/** Sign the job's brief if it is not signed yet (a page of another record may have done it), then send a round as account service. */
async function round(page: Page, job: SeededJob, code: boolean): Promise<{ links: { path: string }[] }> {
  await signIn(page, PEOPLE.accountService)
  if (!(await chainOf(page, (await asMe(page, job.api, job.brief)).token)).some(d => d.kind === 'approve')) await signOff(page, job)
  await signIn(page, PEOPLE.accountService)
  const brief = await asMe(page, job.api, job.brief)
  const r = await page.request.post(`${job.api}/d/${encodeURIComponent(brief.path)}/client-link/round`, { data: { reviewers: Object.values(CLIENT_REVIEWERS), code } })
  expect(r.status(), await r.text()).toBe(200)
  return r.json()
}

export const PAGES: Phase2Page[] = [
  { name: 'client review piece', as: PEOPLE.accountService, show: async (page, { job }) => { const r = await round(page, job, false); await page.goto(r.links[0].path); await expect(page.getByTestId('piece-version')).toBeVisible() } },
  { name: 'client review code', as: PEOPLE.accountService, show: async (page, { job }) => { const r = await round(page, job, true); await page.goto(r.links[0].path); await expect(page.getByTestId('client-link-code')).toBeVisible() } },
  { name: 'job page with a client round', as: PEOPLE.accountService, show: async (page, { job }) => { await round(page, job, false); await page.goto('/'); await page.goto(`/#job-${job.job}`); await page.reload(); await expect(page.getByTestId('job-client-round').first()).toBeVisible() } },
]
