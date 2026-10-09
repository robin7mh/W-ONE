import { execFile } from 'node:child_process'
import type { AgentAvailability, AgentKind } from '@shared/types/agents'
import { shellCommand, shellQuote } from '../terminal/TerminalService'

/** Runs a command line like the user's own terminal would (login shell → their PATH). */
export type Probe = (commandLine: string) => Promise<string>

export const loginShellProbe: Probe = (commandLine) =>
  new Promise((resolve, reject) => {
    const { file } = shellCommand()
    const args = process.platform === 'win32' ? ['-NoLogo', '-Command', commandLine] : ['-lc', commandLine]
    execFile(file, args, { timeout: 10_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })

const version = (out: string) => /(\d+\.\d+\.\d+)/.exec(out)?.[1]

const NAMES: Record<AgentKind, string> = { 'claude-code': 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }

const PLANS: Record<string, string> = { pro: 'Pro plan', max: 'Max plan', team: 'Team plan', enterprise: 'Enterprise plan' }

async function claude(probe: Probe, bin: string): Promise<AgentAvailability> {
  const base = { kind: 'claude-code' as const, name: NAMES['claude-code'] }
  const v = await probe(`${bin} --version`).catch(() => '')
  if (!v) return { ...base, installed: false, ready: false, hint: 'Install Claude Code: https://code.claude.com' }
  let status: { loggedIn?: boolean; authMethod?: string; subscriptionType?: string } = {}
  try {
    status = JSON.parse(await probe(`${bin} auth status`))
  } catch {
    /* older versions (no JSON) or not signed in: exit code 1 */
  }
  const account =
    status.authMethod === 'claude.ai'
      ? (PLANS[status.subscriptionType ?? ''] ?? 'Claude account')
      : status.authMethod && status.authMethod !== 'none'
        ? 'API key'
        : undefined
  const signedIn = !!status.loggedIn
  return {
    ...base,
    installed: true,
    version: version(v),
    signedIn,
    account,
    ready: signedIn,
    hint: signedIn ? undefined : 'Sign in once: claude auth login'
  }
}

/** ACP agents: installed = their CLI answers. Codex also needs npx for its ACP adapter. */
async function acpAgent(kind: 'codex' | 'gemini', probe: Probe): Promise<AgentAvailability> {
  const v = await probe(`${kind} --version`).catch(() => '')
  if (!v) return { kind, name: NAMES[kind], installed: false, ready: false, hint: `Not installed (${kind})` }
  const adapter = kind === 'gemini' || !!(await probe('npx --version').catch(() => ''))
  return {
    kind,
    name: NAMES[kind],
    installed: true,
    version: version(v),
    account: 'Your own sign-in',
    ready: adapter,
    hint: adapter ? undefined : 'Needs Node.js (npx) for the ACP adapter'
  }
}

/**
 * What's installed and usable — asked when the user opens "New chat" or
 * Settings. `claudeBin` overrides the Claude Code binary (tests, odd installs).
 */
export async function detectAgents(probe: Probe = loginShellProbe, claudeBin = 'claude'): Promise<AgentAvailability[]> {
  return Promise.all([claude(probe, shellQuote(claudeBin)), acpAgent('codex', probe), acpAgent('gemini', probe)])
}
