// A minimal ACP agent over stdio, for the spawnAcp test: it answers the
// handshake and opens a session — enough to prove the pipes and framing work.
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
new AgentSideConnection(
  () => ({
    initialize: async () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }),
    newSession: async ({ cwd }) => ({ sessionId: `from ${cwd}` }),
    authenticate: async () => ({}),
    prompt: async () => ({ stopReason: 'end_turn' }),
    cancel: async () => {}
  }),
  stream
)
process.stderr.write('agent log line\n')
