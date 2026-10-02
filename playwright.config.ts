import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the real, built Electron app (`npm run build`) against
 * the Docker database (`npm run db:up`) — `npm run test:e2e` does both first.
 * Each test gets its own throwaway WONE_HOME, so real data is never touched.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
