# Mindeck Core API

The Mindeck core speaks one contract to every client: the desktop window (over Electron IPC), the
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
| Standalone (no Docker) | `npm run web` | `http://127.0.0.1:7420` (`MINDECK_LAN=1` for all interfaces) |
| Docker | `npm run docker:up` | `http://127.0.0.1:7420` (`MINDECK_BIND=0.0.0.0` in `.env` for the LAN) |

For access from outside your home network use a VPN such as Tailscale or WireGuard rather than
opening the port to the internet.

The core speaks plain HTTP. On a network you do not trust (café, hotel, office), the pairing code
and the device token can be read off the wire: use Tailscale (its WireGuard tunnel encrypts every
connection, and `tailscale serve` adds HTTPS) or a reverse proxy with a real certificate (Caddy,
nginx, Traefik) in front of `127.0.0.1:7420`. The core has no built-in TLS on purpose: a
self-signed certificate pinned through the pairing QR code would need certificate pinning in the
app (React Native's `fetch` and `WebSocket` trust only the system's certificate authorities —
pinning needs a native module and a development build) and would show a certificate warning in
every browser.

## 1. Pairing (once per device)

1. On a device that is already trusted: Settings → *Pair a device*. It shows a code like
   `K7QM-2XPA` (valid 10 minutes, one use) and a QR code with `http(s)://<core>/#pair=K7QM-2XPA`.
   Headless: `npm run server:pair` or `npm run docker:pair` (append `-- --admin` for an admin
   device). The standalone server also prints a code at startup as long as no device is paired.
2. The app reads the URL from the QR code (base URL = everything before `/#pair=`), or the user
   types the address and the code.
3. Redeem the code:

```http
POST /api/pair
Content-Type: application/json

{ "code": "K7QM-2XPA", "name": "Pixel 9" }
```

```json
{ "ok": true, "data": { "token": "mindeck_…", "device": { "id": "…", "name": "Pixel 9", "role": "member", "createdAt": "…" } } }
```

Every device has a **role**, set by the code it redeemed:

- `member` (the default): projects, memory, the assistant, the agent cockpit and approvals, within
  the remote rules below.
- `admin`: also pairs and removes devices and changes their roles, sets the AI key, and signs the
  core in or out of the Mindeck account (channels marked *admin* in §4). Given at the desktop when
  pairing (*Pair as admin*) and changeable in the device list there; on a headless core its first
  device is admin, and so are devices paired before roles existed.

Store the token in the platform's secure storage (`expo-secure-store` / Keychain / Keystore). It is
shown exactly once; the core only keeps its SHA-256. Wrong codes answer `401 bad-code`; ten failures
in ten minutes from one address answer `429`.

`GET /api/health` → `{ ok, name: "Mindeck", version, mode: "desktop" | "server" }` (public) tells
whether a URL really is a Mindeck core.

## 2. Calls

```http
POST /api/rpc/<channel>
Authorization: Bearer mindeck_…
Content-Type: application/json

<request payload as JSON, or nothing for channels without a payload>
```

Every call answers HTTP 200 with an `IpcResult`:

```ts
{ ok: true, data: T } | { ok: false, error: { code: string, message: string } }
```

Only authentication problems use HTTP status codes: `401 unauthorized` means the token is unknown
or was revoked — drop it and pair again. `413` = body over 8 MB, `400 bad-json`.

**Remote rules.** Without remote shells a paired device reaches only the *shared folders*: the ones
set at the desktop (Settings → Remote access → *Shared folders*) or, headless, in
`MINDECK_REMOTE_ROOTS` (default `/projects`, the Docker mount), plus the projects added at the
desktop. `fs:dirs`, `projects:add` and `memory:setVault` stay inside them, `projects:list` shows
only the projects a device may use, and every call naming a `projectId` is checked. Always — with
remote shells, too — off-limits: the home folder itself and the folders above it, hidden folders,
system folders, Mindeck's own data folder, and keys and credentials by name (`.ssh`, `.aws`,
`.gnupg`, `.env*`, `*.pem`, `*.key`, `id_*`, keychains, browser profiles …), as files or folders.

