# W-ONE Core API

The W-ONE core speaks one contract to every client: the desktop window (over Electron IPC), the
web UI and the mobile app (over HTTP + WebSocket). This page is the reference for network clients —
first of all the React Native app.

- Contract (every channel, request and response type): [`src/shared/ipc/contract.ts`](../src/shared/ipc/contract.ts)
- Request validation (Zod, the same schemas the core enforces): [`src/shared/ipc/schemas.ts`](../src/shared/ipc/schemas.ts)
- Ready-made client (only `fetch` + `WebSocket`, works in React Native as is): [`src/shared/ipc/transport.ts`](../src/shared/ipc/transport.ts)
- Domain types: [`src/shared/types/`](../src/shared/types)

All of these are plain TypeScript with no DOM, Node or Electron imports — copy them into the app, or
(better) move them into a shared workspace package once the app repository exists.

## Where the core runs

| Host | Start | Base URL |
|---|---|---|
| Desktop app | Settings → Remote access → *Run the API server* (+ *Reachable on the local network* for a phone) | `http://<computer-ip>:7420` |
| Standalone (no Docker) | `npm run web` | `http://127.0.0.1:7420` (`WONE_LAN=1` for all interfaces) |
| Docker | `npm run docker:up` | `http://127.0.0.1:7420` (`WONE_BIND=0.0.0.0` in `.env` for the LAN) |

For access from outside your home network use a VPN such as Tailscale or WireGuard rather than
opening the port to the internet.

## 1. Pairing (once per device)

1. On a device that is already trusted: Settings → *Pair a device*. It shows a code like
   `K7QM-2XPA` (valid 10 minutes, one use) and a QR code with `http(s)://<core>/#pair=K7QM-2XPA`.
   Headless: `npm run server:pair` or `npm run docker:pair`. The standalone server also prints a code
   at startup as long as no device is paired.
2. The app reads the URL from the QR code (base URL = everything before `/#pair=`), or the user
   types the address and the code.
3. Redeem the code:

```http
POST /api/pair
Content-Type: application/json

{ "code": "K7QM-2XPA", "name": "Pixel 9" }
```

```json
{ "ok": true, "data": { "token": "wone_…", "device": { "id": "…", "name": "Pixel 9", "createdAt": "…" } } }
```

Store the token in the platform's secure storage (`expo-secure-store` / Keychain / Keystore). It is
shown exactly once; the core only keeps its SHA-256. Wrong codes answer `401 bad-code`; ten failures
in ten minutes from one address answer `429`.

`GET /api/health` → `{ ok, name: "W-ONE", version, mode: "desktop" | "server" }` (public) tells
whether a URL really is a W-ONE core.

## 2. Calls

```http
POST /api/rpc/<channel>
Authorization: Bearer wone_…
Content-Type: application/json

<request payload as JSON, or nothing for channels without a payload>
```

Every call answers HTTP 200 with an `IpcResult`:

```ts
{ ok: true, data: T } | { ok: false, error: { code: string, message: string } }
```

Only authentication problems use HTTP status codes: `401 unauthorized` means the token is unknown
or was revoked — drop it and pair again. `413` = body over 8 MB, `400 bad-json`.

Error codes worth handling in the UI:

| code | meaning |
|---|---|
| `bad-request` | payload failed the channel's schema (message names the field) |
| `desktop-only` | native dialogs / opening apps on the host — not available remotely |
| `remote-terminal-disabled` | the core does not allow remote shells |
| `no-key` | the assistant has no Anthropic API key yet (Settings → AI) |
| `busy` | the conversation is still running |
| `not-found`, `not-pending`, `bad-key`, `rate-limited`, `ai-unavailable` | as named |

## 3. Push events

```
GET /api/events?token=wone_…   (WebSocket)
```

Messages are JSON `{ "channel": string, "payload": … }`. The first one is
`{ channel: "hello", payload: { deviceId } }`. A revoked device is closed with code `4401`.
While at least one client is connected the core samples system telemetry (`system:tick`, ~1.5 s);
remote clients do not need `system:subscribe`.

