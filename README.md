# W-ONE // Command Center

A premium, dark, futuristic **desktop UI** — a Jarvis-style command center inspired by the
*principle* of sci-fi terminal UIs (terminal · system telemetry · HUD panels), **not** a clone of
any existing tool.

> **This is the UI-only phase.** No memory system, no AI agents, no Obsidian integration, no real
> or dangerous system actions. Everything runs on mock data, but the architecture is built so real
> data, a real shell, Obsidian memory and AI agents drop in cleanly later (see
> [Future integration](#future-integration)).

## Stack

Electron (frameless) · React 18 · TypeScript · Vite (via **electron-vite**) · Tailwind CSS ·
Framer Motion · **xterm.js** (display-only) · custom SVG sparklines/gauges. Fonts (Inter,
JetBrains Mono) are bundled locally — no external requests.

## Getting started

```bash
npm install
npm run dev        # launches the full frameless Electron app (HMR)
```

Other scripts:

```bash
npm run build      # type-checks + builds main / preload / renderer into out/
npm run typecheck  # tsc for both the node (electron) and web (renderer) sides
npm run web:dev    # runs ONLY the renderer in a plain browser (no Electron) —
                   # handy for quick UI iteration; window controls no-op there
```

## What's on screen

| Region | Component | Notes |
| --- | --- | --- |
| Boot overlay | `BootSequence` | Typed boot log + progress, fades to reveal the shell (click to skip). |
| Top bar | `TopStatusBar` | Codename, live clock, mode/uptime/link status, theme toggle; native traffic lights on macOS, custom window controls on Windows/Linux. Draggable region. |
| Left rail | `SideNavigation` | Core · Terminal · Projects · Memory · Agents · System · Settings. Sliding active indicator. Collapses to icon-only on narrow widths. Routing is visual-only. |
| Center | `MainCommandPanel` → `TerminalPanel` | xterm.js terminal showing the W-ONE banner + a styled command input (local echo, **executes nothing**). |
| Right rail | `SystemMonitorPanel` | CPU/RAM gauges, sparklines for CPU/RAM/Disk/Network/Battery, process preview. Live device telemetry; on macOS disk usage and processes match Finder / Activity Monitor. |
| Bottom | `BottomDashboard` | Collapsible *Command Deck* (replaces the eDEX on-screen keyboard). Collapsed by default and empty for now — the demo cards were removed; real agent activity lands here in P9. |

### Design system (single source of truth)

- **Colors** are CSS variables in `src/index.css`, exposed as Tailwind tokens in
  `tailwind.config.ts`. No hardcoded hex in components. The theme toggle swaps `data-theme`
  between two dark variants — variables only, no component changes.
- **One `Panel` primitive** (`src/components/ui/Panel.tsx`) gives every framed surface the same
  border/header treatment; `HudFrame` adds optional corner ticks. One shared glow token, used
  sparingly.
- **Typography:** Inter for UI/headlines, JetBrains Mono for all technical values; small uppercase
  labels via `TechLabel`.
- **Motion:** boot → staggered panel entrance → pulsing status dots → typing terminal → hover
  glows → sliding nav indicator. All subtle and disabled under `prefers-reduced-motion`.

### What is intentionally dummy this phase

Nav routing (visual only); Projects/Memory/Agents/System/Settings render a `ModulePlaceholder`
(only Core/Terminal are fully built); the terminal has no shell; all metrics, events, commands,
processes and agents are mock; window controls work but do nothing beyond min/max/close.

## Project structure

```
electron/            main.ts (frameless window + IPC), preload.ts (window.wone bridge)
src/
  components/  shell · topbar · nav · command · monitor · dashboard · boot · ui
  hooks/       useClock · useMockMetrics · useTerminalStream · useBoot
  data/        navigation · boot/terminal lines
  lib/         cn · format
  types/       shared UI types
```

## Future integration

All privileged capability flows through the single `window.wone` bridge
(`electron/preload.ts`) — that is the seam to extend. Nothing below is built yet.

- **Real system metrics** — add [`systeminformation`](https://www.npmjs.com/package/systeminformation)
  in `electron/main.ts`, push samples over IPC, and replace the body of `useMockMetrics` with a
  read from `window.wone.sysinfo`. Component props are unchanged.
- **Real terminal** — add `node-pty` in the main process, bridge its output to xterm via IPC, and
  write the live stream into the xterm instance owned by `useTerminalStream`. Wire the command input to write
  to the pty. *(This introduces real shell execution — add it deliberately.)*
- **Obsidian memory** — read a vault via `fs` in the main process, expose it through `window.wone`,
  and build the Memory module surface (currently a placeholder).
- **AI agents** — wire the command input to an orchestration service
  (e.g. the Anthropic API called from the main process) and stream responses into
  `MainCommandPanel`; agent activity fills the Command Deck.
