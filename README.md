# W-ONE // Command Center

A premium, dark, futuristic **desktop UI** — a Jarvis-style command center inspired by the
*principle* of sci-fi terminal UIs (terminal · system telemetry · HUD panels), **not** a clone of
any existing tool.

> Real today: AI agents (Claude) with tools behind a permission gate, an Obsidian-compatible memory
> vault with graph, projects with structural context, real shells, live system telemetry — on the
> desktop, in the browser, and over a network API for the coming mobile app. See
> [`W-ONE_ARCHITECTURE.md`](W-ONE_ARCHITECTURE.md) and the API reference [`docs/API.md`](docs/API.md).

## Stack

Electron (frameless) · React 18 · TypeScript · Vite (via **electron-vite**) · Tailwind CSS ·
Framer Motion · **xterm.js** + node-pty · PostgreSQL (Docker) · Anthropic SDK (Claude) · Zod ·
`ws` · Vitest + Testing Library · Playwright. Fonts (Inter, JetBrains Mono) are bundled locally.

## Getting started

Requirements: Node 22, Docker (Docker Desktop on macOS/Windows).

```bash
npm install
```

W-ONE is one **core** (all services) with three ways to run it:

| | Command | What you get |
|---|---|---|
| **Desktop app** | `npm run dev` | Electron window; starts the database container first (HMR in dev) |
| **Web UI + API, no Docker** | `npm run web` | builds the web UI and the core server, serves both on `http://127.0.0.1:7420` |
| **Docker** | `npm run docker:up` | database + the core in containers on `http://127.0.0.1:7420` |

**Browser access is paired.** Open the address, enter the one-time code the server prints at
startup (or `npm run server:pair` / `npm run docker:pair`, or in the desktop app: Settings →
*Pair a device* — that also shows a QR code for a phone). Each browser/phone gets its own token;
revoke devices in Settings. Remote shells are off unless `WONE_REMOTE_TERMINAL=1` (server) or
Settings → *Allow remote shells* (desktop).

**The desktop app can serve the web UI too:** Settings → Remote access → *Run the API server*
(+ *Reachable on the local network* for your phone).

### AI

The agents run on Claude (`claude-opus-5-5` by default, Sonnet 5.5 selectable). Either set
`ANTHROPIC_API_KEY` for the core, or paste a key in Agents/Settings — it is verified once, stored
on the core only (encrypted by the OS keychain on the desktop) and never sent to any client.
Reading tools run freely; anything that changes data asks you first (*Allow once / Always / Deny*);
commands are asked every time.

### Database

PostgreSQL in Docker (`docker-compose.yml`, bound to `127.0.0.1:54329`). `npm run dev` starts it;
W-ONE still works without it (agent runs and the activity history then live in memory only).

```bash
npm run db:up      # start the database (waits until healthy)
npm run db:down    # stop it (data stays in the "wone-pgdata" volume)
npm run db:psql    # SQL shell
npm run db:backup  # pg_dump → ~/W-ONE/backups/
```

Other scripts:

```bash
npm run build         # Electron main / preload / renderer → out/
npm run web:build     # the web UI → out/web
npm run server:build  # the standalone core → out/server/index.cjs
npm run server        # run it (WONE_PORT, WONE_LAN, WONE_REMOTE_TERMINAL, WONE_HOME …)
npm run web:dev       # web UI with HMR; proxies /api to a core on :7420
npm run typecheck     # tsc for node (electron + server), web (renderer) and the tests
```

All settings and data live under `~/W-ONE` (`WONE_HOME` overrides): `data/` (settings, projects,
paired devices, secrets, conversations) and `vault/` (the Obsidian-compatible memory). Copy
`.env.example` to `.env` to change Docker ports or bind addresses.

## Tests

```bash
npm test                 # unit tests (Vitest) — main process in Node, renderer in jsdom
npm run test:coverage    # same, with coverage; fails below 100 %
open coverage/index.html # the coverage report
npm run test:e2e         # build + database + Playwright against the real Electron app
npm run test:all         # typecheck + coverage + e2e — what CI runs on a pull request
```

- **Unit** (`tests/unit/main`, `tests/unit/renderer`): every file in `electron/` and `src/` is
  measured, and lines, branches, functions and statements must all stay at **100 %**.
  Only type-only modules are excluded (`vitest.config.ts`).
- **E2E** (`tests/e2e`), every test with a throwaway `WONE_HOME` (your real `~/W-ONE` is never
  touched):
  - *electron*: the built desktop app — boot + database, every module, a real shell, a vault note
    written to disk, a project, the embedded API server, the theme toggle. On Linux without a
    display run it under `xvfb-run -a`.
  - *web*: the built web UI in Chromium against the real standalone core — pairing, live data,
    the folder browser, access rules, and the assistant end to end (streamed answer, a tool call
    behind an approval, the note on disk) against a local stand-in for the Messages API
    (`tests/e2e/fake-anthropic.mjs`, no key needed). `PW_CHROMIUM=/path/to/chrome` uses a
    preinstalled Chromium.

