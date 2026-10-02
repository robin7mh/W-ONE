# W-ONE // Command Center

A premium, dark, futuristic **desktop UI** — a Jarvis-style command center inspired by the
*principle* of sci-fi terminal UIs (terminal · system telemetry · HUD panels), **not** a clone of
any existing tool.

> Real today: system telemetry, projects (git/stack detection), an Obsidian-compatible memory
> vault with graph, and real shells in the terminal. AI agents are next — see
> [`W-ONE_ARCHITECTURE.md`](W-ONE_ARCHITECTURE.md).

## Stack

Electron (frameless) · React 18 · TypeScript · Vite (via **electron-vite**) · Tailwind CSS ·
Framer Motion · **xterm.js** + node-pty · PostgreSQL (Docker) · Vitest + Testing Library ·
Playwright. Fonts (Inter, JetBrains Mono) are bundled locally — no external requests.

## Getting started

Requirements: Node 22, Docker (Docker Desktop on macOS/Windows).

```bash
npm install
npm run dev        # starts the database container, then the Electron app (HMR)
```

The database is PostgreSQL in Docker (`docker-compose.yml`, bound to `127.0.0.1:54329`).
`npm run dev` starts it automatically; W-ONE still boots without it (nothing depends on it
until P2B). Defaults work as-is — copy `.env.example` to `.env` to change them.

```bash
npm run db:up      # start the database (waits until healthy)
npm run db:down    # stop it (data stays in the "wone-pgdata" volume)
npm run db:psql    # SQL shell
npm run db:backup  # pg_dump → ~/W-ONE/backups/
```

Other scripts:

```bash
npm run build      # builds main / preload / renderer into out/
npm run typecheck  # tsc for node (electron), web (renderer) and the tests
npm run web:dev    # runs ONLY the renderer in a plain browser (no Electron)
npm run docker:web # builds the web image (Dockerfile) and serves it on 127.0.0.1:8080
```

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
- **E2E** (`tests/e2e`): launches the built app with a throwaway `WONE_HOME` (your real
  `~/W-ONE` is never touched) and checks boot + database connection, navigation, a real
  shell in the terminal, writing a vault note to disk, adding a project and the theme toggle.
  On Linux without a display run it under `xvfb-run -a`.

## CI/CD (GitHub Actions)

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | every pull request (and manually) | typecheck · unit tests with the 100 % gate (report as artifact) · E2E against Electron + the Docker database · Docker image build |
| `cd.yml` | push to `main`/`develop` (merges), tags `v*` (releases) | **no tests** — builds the web image and pushes it to `ghcr.io/robin7mh/w-one-ui` (`:develop`, `:main`, `:sha-…`; on a tag also `:1.2.3` and `:latest`); a tag also creates a GitHub Release with the web bundle |

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
| Left rail | `SideNavigation` | Core · Terminal · Projects · Memory · Agents · System · Settings. Sliding active indicator. Collapses to icon-only on narrow widths. Routing is visual-only. |
| Center | `Dashboard` (Core) · `TerminalView` (Terminal) | Core: greeting, HUD clock and real tiles for projects, brain and system. Terminal: real login shells (node-pty) in tabs or split layouts (side by side, stacked, 2×2), opened in Home or a project; sessions keep running while you use other modules. |
| Right rail | `SystemMonitorPanel` | CPU/RAM gauges, sparklines for CPU/RAM/Disk/Network/Battery, process preview. Live device telemetry; on macOS disk usage and processes match Finder / Activity Monitor. |
| Bottom | `BottomDashboard` | Collapsible *Command Deck* (replaces the eDEX on-screen keyboard). Collapsed by default and empty for now — the demo cards were removed; real agent activity lands here in P9. |

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

Agents/System/Settings render a `ModulePlaceholder`; Core, Terminal, Projects and Memory are real.

## Project structure

```
electron/      main.ts (window + service wiring), preload.ts (window.wone bridge),
               ipc/ (channel handlers), main/services/ (db, memory, projects, terminal, …)
src/
  components/  shell · topbar · nav · monitor · dashboard · boot · ui
  features/    dashboard · projects · memory (vault, graph, editor) · terminal · system · context
  shared/      IPC contract + types shared by main, preload and renderer
  hooks/ data/ lib/ types/
tests/
  unit/main      Vitest (node)  — services, IPC, main.ts
  unit/renderer  Vitest (jsdom) — stores, hooks, every component
  e2e            Playwright     — the built Electron app
docker-compose.yml · Dockerfile · docker/   database + web image
.github/workflows/                          ci.yml (PR tests) · cd.yml (image + release)
```

## Future integration

All privileged capability flows through the single `window.wone` bridge
(`electron/preload.ts`) — that is the seam to extend. Next up are AI agents (orchestration in the
main process, activity in the Command Deck) — the phase plan is in
[`W-ONE_ARCHITECTURE.md`](W-ONE_ARCHITECTURE.md).
