import { readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type {
  ContextTreeNode,
  ContextTodo,
  ContextDependency,
  ContextConfigFile,
  TodoKind
} from '@shared/types/context'
import type { ScanResult } from './scan'

/** Shallow tree (top two levels) for a structural overview — bounded. */
export function buildTree(scan: ScanResult, maxNodes = 240): ContextTreeNode[] {
  return scan.entries
    .filter((e) => e.depth <= 1)
    .sort((a, b) => (a.type === b.type ? a.rel.localeCompare(b.rel) : a.type === 'dir' ? -1 : 1))
    .slice(0, maxNodes)
    .map((e) => ({ path: e.rel, type: e.type }))
}

// Basename → human label. Prefixes (e.g. .eslintrc) matched by startsWith.
const CONFIG_FILES: { match: (name: string) => boolean; kind: string }[] = [
  { match: (n) => n === 'tsconfig.json' || n.startsWith('tsconfig.'), kind: 'TypeScript' },
  { match: (n) => n.startsWith('vite.config') || n.startsWith('electron.vite.config'), kind: 'Vite' },
  { match: (n) => n.startsWith('tailwind.config'), kind: 'Tailwind' },
  { match: (n) => n.startsWith('postcss.config'), kind: 'PostCSS' },
  { match: (n) => n.startsWith('.eslintrc') || n === 'eslint.config.js', kind: 'ESLint' },
  { match: (n) => n.startsWith('.prettierrc') || n === 'prettier.config.js', kind: 'Prettier' },
  { match: (n) => n === 'next.config.js' || n === 'next.config.mjs', kind: 'Next.js' },
  { match: (n) => n === 'nuxt.config.ts', kind: 'Nuxt' },
  { match: (n) => n === 'svelte.config.js', kind: 'Svelte' },
  { match: (n) => n === 'Dockerfile' || n === 'docker-compose.yml' || n === 'compose.yaml', kind: 'Docker' },
  { match: (n) => n === 'pyproject.toml' || n === 'requirements.txt', kind: 'Python' },
  { match: (n) => n === 'Cargo.toml', kind: 'Rust' },
  { match: (n) => n === 'go.mod', kind: 'Go' },
  { match: (n) => n === '.env.example' || n === '.env.sample', kind: 'Env template' },
  { match: (n) => n === 'Makefile', kind: 'Make' }
]

/** Detect known config files at the top two levels. */
export function detectConfigFiles(scan: ScanResult): ContextConfigFile[] {
  const found: ContextConfigFile[] = []
  const seen = new Set<string>()
  for (const e of scan.entries) {
    if (e.type !== 'file' || e.depth > 1) continue
    const name = basename(e.rel)
    if (seen.has(name)) continue
    const hit = CONFIG_FILES.find((c) => c.match(name))
    if (hit) {
      found.push({ name, kind: hit.kind })
      seen.add(name)
    }
  }
  return found
}

/** Full dependency list from the root package.json. */
export async function parseDependencies(root: string): Promise<ContextDependency[]> {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const out: ContextDependency[] = []
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      out.push({ name, version: String(version), dev: false })
    }
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      out.push({ name, version: String(version), dev: true })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.sass', '.less',
  '.html', '.vue', '.svelte', '.json', '.md', '.mdx', '.py', '.go', '.rs', '.java',
  '.kt', '.rb', '.php', '.c', '.h', '.cpp', '.cs', '.swift', '.sh', '.zsh', '.yml',
  '.yaml', '.toml', '.sql', '.txt'
])
const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b[:\-\s]*(.*)/

function ext(rel: string): string {
  const i = rel.lastIndexOf('.')
  return i < 0 ? '' : rel.slice(i).toLowerCase()
}

/** Scan text files for TODO/FIXME/HACK/XXX markers. Bounded on all axes. */
export async function scanTodos(
  scan: ScanResult,
  opts: { maxFiles?: number; maxSize?: number; maxTodos?: number } = {}
): Promise<ContextTodo[]> {
  const maxFiles = opts.maxFiles ?? 1500
  const maxSize = opts.maxSize ?? 512 * 1024
  const maxTodos = opts.maxTodos ?? 500

  const candidates = scan.entries.filter(
    (e) => e.type === 'file' && e.size <= maxSize && TEXT_EXT.has(ext(e.rel))
  )
  const todos: ContextTodo[] = []
  let scanned = 0

  for (const file of candidates) {
    if (scanned >= maxFiles || todos.length >= maxTodos) break
    scanned += 1
    let content: string
    try {
      content = await readFile(file.abs, 'utf8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const m = TODO_RE.exec(lines[i])
      if (m) {
        todos.push({
          file: file.rel,
          line: i + 1,
          kind: m[1] as TodoKind,
          text: m[2].trim().slice(0, 200)
        })
        if (todos.length >= maxTodos) break
      }
    }
  }
  return todos
}

/** Extract README title (first H1) + section headings (H2/H3). */
export async function parseReadme(
  root: string,
  scan: ScanResult
): Promise<{ title?: string; sections: string[] } | undefined> {
  const readme = scan.entries.find(
    (e) => e.type === 'file' && e.depth === 0 && /^readme(\.|$)/i.test(basename(e.rel))
  )
  if (!readme) return undefined
  let content: string
  try {
    content = await readFile(readme.abs, 'utf8')
  } catch {
    return undefined
  }
  let title: string | undefined
  const sections: string[] = []
  for (const line of content.split(/\r?\n/)) {
    const h1 = /^#\s+(.+)/.exec(line)
    const h23 = /^##{1,2}\s+(.+)/.exec(line)
    if (h1 && !title) title = h1[1].trim()
    else if (h23 && sections.length < 30) sections.push(h23[1].trim())
  }
  return { title, sections }
}
