// The clan-app e2e (features/production-as-clan-app.clan; TEST-PLAN S1-6, S1-10, S1-12, S1-17, S2-x, S3-1):
// real browsers against a locally started napkin-web + local relay in mock mode, started by
// `scripts/e2e-production-clan up` (lane ports 20420/20421). Nothing here starts a server; E2E_BASE_URL says
// where it is. E2E_STAGE (default 2) says which stage's specs run: later ones stay fixme.
//   scripts/e2e-production-clan up && cd production-tool/web && npx playwright test -c playwright.clan-app.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/clan-app',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results/clan-app',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:20420',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {} } },
  ],
})
