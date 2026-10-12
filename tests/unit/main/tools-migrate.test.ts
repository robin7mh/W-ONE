import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './helpers'
import { CATALOG, pythonFor, which } from '../../../electron/main/services/tools/catalog'
import { loginShellRunner, ToolsService } from '../../../electron/main/services/tools/ToolsService'
import { APPS, appDataDir, MigrateService, parseJsonc, snippetsOf } from '../../../electron/main/services/migrate/MigrateService'
import { SettingsService } from '../../../electron/main/services/settings/SettingsService'
import { isSupportedCommand } from '@shared/types/migrate'
import type { ToolProgress } from '@shared/types/languages'

describe('the tools catalog', () => {
  it('every language has a server; locate snippets, arguments, settings and install commands', async () => {
    const root = await tempDir()
    for (const [id, entry] of Object.entries(CATALOG)) {
      for (const spec of [entry.server, entry.debugger].filter(Boolean)) {
        expect(spec!.locate('/tools'), id).toMatch(/true; \}$/)
        if (spec!.install) expect(spec!.install.command('/tools'), id).toBeTruthy()
      }
      expect(Array.isArray(entry.server.args({ root, tools: '/tools' }))).toBe(true)
      entry.server.settings?.(root)
    }
    expect(CATALOG.python.server.install!.command('/my tools')).toBe("npm install --prefix '/my tools/npm' --no-audit --no-fund --loglevel=error pyright")
    expect(CATALOG.python.server.locate('/t')).toContain('[ -x /t/npm/node_modules/.bin/pyright-langserver ]')
    expect(CATALOG.java.server.args({ root: '/a', tools: '/t' })).toEqual(['-data', expect.stringMatching(/^\/t\/jdtls\/[0-9a-f]{12}$/)])
    expect(which('x')).toBe('{ command -v x 2>/dev/null; true; }')
    expect(which('x', ['/a', '/b'])).toBe('{ command -v x 2>/dev/null || { for p in /a /b; do [ -x "$p" ] && echo "$p" && break; done; }; true; }')
  })

  it('Python runs in the project’s virtualenv when it has one', async () => {
    const root = await tempDir()
    expect(pythonFor(root)).toBe('python3')
    await mkdir(join(root, 'venv/bin'), { recursive: true })
    await writeFile(join(root, 'venv/bin/python'), '')
    expect(pythonFor(root)).toBe(join(root, 'venv/bin/python'))
  })
})

