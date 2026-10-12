// Moving over from VS Code / Cursor: the editor settings, keybindings and
// snippets W-ONE takes along, and what becomes of each extension.
// (Colors and themes stay W-ONE's own, deliberately.)
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export interface EditorKeybinding {
  /** VS Code's notation: `cmd+shift+p`, chords as `cmd+k cmd+c`. */
  key: string
  command: string
  when?: string
}

/** The editor preferences W-ONE applies (taken from VS Code's settings.json). */
export interface EditorSettings {
  fontSize?: number
  fontFamily?: string
  fontLigatures?: boolean
  lineHeight?: number
  tabSize?: number
  insertSpaces?: boolean
  wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded'
  wordWrapColumn?: number
  minimap?: boolean
  lineNumbers?: 'on' | 'off' | 'relative' | 'interval'
  renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all'
  cursorStyle?: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin'
  cursorBlinking?: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'
  rulers?: number[]
  stickyScroll?: boolean
  smoothScrolling?: boolean
  bracketPairColorization?: boolean
  keybindings?: EditorKeybinding[]
  /** Where these came from, when. */
  importedFrom?: { app: string; at: string }
}

export interface Snippet {
  name: string
  /** Monaco language id, or `*` for every language. */
  language: string
  prefix: string
  /** VS Code snippet syntax ($1, ${2:name}, $0) — Monaco reads it as is. */
  body: string
  description?: string
}

export type ExtensionFate = 'built-in' | 'language' | 'snippets' | 'theme' | 'unsupported'

export interface MigrationExtension {
  id: string
  name: string
  fate: ExtensionFate
  /** For `language`: the registry id to install under Settings → Languages. */
  language?: string
}

export interface MigrationSource {
  /** Folder name of the app's data: Code, Cursor, VSCodium, Windsurf. */
  app: string
  name: string
  /** Editor settings W-ONE understands. */
  settings: number
  keybindings: number
  snippets: number
  extensions: MigrationExtension[]
}

export interface MigrationResult {
  settings: number
  keybindings: number
  snippets: number
}

/** VS Code's workbench commands → the W-ONE command palette's ids. */
export const WORKBENCH_COMMANDS: Record<string, string> = {
  'workbench.action.quickOpen': 'go.file',
  'workbench.action.showCommands': 'palette',
  'workbench.action.gotoLine': 'go.line',
  'workbench.action.files.save': 'file.save',
  'workbench.action.files.saveAll': 'file.saveAll',
  'workbench.action.closeActiveEditor': 'file.close',
  'workbench.action.files.newUntitledFile': 'file.new',
  'explorer.newFile': 'file.new',
  'explorer.newFolder': 'file.newFolder',
  'workbench.action.findInFiles': 'view.search',
  'workbench.view.search': 'view.search',
  'workbench.view.scm': 'view.scm',
  'workbench.view.explorer': 'view.files',
  'workbench.view.debug': 'debug.view',
  'workbench.action.debug.start': 'debug.start',
  'workbench.action.debug.continue': 'debug.continue',
  'workbench.action.debug.stop': 'debug.stop',
  'workbench.action.debug.restart': 'debug.restart',
  'workbench.action.debug.stepOver': 'debug.stepOver',
  'workbench.action.debug.stepInto': 'debug.stepInto',
  'workbench.action.debug.stepOut': 'debug.stepOut',
  'editor.debug.action.toggleBreakpoint': 'debug.breakpoint',
  'git.commit': 'git.commit',
  'git.pull': 'git.pull',
  'git.push': 'git.push',
  'git.sync': 'git.sync',
  'git.fetch': 'git.fetch',
  'git.checkout': 'git.checkout',
  'workbench.action.terminal.toggleTerminal': 'module.terminal',
  'workbench.action.terminal.new': 'module.terminal'
}

/** A keybinding W-ONE can honor: Monaco's own editor commands, or a mapped workbench command. */
export const isSupportedCommand = (command: string): boolean =>
  command in WORKBENCH_COMMANDS || /^(editor\.|cursor|actions\.find|deleteLines|undo|redo|tab|outdent)/.test(command)

/** What becomes of well-known extensions. Others are judged by what they contain. */
export const KNOWN_EXTENSIONS: Record<string, { fate: ExtensionFate; language?: string }> = {
  'ms-python.python': { fate: 'language', language: 'python' },
  'ms-python.vscode-pylance': { fate: 'language', language: 'python' },
  'ms-python.debugpy': { fate: 'language', language: 'python' },
  'ms-python.vscode-python-envs': { fate: 'language', language: 'python' },
  'golang.go': { fate: 'language', language: 'go' },
  'rust-lang.rust-analyzer': { fate: 'language', language: 'rust' },
  'ms-vscode.cpptools': { fate: 'language', language: 'cpp' },
  'ms-vscode.cpptools-extension-pack': { fate: 'language', language: 'cpp' },
  'llvm-vs-code-extensions.vscode-clangd': { fate: 'language', language: 'cpp' },
  'redhat.java': { fate: 'language', language: 'java' },
  'vscjava.vscode-java-pack': { fate: 'language', language: 'java' },
  'ms-dotnettools.csharp': { fate: 'language', language: 'csharp' },
  'ms-dotnettools.csdevkit': { fate: 'language', language: 'csharp' },
  'bmewburn.vscode-intelephense-client': { fate: 'language', language: 'php' },
  'shopify.ruby-lsp': { fate: 'language', language: 'ruby' },
  'swiftlang.swift-vscode': { fate: 'language', language: 'swift' },
  'sswg.swift-lang': { fate: 'language', language: 'swift' },
  'fwcd.kotlin': { fate: 'language', language: 'kotlin' },
  'sumneko.lua': { fate: 'language', language: 'lua' },
  'redhat.vscode-yaml': { fate: 'language', language: 'yaml' },
  'mads-hartmann.bash-ide-vscode': { fate: 'language', language: 'shell' },
  'ms-azuretools.vscode-docker': { fate: 'language', language: 'dockerfile' },
  'eamodio.gitlens': { fate: 'built-in' },
  'mhutchie.git-graph': { fate: 'built-in' },
  'donjayamanne.githistory': { fate: 'built-in' },
  'alefragnani.project-manager': { fate: 'built-in' },
  'anthropic.claude-code': { fate: 'built-in' },
  'openai.chatgpt': { fate: 'built-in' },
  'ms-ceintl.vscode-language-pack-de': { fate: 'built-in' }
}
