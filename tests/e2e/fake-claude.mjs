#!/usr/bin/env node
// A stand-in for the Claude Code CLI in end-to-end tests (WONE_CLAUDE_BIN):
// it reads the flags W-ONE passes, talks back through the real hooks, asks
// for one approval and writes a file — without any model or account.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log('9.9.9 (Claude Code)')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }))
  process.exit(0)
}

const flag = (name) => args[args.indexOf(name) + 1]
const settings = JSON.parse(flag('--settings'))
const http = settings.hooks.Stop[0].hooks[0]
const sessionId = flag('--session-id') ?? flag('--resume')
const hook = async (event, extra = {}) => {
  const res = await fetch(http.url, {
    method: 'POST',
    headers: { ...http.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hook_event_name: event, session_id: sessionId, cwd: process.cwd(), ...extra })
  })
  return res.status === 200 ? res.json() : undefined
}

async function turn(prompt) {
  await hook('UserPromptSubmit', { prompt })
  const input = { command: 'echo written by the fake agent > fake-output.txt' }
  await hook('PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: 'tool-1' })
  const answer = await hook('PermissionRequest', { tool_name: 'Bash', tool_input: input, tool_use_id: 'tool-1' })
  if (answer?.hookSpecificOutput?.decision?.behavior === 'allow') {
    writeFileSync(join(process.cwd(), 'fake-output.txt'), 'written by the fake agent\n')
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: 'tool-1', tool_response: { stdout: '' } })
    await hook('Stop', { last_assistant_message: 'Done: wrote fake-output.txt' })
  } else {
    await hook('Stop', { last_assistant_message: 'Okay, I left it.' })
  }
}

// SessionStart goes through the relay (a command hook) in the real CLI.
await fetch(process.env.WONE_HOOK_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.WONE_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: sessionId })
})
console.log('fake claude ready')

let line = ''
const prompt = args.includes('--') ? args[args.indexOf('--') + 1] : undefined
if (prompt) await turn(prompt)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  line += chunk.replace(/\x1b\[20[01]~/g, '')
  const end = line.search(/[\r\n]/)
  if (end < 0) return
  const text = line.slice(0, end).trim()
  line = ''
  if (text) void turn(text)
})
