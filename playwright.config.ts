import { defineConfig, devices } from '@playwright/test'

// E2E runs against the production build served by `vite preview`; `npm run test:e2e` builds first.
const port = Number(process.env.E2E_PORT ?? 4193)

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? undefined : 2,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/app`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