## CI/CD (GitHub Actions)

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | every pull request (and manually) | typecheck · unit tests with the 100 % gate (report as artifact) · E2E (Electron + Docker database, web UI + core) · Docker image build |
| `cd.yml` | push to `main`/`develop` (merges), tags `v*` (releases) | **no tests** — builds the core image (API + web UI) and pushes it to `ghcr.io/robin7mh/w-one-ui` (`:develop`, `:main`, `:sha-…`; on a tag also `:1.2.3` and `:latest`); a tag also creates a GitHub Release with the web bundle |

Release: `git tag v0.2.0 && git push origin v0.2.0`.

To make the tests mandatory before merging, enable branch protection for `main`/`develop`
(GitHub → Settings → Branches) and require the CI checks.

### Later: website / monorepo

When the W-ONE website arrives, the repo can become an npm-workspaces monorepo without
changing the pipeline's shape: `apps/desktop` (this app), `apps/web` (the website),
`packages/shared` (today's `src/shared`). Each app gets its own Dockerfile; CI and CD
run per workspace.

## What's on screen

| Region | Component | Notes |
| --- | --- | --- |
| Boot overlay | `BootSequence` | Typed boot log + progress, fades to reveal the shell (click to skip). |
| Top bar | `TopStatusBar` | Codename, live clock, mode/uptime/link status, theme toggle; native traffic lights on macOS, custom window controls on Windows/Linux. Draggable region. |
| Left rail | `SideNavigation` | Core · Editor · Terminal · Projects · Memory · Agents · System · Settings, plus which core it is linked to. Collapses to icon-only on narrow widths. |
| Center | the active module | **Core**: greeting, HUD clock, tiles for projects, brain and system. **Editor**: Monaco (VS Code's editor core) on your project files — file tree, tabs, ⌘S, follows changes made elsewhere. **Terminal**: real login shells (node-pty) in tabs or splits. **Projects**: git/stack detection + structural context (P3). **Memory**: the Obsidian vault with editor and graph. **Agents**: chat with Assistant / Coding / Research / Chat agents, tool calls, inline approvals, run activity. **System**: full telemetry. **Settings**: AI, remote access & devices, permissions, vault, about. |
| Right rail | `SystemMonitorPanel` | CPU/RAM gauges, sparklines, process preview (hidden in wide modules). |
| Bottom | `BottomDashboard` | *Command Deck*: running agents (stop / jump in), waiting approvals, live activity. |
| Overlay | `ApprovalToasts` | an agent waiting for approval is visible in every module. |

### Design system (single source of truth)

- **Colors** are CSS variables in `src/index.css`, exposed as Tailwind tokens in
  `tailwind.config.ts`. No hardcoded hex in components. The theme toggle swaps `data-theme`
  between dark and light (saved; first start follows the OS appearance) — variables only, no
  component changes. Glows scale with the `--glow` token, so they switch off in light mode.
- **One `Panel` primitive** (`src/components/ui/Panel.tsx`) gives every framed surface the same
  border/header treatment; `HudFrame` adds optional corner ticks. One shared glow token, used
  sparingly.
- **Typography:** Inter for UI/headlines, JetBrains Mono for all technical values; small uppercase
  labels via `TechLabel`.
- **Motion:** boot → staggered panel entrance → pulsing status dots → typing terminal → hover
  glows → sliding nav indicator. All subtle and disabled under `prefers-reduced-motion`.

### Not built yet

The mobile app itself; P5 memory pipeline, P10 Files, P11 Automations, P13 embeddings; packaging
(installers, signing, auto-update). See §12.4 in the architecture document.

## Project structure

```
electron/      the W-ONE core: main.ts (desktop window), preload.ts (window.wone bridge),
               ipc/ (router + channel bindings), main/core (createCore, EventHub),
               main/server (HTTP + WebSocket API), main/platform (electron | headless),
               main/services/ (ai, auth, db, events, files, fs, memory, projects, system, terminal, …)
server/        main.ts — the same core headless (out/server/index.cjs, Docker)
src/
  components/  shell · topbar · nav · monitor · dashboard · boot · ui
  features/    agents · session (pairing) · settings · dashboard · editor · projects · memory · terminal ·
               system · context
  shared/      contract, schemas, transport, types — shared by core, web UI and the mobile app
  hooks/ data/ lib/ types/
tests/
  unit/main      Vitest (node)  — services, core, API server, agent runtime, main.ts
  unit/renderer  Vitest (jsdom) — stores, hooks, every component
  e2e            Playwright     — the built Electron app, and the web UI against the core
docker-compose.yml · Dockerfile            database + the core image (API + web UI)
.github/workflows/                          ci.yml (PR tests) · cd.yml (image + release)
```

## Mobile app

The React Native app talks to the same core over HTTP + WebSocket with a per-device token — the
reference, including the pairing flow and a client sketch, is [`docs/API.md`](docs/API.md). The
client code in `src/shared/ipc/transport.ts` runs in React Native unchanged.
