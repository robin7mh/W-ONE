import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { StackInfo } from '@shared/types/project'

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

// Maps a dependency name (dep or devDep) to a framework label.
const DEP_FRAMEWORKS: Record<string, string> = {
  react: 'React',
  next: 'Next.js',
  electron: 'Electron',
  vue: 'Vue',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  vite: 'Vite',
  express: 'Express',
  fastify: 'Fastify',
  tailwindcss: 'Tailwind',
  'framer-motion': 'Framer Motion'
}

/**
 * Deterministic tech-stack inference from top-level manifest/marker files only
 * (no recursive scan, no code parsing). Fast and safe for Phase 1 — deeper
 * structural analysis is Phase 4.
 */
export async function detectStack(dir: string): Promise<StackInfo> {
  const entries = await listDir(dir)
  const has = (name: string) => entries.includes(name)

  const languages = new Set<string>()
  const frameworks = new Set<string>()
  let packageManager: StackInfo['packageManager']
  let packageJson: StackInfo['packageJson']

  if (has('package.json')) {
    languages.add('JavaScript')
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>
      packageJson = {
        name: typeof pkg.name === 'string' ? pkg.name : undefined,
        version: typeof pkg.version === 'string' ? pkg.version : undefined,
        scripts: pkg.scripts && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts) : []
      }
      if ('typescript' in deps || has('tsconfig.json')) languages.add('TypeScript')
      for (const [dep, label] of Object.entries(DEP_FRAMEWORKS)) {
        if (dep in deps) frameworks.add(label)
      }
    } catch {
      /* malformed package.json — keep JavaScript only */
    }
    packageManager = has('pnpm-lock.yaml')
      ? 'pnpm'
      : has('yarn.lock')
        ? 'yarn'
        : has('bun.lockb')
          ? 'bun'
          : has('package-lock.json')
            ? 'npm'
            : undefined
  }

  if (has('tsconfig.json')) languages.add('TypeScript')
  if (has('Cargo.toml')) languages.add('Rust')
  if (has('go.mod')) languages.add('Go')
  if (has('requirements.txt') || has('pyproject.toml') || has('setup.py')) languages.add('Python')
  if (has('Gemfile')) languages.add('Ruby')
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) languages.add('Java')
  if (has('Dockerfile') || has('docker-compose.yml')) frameworks.add('Docker')
  if ((has('tailwind.config.ts') || has('tailwind.config.js')) && !frameworks.has('Tailwind')) {
    frameworks.add('Tailwind')
  }

  const hasReadme = entries.some((e) => /^readme(\.|$)/i.test(e))

  return {
    languages: [...languages],
    frameworks: [...frameworks],
    packageManager,
    hasReadme,
    packageJson
  }
}
