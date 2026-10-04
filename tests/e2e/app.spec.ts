import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from './fixtures'

test('boots into the Command Center and connects to the Docker database', async ({ page, mainLog }) => {
  await expect(page.getByText('Command Center').first()).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening|night)/)
  await expect.poll(mainLog).toMatch(/\[db\] connected — schema v\d+/)
})

test('navigates every module', async ({ page }) => {
  const nav = (name: string) => page.getByRole('button', { name, exact: true }).or(page.getByTitle(name, { exact: true }))
  await nav('Editor').click()
  await expect(page.getByText('No projects yet')).toBeVisible()
  await nav('Projects').click()
  // the editor stays mounted (hidden) once opened — only the visible text counts
  await expect(page.getByText('No projects yet').filter({ visible: true })).toBeVisible()
  await nav('Memory').click()
  await expect(page.getByText('Create W-ONE vault')).toBeVisible()
  await nav('Agents').click()
  await expect(page.getByText('Your agents, in one place')).toBeVisible() // starts with "New chat", no key needed
  await nav('System').click()
  await expect(page.getByText('Top processes')).toBeVisible()
  await nav('Settings').click()
  await expect(page.getByText('Remote access · web & mobile')).toBeVisible()
  await nav('Core').click()
  await expect(page.getByLabel('Open Projects')).toBeVisible()
})

test('settings: the embedded API server starts on demand and answers', async ({ page }) => {
  await page.getByTitle('Settings', { exact: true }).click()
  await expect(page.getByText('API server off')).toBeVisible()
  await page.getByLabel('Port').fill('7499')
  await page.getByLabel('Port').blur()
  await page.getByLabel('Run the API server').check()
  await expect(page.getByText('API server running')).toBeVisible()
  const res = await fetch('http://127.0.0.1:7499/api/health')
  expect(await res.json()).toMatchObject({ ok: true, name: 'W-ONE', mode: 'desktop' })
  await page.getByRole('button', { name: 'Pair a device' }).click()
  // LAN off: no QR a phone couldn't open — the code and what to switch on instead
  await expect(page.getByText(/Only this computer can connect right now/)).toBeVisible()
  await expect(page.getByLabel('Pairing QR code')).toHaveCount(0)
  await page.getByLabel('Run the API server').uncheck()
  await expect(page.getByText('API server off')).toBeVisible()
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

test('editor: opens a project file in Monaco, saves it with ⌘S and follows changes on disk', async ({ page, home }) => {
  const root = join(home, 'demo')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'hello.ts'), 'export const greeting = "hi"\n')
  writeFileSync(join(root, '.gitignore'), 'dist\n')
  mkdirSync(join(root, 'dist'))
  const added = await page.evaluate((path) => window.wone!.invoke('projects:add', { path }), root)
  expect(added).toMatchObject({ ok: true })

  await page.getByTitle('Editor', { exact: true }).click()
  await expect(page.getByRole('treeitem', { name: 'dist' })).toHaveClass(/opacity-50/) // git-ignored
  await page.getByRole('treeitem', { name: 'src' }).click()
  await page.getByRole('treeitem', { name: 'hello.ts' }).click()
  const lines = page.locator('.monaco-editor .view-lines')
  await expect(lines).toContainText('export const greeting')
  await expect(page.getByText('TypeScript', { exact: true })).toBeVisible()

  await lines.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('export const greeting = "from W-ONE"')
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  expect(readFileSync(join(root, 'src', 'hello.ts'), 'utf8')).toBe('export const greeting = "from W-ONE"')

  // an outside edit (an agent, git, VS Code) shows up in the clean tab by itself
  writeFileSync(join(root, 'src', 'hello.ts'), 'export const greeting = "changed outside"\n')
  await expect(lines).toContainText('changed outside')
})

test('agents: a coding agent session — chat, approval in W-ONE, the change as a diff, a journal in memory', async ({ page, home }) => {
  const root = join(home, 'agent-demo')
  mkdirSync(root)
  writeFileSync(join(root, 'README.md'), '# demo\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', 'add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'], { cwd: root })
  await page.evaluate((path) => window.wone!.invoke('projects:add', { path }), root)
  await page.evaluate(() => window.wone!.invoke('memory:createVault'))

  await page.getByTitle('Agents', { exact: true }).click()
  await page.getByRole('button', { name: 'New chat' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New chat' })
  await expect(dialog.getByText('Pro plan · v9.9.9')).toBeVisible() // detected (the stand-in)
  await dialog.getByLabel('First message').fill('Write the output file')
  await dialog.getByRole('button', { name: 'Start' }).click()

  // the agent asks before it runs a command — answered in W-ONE
  await expect(page.getByText('Write the output file').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow once' })).toHaveCount(1) // inline only — no toast for the open chat
  await page.getByRole('button', { name: 'Allow once' }).click()
  await expect(page.getByText('Done: wrote fake-output.txt')).toBeVisible()
  await expect(page.getByText('· Your turn')).toBeVisible()
  expect(readFileSync(join(root, 'fake-output.txt'), 'utf8')).toBe('written by the fake agent\n')

  // named after its agent; a click on the name renames it
  const name = page.getByLabel('Session name')
  await expect(name).toHaveValue('Claude Code')
  await name.fill('Output writer')
  await name.press('Enter')
  await expect(page.getByText('Output writer', { exact: true })).toBeVisible() // the list follows
  await expect(page.getByText(/^Claude Code · agent-demo/)).toBeVisible()

  // what changed, as a diff
  await page.getByRole('button', { name: /^A fake-output\.txt/ }).click()
  await expect(page.getByRole('dialog', { name: 'Changes in fake-output.txt' })).toBeVisible()
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  await page.getByLabel('Close diff').click()

  // the session's journal lands in the vault
  await expect.poll(() => (existsSync(join(home, 'vault', 'Agents', 'agent-demo')) ? readdirSync(join(home, 'vault', 'Agents', 'agent-demo')) : [])).toHaveLength(1)
  await page.getByRole('tab', { name: /Memory/ }).click()
  await expect(page.getByText('Session journal')).toBeVisible()
  await page.getByLabel('End session').click()
  await expect(page.getByText('· Ended')).toBeVisible()
})

test('theme toggle switches light and dark', async ({ page }) => {
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
  const before = await theme()
  await page.getByLabel(/Switch to (light|dark) mode/).click()
  await expect.poll(theme).not.toBe(before)
})