| channel | payload | when |
|---|---|---|
| `system:tick` | `SystemSnapshot` | every ~1.5 s |
| `memory:changed` | `{ paths?: string[] }` | vault changed (W-ONE or Obsidian) |
| `context:progress` | `ContextProgress` | project scan running |
| `ai:delta` | `{ conversationId, messageId, text }` | streamed answer text |
| `ai:message` | `{ conversationId, message: ChatMessage, running }` | new message, tool status, run finished |
| `ai:conversationsChanged` | `{ reason, id }` | list changed |
| `permission:request` | `PermissionRequest` | an agent waits for approval |
| `permission:resolved` | `{ id, decision }` | answered (by any device) or timed out |
| `events:event` | `WoneEvent` | activity timeline |
| `terminal:data` / `terminal:exit` | … | only when remote shells are allowed |

Apply `ai:delta` exactly like the core does: append to the message's last part if it is a text
part, otherwise start a new text part (`applyDelta` in `src/features/agents/store.ts`).

## 4. Channels by feature

Remote clients may call every channel except those marked *desktop*. Types: see `contract.ts`.

- **App / server:** `app:info` · `server:status` · `server:createPairingCode` · `server:devices` · `server:revokeDevice` · `server:configure` (*desktop*)
- **Projects:** `projects:list` · `projects:add { path }` · `projects:remove` · `projects:refresh` · `context:get` · `context:reindex` · `fs:dirs { path? }` (folder browser on the core's machine) · `projects:pickFolder` / `projects:openInEditor` / `projects:openTerminal` / `projects:openFile` (*desktop*)
- **Memory (vault):** `memory:status` · `memory:list` · `memory:read` · `memory:search` · `memory:graph` · `memory:folders` · `memory:create` · `memory:write` · `memory:writeBody` · `memory:rename` · `memory:move` · `memory:moveFolder` · `memory:createFolder` · `memory:link` · `memory:unlink` · `memory:trash` · `memory:createVault` · `memory:setVault { path }` · `memory:setGraphStyle` · `memory:pickVault` / `memory:reveal` (*desktop*)
- **System:** `system:snapshot` · `system:user`
- **Assistant:** `ai:status` · `ai:setKey { key }` · `ai:clearKey` · `ai:configure { model?, effort? }` · `ai:agents` · `ai:tools` · `ai:conversations` · `ai:conversation { id }` · `ai:send { text, conversationId?, agentId?, projectId? }` → `{ conversationId, messageId }` (the answer streams via push events) · `ai:cancel { conversationId }` · `ai:deleteConversation` · `ai:runs`
- **Permissions:** `permission:pending` · `permission:respond { id, decision: "once" | "always" | "deny" }` · `permission:grants` · `permission:revoke`
- **Activity:** `events:recent { limit?, conversationId? }`
- **Terminal** (only with remote shells): `terminal:create` · `terminal:list` · `terminal:attach` · `terminal:write` · `terminal:resize` · `terminal:kill`

## 5. React Native sketch

```ts
import { createRemoteTransport, pairDevice, probeCore } from './shared/ipc/transport'
import * as SecureStore from 'expo-secure-store'

// once: from the scanned QR URL "http://192.168.1.20:7420/#pair=K7QM-2XPA"
const [baseUrl, code] = scanned.split('/#pair=')
if (!(await probeCore(baseUrl))) throw new Error('Not a W-ONE core')
const { token } = await pairDevice(baseUrl, code, 'Pixel 9')
await SecureStore.setItemAsync('wone', JSON.stringify({ baseUrl, token }))

// every start
const core = createRemoteTransport({
  baseUrl,
  token,
  onUnauthorized: () => SecureStore.deleteItemAsync('wone'), // revoked → pair again
  onLinkState: (state) => setLink(state) // connecting | online | offline
})
const res = await core.invoke('ai:send', { text: 'What is on my plate today?', agentId: 'assistant' })
const off = core.on('ai:delta', ({ messageId, text }) => appendText(messageId, text))
core.on('permission:request', (req) => showApprovalSheet(req)) // → core.invoke('permission:respond', …)
```

The web UI in `src/` is the reference implementation of every flow (session/pairing in
`src/features/session`, the assistant in `src/features/agents`).