Approvals from a device: `deny` always works, read requests may be allowed; changes (`write`) and
commands (`execute`) can be allowed only while remote shells are on (`remote-terminal-disabled`
otherwise). `always` from a device counts as `once`, and requests reach devices with
`allowAlways: false` — "Always allow" is given at the desktop only. An assistant run started by a
device uses no write or command tool without remote shells.

Error codes worth handling in the UI:

| code | meaning |
|---|---|
| `bad-request` | payload failed the channel's schema (message names the field) |
| `desktop-only` | native dialogs / opening apps on the host — not available remotely |
| `remote-terminal-disabled` | the core does not allow remote shells (also: approving changes or commands) |
| `admin-only` | the channel needs an admin device (or the desktop app) |
| `remote-forbidden` | outside the shared folders, or a key / credential / system path |
| `no-key` | the assistant has no Anthropic API key yet (Settings → AI) |
| `busy` | the conversation is still running |
| `not-found`, `not-pending`, `bad-key`, `rate-limited`, `ai-unavailable` | as named |

## 3. Push events

```
GET /api/events   (WebSocket, subprotocols: "mindeck", "mindeck.bearer.<token>")
```

The token travels as the second offered subprotocol — never in the URL, where it would land in
proxy and access logs. The core answers with the `mindeck` protocol only
(`new WebSocket(url, eventsProtocols(token))` in `transport.ts`; React Native's `WebSocket` takes
the same second argument). The old `?token=mindeck_…` query is still accepted for app builds from
before; it is deprecated and will be removed once those builds are gone.

Messages are JSON `{ "channel": string, "payload": … }`. The first one is
`{ channel: "hello", payload: { deviceId, role } }`. A revoked device is closed with code `4401`.
While at least one client is connected the core samples system telemetry (`system:tick`, ~1.5 s);
remote clients do not need `system:subscribe`.

| channel | payload | when |
|---|---|---|
| `system:tick` | `SystemSnapshot` | every ~1.5 s |
| `memory:changed` | `{ paths?: string[] }` | vault changed (Mindeck or Obsidian) |
| `context:progress` | `ContextProgress` | project scan running |
| `ai:delta` | `{ conversationId, messageId, text }` | streamed answer text |
| `ai:message` | `{ conversationId, message: ChatMessage, running }` | new message, tool status, run finished |
| `ai:conversationsChanged` | `{ reason, id }` | list changed |
| `permission:request` | `PermissionRequest` (`allowAlways` always `false` for devices) | an agent waits for approval |
| `permission:resolved` | `{ id, decision }` | answered (by any device) or timed out |
| `events:event` | `MindeckEvent` | activity timeline |
| `terminal:data` / `terminal:exit` | … | only when remote shells are allowed |

Apply `ai:delta` exactly like the core does: append to the message's last part if it is a text
part, otherwise start a new text part (`applyDelta` in `src/features/agents/store.ts`).

## 4. Channels by feature

Remote clients may call every channel except those marked *desktop*; channels marked *admin* need
an admin device. Types: see `contract.ts`.

