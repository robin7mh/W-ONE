// How W-ONE starts Claude Code: the unmodified binary, signed in with the
// user's own account, with everything W-ONE needs passed per session on the
// command line — the user's ~/.claude settings are never touched.

/** Read-only memory tools run without asking; writing to the vault still asks. */
export const MEMORY_READ_TOOLS = ['mcp__wone__memory_search', 'mcp__wone__memory_read', 'mcp__wone__memory_list', 'mcp__wone__project_context']

export const SYSTEM_HINT =
  "You are running inside W-ONE, the user's workspace. W-ONE's memory (MCP server \"wone\") holds project knowledge, decisions " +
  'and journals of earlier agent sessions: search it (mcp__wone__memory_search) before larger changes, and record lasting ' +
  'decisions with mcp__wone__memory_create_note or mcp__wone__memory_append.'

/**
 * For the two events HTTP hooks don't cover (SessionStart, Notification):
 * a command hook relays the event JSON to the same endpoint. The URL and token
 * come from the environment W-ONE gives the PTY — not from this string.
 */
export const HOOK_RELAY =
  'curl -s -m 5 -X POST -H \'Content-Type: application/json\' -H "Authorization: Bearer $WONE_TOKEN" --data-binary @- "$WONE_HOOK_URL" >/dev/null 2>&1 || true'

const HTTP_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'TaskCreated', 'TaskCompleted', 'SessionEnd']
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

/** `--settings` JSON: hooks only. Hooks add to the user's own — they replace nothing. */
export function hookSettings(hookUrl: string, token: string) {
  const http = (timeout: number) => ({ type: 'http', url: hookUrl, headers: { Authorization: `Bearer ${token}` }, timeout })
  const relay = { type: 'command', command: HOOK_RELAY, async: true }
  const hooks: Record<string, unknown[]> = {}
  for (const event of HTTP_EVENTS) hooks[event] = [{ ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}), hooks: [http(10)] }]
  // Waits for the user's decision in W-ONE — longer than W-ONE's own 10-minute approval timeout.
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
}

export function claudeArgs(input: LaunchInput): string[] {
  const mcp = { mcpServers: { wone: { type: 'http', url: input.mcpUrl, headers: { Authorization: `Bearer ${input.token}` } } } }
  const args = [
    ...(input.resume ? ['--resume', input.sessionId] : ['--session-id', input.sessionId, '--name', input.title]),
    '--settings',
    JSON.stringify(hookSettings(input.hookUrl, input.token)),
    '--mcp-config',
    JSON.stringify(mcp),
    '--append-system-prompt',
    SYSTEM_HINT,
    '--allowedTools',
    ...MEMORY_READ_TOOLS
  ]
  // `--allowedTools` takes several values: the prompt must not be read as one more.
  if (input.prompt && !input.resume) args.push('--', input.prompt)
  return args
}

/** The PTY's extra environment, read by the relay hook. */
export function claudeEnv(hookUrl: string, token: string): Record<string, string> {
  return { WONE_HOOK_URL: hookUrl, WONE_TOKEN: token }
}
