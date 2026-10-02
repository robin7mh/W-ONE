import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from './fixtures'

test('boots into the Command Center and connects to the Docker database', async ({ page, mainLog }) => {
  await expect(page.getByText('Command Center').first()).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening|night)/)
  await expect.poll(mainLog).toMatch(/\[db\] connected — schema v\d+/)
})

test('navigates every module; unfinished ones show their placeholder', async ({ page }) => {
  const nav = (name: string) => page.getByRole('button', { name, exact: true }).or(page.getByTitle(name, { exact: true }))
  await nav('Projects').click()
  await expect(page.getByText('No projects yet')).toBeVisible()
  await nav('Memory').click()
  await expect(page.getByText('Create W-ONE vault')).toBeVisible()
  for (const name of ['Agents', 'System', 'Settings']) {
    await nav(name).click()
    await expect(page.getByText('Module reserved · not yet wired')).toBeVisible()
  }
  await nav('Core').click()
  await expect(page.getByLabel('Open Projects')).toBeVisible()
})

test('the terminal runs a real shell, keeps it across modules and splits panes', async ({ page }) => {
  await page.getByTitle('Terminal', { exact: true }).click()
  const screen = page.locator('.xterm-rows').first()
  await expect(screen).toBeVisible()
  await page.locator('.xterm-helper-textarea').first().focus()
  await page.keyboard.type('echo "w-one-$((40 + 2))"\n')
  await expect(screen).toContainText('w-one-42')

  await page.getByTitle('Core', { exact: true }).click()
  await page.getByTitle('Terminal', { exact: true }).click()
  await expect(screen).toContainText('w-one-42') // same session, still there

  await page.getByLabel('Layout: Side by side').click()
  await page.getByRole('button', { name: 'New terminal' }).last().click()
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.locator('.xterm-rows')).toHaveCount(2)
})

test('memory: creates the starter vault, writes a note to disk and links it', async ({ page, home }) => {
  await page.getByTitle('Memory', { exact: true }).click()
  await page.getByText('Create W-ONE vault').click()
  await expect(page.getByText('Willkommen', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'New note' }).first().click()
  const title = page.getByPlaceholder('Note title…')
  await title.fill('E2E Note')
  await title.press('Enter')
  const editor = page.locator('textarea')
  await expect(editor).toBeVisible()
  await editor.fill('Written by Playwright, see [[Willkommen]]')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('saved', { exact: true })).toBeVisible()

  const file = join(home, 'vault', 'E2E Note.md')
  await expect.poll(() => existsSync(file)).toBe(true)
  await page.getByTitle('Read (⌘E)').click()
  await expect(page.locator('.md-prose a.wikilink')).toHaveText('Willkommen')
  await expect(page.getByTitle('This note links to it')).toHaveText('Willkommen')
})

test('projects: adds a git folder through the (stubbed) native picker', async ({ app, page }) => {
  const repo = resolve('.')
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, repo)
  await page.getByTitle('Projects', { exact: true }).click()
  await page.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('w-one-ui') // package.json name
  await expect(page.getByText(repo).first()).toBeVisible()
  if (branch !== 'HEAD') await expect(page.getByText(branch).first()).toBeVisible()
  await expect(page.getByText('TypeScript').first()).toBeVisible()
})

test('theme toggle switches light and dark', async ({ page }) => {
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
  const before = await theme()
  await page.getByLabel(/Switch to (light|dark) mode/).click()
  await expect.poll(theme).not.toBe(before)
})
