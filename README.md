# W-ONE // Command Center

**[Deutsch](#deutsch)** · **[English](#english)**

<a id="deutsch"></a>

Eine hochwertige, dunkle, futuristische **Desktop-App**: ein Command Center im Jarvis-Stil für
deine Projekte, deine Coding-Agenten und dein Wissen. Sie folgt dem *Prinzip* von
Sci-Fi-Terminal-Oberflächen (Terminal · System-Telemetrie · HUD-Panels) und ist **kein** Klon
eines bestehenden Tools.

> Schon heute echt: ein Agent-Cockpit für die Coding-Agenten, die du ohnehin nutzt (Claude Code
> mit deinem eigenen Abo, Codex und Gemini), ein Editor wie VS Code, ein Obsidian-kompatibler
> Gedächtnis-Vault mit Graph, Projekte mit Strukturkontext, echte Shells und Live-Telemetrie. Das
> läuft auf dem Desktop, im Browser und über eine Netzwerk-API für die kommende Mobile-App. Siehe
> [`W-ONE_ARCHITECTURE.md`](W-ONE_ARCHITECTURE.md) und die API-Referenz [`docs/API.md`](docs/API.md).

## Stack

Electron (rahmenlos) · React 18 · TypeScript · Vite (über **electron-vite**) · Tailwind CSS ·
Framer Motion · **Monaco** · **xterm.js** + node-pty · PostgreSQL (Docker) · Agent Client
Protocol · Anthropic SDK · Zod · `ws` · Vitest + Testing Library · Playwright. Die Schriften
(Inter, JetBrains Mono) sind lokal eingebunden.

## Loslegen

Voraussetzungen: Node 22, Docker (Docker Desktop unter macOS/Windows).

```bash
git clone https://github.com/robin7mh/W-ONE.git
cd W-ONE
npm install
```

W-ONE ist ein **Core** (alle Dienste), den du auf drei Arten startest:

| | Befehl | Was du bekommst |
|---|---|---|
| **Desktop-App** | `npm run dev` | Electron-Fenster; startet vorher den Datenbank-Container (im Dev-Modus mit HMR) |
| **Web-UI + API, ohne Docker** | `npm run web` | baut Web-UI und Core-Server und stellt beides unter `http://127.0.0.1:7420` bereit |
| **Docker** | `npm run docker:up` | Datenbank und Core in Containern unter `http://127.0.0.1:7420` |

**Zugriff aus dem Browser wird gekoppelt.** Öffne die Adresse und gib den Einmal-Code ein. Den
Code bekommst du auf einem dieser Wege:

- der Server gibt ihn beim Start aus;
- `npm run server:pair` oder `npm run docker:pair`;
- in der Desktop-App: Settings → *Pair a device*, dort gibt es auch einen QR-Code fürs Handy.

Jeder Browser und jedes Handy bekommt ein eigenes Token; Geräte entziehst du in den Settings.
Remote-Shells sind aus, solange du nicht `WONE_REMOTE_TERMINAL=1` (Server) setzt oder Settings →
*Allow remote shells* (Desktop) einschaltest.

**Die Desktop-App kann die Web-UI auch selbst ausliefern:** Schalte Settings → Remote access →
*Run the API server* ein, fürs Handy zusätzlich *Reachable on the local network*.

### Agents

Der Bereich **Agents** arbeitet mit der KI, für die du schon bezahlst. W-ONE braucht dafür keinen
API-Key:

- **Claude Code** läuft als dein eigenes, unverändertes `claude`-CLI mit deinem Claude-Abo.
  Einmal anmelden mit `claude auth login`.
- **Codex** läuft mit deinem Codex-Login über seinen ACP-Adapter. Beim ersten Start wird der
  Adapter einmalig per `npx` geladen, dafür braucht es Node.js.
- **Gemini CLI** läuft als `gemini --experimental-acp` mit deiner eigenen Gemini-Anmeldung.

Zum Starten öffnest du *New chat* und wählst Agent und Projekt. Optional gibst du gleich die
erste Nachricht mit und setzt das Häkchen bei *Own working folder*. Jede Sitzung ist ein Chat:

- **Freigaben** erscheinen im Chat, im Command Deck und als Mitteilung, wenn W-ONE im Hintergrund
  ist. Befehle werden jedes Mal gefragt; Datei- und Gedächtnis-Werkzeuge kannst du dauerhaft
  erlauben.
- **Changes** zeigt, was der Agent seit Sitzungsbeginn geändert hat. Jede Änderung öffnet sich als
  Diff in Monaco.
- **Plan** zeigt die Aufgabenliste des Agenten, **Memory** die Vault-Notizen, die er gelesen oder
  geschrieben hat.
- Im **Kopf** steht der Name der Sitzung; ein Klick darauf benennt sie um. Daneben gibt es Buttons
  für *GitHub* (die Repo-Seite), *VS Code* (der Ordner der Sitzung) und *Terminal*. Bei Claude
  Code ist das sein eigenes Terminal, bei Codex und Gemini eine Shell im Ordner der Sitzung.

**Eigener Arbeitsordner.** Mit dieser Option arbeitet der Agent in einem Git-Worktree unter
`~/W-ONE/worktrees/<projekt>-<id>`, auf einem lokalen Branch `wone/<id>`. Dein Projektordner
bleibt unberührt, so können mehrere Agenten (und du) parallel arbeiten.

- *Take over* kopiert die Änderungen des Agenten als nicht committete Änderungen in dein Projekt.
  Committe und pushe sie wie gewohnt; erst dann sind sie auf GitHub.
- *Discard* löscht den Ordner und seinen Branch.

**Gedächtnis für jeden Agenten.** Jeder Agent kann deinen Vault über den MCP-Server von W-ONE
durchsuchen und lesen. Nach jeder Antwort schreibt W-ONE eine Protokoll-Notiz nach
`Agents/<projekt>/…` (Auftrag, Ergebnis, geänderte Dateien, Offenes). Der nächste Agent, egal von
welchem Anbieter, kann dort anknüpfen.

**W-ONE Assistant.** Daneben gibt es einen eingebauten Assistenten mit Anthropic-API-Key.
Standardmäßig nutzt er `claude-opus-5-5`, alternativ ist Sonnet 5.5 wählbar. Setze
`ANTHROPIC_API_KEY` für den Core oder trage den Key in den Settings ein. Der Key wird einmal
geprüft und nur im Core gespeichert (auf dem Desktop verschlüsselt über den Schlüsselbund des
Betriebssystems); an Clients geht er nie.

### Datenbank

PostgreSQL läuft in Docker (`docker-compose.yml`, gebunden an `127.0.0.1:54329`), und
`npm run dev` startet sie. W-ONE funktioniert auch ohne; Agent-Läufe und der Aktivitätsverlauf
liegen dann nur im Arbeitsspeicher.

```bash
npm run db:up      # Datenbank starten (wartet, bis sie bereit ist)
npm run db:down    # stoppen (die Daten bleiben im Volume "wone-pgdata")
npm run db:psql    # SQL-Shell
npm run db:backup  # pg_dump → ~/W-ONE/backups/
```

Weitere Skripte:

```bash
npm run build         # Electron main / preload / renderer → out/
npm run web:build     # die Web-UI → out/web
npm run server:build  # der eigenständige Core → out/server/index.cjs
npm run server        # ihn starten (WONE_PORT, WONE_LAN, WONE_REMOTE_TERMINAL, WONE_HOME …)
npm run web:dev       # Web-UI mit HMR; leitet /api an einen Core auf :7420 weiter
npm run typecheck     # tsc für node (electron + server), web (renderer) und die Tests
```

Alle Einstellungen und Daten liegen unter `~/W-ONE` (änderbar mit `WONE_HOME`):

- `data/`: Einstellungen, Projekte, gekoppelte Geräte, Secrets, Unterhaltungen, Agent-Sitzungen
- `vault/`: das Obsidian-kompatible Gedächtnis
- `worktrees/`: die eigenen Arbeitsordner der Agenten

Um Docker-Ports oder Bind-Adressen zu ändern, kopiere `.env.example` nach `.env`.

## Tests

```bash
npm test                 # Unit-Tests (Vitest): Main-Prozess in Node, Renderer in jsdom
npm run test:coverage    # dasselbe mit Abdeckung; schlägt unter 100 % fehl
open coverage/index.html # der Abdeckungsbericht
npm run test:e2e         # Build + Datenbank + Playwright gegen die echte Electron-App
npm run test:all         # Typecheck + Abdeckung + E2E: das, was CI bei einem Pull Request ausführt
```

- **Unit** (`tests/unit/main`, `tests/unit/renderer`): Jede Datei in `electron/` und `src/` wird
  gemessen. Zeilen, Zweige, Funktionen und Anweisungen müssen alle bei **100 %** bleiben.
  Ausgenommen sind nur reine Typ-Module (`vitest.config.ts`).
- **E2E** (`tests/e2e`): Jeder Test läuft mit einem Wegwerf-`WONE_HOME`, dein echtes `~/W-ONE`
  wird nie angefasst.
  - *electron*: die gebaute Desktop-App. Geprüft werden Start und Datenbank, jedes Modul, eine
    echte Shell, eine Vault-Notiz auf der Platte, ein Projekt, der Editor, der eingebettete
    API-Server und der Theme-Schalter. Dazu kommt eine Agent-Sitzung gegen einen Stellvertreter
    für Claude Code (`tests/e2e/fake-claude.mjs`, kein Konto nötig): Chat, Freigabe, Diff,
    Umbenennen und Protokoll. Unter Linux ohne Bildschirm mit `xvfb-run -a` starten.
  - *web*: die gebaute Web-UI in Chromium gegen den echten eigenständigen Core. Geprüft werden
    Kopplung, Live-Daten, der Ordner-Browser, die Zugriffsregeln und der Assistent von Anfang bis
    Ende (gestreamte Antwort, ein Werkzeugaufruf hinter einer Freigabe, die Notiz auf der Platte).
    Der Assistent spricht dabei mit einem lokalen Stellvertreter für die Messages API
    (`tests/e2e/fake-anthropic.mjs`, kein Key nötig). `PW_CHROMIUM=/pfad/zu/chrome` nutzt ein
    vorinstalliertes Chromium.

## CI/CD (GitHub Actions)

| Workflow | Läuft bei | Macht |
| --- | --- | --- |
| `ci.yml` | jedem Pull Request (und manuell) | Typecheck · Unit-Tests mit 100-%-Schwelle (Bericht als Artefakt) · E2E (Electron + Docker-Datenbank, Web-UI + Core) · Docker-Image-Build |
| `cd.yml` | Push auf `main`/`develop` (Merges), Tags `v*` (Releases) | **keine Tests**: baut das Core-Image (API + Web-UI) und pusht es nach `ghcr.io/robin7mh/w-one` (`:develop`, `:main`, `:sha-…`; bei einem Tag zusätzlich `:1.2.3` und `:latest`); ein Tag erstellt außerdem ein GitHub-Release mit dem Web-Bundle |

Release: `git tag v0.2.0 && git push origin v0.2.0`.

`npm run build` und `npm run web:build` starten Node mit 4 GB Heap. Das Bündeln von Monaco (der
Editor und seine Sprach-Worker) braucht etwa 2,5 GB. Auf GitHubs Runnern für private Repos
(7 GB RAM) und in Docker nimmt Node sonst nur etwa 2 GB.

Damit die Tests vor dem Mergen Pflicht sind, aktiviere den Branch-Schutz für `main` und `develop`
(GitHub → Settings → Branches) und mache die CI-Checks erforderlich.

### Später: Website / Monorepo

Wenn die W-ONE-Website kommt, kann das Repo zu einem npm-Workspaces-Monorepo werden, ohne die
Form der Pipeline zu ändern:

- `apps/desktop`: diese App
- `apps/web`: die Website
- `packages/shared`: das heutige `src/shared`

Jede App bekommt ihr eigenes Dockerfile, CI und CD laufen pro Workspace.

## Was auf dem Bildschirm ist

| Bereich | Komponente | Hinweise |
| --- | --- | --- |
| Boot-Overlay | `BootSequence` | Ein getipptes Boot-Log mit Fortschritt, das zur Oberfläche überblendet (Klick überspringt). |
| Obere Leiste | `TopStatusBar` | Codename, Live-Uhr, Modus/Laufzeit/Verbindung und Theme-Schalter. Native Fensterknöpfe unter macOS, eigene unter Windows/Linux. Ziehbarer Bereich. |
| Linke Leiste | `SideNavigation` | Core · Editor · Terminal · Projects · Memory · Agents · System · Settings, dazu der verbundene Core. Bei schmalen Fenstern nur Icons. |
| Mitte | das aktive Modul | Siehe [Module](#module) unten. |
| Rechte Leiste | `SystemMonitorPanel` | CPU/RAM-Anzeigen, Verlaufskurven und eine Prozess-Vorschau. Nur auf Core; alle anderen Module nutzen die volle Breite. |
| Unten | `BottomDashboard` | *Command Deck*: laufende Agent-Sitzungen (öffnen / beenden), wartende Freigaben, Live-Aktivität. |
| Overlay | `ApprovalToasts` | Ein Agent, der auf eine Freigabe wartet, ist in jedem Modul sichtbar. |

### Module

- **Core**: Begrüßung, HUD-Uhr und Kacheln für Projekte, Gedächtnis und System.
- **Editor**: Monaco (der Editor-Kern von VS Code) auf deinen Projektdateien, mit Dateibaum, Tabs
  und ⌘S. Er folgt Änderungen, die anderswo gemacht werden.
- **Terminal**: echte Login-Shells (node-pty) in Tabs oder geteilt.
- **Projects**: Git- und Stack-Erkennung plus Strukturkontext.
- **Memory**: der Obsidian-Vault mit Editor und Graph.
- **Agents**: das Agent-Cockpit, beschrieben unter [Agents](#agents).
- **System**: vollständige Telemetrie.
- **Settings**: Coding-Agenten, W-ONE Assistant, Fernzugriff und Geräte, Berechtigungen, Vault,
  Info.

### Designsystem (eine Quelle der Wahrheit)

- **Farben** sind CSS-Variablen in `src/index.css`, als Tailwind-Tokens in `tailwind.config.ts`
  verfügbar; Komponenten enthalten keine festen Hex-Werte. Unter Einstellungen → Darstellung
  (`src/lib/theme.ts`) wählt man Modus (dunkel, hell, System), Akzentfarbe und dunklen
  Hintergrund. „Cyber“ färbt Flächen, Linien, Text und Raster im Ton des Akzents, „Schwarz“ und
  „Graphit“ bleiben neutral. Der Modus setzt `data-theme`, Akzent und Hintergrund überschreiben
  einzelne Tokens direkt an `<html>`. Die Wahl wird pro Gerät gespeichert, Standard ist System
  in Cyan. Es ändern sich nur die Variablen, nie die Komponenten. Glows hängen am Token `--glow`,
  sind dezent und im hellen Modus aus.
- **Ein `Panel`-Baustein** (`src/components/ui/Panel.tsx`) gibt jeder gerahmten Fläche denselben
  Rahmen und Kopf. `HudFrame` ergänzt optionale Eckmarken. Ein gemeinsamer Glow-Token, sparsam
  eingesetzt.
- **Typografie**: Inter für Oberfläche und Überschriften, JetBrains Mono für alle technischen
  Werte, kleine Großbuchstaben-Labels über `TechLabel`.
- **Bewegung**: Boot → gestaffelt erscheinende Panels → pulsierende Status-Punkte → tippendes
  Terminal → Hover-Glows → gleitende Navigationsmarke. Alles dezent und bei
  `prefers-reduced-motion` abgeschaltet.

### Noch nicht gebaut

- die Mobile-App selbst
- P5 Gedächtnis-Pipeline, P10 Files, P11 Automations, P13 Embeddings
- Auslieferung: Installer, Signierung, Auto-Update

Siehe §12.4 im Architekturdokument.

## Projektstruktur

```
electron/      der W-ONE-Core: main.ts (Desktop-Fenster), preload.ts (window.wone-Brücke),
               ipc/ (Router + Kanal-Bindungen), main/core (createCore, EventHub),
               main/server (HTTP- + WebSocket-API), main/platform (electron | headless),
               main/services/ (agents, ai, auth, db, events, files, fs, git, memory, projects,
               system, terminal, …)
server/        main.ts: derselbe Core ohne Oberfläche (out/server/index.cjs, Docker)
src/
  components/  shell · topbar · nav · monitor · dashboard · boot · ui
  features/    agents · session (Kopplung) · settings · dashboard · editor · projects · memory ·
               terminal · system · context
  shared/      Vertrag, Schemas, Transport, Typen: geteilt von Core, Web-UI und Mobile-App
  hooks/ data/ lib/ types/
tests/
  unit/main      Vitest (node): Dienste, Core, API-Server, Agent-Laufzeit, main.ts
  unit/renderer  Vitest (jsdom): Stores, Hooks, jede Komponente
  e2e            Playwright: die gebaute Electron-App und die Web-UI gegen den Core
docker-compose.yml · Dockerfile            Datenbank und Core-Image (API + Web-UI)
.github/workflows/                          ci.yml (PR-Tests) · cd.yml (Image + Release)
```

## Mobile-App

Die React-Native-App spricht über HTTP und WebSocket mit demselben Core, mit einem Token pro
Gerät. Die Referenz, inklusive Kopplungsablauf und einer Client-Skizze, steht in
[`docs/API.md`](docs/API.md). Der Client-Code in `src/shared/ipc/transport.ts` läuft unverändert
in React Native.

---

<a id="english"></a>

A premium, dark, futuristic **desktop app**: a Jarvis-style command center for your projects,
your coding agents and your knowledge. It follows the *principle* of sci-fi terminal UIs
(terminal · system telemetry · HUD panels) and is **not** a clone of any existing tool.

> Real today: an agent cockpit for the coding agents you already use (Claude Code on your own
> plan, Codex and Gemini), a VS Code–style editor, an Obsidian-compatible memory vault with graph,
> projects with structural context, real shells and live system telemetry. It runs on the
> desktop, in the browser, and over a network API for the coming mobile app. See
> [`W-ONE_ARCHITECTURE.md`](W-ONE_ARCHITECTURE.md) and the API reference [`docs/API.md`](docs/API.md).

## Stack

Electron (frameless) · React 18 · TypeScript · Vite (via **electron-vite**) · Tailwind CSS ·
Framer Motion · **Monaco** · **xterm.js** + node-pty · PostgreSQL (Docker) · Agent Client
Protocol · Anthropic SDK · Zod · `ws` · Vitest + Testing Library · Playwright. The fonts (Inter,
JetBrains Mono) are bundled locally.

## Getting started

Requirements: Node 22, Docker (Docker Desktop on macOS/Windows).

```bash
git clone https://github.com/robin7mh/W-ONE.git
cd W-ONE
npm install
```

W-ONE is one **core** (all services) with three ways to run it:

| | Command | What you get |
|---|---|---|
| **Desktop app** | `npm run dev` | Electron window; starts the database container first (HMR in dev) |
| **Web UI + API, no Docker** | `npm run web` | builds the web UI and the core server and serves both on `http://127.0.0.1:7420` |
| **Docker** | `npm run docker:up` | the database and the core in containers on `http://127.0.0.1:7420` |

**Browser access is paired.** Open the address and enter the one-time code. You get the code in
one of these ways:

- the server prints it at startup;
- `npm run server:pair` or `npm run docker:pair`;
- in the desktop app: Settings → *Pair a device*, which also shows a QR code for a phone.

Each browser or phone gets its own token, and you can revoke devices in Settings. Remote shells
stay off unless you set `WONE_REMOTE_TERMINAL=1` (server) or turn on Settings → *Allow remote
shells* (desktop).

**The desktop app can serve the web UI too:** turn on Settings → Remote access → *Run the API
server*, and also *Reachable on the local network* for your phone.

### Agents

The **Agents** module works with the AI you already pay for. W-ONE needs no API key for it:

- **Claude Code** runs as your own, unmodified `claude` CLI on your Claude plan. Sign in once
  with `claude auth login`.
- **Codex** runs with your Codex sign-in through its ACP adapter. On first start the adapter is
  fetched once with `npx`, so Node.js is needed.
- **Gemini CLI** runs as `gemini --experimental-acp` with your own Gemini sign-in.

To start one, open *New chat* and pick the agent and the project. Optionally give the first
message, and optionally tick *Own working folder*. Every session is a chat:

- **Approvals** appear inline, in the Command Deck, and as a desktop notification while W-ONE is
  in the background. Commands are asked every time; file and memory tools can be allowed for good.
- **Changes** shows what the agent changed since the session started. Each change opens as a
  diff in Monaco.
- **Plan** shows the agent's task list, and **Memory** shows the vault notes it read or wrote.
- The **header** shows the session's name: click it to rename. Next to it are buttons for
  *GitHub* (the repo page), *VS Code* (the session's folder) and *Terminal*. For Claude Code the
  terminal is its own; for Codex and Gemini it is a shell in the session's folder.

**Own working folder.** With this option the agent works in a git worktree under
`~/W-ONE/worktrees/<project>-<id>`, on a local branch `wone/<id>`. Your project folder stays
untouched, so several agents (and you) can work in parallel.

- *Take over* copies the agent's changes into your project as uncommitted edits. Commit and push
  them as usual; only then do they reach GitHub.
- *Discard* deletes the folder and its branch.

**Memory for every agent.** Each agent can search and read your vault over W-ONE's MCP server.
After every turn, W-ONE writes a journal note to `Agents/<project>/…` (task, result, changed
files, open items). The next agent, from any vendor, can pick up from there.

**W-ONE Assistant.** Separately, there is a built-in assistant on an Anthropic API key. It uses
`claude-opus-5-5` by default, and Sonnet 5.5 can be selected instead. Set `ANTHROPIC_API_KEY` for
the core, or paste the key in Settings. The key is verified once and stored on the core only
(encrypted by the OS keychain on the desktop); it is never sent to any client.

### Database

PostgreSQL runs in Docker (`docker-compose.yml`, bound to `127.0.0.1:54329`), and `npm run dev`
starts it. W-ONE still works without it; agent runs and the activity history then live in memory
only.

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

All settings and data live under `~/W-ONE` (`WONE_HOME` overrides this):

- `data/`: settings, projects, paired devices, secrets, conversations, agent sessions
- `vault/`: the Obsidian-compatible memory
- `worktrees/`: the agents' own working folders

To change Docker ports or bind addresses, copy `.env.example` to `.env`.

## Tests

```bash
npm test                 # unit tests (Vitest): main process in Node, renderer in jsdom
npm run test:coverage    # the same, with coverage; fails below 100 %
open coverage/index.html # the coverage report
npm run test:e2e         # build + database + Playwright against the real Electron app
npm run test:all         # typecheck + coverage + e2e: what CI runs on a pull request
```

- **Unit** (`tests/unit/main`, `tests/unit/renderer`): every file in `electron/` and `src/` is
  measured. Lines, branches, functions and statements must all stay at **100 %**. Only type-only
  modules are excluded (`vitest.config.ts`).
- **E2E** (`tests/e2e`): every test runs with a throwaway `WONE_HOME`, so your real `~/W-ONE` is
  never touched.
  - *electron*: the built desktop app. It covers boot and the database, every module, a real
    shell, a vault note written to disk, a project, the editor, the embedded API server and the
    theme toggle. It also runs a coding agent session against a stand-in for Claude Code
    (`tests/e2e/fake-claude.mjs`, no account needed): chat, approval, diff, rename and journal.
    On Linux without a display, run it under `xvfb-run -a`.
  - *web*: the built web UI in Chromium against the real standalone core. It covers pairing, live
    data, the folder browser, the access rules, and the assistant end to end (streamed answer, a
    tool call behind an approval, the note on disk). The assistant talks to a local stand-in for
    the Messages API (`tests/e2e/fake-anthropic.mjs`, no key needed).
    `PW_CHROMIUM=/path/to/chrome` uses a preinstalled Chromium.

## CI/CD (GitHub Actions)

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | every pull request (and manually) | typecheck · unit tests with the 100 % gate (report as artifact) · E2E (Electron + Docker database, web UI + core) · Docker image build |
| `cd.yml` | push to `main`/`develop` (merges), tags `v*` (releases) | **no tests**: builds the core image (API + web UI) and pushes it to `ghcr.io/robin7mh/w-one` (`:develop`, `:main`, `:sha-…`; on a tag also `:1.2.3` and `:latest`); a tag also creates a GitHub Release with the web bundle |

To release: `git tag v0.2.0 && git push origin v0.2.0`.

`npm run build` and `npm run web:build` run Node with a 4 GB heap. Bundling Monaco (the editor
and its language workers) needs about 2.5 GB. On GitHub's runners for private repos (7 GB RAM)
and in Docker, Node otherwise picks only about 2 GB.

To make the tests mandatory before merging, enable branch protection for `main` and `develop`
(GitHub → Settings → Branches) and require the CI checks.

### Later: website / monorepo

When the W-ONE website arrives, the repo can become an npm-workspaces monorepo without changing
the shape of the pipeline:

- `apps/desktop`: this app
- `apps/web`: the website
- `packages/shared`: today's `src/shared`

Each app gets its own Dockerfile, and CI and CD run per workspace.

## What's on screen

| Region | Component | Notes |
| --- | --- | --- |
| Boot overlay | `BootSequence` | A typed boot log with progress that fades to reveal the shell (click to skip). |
| Top bar | `TopStatusBar` | Codename, live clock, mode/uptime/link status and theme toggle. Native traffic lights on macOS, custom window controls on Windows/Linux. Draggable region. |
| Left rail | `SideNavigation` | Core · Editor · Terminal · Projects · Memory · Agents · System · Settings, plus which core it is linked to. Collapses to icons only on narrow widths. |
| Center | the active module | See [Modules](#modules) below. |
| Right rail | `SystemMonitorPanel` | CPU/RAM gauges, sparklines and a process preview. Shown on Core only; every other module uses the full width. |
| Bottom | `BottomDashboard` | *Command Deck*: running agent sessions (jump in / end), waiting approvals, live activity. |
| Overlay | `ApprovalToasts` | An agent waiting for approval is visible in every module. |

### Modules

- **Core**: greeting, HUD clock, and tiles for projects, brain and system.
- **Editor**: Monaco (VS Code's editor core) on your project files, with file tree, tabs and ⌘S.
  It follows changes made elsewhere.
- **Terminal**: real login shells (node-pty) in tabs or splits.
- **Projects**: git and stack detection plus structural context.
- **Memory**: the Obsidian vault with editor and graph.
- **Agents**: the agent cockpit described in [Agents](#agents-1).
- **System**: full telemetry.
- **Settings**: coding agents, the W-ONE Assistant, remote access and devices, permissions,
  vault, about.

### Design system (single source of truth)

- **Colors** are CSS variables in `src/index.css`, exposed as Tailwind tokens in
  `tailwind.config.ts`; components contain no hardcoded hex. Settings → Appearance
  (`src/lib/theme.ts`) picks the mode (dark, light, system), accent color and dark background.
  "Cyber" tints surfaces, lines, text and grid in the accent's hue; "black" and "graphite" stay
  neutral. The mode sets `data-theme`, accent and background override single tokens inline on
  `<html>`. The choice is saved per device and defaults to the OS in cyan. Only the variables
  change, never the components. Glows scale with the `--glow` token, are kept subtle and switch
  off in light mode.
- **One `Panel` primitive** (`src/components/ui/Panel.tsx`) gives every framed surface the same
  border and header treatment. `HudFrame` adds optional corner ticks. One shared glow token is
  used sparingly.
- **Typography**: Inter for UI and headlines, JetBrains Mono for all technical values, and small
  uppercase labels via `TechLabel`.
- **Motion**: boot → staggered panel entrance → pulsing status dots → typing terminal → hover
  glows → sliding nav indicator. All motion is subtle and turned off under
  `prefers-reduced-motion`.

### Not built yet

- the mobile app itself
- P5 memory pipeline, P10 Files, P11 Automations, P13 embeddings
- packaging: installers, signing, auto-update

See §12.4 in the architecture document.

## Project structure

```
electron/      the W-ONE core: main.ts (desktop window), preload.ts (window.wone bridge),
               ipc/ (router + channel bindings), main/core (createCore, EventHub),
               main/server (HTTP + WebSocket API), main/platform (electron | headless),
               main/services/ (agents, ai, auth, db, events, files, fs, git, memory, projects,
               system, terminal, …)
server/        main.ts: the same core, headless (out/server/index.cjs, Docker)
src/
  components/  shell · topbar · nav · monitor · dashboard · boot · ui
  features/    agents · session (pairing) · settings · dashboard · editor · projects · memory ·
               terminal · system · context
  shared/      contract, schemas, transport, types: shared by the core, the web UI and the mobile app
  hooks/ data/ lib/ types/
tests/
  unit/main      Vitest (node): services, core, API server, agent runtime, main.ts
  unit/renderer  Vitest (jsdom): stores, hooks, every component
  e2e            Playwright: the built Electron app, and the web UI against the core
docker-compose.yml · Dockerfile            the database and the core image (API + web UI)
.github/workflows/                          ci.yml (PR tests) · cd.yml (image + release)
```

## Mobile app

The React Native app talks to the same core over HTTP and WebSocket with a per-device token.
The reference, including the pairing flow and a client sketch, is in [`docs/API.md`](docs/API.md).
The client code in `src/shared/ipc/transport.ts` runs in React Native unchanged.
