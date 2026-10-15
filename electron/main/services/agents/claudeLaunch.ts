// How Mindeck starts Claude Code: the unmodified binary, signed in with the
// user's own account, with everything Mindeck needs passed per session on the
// command line — the user's ~/.claude settings are never touched.

import type { AgentCommand } from '@shared/types/agents'

/** Built-in commands that answer in the chat (not only in the terminal) and keep the session. */
export const CLAUDE_COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Summarize the conversation to free up context', hint: 'what to keep' },
  { name: 'init', description: 'Write a CLAUDE.md that describes this project' },
  { name: 'review', description: 'Review a pull request', hint: 'PR number' },
  { name: 'security-review', description: 'Review the pending changes for security issues' },
  { name: 'model', description: 'Switch the model', hint: 'opus, sonnet, haiku' }
]

/** Read-only memory tools run without asking; writing to the vault still asks. */
export const MEMORY_READ_TOOLS = ['mcp__mindeck__memory_search', 'mcp__mindeck__memory_read', 'mcp__mindeck__memory_list', 'mcp__mindeck__project_context']
/** Reading the browser runs unasked too: agents only ever see tabs shared with them. */
export const MCP_BROWSER_READ_TOOLS = ['mcp__mindeck__browser_tabs', 'mcp__mindeck__browser_snapshot', 'mcp__mindeck__browser_read', 'mcp__mindeck__browser_screenshot', 'mcp__mindeck__browser_console']

export const SYSTEM_HINT =
  "You are running inside Mindeck, the user's workspace. Mindeck's memory (MCP server \"mindeck\") holds project knowledge, decisions " +
  'and journals of earlier agent sessions: search it (mcp__mindeck__memory_search) before larger changes, and record lasting ' +
  'decisions with mcp__mindeck__memory_create_note or mcp__mindeck__memory_append. Mindeck also has a browser (mcp__mindeck__browser_*): ' +
  "it shows the user's local dev pages and tabs they share — after UI changes, check the page with browser_snapshot and browser_console."

/**
 * For the two events HTTP hooks don't cover (SessionStart, Notification):
 * a command hook relays the event JSON to the same endpoint. The URL and token
 * come from the environment Mindeck gives the PTY — not from this string.
 */
export const HOOK_RELAY =
  'curl -s -m 5 -X POST -H \'Content-Type: application/json\' -H "Authorization: Bearer $MINDECK_TOKEN" --data-binary @- "$MINDECK_HOOK_URL" >/dev/null 2>&1 || true'

const HTTP_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'TaskCreated', 'TaskCompleted', 'SessionEnd']
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

/** `--settings` JSON: hooks only. Hooks add to the user's own — they replace nothing. */
export function hookSettings(hookUrl: string, token: string) {
  const http = (timeout: number) => ({ type: 'http', url: hookUrl, headers: { Authorization: `Bearer ${token}` }, timeout })
  const relay = { type: 'command', command: HOOK_RELAY, async: true }
  const hooks: Record<string, unknown[]> = {}
  for (const event of HTTP_EVENTS) hooks[event] = [{ ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}), hooks: [http(10)] }]
  // Waits for the user's decision in Mindeck — longer than Mindeck's own 10-minute approval timeout.
  hooks.PermissionRequest = [{ matcher: '*', hooks: [http(660)] }]
  hooks.SessionStart = [{ hooks: [relay] }]
  hooks.Notification = [{ hooks: [relay] }]
  return { hooks }
}

export interface LaunchInput {
  sessionId: string
  title: string
  hookUrl: string
  mcpUrl: string
  token: string
  /** Continue an earlier session (its transcript) instead of starting a new one. */
  resume?: boolean
  /** First message (new sessions only). */
  prompt?: string
  /** A model alias from CLAUDE_MODELS (`default` = none given). */
  model?: string
  /** A permission mode from CLAUDE_MODES (`default` = none given). */
  mode?: string
}

export function claudeArgs(input: LaunchInput): string[] {
  const mcp = { mcpServers: { mindeck: { type: 'http', url: input.mcpUrl, headers: { Authorization: `Bearer ${input.token}` } } } }
  const args = [
    ...(input.resume ? ['--resume', input.sessionId] : ['--session-id', input.sessionId, '--name', input.title]),
    ...(input.model && input.model !== 'default' ? ['--model', input.model] : []),
    ...(input.mode && input.mode !== 'default' ? ['--permission-mode', input.mode] : []),
    '--settings',
    JSON.stringify(hookSettings(input.hookUrl, input.token)),
    '--mcp-config',
    JSON.stringify(mcp),
    '--append-system-prompt',
    SYSTEM_HINT,
    '--allowedTools',
    ...MEMORY_READ_TOOLS,
    ...MCP_BROWSER_READ_TOOLS
  ]
  // `--allowedTools` takes several values: the prompt must not be read as one more.
  if (input.prompt && !input.resume) args.push('--', input.prompt)
  return args
}

/** The PTY's extra environment, read by the relay hook. */
export function claudeEnv(hookUrl: string, token: string): Record<string, string> {
  return { MINDECK_HOOK_URL: hookUrl, MINDECK_TOKEN: token }
}
