import { defineConfig, devices } from '@playwright/test'

// The smoke runs against a seeded local stack on 127.0.0.1 (stack.mjs starts it):
// the real shell, the real napkin-web, real documents, no model and no network.
// Run it with `npm run e2e` here, or `scripts/check.sh --only e2e` from the root.
const port = process.env.NAPKIN_E2E_PORT || '18080'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // One server, one data directory: each test makes its own browser context, so
  // its own anonymous tenant, and nothing a test does is visible to another.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/stack.mjs',
    cwd: '..',
    url: `http://127.0.0.1:${port}/api/healthz`,
    reuseExistingServer: false,
    // A cold cargo build and a vite build come first.
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