describe('ToolsService', () => {
  const lines = (pairs: Record<string, string>) => Object.entries(pairs).map(([k, v]) => `${k}\t${v}`).join('\n')

  it('one shell round trip tells what is ready, installable, needs a toolchain or comes with one', async () => {
    const scripts: string[] = []
    const tools = new ToolsService({
      dir: '/t',
      probe: async (script) => {
        scripts.push(script)
        return `${lines({ 'python:server': '/t/npm/node_modules/.bin/pyright-langserver', 'cpp:server': '/usr/bin/clangd', 'python:debugger': '', 'has:npm': '/usr/bin/npm', 'has:python3': '/usr/bin/python3', 'has:brew': '' })}\nnoise without a tab`
      }
    })
    const status = await tools.status()
    expect(scripts).toHaveLength(1)
    const byId = Object.fromEntries(status.map((l) => [l.id, l]))
    expect(byId.python.server).toEqual({ name: 'Pyright', state: 'ready' })
    expect(byId.python.debugger).toMatchObject({ name: 'debugpy', state: 'missing', requires: 'python3' })
    expect(byId.go.server).toMatchObject({ state: 'toolchain', requires: 'go', command: 'go install golang.org/x/tools/gopls@latest' })
    expect(byId.cpp.server.state).toBe('ready')
    expect(byId.java.server).toMatchObject({ state: 'toolchain', requires: 'brew' })
    expect(byId.swift.server).toEqual({ name: 'SourceKit-LSP', state: 'manual' })
    expect(byId.rust.debugger).toMatchObject({ name: 'lldb-dap', state: 'toolchain', requires: 'brew' })
    expect(byId.lua.debugger).toBeUndefined()
    // What status() found is what locate() answers — no second shell.
    expect(await tools.locate('python', 'server')).toBe('/t/npm/node_modules/.bin/pyright-langserver')
    expect(await tools.locate('python', 'debugger')).toBeUndefined()
    expect(scripts).toHaveLength(1)
    expect(tools.dir).toBe('/t')
  })

  it('locate asks the shell for what it doesn’t know yet; unknown tools are not there; a failing shell finds nothing', async () => {
    let answer = '/opt/gopls\nsecond line'
    const tools = new ToolsService({ dir: '/t', probe: async () => answer })
    expect(await tools.locate('go', 'server')).toBe('/opt/gopls')
    answer = ''
    expect(await tools.locate('go', 'server')).toBe('/opt/gopls') // cached
    expect(await tools.locate('rust', 'debugger')).toBeUndefined()
    expect(await tools.locate('cobol', 'server')).toBeUndefined()
    const broken = new ToolsService({ dir: '/t', probe: async () => Promise.reject(new Error('no shell')) })
    expect(await broken.locate('go', 'server')).toBeUndefined()
    expect((await broken.status()).every((l) => l.server.state !== 'ready')).toBe(true)
  })

  it('installs on request: output streams, a failure says why, one install at a time', async () => {
    const dir = join(await tempDir(), 'tools')
    const progress: ToolProgress[] = []
    let exit = 0
    let release!: () => void
    let ready = false
    const tools = new ToolsService({
      dir,
      probe: async (script) => (ready && script.includes('python:server') ? 'python:server\t/x/pyright' : ''),
      publish: (p) => progress.push(p),
      run: async (command, cwd, onLine) => {
        expect(cwd).toBe(dir)
        for (let i = 1; i <= 14; i += 1) onLine(`line ${i}`)
        if (command.includes('slow')) await new Promise<void>((r) => (release = r))
        return exit
      }
    })
    ready = true
    const result = await tools.install('python', 'server')
    expect(result.server.state).toBe('ready')
    expect(progress[0]).toEqual({ id: 'python', part: 'server', line: expect.stringContaining('$ npm install --prefix') })
    expect(progress).toHaveLength(15)

    exit = 1
    await expect(tools.install('php', 'server')).rejects.toMatchObject({ code: 'install-failed', message: expect.stringMatching(/^line 3\n[\s\S]*line 14$/) })
    const quiet = new ToolsService({ dir, run: async () => 2 })
    await expect(quiet.install('yaml', 'server')).rejects.toMatchObject({ message: 'YAML Language Server: exit 2' })
    await expect(tools.install('swift', 'server')).rejects.toMatchObject({ code: 'not-installable' })
    await expect(tools.install('lua', 'debugger')).rejects.toMatchObject({ code: 'not-installable' })
    await expect(tools.install('cobol', 'server')).rejects.toMatchObject({ code: 'not-installable' })

    exit = 0
    CATALOG.lua.server.install!.command = () => 'slow'
    const first = tools.install('lua', 'server')
    await new Promise((r) => setTimeout(r, 10))
    await expect(tools.install('lua', 'server')).rejects.toMatchObject({ code: 'busy' })
    release()
    await first
  })

  it('by default it asks the user’s login shell and installs through it', async () => {
    const dir = join(await tempDir(), 'tools')
    const tools = new ToolsService({ dir })
    const status = await tools.status()
    expect(status.map((l) => l.id)).toContain('python')
    expect(await tools.locate('kotlin', 'server')).toSatisfy((v: unknown) => v === undefined || typeof v === 'string')
    const fresh = new ToolsService({ dir })
    expect(await fresh.locate('cobol', 'server')).toBeUndefined()
    await fresh.locate('lua', 'server') // asks the shell on its own
    const original = CATALOG.yaml.server.install!.command
    CATALOG.yaml.server.install!.command = () => 'echo installed'
    const lines: string[] = []
    const installer = new ToolsService({ dir, publish: (p) => lines.push(p.line) })
    await installer.install('yaml', 'server')
    expect(lines).toEqual(['$ echo installed', 'installed'])
    CATALOG.yaml.server.install!.command = original
  }, 30_000)

  it('the login-shell runner: lines from stdout and stderr, the exit code, a shell that can’t start', async () => {
    const got: string[] = []
    expect(await loginShellRunner("printf 'a\\nb'; echo err >&2; exit 3", await tempDir(), (l) => got.push(l))).toBe(3)
    expect(got.sort()).toEqual(['a', 'b', 'err'])
    expect(await loginShellRunner('kill -9 $$', await tempDir(), () => {})).toBe(1) // killed: no exit code
    const failed: string[] = []
    expect(await loginShellRunner('true', '/definitely/not/here', (l) => failed.push(l))).toBe(127)
    expect(failed[0]).toMatch(/ENOENT/)
  }, 20_000)
})

