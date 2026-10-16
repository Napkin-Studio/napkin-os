// The e2e harness (e2e/README.md; features/image-editor-masks-layers.clan P0): Playwright with real
// pointer events against the dev server and its in-browser MockRelay. Nothing here reaches a relay,
// Runway or any paid service. E2E_CHROMIUM points at a local Chromium instead of Playwright's download.
import { defineConfig } from '@playwright/test'

const port = Number(process.env.E2E_PORT || 5199)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/`,
    // A server already on the port is used only when asked (E2E_REUSE=1): another checkout's would test other code.
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 120_000,
  },
})