- **App / server:** `app:info` · `server:status` · `server:devices` → `Device[]` (with `role`) · `server:revokeDevice { id }` (any device may remove itself; others: *admin*) · *(admin:)* `server:createPairingCode { role? }` → `{ code, role, expiresAt, urls }` · `server:setDeviceRole { id, role }` → `Device[]` · `server:configure` (*desktop*; `remoteRoots` = the shared folders)
- **Projects:** `projects:list` (the ones the device may use) · `projects:add { path }` (inside the shared folders) · `projects:remove` · `projects:refresh` · *(only with remote shells:)* `projects:pull` (`git pull --ff-only`) · `context:get` · `context:reindex` · `fs:dirs { path? }` (folder browser on the core's machine; for devices: the shared folders, listed in `roots`, no `path` = the first) · `projects:pickFolder` / `projects:openInEditor` / `projects:githubDesktop` / `projects:openInGitHubDesktop` / `projects:openFile` (*desktop*)
- **Editor (project files):** `files:list { projectId, dir? }` → `FileEntry[]` · `files:read { projectId, path }` → `FileContent` (`unsupported: "binary" | "too-large"` instead of text) · `files:stat { projectId, paths }` · `files:write { projectId, path, content, expectedMtime? }` (only with remote shells; fails with `conflict` when the file changed since `expectedMtime`)
- **Agent cockpit:** `agents:detect` · `agents:list` · `agents:get { id }` → session + messages · `agents:changes { id }` · `agents:branch { id }` → own working folder: pushed, pull request (via `gh`), merged, uncommitted files · `agents:diff { id, path }` · *(only with remote shells:)* `agents:create { kind, projectId, isolated?, prompt? }` · `agents:send { id, text }` · `agents:interrupt` · `agents:stop` · `agents:resume` · `agents:remove` · `agents:accept` · `agents:discard` · `agents:rename { id, title }` · `agents:shell { id }` → `{ terminalId }` (a shell in the session's folder, attach with `terminal:*`) · *(desktop only:)* `agents:openInEditor { id }` (VS Code on the session's folder). Push: `agents:changed { session? , removed? }`, `agents:message { sessionId, message }`; approvals come as `permission:request` like the assistant's
- **Mindeck account (license):** `cloud:status` → `{ enforced, allowed, state, account, license, validUntil, online, webUrl, error }` · *(admin:)* `cloud:login { email, password }` · `cloud:register { email, password, name?, locale }` · `cloud:logout` · `cloud:adopt` · `cloud:refresh` · `cloud:resendVerification` · `cloud:forgotPassword { email }` · `cloud:checkout` → `{ url }` (Stripe Checkout). Push: `cloud:status`. On a licensed core every other channel answers `license-required` until `allowed` — sign in first.
- **Memory (vault):** `memory:status` · `memory:list` · `memory:read` · `memory:search` · `memory:graph` · `memory:folders` · `memory:create` · `memory:write` · `memory:writeBody` · `memory:rename` · `memory:move` · `memory:moveFolder` · `memory:createFolder` · `memory:link` · `memory:unlink` · `memory:trash` · `memory:createVault` · `memory:setVault { path }` · `memory:setGraphStyle` · `memory:pickVault` / `memory:reveal` (*desktop*)
- **System:** `system:snapshot` · `system:user`
- **Assistant:** `ai:status` · *(admin:)* `ai:setKey { key }` · `ai:clearKey` · `ai:configure { model?, effort? }` · `ai:agents` · `ai:tools` · `ai:conversations` · `ai:conversation { id }` · `ai:send { text, conversationId?, agentId?, projectId? }` → `{ conversationId, messageId }` (the answer streams via push events) · `ai:cancel { conversationId }` · `ai:deleteConversation` · `ai:runs`
- **Permissions:** `permission:pending` · `permission:respond { id, decision: "once" | "always" | "deny" }` (see the remote rules in §2) · `permission:grants` → `PermissionGrant[]` (`{ agentId, toolName, projectId?, createdAt }`: an "Always allow" holds for one agent, one tool and one project — no `projectId` = outside projects, `"*"` = every project, kept from before grants were per project) · *(admin:)* `permission:revoke { agentId, toolName, projectId? }`
- **Activity:** `events:recent { limit?, conversationId? }`
- **Terminal** (only with remote shells): `terminal:create` · `terminal:list` · `terminal:attach` · `terminal:write` · `terminal:resize` · `terminal:kill`

## 5. React Native sketch

```ts
import { createRemoteTransport, pairDevice, probeCore } from './shared/ipc/transport'
import * as SecureStore from 'expo-secure-store'

// once: from the scanned QR URL "http://192.168.1.20:7420/#pair=K7QM-2XPA"
const [baseUrl, code] = scanned.split('/#pair=')
if (!(await probeCore(baseUrl))) throw new Error('Not a Mindeck core')
const { token } = await pairDevice(baseUrl, code, 'Pixel 9')
await SecureStore.setItemAsync('mindeck', JSON.stringify({ baseUrl, token }))

// every start
const core = createRemoteTransport({
  baseUrl,
  token,
  onUnauthorized: () => SecureStore.deleteItemAsync('mindeck'), // revoked → pair again
  onLinkState: (state) => setLink(state) // connecting | online | offline
})
const res = await core.invoke('ai:send', { text: 'What is on my plate today?', agentId: 'assistant' })
const off = core.on('ai:delta', ({ messageId, text }) => appendText(messageId, text))
core.on('permission:request', (req) => showApprovalSheet(req)) // → core.invoke('permission:respond', …)
```

The web UI in `src/` is the reference implementation of every flow (session/pairing in
`src/features/session`, the assistant in `src/features/agents`).
