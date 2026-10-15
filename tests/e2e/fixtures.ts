import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type Fixtures = {
  /** Throwaway ~/Mindeck for this test (vault, settings, project registry). */
  home: string
  app: ElectronApplication
  /** The main window, past the boot overlay. */
  page: Page
  /** Everything the main process printed so far. */
  mainLog: () => string
}

/**
 * Every test runs on a fresh ~/Mindeck, so the window opens as a first start
 * with the setup over it (it has its own test). Waits until the setup has
 * decided and skips it.
 */
export async function skipSetup(page: Page): Promise<void> {
  await page.waitForFunction(() => localStorage.getItem('mindeck.onboarding') !== null)
  const decided = await page.evaluate(() => JSON.parse(localStorage.getItem('mindeck.onboarding')!) as { done: boolean })
  if (!decided.done) await page.getByRole('dialog', { name: 'Set up Mindeck' }).getByRole('button', { name: 'Skip setup' }).click()
}

/**
 * A fresh profile shows the split screen's tip under the top bar's Split
 * button; tests that don't need it put it away, so it covers nothing.
 */
export async function dismissTips(page: Page): Promise<void> {
  const tip = page.getByRole('dialog', { name: 'Split screen' })
  if (await tip.isVisible()) await tip.getByRole('button', { name: 'Dismiss' }).click()
}

export const test = base.extend<Fixtures>({
  home: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'mindeck-e2e-'))
    await use(dir)
    await rm(dir, { recursive: true, force: true })
  },

  app: async ({ home }, use) => {
    // MINDECK_CLAUDE_BIN: agent sessions run a stand-in for Claude Code (no account, no model).
    const env = { ...process.env, MINDECK_HOME: home, LANG: 'en_US.UTF-8', MINDECK_CLAUDE_BIN: resolve('tests/e2e/fake-claude.mjs') } as Record<string, string>
    delete env.ELECTRON_RENDERER_URL // always the built renderer, never a dev server
    delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({
      // --no-sandbox: CI runners and containers have no usable Chromium sandbox.
      // --lang: on macOS Electron takes the system language, not LANG.
      // --user-data-dir: the window's own storage (layout, setup, …) is this test's too.
      args: [resolve('out/main/index.js'), '--no-sandbox', '--lang=en-US', `--user-data-dir=${join(home, 'electron')}`],
      env
    })
    await use(app)
    // Shells or agents still running make a quit ask first (no one answers here): exit outright.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close().catch(() => {})
  },

  mainLog: async ({ app }, use) => {
    let log = ''
    app.process().stdout?.on('data', (d) => (log += String(d)))
    app.process().stderr?.on('data', (d) => (log += String(d)))
    await use(() => log)
  },

  page: async ({ app, mainLog }, use) => {
    void mainLog // start capturing before the window opens
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await skipSetup(page)
    const boot = page.getByText('click to skip')
    if (await boot.isVisible()) await boot.click()
    await boot.waitFor({ state: 'detached' })
    await dismissTips(page)
    await use(page)
  }
})

export { expect } from '@playwright/test'
