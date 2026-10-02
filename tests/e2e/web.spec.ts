import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
// @ts-expect-error — plain ESM helper without type declarations
import { startFakeAnthropic } from './fake-anthropic.mjs'

/**
 * The web UI against the real standalone core (`npm run web:build` +
 * `npm run server:build`): pairing, live data over the WebSocket, the folder
 * browser and the access rules for remote clients.
 */
type Core = { url: string; home: string; code: () => Promise<string>; log: () => string }

const test = base.extend<{ core: Core; paired: Page }>({
  core: async ({}, use) => {
    const home = await mkdtemp(join(tmpdir(), 'wone-web-e2e-'))
    const port = 7600 + Math.floor(Math.random() * 300)
    const anthropic = await startFakeAnthropic()
    let log = ''
    const proc: ChildProcess = spawn(process.execPath, [resolve('out/server/index.cjs')], {
      env: {
        ...process.env,
        WONE_HOME: home,
        WONE_PORT: String(port),
        WONE_WEB_ROOT: resolve('out/web'),
        // the assistant talks to a local stand-in for the Messages API
        ANTHROPIC_BASE_URL: anthropic.url,
        ANTHROPIC_API_KEY: 'sk-e2e-fake-key-000000'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    proc.stdout!.on('data', (d) => (log += String(d)))
    proc.stderr!.on('data', (d) => (log += String(d)))
    await expect.poll(() => log, { timeout: 15_000 }).toContain('listening on')
    const code = async () => {
      await expect.poll(() => /Code: {2}([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(log)?.[1]).toBeTruthy()
      return /Code: {2}([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(log)![1]
    }
    await use({ url: `http://127.0.0.1:${port}`, home, code, log: () => log })
    proc.kill('SIGTERM')
    await new Promise((r) => proc.once('exit', r))
    await anthropic.close()
    await rm(home, { recursive: true, force: true })
  },

  paired: async ({ page, core }, use) => {
    await page.goto(core.url)
    await page.getByLabel('Pairing code').fill(await core.code())
    await page.getByRole('button', { name: 'Pair device' }).click()
    await page.getByText('click to skip').click()
    await page.getByText('click to skip').waitFor({ state: 'detached' })
    await use(page)
  }
})

test('pairs a browser and shows live data from the core', async ({ paired, core }) => {
  await expect(paired.getByText(/REMOTE ·/)).toBeVisible()
  await expect(paired.getByText('LIVE')).toBeVisible() // telemetry over the WebSocket
  await expect(paired.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening|night)/)

  // the token survives a reload; unpairing returns to the pairing screen
  await paired.reload()
  await expect(paired.getByText(/REMOTE ·/)).toBeVisible()
  await paired.getByLabel('Disconnect this browser').click()
  await expect(paired.getByLabel('Pairing code')).toBeVisible()
  expect(core.log()).toContain('W-ONE pairing')
})

test('rejects a wrong pairing code', async ({ page, core }) => {
  await page.goto(core.url)
  await page.getByLabel('Pairing code').fill('AAAA-AAAA')
  await page.getByRole('button', { name: 'Pair device' }).click()
  await expect(page.getByText('Pairing code is invalid or expired')).toBeVisible()
})

test('adds a project and a vault through the folder browser', async ({ paired, core }) => {
  await mkdir(join(core.home, 'code', 'demo'), { recursive: true })
  await paired.getByTitle('Projects', { exact: true }).click()
  await paired.getByRole('button', { name: 'Add project' }).click()
  await paired.getByLabel('Folder path').fill(join(core.home, 'code'))
  await paired.getByLabel('Folder path').press('Enter')
  await paired.getByRole('button', { name: 'demo' }).click()
  await paired.locator('footer').getByRole('button', { name: 'Add project' }).click()
  await expect(paired.getByRole('heading', { level: 2 })).toHaveText('demo')
  await expect(paired.getByText('VS Code')).toHaveCount(0) // host apps are desktop-only

  await paired.getByTitle('Memory', { exact: true }).click()
  await paired.getByText('Create W-ONE vault').click()
  await expect(paired.getByText('Willkommen', { exact: true }).first()).toBeVisible()
  await expect(paired.getByLabel('Show vault in Finder')).toHaveCount(0)
})

test('remote shells stay off unless the core allows them', async ({ paired, core }) => {
  await paired.getByTitle('Terminal', { exact: true }).click()
  await expect(paired.getByText('Remote shells are off')).toBeVisible()
  const res = await fetch(`${core.url}/api/rpc/terminal:list`, { method: 'POST' })
  expect(res.status).toBe(401)
})

test('agents: streamed answer, a tool call behind an approval, the note lands in the vault', async ({ paired, core }) => {
  await paired.getByTitle('Memory', { exact: true }).click()
  await paired.getByText('Create W-ONE vault').click()
  await expect(paired.getByText('Willkommen', { exact: true }).first()).toBeVisible()

  // ask from the Core dashboard — it opens the Agents module
  await paired.getByTitle('Core', { exact: true }).click()
  await paired.getByLabel('Ask W-ONE').fill('Hallo W-ONE')
  await paired.getByLabel('Ask W-ONE').press('Enter')
  await expect(paired.getByRole('heading', { name: 'Hello from the assistant' })).toBeVisible()
  await expect(paired.getByText('I can see your W-ONE context.')).toBeVisible()
  await expect(paired.getByLabel('Send')).toBeVisible() // the run is over

  await paired.getByLabel('Message').fill('Bitte merk dir das als Notiz')
  await paired.getByLabel('Message').press('Enter')
  await expect(paired.getByText('Why: You asked me to remember this plan')).toBeVisible()
  await paired.getByRole('button', { name: 'Allow once' }).first().click()
  await expect(paired.getByText(/Saved — the note/)).toBeVisible()
  await expect.poll(() => existsSync(join(core.home, 'vault', 'E2E Plan.md'))).toBe(true)
  await expect(paired.getByText(/Run completed · 2 steps/).first()).toBeVisible()

  // settings shows the key from the environment and the standing permissions
  await paired.getByTitle('Settings', { exact: true }).click()
  await expect(paired.getByText(/Anthropic key from the environment/)).toBeVisible()
})
