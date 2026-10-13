import { mkdir, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type { LspDiagnostic } from '@shared/types/lsp'
import type { SassFormat, SassSettings } from '@shared/types/migrate'
import type { SassResult } from '@shared/types/live'
import { confine } from '../../lib/confine'
import { writeAtomic } from '../../lib/writeAtomic'
import { matchesGlob } from './LiveServerService'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}


/** The compiler (Dart Sass); swapped in tests. */
export interface SassCompiler {
  compileAsync(path: string, opts: { style: 'expanded' | 'compressed'; sourceMap: boolean; loadPaths?: string[] }): Promise<{ css: string; sourceMap?: unknown }>
}

const DEFAULT_FORMATS: SassFormat[] = [{ format: 'expanded', extensionName: '.css', savePath: null }]
const SKIP = new Set(['node_modules', '.git'])
const isSass = (p: string) => /\.s[ac]ss$/i.test(p)
const isPartial = (p: string) => basename(p).startsWith('_')

/**
 * Where a format writes a compiled file — the Live Sass Compiler's rules:
 * no savePath → next to the source; '/css' → from the project root;
 * '~/../css' → from the source file's folder.
 */
export function outputPath(root: string, source: string, format: SassFormat): string {
  const name = basename(source, extname(source)) + format.extensionName
  const save = format.savePath
  if (!save) return join(dirname(source), name)
  if (save.startsWith('~')) return join(dirname(source), save.slice(1), name)
  return join(root, save, name)
}

/**
 * Live Sass Compiler: .scss / .sass → .css (and maps), as the user's settings
 * say. A saved partial (`_x.scss`) recompiles every non-partial file, since
 * any of them may use it.
 */
export class SassService {
  constructor(
    private readonly resolveRoot: (projectId: string) => string | undefined,
    private readonly settings: () => SassSettings | undefined = () => undefined,
    private readonly compiler: () => Promise<SassCompiler> = async () => (await import('sass')) as unknown as SassCompiler
  ) {}

  /** A saved file: compile it (or, for a partial, every file that may use it). Other files: nothing. */
  async compile(projectId: string, path: string): Promise<SassResult> {
    if (!isSass(path)) return { written: [], errors: {} }
    const root = await this.root(projectId)
    if (this.excluded(path)) return { written: [], errors: {} }
    const targets = isPartial(path) ? await this.all(root) : [path]
    return this.run(root, targets)
  }

  /** Compile every Sass file of the project (start of watching). */
  async compileAll(projectId: string): Promise<SassResult> {
    const root = await this.root(projectId)
    return this.run(root, await this.all(root))
  }

  // --- helpers ---

  private async root(projectId: string): Promise<string> {
    const configured = this.resolveRoot(projectId)
    if (!configured) throw coded('not-found', `Unknown project: ${projectId}`)
    return realpath(configured)
  }

  private excluded(rel: string): boolean {
    return (this.settings()?.exclude ?? []).some((g) => matchesGlob(rel, g) || rel.startsWith(`${g.replace(/^\/+|\/+$/g, '')}/`))
  }

  /** Every non-partial Sass file of the project (dependency folders and excluded ones left out). */
  private async all(root: string): Promise<string[]> {
    const found: string[] = []
    const walk = async (dir: string) => {
      for (const d of await readdir(dir, { withFileTypes: true })) {
        if (SKIP.has(d.name)) continue
        const abs = join(dir, d.name)
        const rel = relative(root, abs).split(sep).join('/')
        if (d.isDirectory()) await walk(abs)
        else if (isSass(d.name) && !isPartial(d.name) && !this.excluded(rel)) found.push(rel)
      }
    }
    await walk(root)
    return found.sort()
  }

  private async run(root: string, sources: string[]): Promise<SassResult> {
    const sass = await this.compiler()
    const settings = this.settings() ?? {}
    const formats = settings.formats?.length ? settings.formats : DEFAULT_FORMATS
    const result: SassResult = { written: [], errors: {} }
    for (const rel of sources) {
      const source = await confine(root, rel)
      result.errors[rel] = []
      for (const format of formats) {
        try {
          const out = await sass.compileAsync(source, { style: format.format, sourceMap: !!settings.generateMap, loadPaths: [root] })
          const target = outputPath(root, source, format)
          await confine(root, relative(root, target)) // never outside the project
          await mkdir(dirname(target), { recursive: true })
          const map = settings.generateMap && out.sourceMap
          await writeAtomic(target, map ? `${out.css}\n/*# sourceMappingURL=${basename(target)}.map */\n` : `${out.css}\n`)
          if (map) await writeAtomic(`${target}.map`, JSON.stringify(out.sourceMap))
          result.written.push(relative(root, target).split(sep).join('/'))
        } catch (err) {
          const e = err as { message?: string; span?: { start: { line: number; column: number }; end: { line: number; column: number }; url?: URL } }
          if ((e as { code?: string }).code === 'outside-project') throw err
          const at = e.span ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }
          const message = (e.message ?? String(err)).split('\n')[0]
          result.errors[rel].push({
            range: { start: { line: at.start.line + 1, offset: at.start.column + 1 }, end: { line: at.end.line + 1, offset: at.end.column + 1 } },
            message,
            severity: 'error',
            source: 'Sass'
          })
          break
        }
      }
    }
    return result
  }
}