describe('moving over from VS Code / Cursor', () => {
  async function machine() {
    const home = await tempDir('wone-home-')
    const appData = join(home, 'AppData')
    const user = join(appData, 'Code', 'User')
    await mkdir(join(user, 'snippets'), { recursive: true })
    await writeFile(
      join(user, 'settings.json'),
      `{
  // my editor
  "editor.fontSize": 15,
  "editor.fontFamily": "Fira Code",
  "editor.fontLigatures": "'ss01'",
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "on",
  "editor.minimap.enabled": false,
  "editor.lineNumbers": "relative",
  "editor.renderWhitespace": "all",
  "editor.cursorStyle": "block",
  "editor.cursorBlinking": "smooth",
  "editor.rulers": [80, { "column": 120 }, "x"],
  "editor.stickyScroll.enabled": true,
  "editor.smoothScrolling": true,
  "editor.bracketPairColorization.enabled": false,
  "editor.lineHeight": 22,
  "editor.wordWrapColumn": 100,
  "editor.cursorStyle.bogus": 1,
  "editor.fontSize.x": "y",
  "editor.formatOnSave": true,
  "liveServer.settings.port": 5501,
  "liveSassCompile.settings.generateMap": true,
  "blankLine.keepOneEmptyLine": false,
  "[python]": { "editor.tabSize": 4, "editor.formatOnSave": false },
  "[javascript][typescriptreact]": { "editor.tabSize": 2 },
  "[markdown]": { "markdown.preview": true },
  "[go]": "not settings",
  "workbench.colorTheme": "One Dark Pro", /* themes stay */
  "url": "https://example.com/a//b",
  "quote": "say \\"hi\\" // not a comment",
}`
    )
    await writeFile(
      join(user, 'keybindings.json'),
      `[
  { "key": "cmd+k cmd+c", "command": "editor.action.commentLine", "when": "editorTextFocus" },
  { "key": "cmd+shift+o", "command": "workbench.action.quickOpen" },
  { "key": "cmd+j", "command": "-workbench.action.togglePanel" },
  { "key": "cmd+y", "command": "gitlens.showGraph" },
  { "nope": true },
]`
    )
    await writeFile(join(user, 'snippets', 'typescriptreact.json'), JSON.stringify({ Comp: { prefix: ['rfc', 'comp'], body: ['export function $1() {', '  return null', '}'], description: ['A', 'component'] } }))
    await writeFile(join(user, 'snippets', 'mine.code-snippets'), JSON.stringify({ Log: { prefix: 'log', body: 'console.log($1)', scope: 'javascript, typescript' }, Any: { prefix: 'todo', body: 'TODO' }, Broken: { body: 'x' } }))
    await writeFile(join(user, 'snippets', 'notes.txt'), 'ignored')
    await writeFile(join(user, 'snippets', 'bad.json'), '{ not json')

    const ext = join(home, '.vscode', 'extensions')
    const extension = async (folder: string, pkg: object, files: Record<string, string> = {}) => {
      await mkdir(join(ext, folder), { recursive: true })
      await writeFile(join(ext, folder, 'package.json'), JSON.stringify(pkg))
      for (const [name, body] of Object.entries(files)) await writeFile(join(ext, folder, name), body)
    }
    await extension('ms-python.python-1', { publisher: 'ms-python', name: 'python', displayName: '%ext.name%' }, { 'package.nls.json': JSON.stringify({ 'ext.name': 'Python' }) })
    await extension('dsznajder.es7-1', {
      publisher: 'dsznajder',
      name: 'es7',
      displayName: 'ES7 snippets',
      main: './x.js',
      contributes: { snippets: [{ language: 'javascriptreact', path: './s.json' }, { language: 'javascript', path: './s.json' }] }
    }, { 's.json': JSON.stringify({ rafce: { prefix: 'rafce', body: 'export default $1' } }) })
    await extension('zhuangtongfa.material-theme-3', { publisher: 'zhuangtongfa', name: 'material-theme', displayName: 'One Dark Pro', main: './x.js', contributes: { themes: [{}] } })
    await extension('pkief.icons-1', { publisher: 'pkief', name: 'icons', displayName: '%missing%', contributes: { iconThemes: [{}] } }, { 'package.nls.json': JSON.stringify({ other: { message: 'x' } }) })
    await extension('obj.nls-1', { publisher: 'obj', name: 'nls', displayName: '%n%' }, { 'package.nls.json': JSON.stringify({ n: { message: 'Object Name' } }) })
    await extension('mhutchie.git-graph-1', { publisher: 'mhutchie', name: 'git-graph' })
    await extension('mhutchie.git-graph-2', { publisher: 'mhutchie', name: 'git-graph' }) // two versions side by side
    await extension('random.tool-1', { publisher: 'random', name: 'tool', main: './x.js' })
    await extension('ctf0.blank-line-organizer-0', { publisher: 'ctf0', name: 'blank-line-organizer', main: './x.js' })
    await extension('broken-1', { name: 'no-publisher' })
    await mkdir(join(ext, 'empty-1'))
    // Cursor installed too, with one setting; VSCodium with settings W-ONE can't use.
    await mkdir(join(appData, 'Cursor', 'User'), { recursive: true })
    await writeFile(join(appData, 'Cursor', 'User', 'settings.json'), '{ "editor.fontLigatures": false }')
    await mkdir(join(appData, 'VSCodium', 'User'), { recursive: true })
    const invalid = {
      'editor.fontSize': 2,
      'editor.fontFamily': '  ',
      'editor.fontLigatures': 3,
      'editor.lineHeight': -1,
      'editor.tabSize': 40,
      'editor.insertSpaces': 'yes',
      'editor.wordWrap': 'sometimes',
      'editor.wordWrapColumn': 0,
      'editor.minimap.enabled': 1,
      'editor.lineNumbers': 'roman',
      'editor.renderWhitespace': 'some',
      'editor.cursorStyle': 'heart',
      'editor.cursorBlinking': 'disco',
      'editor.rulers': 'eighty',
      'editor.stickyScroll.enabled': 'on',
      'editor.smoothScrolling': null,
      'editor.bracketPairColorization.enabled': 'true',
      'editor.formatOnSave': 'yes'
    }
    await writeFile(join(appData, 'VSCodium', 'User', 'settings.json'), JSON.stringify(invalid))
    // Windsurf installed, never configured.
    await mkdir(join(appData, 'Windsurf', 'User'), { recursive: true })

    const data = await tempDir()
    const settings = new SettingsService(join(data, 'settings.json'))
    await settings.init()
    const service = new MigrateService({ home, appData, settings, snippetsFile: join(data, 'snippets.json') })
    return { service, settings, data }
  }

  it('finds the apps and tells what moving over brings — without changing anything', async () => {
    const { service } = await machine()
    const [code, cursor, codium, windsurf] = await service.scan()
    expect(windsurf).toMatchObject({ app: 'Windsurf', settings: 0, keybindings: 0 })
    expect(codium).toMatchObject({ app: 'VSCodium', settings: 0 }) // nothing W-ONE could use
    expect(code).toMatchObject({ app: 'Code', name: 'Visual Studio Code', settings: 24, keybindings: 3, snippets: 6 })
    expect(code.extensions.map((e) => `${e.id}|${e.name}|${e.fate}|${e.language ?? ''}`)).toEqual([
      'ctf0.blank-line-organizer|blank-line-organizer|built-in|',
      'dsznajder.es7|ES7 snippets|snippets|',
      'mhutchie.git-graph|git-graph|built-in|',
      'ms-python.python|Python|language|python',
      'obj.nls|Object Name|unsupported|',
      'pkief.icons|icons|theme|',
      'random.tool|tool|unsupported|',
      'zhuangtongfa.material-theme|One Dark Pro|theme|'
    ])
    expect(cursor).toEqual({ app: 'Cursor', name: 'Cursor', settings: 1, keybindings: 0, snippets: 0, extensions: [] })
  })

  it('takes settings, the keybindings W-ONE can honor and every snippet over', async () => {
    const { service, settings, data } = await machine()
    expect(await service.apply('Code')).toEqual({ settings: 24, keybindings: 2, snippets: 6 })
    const editor = settings.get().editor!
    expect(editor).toMatchObject({
      fontSize: 15,
      fontFamily: 'Fira Code',
      fontLigatures: true,
      tabSize: 2,
      wordWrap: 'on',
      minimap: false,
      lineNumbers: 'relative',
      rulers: [80, 120],
      bracketPairColorization: false,
      formatOnSave: true,
      // The Blank Line Organizer was installed: it ran on save, and kept no blank lines.
      blankLines: { onSave: true, keepOne: false },
      languages: { python: { tabSize: 4, formatOnSave: false }, javascript: { tabSize: 2 }, typescript: { tabSize: 2 } },
      importedFrom: { app: 'Code', at: expect.any(String) }
    })
    expect(editor.keybindings).toEqual([
      { key: 'cmd+k cmd+c', command: 'editor.action.commentLine', when: 'editorTextFocus' },
      { key: 'cmd+shift+o', command: 'workbench.action.quickOpen' }
    ])
    const snippets = JSON.parse(await readFile(join(data, 'snippets.json'), 'utf8'))
    expect(snippets.map((s: { language: string; prefix: string }) => `${s.language}:${s.prefix}`).sort()).toEqual(['*:todo', 'javascript:log', 'javascript:rafce', 'typescript:comp', 'typescript:log', 'typescript:rfc'])
    expect(snippets.find((s: { prefix: string }) => s.prefix === 'rfc')).toMatchObject({ name: 'Comp', body: 'export function $1() {\n  return null\n}', description: 'A component' })
    expect(await service.editor()).toMatchObject({ settings: { fontSize: 15 }, snippets: expect.any(Array) })
    await expect(service.apply('Notepad')).rejects.toMatchObject({ code: 'not-found' })
    const elsewhere = new MigrateService({ home: '/nowhere', appData: await tempDir(), settings, snippetsFile: join(data, 'x.json') })
    await expect(elsewhere.apply('Code')).rejects.toMatchObject({ code: 'not-found' }) // not installed here
    expect(await elsewhere.scan()).toEqual([])
  })

  it('without anything imported the editor gets defaults; a broken snippet file is no snippets', async () => {
    const { service, data } = await machine()
    expect(await service.editor()).toEqual({ settings: {}, snippets: [] })
    await writeFile(join(data, 'snippets.json'), '{"not": "a list"}')
    expect((await service.editor()).snippets).toEqual([])
  })

  it('JSONC, snippet files, app folders per platform, supported commands', () => {
    expect(parseJsonc('{"a": "x // y", /* c */ "b": [1,2,],}')).toEqual({ a: 'x // y', b: [1, 2] })
    expect(parseJsonc('{"a": 1} /* never closed')).toEqual({ a: 1 })
    expect(snippetsOf(undefined)).toEqual([])
    expect(snippetsOf({ s: { prefix: 'p', body: 'b' } }, 'go')).toEqual([{ name: 's', language: 'go', prefix: 'p', body: 'b', description: undefined }])
    expect(snippetsOf({ s: { prefix: 'p', body: 'b', scope: 'shellscript' } })[0].language).toBe('shell')
    expect(appDataDir('darwin', {}, '/h')).toBe('/h/Library/Application Support')
    expect(appDataDir('win32', { APPDATA: 'C:\\A' }, '/h')).toBe('C:\\A')
    expect(appDataDir('win32', {}, '/h')).toBe('/h/AppData/Roaming')
    expect(appDataDir('linux', { XDG_CONFIG_HOME: '/x' }, '/h')).toBe('/x')
    expect(appDataDir('linux', {}, '/h')).toBe('/h/.config')
    expect(appDataDir()).toBeTruthy()
    expect(APPS.map((a) => a.app)).toEqual(['Code', 'Cursor', 'VSCodium', 'Windsurf'])
    expect(['editor.action.commentLine', 'workbench.action.quickOpen', 'cursorDown', 'gitlens.showGraph'].map(isSupportedCommand)).toEqual([true, true, true, false])
  })
})
