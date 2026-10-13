import { existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { shellQuote } from '../terminal/TerminalService'

/** How a tool gets onto the machine: a shell command needing one program (npm, go, brew, …). */
export interface InstallSpec {
  requires: string
  command: (tools: string) => string
}

export interface ToolSpec {
  name: string
  /** A shell snippet printing the tool's path (empty when it isn't there), run in the user's login shell. */
  locate: (tools: string) => string
  install?: InstallSpec
}

export interface ServerSpec extends ToolSpec {
  args: (ctx: { root: string; tools: string }) => string[]
  /** The `initialize` request's initializationOptions (jdtls: its debug plugin). */
  initializationOptions?: (ctx: { root: string; tools: string }) => unknown
  /** Answers to `workspace/configuration`, by section. */
  settings?: (root: string) => Record<string, unknown>
}

export interface CatalogEntry {
  server: ServerSpec
  debugger?: ToolSpec
}

/** `command -v bin`, else the first executable of `fallbacks` (shell words, expanded). */
export function which(bin: string, fallbacks: string[] = []): string {
  const loop = fallbacks.length ? ` || { for p in ${fallbacks.join(' ')}; do [ -x "$p" ] && echo "$p" && break; done; }` : ''
  return `{ command -v ${bin} 2>/dev/null${loop}; true; }`
}

/** A server installed with npm into W-ONE's tools folder (found there first). */
const npmBin = (bin: string) => (tools: string) => {
  const local = shellQuote(join(tools, 'npm', 'node_modules', '.bin', bin))
  return `{ [ -x ${local} ] && echo ${local} || command -v ${bin} 2>/dev/null; true; }`
}
const npm = (...packages: string[]): InstallSpec => ({
  requires: 'npm',
  command: (tools) => `npm install --prefix ${shellQuote(join(tools, 'npm'))} --no-audit --no-fund --loglevel=error ${packages.join(' ')}`
})
const brew = (formula: string): InstallSpec => ({ requires: 'brew', command: () => `brew install ${formula}` })

/** A VS Code extension's files from Open VSX (MIT-licensed debug adapters), unpacked into `<tools>/<dir>/extension`. */
const openVsx = (requires: string, extension: string, dir: string): InstallSpec => ({
  requires,
  command: (tools) => {
    const d = shellQuote(join(tools, dir))
    return [
      `rm -rf ${d} && mkdir -p ${d}`,
      `url=$(curl -fsSL https://open-vsx.org/api/${extension} | grep -o '"download":"[^"]*"' | head -1 | cut -d'"' -f4)`,
      `curl -fsSL "$url" -o ${d}/ext.vsix`,
      `unzip -oq ${d}/ext.vsix 'extension/*' -d ${d}`,
      `rm ${d}/ext.vsix`
    ].join(' && ')
  }
})

/** LLDB's debug adapter — C, C++, Objective-C, Rust and Swift (Xcode's, Homebrew's LLVM, or the system's). */
const lldbDap: ToolSpec = {
  name: 'lldb-dap',
  locate: () =>
    `{ command -v lldb-dap 2>/dev/null || xcrun --find lldb-dap 2>/dev/null || command -v lldb-vscode 2>/dev/null || { for p in /opt/homebrew/opt/llvm/bin/lldb-dap /usr/local/opt/llvm/bin/lldb-dap; do [ -x "$p" ] && echo "$p" && break; done; }; true; }`,
  install: brew('llvm')
}

/** Microsoft's Java debug plugin for jdtls (from the Java Debugger extension). */
export function javaDebugJar(tools: string): string | undefined {
  const dir = join(tools, 'java-debug', 'extension', 'server')
  const jar = existsSync(dir) ? readdirSync(dir).filter((f) => /^com\.microsoft\.java\.debug\.plugin-.*\.jar$/.test(f)).sort().pop() : undefined
  return jar && join(dir, jar)
}

/** The project's virtualenv interpreter (`bin/python`, on Windows `Scripts\\python.exe`), if it has one. */
export function venvPython(root: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const inVenv = platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']
  return ['.venv', 'venv', 'env'].map((venv) => join(root, venv, ...inVenv)).find((python) => existsSync(python))
}

/** The Python on the PATH: `python3` (Windows installs call it `python`). */
export const systemPython = (platform: NodeJS.Platform = process.platform): string => (platform === 'win32' ? 'python' : 'python3')

/** A Python interpreter: the project's virtualenv, else the system's. */
export function pythonFor(root: string, platform: NodeJS.Platform = process.platform): string {
  return venvPython(root, platform) ?? systemPython(platform)
}

/**
 * Language servers and debuggers W-ONE knows how to find and install —
 * the tools VS Code's language extensions wrap, used directly.
 */
export const CATALOG: Record<string, CatalogEntry> = {
  python: {
    server: {
      name: 'Pyright',
      locate: npmBin('pyright-langserver'),
      args: () => ['--stdio'],
      install: npm('pyright'),
      settings: (root) => ({
        python: { pythonPath: pythonFor(root) },
        'python.analysis': { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly' }
      })
    },
    debugger: {
      name: 'debugpy',
      locate: (tools) => {
        const dir = shellQuote(join(tools, 'debugpy'))
        return `{ [ -f ${dir}/debugpy/__init__.py ] && echo ${dir}; true; }`
      },
      install: { requires: 'python3', command: (tools) => `python3 -m pip install --upgrade --quiet --target ${shellQuote(join(tools, 'debugpy'))} debugpy` }
    }
  },
  go: {
    server: {
      name: 'gopls',
      locate: () => which('gopls', ['"$(go env GOPATH 2>/dev/null)/bin/gopls"']),
      args: () => [],
      install: { requires: 'go', command: () => 'go install golang.org/x/tools/gopls@latest' }
    },
    debugger: {
      name: 'Delve',
      locate: () => which('dlv', ['"$(go env GOPATH 2>/dev/null)/bin/dlv"']),
      install: { requires: 'go', command: () => 'go install github.com/go-delve/delve/cmd/dlv@latest' }
    }
  },
  rust: {
    server: {
      name: 'rust-analyzer',
      locate: () => `{ command -v rust-analyzer 2>/dev/null || rustup which rust-analyzer 2>/dev/null; true; }`,
      args: () => [],
      install: { requires: 'rustup', command: () => 'rustup component add rust-analyzer' }
    },
    debugger: lldbDap
  },
  cpp: {
    server: {
      name: 'clangd',
      locate: () => which('clangd', ['/opt/homebrew/opt/llvm/bin/clangd', '/usr/local/opt/llvm/bin/clangd']),
      args: () => ['--background-index'],
      install: brew('llvm')
    },
    debugger: lldbDap
  },
  java: {
    server: {
      name: 'Eclipse JDT LS',
      locate: () => which('jdtls'),
      // jdtls keeps its index per workspace — one folder per project.
      args: ({ root, tools }) => ['-data', join(tools, 'jdtls', createHash('sha1').update(root).digest('hex').slice(0, 12))],
      // The debug plugin rides along when it is installed (Run & Debug starts sessions through jdtls).
      initializationOptions: ({ tools }) => {
        const jar = javaDebugJar(tools)
        return { bundles: jar ? [jar] : [] }
      },
      install: brew('jdtls')
    },
    debugger: {
      name: 'Java Debug',
      locate: (tools) => `{ ls ${shellQuote(join(tools, 'java-debug', 'extension', 'server'))}/com.microsoft.java.debug.plugin-*.jar 2>/dev/null | tail -1; true; }`,
      install: openVsx('java', 'vscjava/vscode-java-debug', 'java-debug')
    }
  },
  csharp: {
    server: {
      name: 'csharp-ls',
      locate: () => which('csharp-ls', ['"$HOME/.dotnet/tools/csharp-ls"']),
      args: () => [],
      install: { requires: 'dotnet', command: () => 'dotnet tool install --global csharp-ls' }
    }
  },
  php: {
    server: { name: 'Intelephense', locate: npmBin('intelephense'), args: () => ['--stdio'], install: npm('intelephense') },
    // Xdebug's own adapter; the program needs php with the Xdebug extension.
    debugger: {
      name: 'PHP Debug (Xdebug)',
      locate: (tools) => {
        const js = shellQuote(join(tools, 'php-debug', 'extension', 'out', 'phpDebug.js'))
        return `{ [ -f ${js} ] && echo ${js}; true; }`
      },
      install: openVsx('php', 'xdebug/php-debug', 'php-debug')
    }
  },
  ruby: {
    server: {
      name: 'Ruby LSP',
      locate: () => which('ruby-lsp', [`"$(ruby -e 'print Gem.bindir' 2>/dev/null)/ruby-lsp"`]),
      args: () => [],
      install: { requires: 'gem', command: () => 'gem install ruby-lsp' }
    }
  },
  swift: {
    // Comes with Xcode / the Swift toolchain.
    server: { name: 'SourceKit-LSP', locate: () => `{ command -v sourcekit-lsp 2>/dev/null || xcrun --find sourcekit-lsp 2>/dev/null; true; }`, args: () => [] },
    debugger: lldbDap
  },
  kotlin: {
    server: { name: 'Kotlin Language Server', locate: () => which('kotlin-language-server'), args: () => [], install: brew('kotlin-language-server') },
    debugger: {
      name: 'Kotlin Debug Adapter',
      locate: (tools) => {
        const bin = shellQuote(join(tools, 'kotlin-debug', 'adapter', 'bin', 'kotlin-debug-adapter'))
        return `{ [ -x ${bin} ] && echo ${bin}; true; }`
      },
      install: {
        requires: 'java',
        command: (tools) => {
          const d = shellQuote(join(tools, 'kotlin-debug'))
          return `rm -rf ${d} && mkdir -p ${d} && curl -fsSL https://github.com/fwcd/kotlin-debug-adapter/releases/latest/download/adapter.zip -o ${d}/adapter.zip && unzip -oq ${d}/adapter.zip -d ${d} && rm ${d}/adapter.zip && chmod +x ${d}/adapter/bin/kotlin-debug-adapter`
        }
      }
    }
  },
  lua: {
    server: { name: 'Lua Language Server', locate: () => which('lua-language-server'), args: () => [], install: brew('lua-language-server') }
  },
  yaml: {
    server: {
      name: 'YAML Language Server',
      locate: npmBin('yaml-language-server'),
      args: () => ['--stdio'],
      install: npm('yaml-language-server'),
      settings: () => ({ yaml: { validate: true, hover: true, completion: true, schemaStore: { enable: true } } })
    }
  },
  shell: {
    server: { name: 'Bash Language Server', locate: npmBin('bash-language-server'), args: () => ['start'], install: npm('bash-language-server') }
  },
  dockerfile: {
    server: { name: 'Dockerfile Language Server', locate: npmBin('docker-langserver'), args: () => ['--stdio'], install: npm('dockerfile-language-server-nodejs') }
  }
}
