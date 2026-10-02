import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type Fixtures = {
  /** Throwaway ~/W-ONE for this test (vault, settings, project registry). */
  home: string
  app: ElectronApplication
  /** The main window, past the boot overlay. */
  page: Page
  /** Everything the main process printed so far. */
  mainLog: () => string
}

export const test = base.extend<Fixtures>({
  home: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'wone-e2e-'))
    await use(dir)
    await rm(dir, { recursive: true, force: true })
  },

  app: async ({ home }, use) => {
    const env = { ...process.env, WONE_HOME: home, LANG: 'en_US.UTF-8' } as Record<string, string>
    delete env.ELECTRON_RENDERER_URL // always the built renderer, never a dev server
    delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({
      // --no-sandbox: CI runners and containers have no usable Chromium sandbox.
      args: [resolve('out/main/index.js'), '--no-sandbox'],
      env
    })
    await use(app)
    await app.close()
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
    await page.getByText('click to skip').click()
    await page.getByText('click to skip').waitFor({ state: 'detached' })
    await use(page)
  }
})

export { expect } from '@playwright/test'
