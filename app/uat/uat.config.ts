import { defineConfig, devices } from '@playwright/test'

// The UAT suite (features/uat-loop.clan): the real product on a deployed stack, as the
// mock accounts in infra/scripts/accounts.uat.tsv. Unlike app/e2e it spends real money
// (Research and Brief runs call models and web search), so CI never runs it; scripts/uat-round
// does, after deploying a ref to UAT. Assertions are about structure and time, never wording.
const base = process.env.UAT_URL || 'http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com'

export default defineConfig({
  testDir: '.',
  testMatch: '*.uat.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.UAT_JSON || 'uat-results.json' }]],
  // A Research run takes two to four minutes, plus its questions.
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: base,
    ...devices['Desktop Chrome'],
    viewport: { width: 1460, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
