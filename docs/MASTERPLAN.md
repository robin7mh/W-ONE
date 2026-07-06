# W/-ONE — Masterplan: Von der UI zum persönlichen Command Center

> **Status dieses Dokuments:** reiner Architektur- & Umsetzungsplan. **Kein Code, keine
> Implementierung, kein UI-Redesign.** Der Plan ist so geschnitten, dass du ihn danach Phase für
> Phase (und innerhalb jeder Phase Auftrag für Auftrag) mit Claude Code umsetzen kannst.

---

## 0. BESTANDSAUFNAHME (Analyse des Ist-Stands)

**Verifiziert am 2026-07-06 gegen die echte Codebase** (`src/` + `electron/`, 44 Dateien, ~1.974 LOC).

### Was existiert und ist gut (→ NICHT neu bauen, Regel 10)
- **Electron-Grundgerüst, sicher:** `electron/main.ts` (frameless BrowserWindow, `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: false`, externe Links via `shell.openExternal`), CJS main/preload.
  Das ist bereits eine korrekte, sichere Baseline — sie wird nur **erweitert**, nicht ersetzt.
- **Eine einzige Bridge:** `electron/preload.ts` exponiert `window.wone` (aktuell nur Window-Controls
  + `platform`). Genau der richtige, erweiterbare Naht-Punkt für alles Weitere.
- **Design-System aus einem Guss:** CSS-Variablen → Tailwind-Tokens (`src/index.css`,
  `tailwind.config.ts`), **eine** `Panel`-Primitive (`src/components/ui/Panel.tsx`), `TechLabel`,
  `StatusDot`, `HudFrame`. Konsistentes Spacing, Mono/Sans-Trennung. → Wird 1:1 weiterverwendet.
- **UI-Flächen vollständig vorhanden** (alle im Plan referenziert): `AppShell`, `TopStatusBar`,
  `SideNavigation` (7 Module), `MainCommandPanel` + `TerminalPanel` (xterm.js bereits eingebunden,
  display-only), `SystemMonitorPanel` (Gauges + SVG-Sparklines), `BottomDashboard` (Objective,
  CommandTimeline, EventLog, ProjectContext, Agents, QuickActions), `BootSequence`, `ModulePlaceholder`.
- **Saubere Datentrennung:** Mockdaten liegen isoliert in `src/data/*`, getrieben von Hooks
  (`useMockMetrics` = Random-Walk, `useTerminalStream` = xterm + Fake-Log, `useClock`, `useBoot`).
  Typen zentral in `src/types/index.ts`. → Das Ersetzen von Mock durch echt ist dadurch chirurgisch
  möglich, ohne Komponenten anzufassen.

### Was fehlt (= der eigentliche Bauumfang)
- **Kein Main-Process-Service-Layer**, **kein typisiertes IPC** (nur 4 Window-Control-Channels),
  **keine Persistenz** (keine DB, kein Config-Store), **kein State-Manager** im Renderer
  (nur lokaler React-State), **kein echtes PTY**, **keine echten Systemdaten**, **keine KI**.
- xterm.js rendert, ist aber nicht an eine Shell gebunden. Systemwerte sind Random-Walk.

### Kern-Erkenntnis
> Du hast eine **hochwertige Präsentationsschicht + eine korrekte Electron-Sicherheitsbasis**.
> Was fehlt, ist **fast alles hinter der Bridge**. Der Plan baut deshalb **von unten nach oben**:
> zuerst ein dünnes, typisiertes Fundament (IPC + Service-Pattern + Storage), dann Phase für Phase
> echte Fähigkeiten — und verdrahtet dabei die schon existierende UI an echte Daten, statt neue UI
> zu erfinden.

---

## PHASE 0 — FOUNDATION (impliziter Sockel, unbedingt zuerst)

Der User-Plan startet bei „Projects", aber Projects/System/Terminal brauchen alle denselben Sockel.
Diesen Sockel **einmal** sauber zu bauen verhindert die größte technische Schuld des Projekts.
(Umfang klein — ~1–2 Arbeitssitzungen. Wird in Phase 1 mit-erledigt, hier separat benannt.)

1. **Typed IPC Contract** (`src/shared/ipc/contract.ts`): ein zentrales, typisiertes Channel-Register
   (Request/Response-Typen pro Channel). Preload und Renderer teilen sich diese Typen. Handrolled,
   keine Lib nötig (~100 Zeilen). Später optional `electron-trpc`, falls Streaming/Router wachsen.
2. **Preload-Namespaces:** `window.wone` wird in Domänen unterteilt: `window.wone.window.*` (bestehend),
   `.projects.*`, `.system.*`, `.terminal.*`, `.context.*`, `.sessions.*`, `.memory.*`, `.ai.*`,
   `.tools.*`. Jede Domäne nur `invoke`/`on` über den typed Contract — **nie** `ipcRenderer` roh.
3. **Service-Pattern im Main:** `electron/main/services/<domain>/<Domain>Service.ts`. Ein dünner
   `registerIpc()`-Layer (`electron/ipc/`) bindet Contract-Channels an Service-Methoden. Services
   kennen kein Electron-Window — reine Logik + Node-APIs (testbar).
4. **Renderer-State:** **Zustand** (winzig, kein Boilerplate) als Client-Store, Stores pro Feature
   (`src/features/<x>/store.ts`), hydriert über IPC. Kein Redux, kein React-Query (Overkill für
   lokales IPC).
5. **Result-Typ statt Exceptions über IPC:** `type IpcResult<T> = { ok: true; data: T } | { ok: false;
   error: { code: string; message: string } }`. Fehler werden nie roh über die Bridge geworfen.

---

## A) GESAMTARCHITEKTUR

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ RENDERER (React 18 + Vite, sandboxed, kein Node)                               │
│   features/*  (projects, system, terminal, context, sessions, memory, ai, …)   │
│   components/ui/*  (Panel, TechLabel, StatusDot – bestehend)                    │
│   stores/*  (Zustand)   hooks/*                                                 │
└───────────────▲────────────────────────────────┬──────────────────────────────┘
                │  typed events / streams          │  typed invoke() calls
┌───────────────┴──────────────────────────────────▼──────────────────────────────┐
│ PRELOAD BRIDGE (contextBridge → window.wone.<domain>.*)  — nur whitelisted APIs  │
└───────────────▲──────────────────────────────────┬──────────────────────────────┘
                │                                    │  ipcRenderer.invoke / on
┌───────────────┴──────────────────────────────────▼──────────────────────────────┐
│ TYPED IPC LAYER (electron/ipc)  — Channel-Registry, Zod-Validierung, IpcResult   │
└───────────────▲──────────────────────────────────┬──────────────────────────────┘
                │                                    │
┌───────────────┴──────────────────────────────────▼──────────────────────────────┐
│ MAIN PROCESS — SERVICES (electron/main)                                          │
│                                                                                  │
│  ProjectService   SystemService   TerminalService(PTY)   ContextService          │
│  SessionService   MemoryService   AIService(Providers)   ToolService+Policy      │
│  VoiceService     AgentOrchestrator          AuditService   SecretsService       │
│        │              │              │            │           │         │         │
│        ▼              ▼              ▼            ▼           ▼         ▼         │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ INFRASTRUKTUR                                                             │   │
│  │  SQLite (better-sqlite3)   Markdown-Vault (fs)   node-pty   os/systeminfo │   │
│  │  Keychain/Credential-Store   Provider-SDKs (Anthropic/OpenAI)  Embeddings │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘

DATENFLUSS-PRINZIP:  Renderer stellt nur Anfragen. ALLE privilegierten Operationen
(fs, Shell, Git, Netz, KI, Secrets) laufen im Main. Der Renderer bekommt nie Node-Zugriff.
```

Ergänzung ggü. deinem Skizzendiagramm: **Zod-Validierung + IpcResult** an der IPC-Grenze,
**AuditService** und **SecretsService** als Querschnitt, **Policy-Engine** vor dem ToolService.

---

## B) ORDNERSTRUKTUR (skalierbar, minimaler Umbau der bestehenden UI)

Grundsatz: **Bestehendes bleibt liegen**, Neues kommt in `features/`, `shared/`, `electron/main`.
Migration bestehender `components/*` in `features/*` ist optional/graduell (kein Big-Bang-Refactor).

```
electron/
  main.ts                      # bootstrap: Window + registerAllIpc() (bestehend, erweitert)
  preload.ts                   # contextBridge, baut window.wone aus den Domänen (bestehend, erweitert)
  ipc/
    registry.ts                # bindet Contract-Channels an Services, Zod-Validierung
    <domain>.ipc.ts            # pro Domäne die Channel→Handler-Bindings
  main/
    services/
      projects/  ProjectService.ts  gitDetect.ts  stackDetect.ts
      system/    SystemService.ts   collectors.ts
      terminal/  TerminalService.ts pty.ts  sessionRegistry.ts
      context/   ContextService.ts  analyzers/*.ts   contextStore.ts
      sessions/  SessionService.ts  markdownWriter.ts
      memory/    MemoryService.ts   vault.ts  index.ts  embeddings.ts
      ai/        AIService.ts  providers/{anthropic,openai,local}.ts  contextAssembler.ts
      tools/     ToolService.ts  registry.ts  policy.ts  approvals.ts
      voice/     VoiceService.ts  stt.ts  tts.ts
      agents/    Orchestrator.ts  roles/*.ts
      audit/     AuditService.ts
      secrets/   SecretsService.ts
    db/
      db.ts                    # better-sqlite3 Handle
      migrations/000_init.ts…  # versionierte Schema-Migrationen
    lib/  paths.ts  fsSafe.ts  logger.ts

src/
  shared/
    ipc/ contract.ts  client.ts   # typed invoke-Wrapper, von Renderer genutzt
    types/*                        # geteilte Domänentypen (Project, Session, Memory, …)
  features/
    projects/ { components/, store.ts, hooks.ts }
    system/   { … }   terminal/ { … }   context/ { … }   sessions/ { … }
    memory/   { … }   ai/ { … }   tools/ { … }   voice/ { … }   agents/ { … }
  components/ui/*                  # Panel, TechLabel, StatusDot (bestehend — Single Source of Truth)
  components/shell|topbar|nav|…    # bestehend; werden nur an Feature-Stores angeschlossen
  hooks/  lib/  types/  index.css  # bestehend
```

---

## C) DATENBANKSTRATEGIE

**Leitsatz:** *Menschlich Lesbares & Narratives → Markdown (Source of Truth). Strukturiertes,
Abfragbares, Relationales → SQLite (Index/Cache, aus Markdown rebaubar). Semantik → Embeddings,
erst wenn nötig.*

| Datenart | Phase | Format | Warum |
|---|---|---|---|
| App-Settings, Fenster, Theme | 1 | **JSON** (`electron-store` **oder** eigenes `settings.json`) | winzig, key/value, kein Schema-Zwang |
| Project-Registry | 1 | **JSON** → später SQLite | anfangs <100 Einträge, simpel |
| System-Snapshots (optional Historie) | 2 | **In-Memory Ring-Buffer**, keine DB | flüchtig, hohe Frequenz, nicht persistieren |
| Terminal-History | 3 | **JSONL** pro Session | append-only, streambar |
| Project-Context-Metadaten | 4 | **SQLite** | Relationen (Projekt↔Dateien↔TODOs), Queries |
| Sessions (Narrativ) | 5 | **Markdown + YAML-Frontmatter** (Vault) | menschenlesbar, git-/Obsidian-fähig |
| Sessions (Index) | 5 | **SQLite** | Liste/Filter/Sortierung/Verknüpfung |
| Memory (Decisions, Learnings, People, Prefs, Daily) | 6 | **Markdown (SoT) + SQLite (Index)** | s. Phase 6 |
| Embeddings/Vektoren | 7 | **sqlite-vec** (Extension in derselben DB) | ein File, lokal, kein separater Vector-Store |
| Conversations (KI) | 7 | **SQLite** | strukturiert, viele Rows, Token-Zählung |
| Audit-Log | 8 | **SQLite (append-only) + JSONL-Spiegel** | manipulationsarm + grep-bar |

**Migrationszeitpunkt zu SQLite: Phase 4.** Bis dahin JSON/JSONL. Ab Phase 4 lohnt SQLite wegen
Relationen & Queries. **Empfehlung: `better-sqlite3`** (synchron, schnell, nur im Main; robustes
Native-Modul; passt zu Electron; Migrationen als nummerierte SQL/TS-Skripte mit `user_version`-Pragma).
**Kein** ORM in v1 (Prisma/Drizzle = Overhead & Native-Build-Komplexität) — dünne Repository-Funktionen.

- **Schema-Migrationen:** `PRAGMA user_version`; beim Start alle Migrationen > aktueller Version
  in Transaktion anwenden. Jede Migration idempotent & vorwärtsgerichtet.
- **Backup:** vor jeder Migration `db.backup()` nach `…/backups/db-<version>.sqlite`. Vault = Markdown =
  ohnehin git-fähig (optionales Auto-`git commit` im Vault-Ordner).
- **Export:** „Export All" → ZIP aus Vault-Markdown + `db → JSON`-Dump. Lokal-first, keine Cloud.

---

## D) SECURITY-MODELL (gilt app-weit, verschärft sich Richtung Phase 8)

**Baseline (heute schon erfüllt):** `contextIsolation: true`, `nodeIntegration: false`,
frameless, externe Links via `shell.openExternal`, keine Remote-Inhalte, strenge CSP in `index.html`.

**Erweiterungen entlang der Phasen:**
1. **Preload-Whitelist:** `window.wone` exponiert nur benannte, typisierte Methoden — nie `ipcRenderer`,
   nie `require`, nie ganze Module. Jede neue Fähigkeit = ein bewusst hinzugefügter Channel.
2. **Zod an der IPC-Grenze:** jede Renderer→Main-Payload wird validiert, bevor ein Service sie sieht.
3. **Path-Validation (ab Phase 1, kritisch ab 4/8):** jeder Pfad wird gegen die Menge **registrierter
   Projekt-Roots + Vault-Root** kanonisiert (`realpath`) und auf Enthaltensein geprüft
   (Schutz vor `..`, Symlink-Escape). Zentral in `electron/main/lib/fsSafe.ts`.
4. **Shell-Execution (ab Phase 3, scharf ab 8):** PTY läuft im User-Kontext, aber KI-getriggerte
   Ausführung durchläuft Policy-Engine: **Allowlist/Blocklist**, Arg-Parsing, Confirmation.
   Nie `shell: true`-String-Konkatenation aus Modell-Output.
5. **API-Keys/Secrets:** **nie** in JSON/localStorage. **OS-Keychain** via `keytar` **oder**
   Electron `safeStorage` (bevorzugt: `safeStorage`, keine Native-Dep). Keys existieren nur im Main;
   der Renderer sieht nie einen Key, nur „konfiguriert: ja/nein".
6. **Tool-Permissions (Phase 8):** 4 Klassen — READ (auto-erlaubbar, konfigurierbar) · WRITE
   (Bestätigung + Diff-Preview) · EXECUTE (Bestätigung + Command-Preview) · DESTRUCTIVE
   (Doppelbestätigung/„type to confirm" oder hart geblockt).
7. **Audit-Log (Phase 8):** append-only, jede Tool-Aktion mit Actor, Input, Approval, Ergebnis, Zeit.
8. **Prompt-Injection-Abwehr (ab Phase 7):** Datei-/Web-/Repo-Inhalte sind **untrusted data**, nie
   Instruktionen. Klare Trennung System-Prompt ↔ Kontext-Daten. **Kein** Auto-Execute aus Modell-Text;
   W/E/D immer human-in-the-loop. Modell darf Aktionen nur **vorschlagen**, nicht selbst freigeben.
9. **Destruktiv-Schutz:** Blocklist (`rm -rf`, `git push --force`, `dd`, `mkfs`, `:(){:|:&};:`,
   Ausleiten nach `curl | sh`, …) + Heuristik; im Zweifel blocken statt fragen.

---

## DIE 10 PHASEN

> Jede Phase folgt derselben 20-Punkte-Struktur (Ziel · Warum hier · Voraussetzungen · Features ·
> Architektur · Libraries · Komponenten · Services · Main-Funktionen · IPC-Channels · Datenmodelle ·
> Speicherstrategie · Security-Risiken · Performance-Risiken · macOS/Windows · Umsetzungsreihenfolge ·
> Definition of Done · Tests · NICHT in dieser Phase · zu vermeidende Tech-Schulden).

---

### PHASE 1 — PROJECTS

1. **Ziel:** Lokale Projekte in W/-ONE registrieren, mit erkannten Git-/Stack-Metadaten anzeigen,
   in VS Code / Terminal öffnen, entfernen. Rein deterministisch, **keine KI**.
2. **Warum hier:** Projekt-Identität ist das Fundament, an das später Context (4), Sessions (5) und
   Memory (6) andocken. Ohne stabile Projekt-IDs hat nichts Weiteres einen Anker.
3. **Voraussetzungen:** Phase 0 (typed IPC + Service-Pattern + Zustand + JSON-Store). Git im PATH.
4. **Features:** Projekt hinzufügen (nativer Ordner-Dialog) · Pfad speichern · Name (aus Ordner/`package.json`)
   · Git-Repo erkennen · aktueller Branch · letzter Commit (Hash/Msg/Autor/Zeit) · Git-Status (dirty/clean,
   ahead/behind) · Tech-Stack-Erkennung · `package.json`-Parse · README-Erkennung · „in VS Code öffnen"
   · „Terminal im Projektpfad öffnen" · Projekt entfernen.
5. **Architektur:** `ProjectService` (Main) hält Registry (JSON), führt Git-Kommandos read-only aus,
   erkennt Stack via Datei-Heuristik. Renderer: `features/projects` (Zustand-Store `projects`), bindet
   an bestehende `ProjectContextCard` + neue Projects-Liste im `Projects`-Modul.
6. **Libraries:** **keine neue Pflicht-Lib.** Git via `child_process`/`execFile` (kein `simple-git`
   nötig — read-only Kommandos sind trivial). Ordner-Dialog = Electron `dialog`. Optional später
   `simple-git`, wenn Git-Feature-Fläche wächst (erst rechtfertigen).
7. **Neue Komponenten:** `ProjectList`, `ProjectListItem`, `AddProjectButton`, `ProjectDetailPanel`;
   `ProjectContextCard` (bestehend) an echte Daten anschließen.
8. **Neue Services:** `ProjectService`, Helfer `gitDetect.ts`, `stackDetect.ts`.
9. **Main-Funktionen:** `dialog.showOpenDialog({properties:['openDirectory']})`; `execFile('git', …)`
   mit `cwd`; `fs.readFile` für `package.json`/README; `shell.openExternal`/`shell.openPath`;
   VS Code via `code <path>` (Fallback: `open -a`/`start`).
10. **IPC-Channels:** `projects:list`, `projects:add`, `projects:remove`, `projects:pickFolder`,
    `projects:refresh` (Git/Stack neu lesen), `projects:openInEditor`, `projects:openTerminal`.
11. **Datenmodelle:**
    ```ts
    interface Project {
      id: string;                 // uuid
      name: string;
      path: string;               // absolut, kanonisiert
      addedAt: string; lastSeenAt: string;
      git?: { isRepo: boolean; branch?: string; ahead?: number; behind?: number;
              dirty?: boolean; lastCommit?: { hash: string; subject: string; author: string; date: string } };
      stack?: { languages: string[]; frameworks: string[]; packageManager?: string; hasReadme: boolean };
      pinned?: boolean;
    }
    ```
12. **Speicherstrategie:** `projects.json` in `app.getPath('userData')/wone/`. Atomar schreiben
    (temp + rename). Git/Stack werden **on demand** neu erkannt (nicht dauerhaft cachen — Wahrheit
    liegt im Repo).
13. **Security-Risiken:** Pfad-Validation (kanonisieren, speichern nur echte Verzeichnisse);
    `execFile` **ohne** Shell-Interpolation (Args-Array); niemals Projektpfade als Shell-String bauen.
14. **Performance-Risiken:** Git-Status auf großen Repos (`git status` kann dauern) → Timeout +
    Loading-State; Stack-Detection nur oberste Ebene + bekannte Manifeste (kein rekursives Scannen).
15. **macOS/Windows:** VS Code-Launch (`code` PATH vs. nicht vorhanden) unterschiedlich; Terminal öffnen
    (macOS `open -a Terminal`, Windows `wt`/`cmd`); Pfad-Trenner/UNC-Pfade; `git.exe` vorhanden?
16. **Umsetzungsreihenfolge:** Datenmodell → JSON-Store → pickFolder → add/list/remove → gitDetect →
    stackDetect → openInEditor/openTerminal → UI-Anschluss → Fehlerfälle.
17. **DoD:** Ich kann Projekte hinzufügen/entfernen; Git-Branch/-Status/letzter Commit stimmen; „in VS
    Code/Terminal öffnen" funktioniert auf meinem OS; Registry übersteht App-Neustart.
18. **Tests:** Ordner ohne Git; Ordner mit dirty/clean Repo; kaputte `package.json`; gelöschter Pfad
    (graceful); doppeltes Hinzufügen; sehr großes Repo (Timeout).
19. **NICHT in Phase 1:** keine KI, kein Datei-Browser/Tree, keine Repo-weite Analyse (das ist Phase 4),
    kein Schreiben in Projekte.
20. **Tech-Schulden vermeiden:** Registry nicht in localStorage; Git nicht per String-Concat; keine
    UI-Direktzugriffe auf `fs` — alles über `ProjectService` + typed IPC (setzt das Muster für ALLE Phasen).

---

### PHASE 2 — SYSTEM MONITOR (echte Daten)

1. **Ziel:** Mock-Systemwerte durch echte lokale Metriken ersetzen (CPU, RAM, Disk, Netz, Battery,
   Uptime, Prozesse). **Keine KI.**
2. **Warum hier:** Höchster visueller Payoff bei geringem Risiko; etabliert das **Polling-über-IPC-Muster**
   (Main sammelt, pusht periodisch, Renderer abonniert), das später Terminal/AI-Streaming wiederverwenden.
   **Unabhängig von Phase 1** → parallelisierbar.
3. **Voraussetzungen:** Phase 0. Sonst nichts.
4. **Features:** CPU-Last (gesamt/Kerne) · RAM (used/total) · Disk (Kapazität/IO optional) · Netz
   (rx/tx-Rate) · Battery (%/charging) · System-Uptime · Top-Prozesse (PID, Name, CPU, MEM) ·
   optional Temperatur **nur wenn plattformrobust** (sonst weglassen).
5. **Architektur:** `SystemService` mit Collector-Funktionen; ein `setInterval` (1–2 s) im Main sammelt
   und sendet via `system:tick` an den Renderer (push, nicht pull). Renderer: `useMockMetrics` wird zu
   `useSystemMetrics` (gleiche Datenform `Metrics`/`MetricSample` → **Komponenten unverändert**).
6. **Libraries:** **`systeminformation`** (eine, gut gepflegte, plattformübergreifende Dep) für Disk/Netz/
   Battery/Prozesse/Temperatur. CPU/RAM/Uptime gehen auch nativ über `os` — aber `systeminformation`
   vereinheitlicht Cross-Platform sauber; **eine** Dep ist gerechtfertigt.
7. **Neue Komponenten:** keine neuen — `SystemMonitorPanel`, `SystemMetricCard`, `Sparkline`,
   `RadialGauge` bleiben; nur Datenquelle tauschen. Optional `ProcessList` ausbauen.
8. **Neue Services:** `SystemService` (+ `collectors.ts`).
9. **Main-Funktionen:** periodischer Sampler (startet, wenn ≥1 Renderer abonniert; stoppt sonst →
   Energie sparen), `os.cpus()`, `si.currentLoad()`, `si.mem()`, `si.fsSize()`, `si.networkStats()`,
   `si.battery()`, `si.processes()`.
10. **IPC-Channels:** `system:subscribe` / `system:unsubscribe` (steuert Sampler) und push-Event
    `system:tick`; `system:snapshot` (einmalig, on demand).
11. **Datenmodelle:** bestehendes `Metrics = Record<MetricKind, MetricSample>` beibehalten; erweitern:
    `interface SystemSnapshot { cpu:{total:number;cores:number[]}; mem:{used:number;total:number};
    disks:{mount:string;usedPct:number}[]; net:{rxRate:number;txRate:number}; battery?:{pct:number;
    charging:boolean}; uptimeSec:number; processes:{pid:number;name:string;cpu:number;mem:number}[]; ts:number }`.
12. **Speicherstrategie:** **nicht persistieren.** Historie = Ring-Buffer im Renderer-Store (für
    Sparklines). Keine DB (hohe Frequenz, flüchtig).
13. **Security-Risiken:** minimal (nur Lesen). Prozessliste nicht ins Log/Netz leaken. Kein Command-Injection.
14. **Performance-Risiken:** `si.processes()` ist relativ teuer → seltener samplen (z. B. alle 3–5 s),
    Rest 1 s. Interval **nur** laufen lassen, wenn Fenster sichtbar (`window.isVisible`/`blur`).
15. **macOS/Windows:** Temperatur oft nur mit Adminrechten/Tools → **standardmäßig aus**. Netz-Interface-
    Namen unterschiedlich; Battery bei Desktops nicht vorhanden (graceful „N/A"); `si` kapselt vieles.
16. **Umsetzungsreihenfolge:** `SystemService` + Snapshot → `system:subscribe`/`tick` → `useSystemMetrics`
    → Panel anschließen → Sampler an Sichtbarkeit koppeln → Prozessliste → Battery/Temp-Fallbacks.
17. **DoD:** Werte entsprechen dem OS-Aktivitätsmonitor (±Toleranz); Sparklines laufen flüssig; CPU-Last
    der App selbst niedrig; kein Sampling bei minimiertem Fenster.
18. **Tests:** Desktop ohne Akku; Netz-Last erzeugen (Rate steigt); viele Prozesse; App idle über 10 min
    (kein Memory-Leak im Ring-Buffer); minimiert = kein Tick.
19. **NICHT in Phase 2:** keine Alerts/Automationen, keine historische Persistenz, keine „KI erklärt dein
    System", kein Killing/Steuern von Prozessen.
20. **Tech-Schulden vermeiden:** Sampler-Lifecycle (start/stop) sauber; keine mehrfachen Intervalle;
    `Metrics`-Form beibehalten, damit UI nicht angefasst wird.

---

### PHASE 3 — REAL TERMINAL

1. **Ziel:** Das bestehende xterm.js-Panel an eine echte lokale Shell binden (PTY), mehrere Sessions,
   Resize, History, Exit-Codes, CWD. **Nur der Nutzer führt aus — keine KI-Ausführung.**
2. **Warum hier:** Liefert sofort echten Alltagsnutzen und schafft die PTY-Infrastruktur, die Phase 8
   (kontrollierte Ausführung) später **wiederverwendet, aber absichert**. **Unabhängig von 1 & 2** →
   parallelisierbar, aber technisch am riskantesten (Native-Modul) → nicht zwingend zuerst.
3. **Voraussetzungen:** Phase 0. Native-Build-Toolchain (Xcode CLT / VS Build Tools).
4. **Features:** echte Shell (login shell des Users) · PTY · Shell pro Projekt (CWD = Projektpfad) ·
   mehrere Sessions/Tabs · öffnen/schließen · Resize (Fit-Addon ↔ `pty.resize`) · Command-History ·
   Exit-Codes · aktuelles Working-Directory anzeigen.
5. **Architektur:** `TerminalService` verwaltet eine Map `sessionId → PtyProcess`. Datenfluss:
   Renderer-Keystrokes → `terminal:input` → `pty.write`; `pty.onData` → `terminal:data` → `xterm.write`.
   `useTerminalStream` (Fake) wird zu `useTerminalSession` (echt).
6. **Libraries:** **`node-pty`** (Pflicht, Native-Modul). `@xterm/xterm` + `@xterm/addon-fit` bereits da.
   Optional `@xterm/addon-web-links`. `node-pty` muss mit `electron-rebuild`/`@electron/rebuild` gegen
   Electrons Node-ABI gebaut werden — **das ist der Knackpunkt** (siehe H).
7. **Neue Komponenten:** `TerminalTabs`, `TerminalView` (kapselt xterm-Instanz je Session),
   `TerminalToolbar` (New/Close/CWD). Bestehendes `TerminalPanel` wird Host.
8. **Neue Services:** `TerminalService` (+ `pty.ts`, `sessionRegistry.ts`).
9. **Main-Funktionen:** `pty.spawn(shell, args, { cwd, env, cols, rows })`; Shell-Auswahl
   (macOS `$SHELL`/zsh, Windows `powershell`/`pwsh`); Session-Cleanup bei Fenster-Close.
10. **IPC-Channels:** `terminal:create` (→ sessionId, cwd) · `terminal:input` · `terminal:data` (push) ·
    `terminal:resize` · `terminal:close` · `terminal:list` · `terminal:exit` (push, mit Code).
11. **Datenmodelle:** `interface TermSession { id:string; projectId?:string; cwd:string; shell:string;
    createdAt:string; status:'running'|'exited'; exitCode?:number }`. History als JSONL pro Session.
12. **Speicherstrategie:** Sessions flüchtig (leben im Main). History optional als JSONL in
    `userData/wone/terminal/<id>.jsonl` (append). Kein DB nötig.
13. **Security-Risiken:** Volle User-Shell = volle Rechte — **deshalb hier bewusst nur nutzer-getrieben**,
    keine Programmierschnittstelle für „führe X aus". Klare Grenze zu Phase 8. Env sanitisieren
    (keine Secrets in Child-Env leaken).
14. **Performance-Risiken:** Backpressure bei viel Output (`yes`, Build-Logs) → xterm hat Limits, ggf.
    Flow-Control/Chunking; nicht jede Zeile einzeln über IPC (batchen).
15. **macOS/Windows:** PTY-Verhalten unterschiedlich (ConPTY auf Windows ≥10 via node-pty); Default-Shell,
    Zeilenenden, Signals (`SIGINT` vs. Windows); Rebuild-Toolchain je OS.
16. **Umsetzungsreihenfolge:** node-pty + Rebuild grün → single Session end-to-end → Resize/Fit →
    Exit-Codes → mehrere Sessions/Tabs → CWD/Projektbindung → History → Cleanup.
17. **DoD:** Ich kann `vim`, `git log`, langlaufende Prozesse nutzen; Resize korrekt; mehrere Tabs; Schließen
    killt PTY sauber; Öffnen „im Projekt" startet im richtigen CWD.
18. **Tests:** interaktive Programme (vim/htop); Ctrl-C; großes Output; Resize während Ausgabe; Shell-Exit;
    Fenster schließen bei laufendem Prozess (kein Zombie).
19. **NICHT in Phase 3:** **keine** KI-gesteuerte Ausführung, keine Auto-Commands, kein Remote/SSH,
    kein Command-Approval (das ist Phase 8).
20. **Tech-Schulden vermeiden:** node-pty-Rebuild in `postinstall` automatisieren (sonst bricht CI/Neuinstall);
    saubere Session-Lifecycle-Verwaltung (Leaks!); IPC-Batching von Anfang an.

---

### PHASE 4 — PROJECT CONTEXT (deterministisch, ohne LLM)

1. **Ziel:** W/-ONE **versteht** Projekte strukturell — ohne KI. Struktur, Manifeste, Git, Frameworks,
   Dependencies, TODO/FIXME, Projekt-Metadaten; lokal gespeichert; re-indexierbar.
2. **Warum hier:** Liefert den **strukturierten Kontext**, den später die KI (7) konsumiert. Deterministisch
   zuerst zu bauen ist billiger, testbarer und reduziert später Token/Kosten drastisch. Baut auf Projekt-
   Identität (1) auf.
3. **Voraussetzungen:** Phase 1 (Projekte). SQLite-Einführung (Phase-4-Migrationspunkt aus Sektion C).
4. **Features:** Verzeichnisstruktur analysieren (bis Tiefe N, `.gitignore`-aware) · `package.json` (Scripts,
   Deps, Version) · README (Titel/Abschnitte) · Git (Branch, letzter Commit, Status) · Config-Dateien erkennen
   (tsconfig, vite, tailwind, eslint, dockerfile, …) · Frameworks ableiten (React/Next/Electron/…) ·
   Dependencies auflisten · TODO/FIXME/HACK finden (mit Datei:Zeile) · Metadaten erzeugen · **lokal speichern**
   · „Re-Index"-Button.
5. **Architektur:** `ContextService` mit **Analyzer-Pipeline** (je Analyzer eine Funktion `run(projectPath)
   → PartialContext`): `structureAnalyzer`, `manifestAnalyzer`, `gitAnalyzer`, `frameworkAnalyzer`,
   `todoAnalyzer`, `readmeAnalyzer`. Ergebnis wird in SQLite persistiert. Renderer: `Project Context`-Card
   + Context-Ansicht im Projekt-Detail.
6. **Libraries:** **`fast-glob`** (Datei-Scan) + **`ignore`** (`.gitignore` respektieren). Optional
   `ripgrep`-Binary für TODO-Scan bei großen Repos (schneller als JS) — erst wenn nötig. Kein AST-Parser
   in v1 (Heuristik reicht; `dependency-cruiser`/ts-morph wären Overkill).
7. **Neue Komponenten:** `ProjectContextView` (Struktur, Stack, TODOs, Configs), `ContextRefreshButton`,
   `TodoList`. Bestehende `ProjectContextCard` zeigt die Zusammenfassung.
8. **Neue Services:** `ContextService`, `analyzers/*`, `contextStore.ts` (SQLite-Repo).
9. **Main-Funktionen:** rekursiver, ignore-aware Scan mit Tiefen-/Dateilimit; Datei-Sampling (nur Manifeste
   & README ganz lesen, Code nur für TODO-Grep zeilenweise); Hashing (mtime/size) für Change-Detection.
10. **IPC-Channels:** `context:get` (Projekt) · `context:reindex` · `context:status` (läuft/fertig/Progress,
    push).
11. **Datenmodelle:**
    ```ts
    interface ProjectContext {
      projectId: string; indexedAt: string; fileCount: number;
      tree: { path: string; type: 'file'|'dir' }[];        // gekürzt, ignore-aware
      manifests: { packageJson?: {...}; tsconfig?: boolean; … };
      frameworks: string[]; dependencies: { name:string; version:string; dev:boolean }[];
      todos: { file:string; line:number; kind:'TODO'|'FIXME'|'HACK'; text:string }[];
      readme?: { title?:string; sections:string[] };
      git: Project['git'];
    }
    ```
12. **Speicherstrategie:** SQLite-Tabellen `context`, `context_todo`, `context_dep`. Rebuild jederzeit aus
    dem Repo möglich (DB = Cache). Change-Detection via mtime, nicht bei jedem Öffnen voll neu scannen.
13. **Security-Risiken:** Pfad-Confinement (nur innerhalb Projekt-Root, ignore-aware, keine Symlink-Escapes);
    keine Ausführung von Projekt-Code (nur Lesen/Parsen).
14. **Performance-Risiken:** Riesige Monorepos → Tiefen-/Datei-Limits, Streaming-Progress, Worker/Batching;
    `node_modules`/`.git`/`dist` immer ausschließen.
15. **macOS/Windows:** Pfad-Normalisierung; Case-Sensitivity (macOS default case-insensitive) bei Datei-Matching;
    Zeilenenden im TODO-Scan.
16. **Umsetzungsreihenfolge:** SQLite-Setup + Migration → structure/manifest/git-Analyzer → framework/dep →
    todo → readme → persist + change-detection → Reindex-UI → Progress.
17. **DoD:** Für ein echtes Projekt sehe ich korrekt Stack, Deps, Configs, TODOs (klickbar zu Datei:Zeile),
    Struktur — reproduzierbar, ohne KI; Reindex aktualisiert.
18. **Tests:** Monorepo; Nicht-Node-Projekt (Python/Go); Repo ohne README; 5.000+ Dateien (Limits greifen);
    `.gitignore`-Respekt; kaputte Manifeste.
19. **NICHT in Phase 4:** **keine** LLM-Zusammenfassung, keine Embeddings, keine Code-Semantik/„was macht
    diese Funktion", kein Schreiben.
20. **Tech-Schulden vermeiden:** Analyzer als reine, einzeln testbare Funktionen; DB als Cache behandeln
    (jederzeit rebuildbar); **klare Grenze deterministisch↔KI** dokumentieren (Punkt 4-Sonderfrage:
    *alles hier ist deterministisch* — KI kommt erst in 7 obendrauf).

---

### PHASE 5 — SESSION NOTES

1. **Ziel:** Arbeitsstände dauerhaft festhalten: „Was gemacht / was offen / welche Entscheidung / nächster
   Schritt", je Projekt, mit Historie. **Funktioniert zunächst rein manuell (ohne KI).**
2. **Warum hier:** Das ist die **narrative Kontextquelle**, die dein Eingangs-Szenario („woran habe ich
   zuletzt gearbeitet?") direkt bedient — schon **ohne** KI wertvoll. Bildet zusammen mit Phase 4 den
   Input für Memory (6) und KI (7).
3. **Voraussetzungen:** Phase 1 (Projektbindung). SQLite (aus Phase 4) für den Index.
4. **Features:** Session starten (aktives Projekt wählen) · Felder „Done/Open/Decisions/Next" · Session beenden
   · Session-History je Projekt · Markdown-Speicherung (menschenlesbar) · Verknüpfung Session↔Projekt ·
   Zeitstempel/Dauer · Freitext-Notizen.
5. **Architektur:** `SessionService` schreibt pro Session **eine Markdown-Datei mit YAML-Frontmatter** in den
   Vault-Ordner und indexiert Metadaten in SQLite. Renderer: `ActiveSessionCard` (bestehend) wird echt;
   neues Session-Modul (Liste/Detail/Editor).
6. **Libraries:** **`gray-matter`** (YAML-Frontmatter parsen/schreiben). Sonst nichts (Markdown ist Text).
7. **Neue Komponenten:** `SessionEditor` (die 4 Felder + Notes), `SessionList`, `SessionDetail`,
   `SessionTimeline`; `ActiveSessionCard` an echten State koppeln.
8. **Neue Services:** `SessionService`, `markdownWriter.ts`.
9. **Main-Funktionen:** Datei schreiben/lesen (atomar), Frontmatter serialisieren, Index-Upsert, optional
   Auto-`git commit` im Vault.
10. **IPC-Channels:** `sessions:start` · `sessions:update` · `sessions:end` · `sessions:list` (nach Projekt/
    Zeit) · `sessions:get`.
11. **Datenmodelle:**
    ```ts
    interface Session {
      id:string; projectId:string; startedAt:string; endedAt?:string;
      title?:string; done:string[]; open:string[]; decisions:string[]; next:string[];
      notes?:string; tags?:string[];
    }
    ```
    Markdown-Datei: Frontmatter (id, projectId, Zeiten, tags) + Body (Done/Open/Decisions/Next/Notes).
12. **Speicherstrategie:** **Markdown = Source of Truth** (`vault/sessions/<projectSlug>/<date>-<id>.md`),
    **SQLite = Index** (`sessions`-Tabelle für schnelle Listen/Filter). Index aus Markdown rebuildbar.
13. **Security-Risiken:** gering; Vault-Pfad-Confinement; kein HTML-Injection beim Rendern von Markdown
    (sicherer Renderer, `rehype-sanitize` falls Markdown gerendert wird).
14. **Performance-Risiken:** vernachlässigbar (kleine Textdateien). Bei tausenden Sessions: Index-Query statt
    Ordner-Scan.
15. **macOS/Windows:** Datei-/Ordnernamen (Slug ohne verbotene Zeichen), Zeilenenden, Pfadlängen (Windows 260).
16. **Umsetzungsreihenfolge:** Vault-Ordner + Schema → start/update/end (Markdown + Index) → List/Detail-UI →
    `ActiveSessionCard` echt → History/Timeline → optionaler Vault-Git-Commit.
17. **DoD:** Ich starte eine Session, fülle die Felder, beende sie; sie liegt als lesbares `.md` vor und
    erscheint in der Historie; „letzte Session je Projekt" ist abrufbar — **alles ohne KI**.
18. **Tests:** Session ohne Projekt (verhindern/erlauben?); App-Absturz mit offener Session (Recovery);
    Sonderzeichen in Feldern; großer Notes-Block; Index-Rebuild aus Markdown.
19. **NICHT in Phase 5:** keine KI-Zusammenfassung, keine Auto-Erkennung „was hast du gemacht" (das ist die
    KI-Veredelung in 7), keine Cross-Projekt-Verknüpfung/Graph.
20. **Tech-Schulden vermeiden:** **Markdown als SoT festlegen** (nicht DB-only — sonst später schmerzhafte
    Migration zu menschenlesbarem Memory); Frontmatter-Schema früh stabilisieren.

---

### PHASE 6 — MEMORY

1. **Ziel:** Persistentes Langzeitgedächtnis über Projekte/Sessions hinaus: Decisions, Tasks, People,
   Preferences, Learnings, Daily Notes — strukturiert **und** menschenlesbar.
2. **Warum hier:** Bündelt Projekte (1/4) + Sessions (5) zu abrufbarem Wissen und ist die Grundlage für
   sinnvolle KI-Antworten (7). **Vor** KI, damit die KI später *auf etwas* zugreift.
3. **Voraussetzungen:** Phase 4/5 (SQLite + Vault + Markdown-Muster stehen).

4. **Technische Entscheidung (deine ausdrückliche Frage — NICHT blind Obsidian):**

   | Option | Rolle | Bewertung |
   |---|---|---|
   | **Eigenes Markdown-System** | **Source of Truth** | ✅ menschenlesbar, git-fähig, zukunftssicher, **Obsidian-kompatibel** (Frontmatter + `[[wiki-links]]`) ohne Obsidian-Abhängigkeit |
   | Obsidian (als Pflicht) | — | ❌ **nicht** als harte Abhängigkeit — koppelt dich an fremde App/Plugin-API. **Aber:** Vault so schreiben, dass du ihn *optional in Obsidian öffnen* kannst |
   | **SQLite** | **Index/Query-Layer** | ✅ schnelle Filter/Relationen/Backlinks; **abgeleitet**, aus Markdown rebuildbar |
   | Vector-DB (Chroma/LanceDB) | — | ❌ **v1 nicht nötig**; separater Store = Betriebs-/Sync-Aufwand |
   | **sqlite-vec** (Embeddings *in* SQLite) | optional ab 7 | ✅ falls semantische Suche → **ein File**, kein Extra-Dienst |
   | Embeddings | — | erst, wenn Keyword-/Metadaten-Suche nachweislich nicht reicht (Phase 7) |

   **Empfehlung V1:**
   - **Source of Truth = Markdown-Vault** (`~/.wone/vault/` oder vom Nutzer gewählter Ordner; Frontmatter +
     Wiki-Links → *interoperabel mit Obsidian, ohne es zu brauchen*).
   - **SQLite = Index** (Volltext via FTS5 + Metadaten/Backlinks) — **rebuildbar** aus dem Vault.
   - **Noch keine Vector-DB, noch keine Embeddings.** FTS5-Keyword-Suche + Tags/Backlinks reicht für V1.
   - Embeddings (via sqlite-vec) **erst in/ab Phase 7**, wenn „unscharfe" semantische Treffer gebraucht werden.
   - **Chaos-Vermeidung:** feste Memory-Typen mit **festem Frontmatter-Schema**, feste Ordner je Typ,
     Templates, Pflicht-Tags, ein „Inbox→kuratiert"-Flow. Struktur wird durch Schema erzwungen, nicht durch Disziplin.

5. **Architektur:** `MemoryService`: `vault.ts` (Markdown CRUD + Frontmatter), `index.ts` (SQLite-FTS5 +
   Backlink-Graph), später `embeddings.ts`. Ein Datei-Watcher hält den Index konsistent, wenn extern
   editiert wird (z. B. in Obsidian).
6. **Libraries:** `gray-matter` (da), **SQLite FTS5** (in better-sqlite3 enthalten), **`chokidar`**
   (Vault-Watcher). **Keine** Vector-DB, **kein** Embedding-SDK in dieser Phase.
7. **Neue Komponenten:** `MemoryBrowser` (nach Typ/Tag/Suche), `MemoryEntryView`, `MemoryEditor`,
   `BacklinkPanel`, globale `MemorySearch` (Command-Palette-fähig). Das `Memory`-Modul wird echt.
8. **Neue Services:** `MemoryService` (+ vault/index/watcher).
9. **Main-Funktionen:** Markdown lesen/schreiben, Frontmatter validieren (Zod pro Typ), FTS-Upsert,
   Backlinks parsen (`[[…]]`), Vault-Watch → Reindex, „rebuild index".
10. **IPC-Channels:** `memory:create` · `memory:update` · `memory:delete` · `memory:get` · `memory:search`
    (Query + Typ/Tag-Filter) · `memory:backlinks` · `memory:reindex` (+ Progress-Push).
11. **Datenmodelle:**
    ```ts
    type MemoryType='project'|'session'|'decision'|'task'|'person'|'preference'|'learning'|'daily';
    interface MemoryEntry {
      id:string; type:MemoryType; title:string;
      createdAt:string; updatedAt:string; tags:string[];
      links:string[];                 // [[targets]]
      projectId?:string;              // Bindung
      body:string;                    // Markdown
      // typ-spezifische Frontmatter-Felder (z.B. decision: {context,choice,rationale})
    }
    ```
12. **Speicherstrategie:** Vault-Ordnerbaum je Typ (`decisions/`, `learnings/`, `people/`, `daily/`, …).
    SQLite: `memory` + `memory_fts` + `memory_link`. **Vault = SoT**, DB = Index (aus Vault rebuildbar).
13. **Security-Risiken:** Vault-Pfad-Confinement; sicheres Markdown-Rendering (Sanitizing); bei externem
    Editieren keine Code-Ausführung; Frontmatter-Validierung gegen Schema.
14. **Performance-Risiken:** Reindex bei großem Vault → inkrementell (mtime), Progress; FTS-Queries sind schnell.
    Watcher-Debounce, sonst Reindex-Sturm.
15. **macOS/Windows:** Datei-Watching-Verhalten (chokidar kapselt), Case-Sensitivity bei Wiki-Link-Auflösung,
    Pfadlängen.
16. **Umsetzungsreihenfolge:** Vault-Schema + Typen/Templates → CRUD (Markdown) → FTS-Index → Suche/Filter-UI →
    Backlinks → Watcher/Reindex → Sessions (5) & Projects (1) in Memory einhängen.
17. **DoD:** Ich kann Decisions/Learnings/etc. anlegen, per Volltext+Tag finden, Backlinks sehen; alles liegt
    als lesbares Markdown vor und ist (optional) in Obsidian öffnbar; Index aus Vault rebuildbar. **Ohne KI.**
18. **Tests:** externes Editieren (Obsidian) → Index folgt; 1.000+ Einträge (Such-Latenz); Backlink-Zyklen;
    Frontmatter-Verletzung (Validierungsfehler sichtbar); Reindex-Korrektheit.
19. **NICHT in Phase 6:** **keine** Embeddings/Vector-Suche (erst 7 bei Bedarf), keine KI-Auto-Kuratierung,
    keine automatische Memory-Erzeugung durch ein Modell.
20. **Tech-Schulden vermeiden:** **DB niemals zur SoT machen**; Typ-Schemata + Ordnerkonvention **vor** dem
    Befüllen fixieren; Templates erzwingen (verhindert das „chaotische Memory").

---

### PHASE 7 — AI LAYER

1. **Ziel:** Erstes Modell anschließen: Fragen beantworten, Projekt-/Memory-Kontext lesen, Sessions
   zusammenfassen, Pläne/Vorschläge erstellen. **Noch KEINE Tool-Ausführung** (nur Text raus).
2. **Warum hier:** Erst jetzt existiert *echter Kontext* (1/4/5/6), den das Modell nutzen kann — dadurch
   billig, fokussiert und ohne „dump my whole memory".
3. **Voraussetzungen:** Phasen 4–6 (Context, Sessions, Memory + Index/FTS). SecretsService (safeStorage).
4. **Features:** Chat/Ask im `MainCommandPanel` · Kontext-Assembly aus Projekt+Memory · Memory-Suche als
   Retrieval · Session-Zusammenfassung · Plan-/Vorschlags-Generierung · Streaming-Antworten ·
   Provider-/Modellwahl in Settings · Conversation-Historie.
5. **Architektur:** `AIService` mit **Provider-Abstraktion** (`LLMProvider`-Interface) und
   **`contextAssembler`** (Retrieval-Pipeline). Modellaufruf **nur im Main** (Key-Schutz), Antwort per
   Stream über IPC in den Renderer. Conversations in SQLite.
6. **Libraries:** **`@anthropic-ai/sdk`** (primär; neueste Claude-Modelle als Default), optional
   **`openai`** (zweiter Provider). Token-Zählung über die SDKs/`countTokens`. **Kein** LangChain/Framework
   (unnötige Abstraktion; du kontrollierst Prompt & Retrieval selbst).
7. **Neue Komponenten:** `ChatPanel`/`ConversationView` (im `MainCommandPanel`), `MessageStream`,
   `ContextPreview` („welcher Kontext ging ins Modell"), `ModelPicker` (Settings), `TokenBadge`.
8. **Neue Services:** `AIService`, `providers/*`, `contextAssembler.ts`, `conversationStore.ts`, `SecretsService`.
9. **Main-Funktionen:** Streaming-Request an Provider, Chunk→IPC, Cancellation (AbortController),
   Retry/Backoff, Token-Budgeting, Key aus safeStorage.
10. **IPC-Channels:** `ai:ask` (Prompt + Scope) · `ai:stream` (push Chunks) · `ai:cancel` ·
    `ai:conversations` / `ai:conversation:get` · `ai:providers` / `ai:setKey` (Key nie zurückgeben) ·
    `ai:summarizeSession`.
11. **Datenmodelle:**
    ```ts
    interface Conversation { id:string; projectId?:string; title:string; createdAt:string;
      model:string; messages:Message[] }
    interface Message { role:'user'|'assistant'|'system'; content:string; ts:string;
      tokensIn?:number; tokensOut?:number; contextRefs?:string[] }  // welche Memory/Context-IDs
    interface LLMProvider { id:string; listModels():Model[];
      stream(req:LLMRequest, onChunk, signal):Promise<LLMResult> }
    ```
12. **Speicherstrategie:** Conversations in SQLite; Keys in OS-Keychain/`safeStorage`; **niemals** Keys in
    JSON/Store/Renderer.
13. **Security-Risiken:** **Key-Leak** (nur Main, nie Renderer); **Prompt-Injection** aus Memory/Context
    (Kontext = untrusted data, klar vom System-Prompt getrennt; Modell darf nichts ausführen); PII/Datenschutz
    (was verlässt lokal die Maschine → transparent machen, Opt-in).
14. **Performance/Kosten-Risiken:** **zu viel Kontext = teuer/langsam** → hartes Token-Budget; Retrieval statt
    Full-Dump; Prompt-Caching nutzen; Streaming für gefühlte Latenz.
15. **macOS/Windows:** `safeStorage`-Backend unterschiedlich (Keychain vs. DPAPI) — API gleich; sonst kaum
    Unterschiede (reines Netz/IO).
16. **Umsetzungsreihenfolge:** SecretsService + Key-Setup → `LLMProvider` (Anthropic) + Streaming end-to-end
    (ohne Kontext) → `contextAssembler` (deterministisch: Projekt-Scope + jüngste Sessions + FTS-Treffer +
    Pins) → Token-Budgeting → Conversation-Storage → Session-Summary → ContextPreview → zweiter Provider.
17. **DoD:** Ich stelle eine Frage im Command-Panel; W/-ONE lädt *relevanten* Kontext (sichtbar im
    ContextPreview), streamt eine fundierte Antwort, speichert die Conversation; **nichts wird ausgeführt**.
    Dein Eingangs-Szenario („woran habe ich zuletzt gearbeitet?") funktioniert real.

18. **Sonderfrage — „nur relevanter Kontext statt gesamtes Memory":** mehrstufige Retrieval-Pipeline im
    `contextAssembler`:
    1) **Scope zuerst** (aktives Projekt/aktuelle Session als harter Filter).
    2) **Deterministisch** (SQLite): jüngste Sessions, offene Tasks/Decisions des Projekts, gepinnte Einträge.
    3) **Keyword/FTS5** auf die Query (Top-K Memory-Einträge).
    4) **Erst falls nötig: semantisch** (Embeddings via sqlite-vec) für unscharfe Treffer.
    5) **Ranking + Token-Budget:** feste Sektionen (System, Projekt-Fakten, Top-K Memory, jüngste Session),
       harte Obergrenze; überzählige Treffer werden zusammengefasst statt eingefügt.
    → Das Modell sieht **kuratierte, ID-referenzierte Snippets**, nie den ganzen Vault.

19. **NICHT in Phase 7:** **keine** Tool-Ausführung, kein Datei-Schreiben, kein Terminal durch die KI, keine
    Autonomie, keine Multi-Agenten.
20. **Tech-Schulden vermeiden:** Provider **hinter Interface** (kein Vendor-Lock im UI); Retrieval **getrennt**
    von Prompt-Templates; Token-Budget von Tag 1; Kontext-Herkunft (IDs) mitschreiben (Debuggbarkeit &
    Injection-Forensik).

---

### PHASE 8 — TOOL ACTIONS (kontrolliert)

1. **Ziel:** Die KI darf Aktionen **vorschlagen** und — nach Freigabe — ausführen: Projekt öffnen, Datei
   suchen/lesen, Git-Status, Terminal-Befehl vorschlagen/ausführen, Browser öffnen, Datei erstellen/ändern.
   **Sicherheit > Autonomie.**
2. **Warum hier:** Erst mit belastbarem Kontext (7) *und* nach bewusst gebautem Approval/Audit sinnvoll —
   das ist der gefährlichste Schritt und braucht das Fundament davor.
3. **Voraussetzungen:** Phase 7 (AI), Phase 3 (PTY), Phase 1/4 (Projekt-Roots für Path-Confinement),
   AuditService.
4. **Features:** Tool-Registry mit Schemas · Modell erzeugt **Tool-Calls** (Anthropic Tool-Use) · Approval-UI
   (READ ggf. auto, WRITE=Diff+Bestätigung, EXECUTE=Command+Bestätigung, DESTRUCTIVE=Block/„type to confirm")
   · Ausführung im Main mit Policy-Check · Audit-Log · Timeouts/Cancellation · Allowlist/Blocklist.
5. **Architektur:** `ToolService` = Registry (Zod-Schema pro Tool) + `policy.ts` (Klassifizierung &
   Allow/Block) + `approvals.ts` (Renderer-Bestätigung via IPC-Roundtrip) + Executor. Ablauf: KI schlägt
   Tool-Call vor → Policy klassifiziert → (falls nötig) Approval-UI → Executor → Ergebnis zurück ins Modell →
   Audit. **Deterministische Policy-Engine vor jeder Ausführung**, nie das Modell entscheidet über Freigabe.
6. **Libraries:** **`zod`** (Tool-Schemas + Validierung; ggf. schon in 0 eingeführt). Anthropic Tool-Use aus
   dem SDK (da). Kein Agent-Framework.
7. **Neue Komponenten:** `ApprovalDialog` (Read/Write/Execute/Destructive-Varianten), `DiffPreview`,
   `CommandPreview`, `ToolCallCard` (im Chat), `AuditLogView`, `PermissionSettings`. `QuickActions` &
   `RecentCommands` werden hier echt.
8. **Neue Services:** `ToolService`, `policy.ts`, `approvals.ts`, `AuditService`.
9. **Main-Funktionen:** Tool-Dispatch, Path-Confinement (`fsSafe`), Command-Parsing + Allow/Blocklist,
   sichere Ausführung (`execFile`/PTY, **kein** `shell:true` aus Modell-Text), Timeout/Kill, Audit-Write.
10. **IPC-Channels:** `tools:list` · `tools:proposeApproval` (Main→Renderer push) · `tools:approve`/`tools:reject`
    · `tools:execute` (nach Freigabe) · `tools:cancel` · `audit:list`. KI-Loop: `ai:ask` liefert Tool-Calls →
    Approval → `tools:execute` → Ergebnis zurück in `ai:stream`.
11. **Datenmodelle:**
    ```ts
    type Risk='read'|'write'|'execute'|'destructive';
    interface ToolDef { name:string; risk:Risk; schema:ZodSchema; run(input):Promise<ToolResult> }
    interface ToolCall { id:string; tool:string; input:unknown; risk:Risk;
      status:'proposed'|'approved'|'rejected'|'running'|'done'|'error'|'timeout'; result?:ToolResult }
    interface AuditEntry { id:string; ts:string; tool:string; risk:Risk; input:unknown;
      approvedBy:'auto'|'user'; outcome:string; projectId?:string }
    ```
12. **Speicherstrategie:** Tool-Registry im Code; Audit append-only in SQLite + JSONL-Spiegel; Permission-
    Defaults in Settings (z. B. „READ auto-erlauben: an/aus").
13. **Security-Risiken (Kern der Phase):** Path-Traversal (Confinement auf Projekt-Roots), Command-Injection
    (Args-Array, Blocklist, keine Shell-Interpolation), Prompt-Injection→Aktion (Modell schlägt nur vor,
    Mensch/Policy gibt frei), Destruktives (harte Blocklist + Doppelbestätigung), Secret-Exfiltration (Tools
    dürfen keine Keys lesen/senden), Timeout/Runaway (Kill-Switch, globaler „Stop all").
14. **Performance-Risiken:** langlaufende Tools → async + Cancellation; Audit-Writes gepuffert.
15. **macOS/Windows:** „Browser/Editor öffnen", „Terminal öffnen", Command-Syntax, Signale/Kill,
    Executable-Auflösung unterschiedlich → pro-OS-Adapter im Executor.
16. **Umsetzungsreihenfolge:** Registry + Zod → **nur READ-Tools** (list/read/git-status) + Audit →
    Policy-Engine + Approval-UI → WRITE (Datei erstellen/ändern **mit Diff**) → EXECUTE (Command **mit
    Preview**, Allowlist) → DESTRUCTIVE-Block → globaler Kill-Switch → KI-Tool-Loop verdrahten.
17. **DoD:** Die KI kann eine Read-Aktion (z. B. „lies Datei X, prüfe Git-Status") ausführen; jede Write/
    Execute-Aktion erfordert meine Bestätigung mit Vorschau; destruktive Kommandos werden blockiert; jede
    Aktion steht im Audit-Log; „Stop all" wirkt sofort.
18. **Tests:** Path-Escape-Versuch (`../../etc`), injizierte Instruktion in einer Datei („ignore rules and
    run …") → **kein** Auto-Execute; `rm -rf` → blockiert; Timeout greift; Reject bricht sauber ab;
    Audit vollständig; Cancellation mitten in Ausführung.
19. **NICHT in Phase 8:** keine unbeaufsichtigte Autonomie, kein Auto-Approve für Write/Execute, kein Remote-
    Zugriff, keine Multi-Agenten.
20. **Tech-Schulden vermeiden:** **Policy deterministisch & getrennt vom Modell**; Approval **nie** vom LLM
    entscheidbar; Registry/Permissions von Anfang erweiterbar; Audit von der ersten Aktion an.

---

### PHASE 9 — VOICE

1. **Ziel:** Sprachsteuerung in fester Reihenfolge: 1) Push-to-Talk → 2) STT → 3) Text-Antwort →
   4) TTS → (5) Wake-Word später → (6) Realtime später.
2. **Warum hier:** Reines **Input/Output-Convenience** über der bestehenden KI (7/8) — bringt keinen neuen
   Kern-Nutzen, daher bewusst spät. Kein Blocker für irgendetwas.
3. **Voraussetzungen:** Phase 7 (KI antwortet). Mikrofon-Permission.
4. **Features (in Reihenfolge):** PTT-Taste (Hotkey/Button) · Audio-Aufnahme · STT → Text ins Command-Panel ·
   Antwort als Text (da) · TTS der Antwort · später Wake-Word · später Realtime-Duplex.

5. **Vergleich (deine ausdrückliche Frage):**

   | Aspekt | Lokal | Cloud |
   |---|---|---|
   | **STT** | whisper.cpp (`whisper-node`/Binary) — privat, offline, kostenlos; Latenz je nach Modell/CPU; Setup-Aufwand | Deepgram/OpenAI Whisper/AssistantAI — sehr gut & schnell, aber Audio verlässt Gerät, Kosten |
   | **TTS** | Piper (lokal, gut, offline) / OS-`say`/SAPI (simpel, mittlere Qualität) | ElevenLabs/OpenAI — beste Qualität, Kosten, Netz |
   | **Latenz** | abhängig von Hardware | Netz-RTT, meist niedrig |
   | **Kosten** | 0 | pro Minute/Zeichen |
   | **Datenschutz** | ✅ lokal-first | ⚠️ Audio/Text in Cloud |

   **Empfehlung:** Start pragmatisch **Cloud-STT (Whisper/Deepgram) + OS-TTS** für schnelle Ergebnisse,
   **Abstraktion** (`SpeechProvider`) einbauen und **lokale Optionen (whisper.cpp / Piper)** als
   Privacy-Modus nachrüsten. PTT zuerst, Wake-Word (Picovoice Porcupine) und Realtime **deutlich später**.
6. **Libraries:** je nach Wahl: Cloud-SDK **oder** `whisper.cpp`-Binding + `Piper`. `MediaRecorder`
   (Web-API, im Renderer) für Aufnahme. Global-Hotkey via Electron `globalShortcut`. Minimal halten.
7. **Neue Komponenten:** `PushToTalkButton`, `VoiceIndicator` (Listening/Transcribing), `TranscriptPreview`,
   Voice-Settings (Provider, Sprache, Stimme).
8. **Neue Services:** `VoiceService` (`stt.ts`, `tts.ts`, `SpeechProvider`-Abstraktion).
9. **Main-Funktionen:** Audio → STT (lokal/Cloud), Text → `ai:ask`, Antwort → TTS → Playback; Hotkey-Registrierung.
10. **IPC-Channels:** `voice:startPTT` · `voice:stopPTT` · `voice:transcript` (push) · `voice:speak` ·
    `voice:state`.
11. **Datenmodelle:** `interface VoiceSettings { sttProvider; ttsProvider; language; voice; pttHotkey;
    privacyLocalOnly:boolean }`. Transcript → normale `ai:ask`-Eingabe.
12. **Speicherstrategie:** Settings persistiert; Audio **nicht** dauerhaft speichern (Datenschutz),
    höchstens flüchtig.
13. **Security-Risiken:** Mikrofon-Consent; Audio-Cloud-Transfer transparent & opt-in; Wake-Word = Dauer-
    Listening → nur mit klarer Anzeige/Opt-in; kein heimliches Aufnehmen.
14. **Performance-Risiken:** lokales Whisper = CPU/RAM-intensiv (Modellgröße wählbar); TTS-Startlatenz;
    Audio-Pipeline nicht blockierend.
15. **macOS/Windows:** Mikrofon-Permission-Flow unterschiedlich (macOS TCC-Prompt); Audio-Devices; `globalShortcut`-
    Konflikte; OS-TTS-Stimmen unterschiedlich.
16. **Umsetzungsreihenfolge:** PTT-Button + Aufnahme → STT (Cloud) → Transcript ins Panel → TTS (OS) →
    Settings/Provider-Abstraktion → (später) lokale Provider → (später) Wake-Word → (viel später) Realtime.
17. **DoD:** Ich halte PTT, spreche, sehe das Transkript, bekomme eine gesprochene Antwort — stabil, mit
    sichtbarem Zustand und Consent.
18. **Tests:** laute Umgebung; lange Aufnahme; Sprachumschaltung; Permission verweigert (graceful);
    Hotkey-Konflikt; Cloud offline → Fallback/Fehler.
19. **NICHT in Phase 9:** kein Always-On-Wake-Word zu Beginn, kein Realtime-Duplex, keine Sprach-getriggerte
    *Ausführung* ohne die Phase-8-Approvals (Voice ändert **nichts** an den Sicherheitsregeln).
20. **Tech-Schulden vermeiden:** `SpeechProvider`-Abstraktion von Anfang (lokal/Cloud tauschbar); Audio nie
    unnötig persistieren; Voice ist nur ein I/O-Adapter vor der bestehenden KI, **keine** parallele Logik.

---

### PHASE 10 — MULTI-AGENT ORCHESTRATOR (nur wenn wirklich nötig)

1. **Ziel:** **Kritisch prüfen**, ob aus dem Single-Agent (7/8) ein Multi-Agent-System werden soll — und es
   nur dann, minimal, einführen. Rollen: CORE (Orchestrator), SCOUT (Retrieval), FORGE (Code), SENTINEL
   (Sicherheit).
2. **Warum ganz am Ende:** Multi-Agent löst *Skalierungs-/Isolationsprobleme*, die du erst hast, wenn der
   Single-Agent nachweislich an Grenzen stößt. Vorher = künstliche Komplexität (Regel 5).

3. **Ehrliche Architektur-Bewertung (deine ausdrückliche Frage):**
   - **Wann reicht EIN Agent mit Tools?** Fast immer für persönliche Command-Center-Aufgaben. Ein Agent +
     gutes Retrieval + Tool-Registry (8) deckt „verstehen, planen, kontrolliert ausführen" vollständig ab.
   - **Wann sind Sub-Agenten sinnvoll?** Nur bei (a) **Kontext-Isolation** (parallele, unabhängige Teil-
     aufgaben mit je eigenem, großem Kontextfenster), (b) **unterschiedlichen Tool-/Permission-Scopes**
     (z. B. read-only Retrieval getrennt von schreibendem Code-Agent), (c) echter **Parallelisierbarkeit**.
   - **Wann lohnt ein Orchestrator?** Erst wenn du mehrere solcher Sub-Agenten *koordinieren* musst.
   - **Probleme durch Multi-Agent:** Latenz (mehr Roundtrips), Kosten (mehrfacher Kontext), Fehlerfortpflanzung,
     Debugging-Hölle, „Agenten reden aneinander vorbei", nichtdeterministische Kontrolle über Aktionen.
   - **SENTINEL sollte KEIN LLM sein:** Sicherheit gehört in eine **deterministische Policy-Engine** (Phase 8),
     nicht in einen Sprachmodell-„Wächter" (der selbst injizierbar ist). SENTINEL = Code, nicht Agent.
   - **Empfehlung:** **Kein echtes Multi-Agent-System bauen, solange Single-Agent + Tools reicht.** Wenn doch,
     dann als **erster Schritt genau EINE Grenze**: ein **read-only SCOUT-Sub-Agent** (isoliertes Retrieval/
     Zusammenfassen großer Quellen) — als *Tool*, das CORE aufruft, nicht als dauerhaft laufender Peer. FORGE
     nur, wenn Code-Aufgaben eigenen, großen Kontext brauchen. CORE bleibt der einzige Aktions-Entscheider
     (mit Phase-8-Approvals). **SENTINEL bleibt deterministische Policy, kein Agent.**
4. **Features (falls gebaut, minimal):** CORE plant & ruft SCOUT (als Tool) für Retrieval/Zusammenfassung;
   optional FORGE für Code-lastige Teilaufgaben; alle Aktionen weiter durch Phase-8-Approvals.
5. **Architektur:** `Orchestrator` = dünne Schleife: CORE-Turn → ggf. Sub-Agent-Tool-Call (eigener Kontext,
   eigenes Budget) → Ergebnis zurück zu CORE. **Kein** Dauerläufer, **kein** Agent-Bus. Sub-Agenten sind
   spezialisierte Prompts+Tool-Scopes, nicht separate Prozesse.
6. **Libraries:** keine neuen (dasselbe Provider-SDK, dieselbe Tool-Registry). **Kein** Agent-Framework
   (CrewAI/AutoGen/LangGraph) — würde Kontrolle & Sicherheit verwässern.
7. **Neue Komponenten:** `AgentActivityView` (welcher „Rollen-Turn" gerade läuft), Erweiterung der bestehenden
   `AgentStatusCard`s zu echten Zuständen.
8. **Neue Services:** `Orchestrator`, `roles/*` (Prompt+Tool-Scope-Definitionen).
9. **Main-Funktionen:** Turn-Loop, Sub-Kontext-Budgetierung, Ergebnis-Zusammenführung, Hard-Limits
   (max Turns/Kosten).
10. **IPC-Channels:** `agents:run` · `agents:activity` (push, welche Rolle/Was) · `agents:cancel`. Aktionen
    weiterhin über `tools:*` (unverändert abgesichert).
11. **Datenmodelle:** `interface AgentRole { id:'core'|'scout'|'forge'; system:string; toolScope:string[];
    model:string; maxTokens:number }` · `interface AgentRun { id:string; goal:string; turns:AgentTurn[];
    status; costTokens:number }`.
12. **Speicherstrategie:** Runs/Turns in SQLite (wie Conversations); Rollen-Definitionen im Code.
13. **Security-Risiken:** mehr Aktions-Oberfläche → **alle** Aktionen bleiben durch Phase-8-Policy/Approval;
    Sub-Agenten erben **engere** Tool-Scopes (SCOUT read-only); kein Agent umgeht SENTINEL/Policy.
14. **Performance/Kosten-Risiken:** Multiplikation von Kontext/Turns → harte Turn-/Kosten-Limits, Caching,
    „einfachster Pfad zuerst" (erst Single-Agent versuchen).
15. **macOS/Windows:** keine spezifischen Unterschiede (reine Logik/Netz).
16. **Umsetzungsreihenfolge:** **Messen** (wo scheitert Single-Agent?) → *falls* nötig: SCOUT als read-only
    Tool → CORE→SCOUT-Loop → Limits/Activity-UI → *nur bei Bedarf* FORGE. SENTINEL = bleibt Policy (Phase 8).
17. **DoD:** Entweder dokumentierte Entscheidung „Single-Agent reicht — kein Multi-Agent" **oder** ein
    minimaler CORE+SCOUT-Flow mit klaren Limits, der eine reale Aufgabe messbar besser löst als der Single-Agent.
18. **Tests:** identische Aufgabe Single- vs. Multi-Agent (Qualität/Kosten/Latenz vergleichen); Sub-Agent-
    Tool-Scope-Verletzung (verhindert); Kosten-Limit greift; Abbruch mitten im Run.
19. **NICHT in Phase 10:** keine dauerhaft laufenden autonomen Agenten, kein Agent-zu-Agent-Chat ohne CORE,
    kein LLM-SENTINEL, kein Framework.
20. **Tech-Schulden vermeiden:** Multi-Agent **nur mit Nachweis** einführen; Sub-Agenten als Tool-mit-Kontext,
    nicht als Prozess-Zoo; Sicherheit bleibt deterministisch; jederzeit auf Single-Agent zurückfallbar.

---

## E) UI-MAPPING (bestehende Flächen → echte Funktion)

| UI-Fläche (existiert) | Wird echt in | Zeigt Daten | Erlaubt Aktionen |
|---|---|---|---|
| **Core** (Modul) | 5→7 | Dashboard: aktives Projekt, letzte Session, Objective, KI-Ask | Frage stellen (7), Session starten (5) |
| **Terminal** (Modul) | **3** | echte Shell-Sessions | ausführen (nur Nutzer); ab 8 KI-Vorschläge mit Approval |
| **Projects** (Modul) | **1** (Tiefe: 4) | Registry, Git, Stack; Kontext (4) | add/remove/open in VS Code/Terminal, reindex |
| **Memory** (Modul) | **6** | Vault-Einträge, Suche, Backlinks | anlegen/editieren/suchen |
| **Agents** (Modul) | 7 (Single) → 10 (Multi) | Modell/Provider-Status; später Rollen-Aktivität | Modell wählen (7); Runs starten (10, optional) |
| **System** (Modul) | **2** | echte CPU/RAM/Disk/Netz/Battery/Prozesse | (read-only) |
| **Settings** | 1→2→7 | Theme, Projekte, Provider/Keys, Voice, Permissions | Keys setzen (7), Permissions (8), Voice (9) |
| **Main Command Interface** | 3 (Terminal) / **7** (Chat) | Terminal-Output **und** KI-Konversation + ContextPreview | ausführen (3), fragen (7), Tool-Calls (8) |
| **Current Objective** | 5→7 | aktuelles Ziel/Plan (manuell in 5, KI-veredelt in 7) | setzen/aktualisieren |
| **Recent Commands** | 3→**8** | zuletzt (vom Nutzer) ausgeführt; ab 8 KI-vorgeschlagen | erneut ausführen (mit Approval ab 8) |
| **System Events** | 2→8 | echte System-/App-Events; ab 8 Audit-Ereignisse | — / Audit öffnen |
| **Project Context** (Card) | 1→**4** | Git/Stack (1), dann Struktur/Deps/TODOs (4) | reindex, Datei öffnen |
| **Agent Cards** | 7→10 | Single-Agent-Status (7); echte Rollen erst bei 10 | — / Run (10) |
| **Quick Actions** | 1→**8** | Buttons (Projekt öffnen, Terminal, …) real ab 1; KI-Tools ab 8 | ausführen (mit Approval-Klassen ab 8) |

---

## F) PHASEN-ABHÄNGIGKEITEN (mit kritischer Prüfung)

```
                 ┌───────────────────────────── PHASE 0 (Foundation: IPC/Services/Store) ─────┐
                 ▼                                                                             │
   PHASE 1 Projects ──────────────► PHASE 4 Context ──► PHASE 5 Sessions ──► PHASE 6 Memory ──► PHASE 7 AI ──► PHASE 8 Tools ──► PHASE 10 Agents(optional)
                 │                                                                                    │             ▲
   PHASE 2 System (parallel) ─┐                                                                       │             │
   PHASE 3 Terminal (parallel)┴─────────────────────────────────────────────────────────────────────┘   PHASE 9 Voice ──► (nutzt 7/8)
```

**Kritische Prüfung deiner Reihenfolge:**
- **Müssen 2 und 3 in dieser Reihenfolge?** **Nein.** Phase 2 (System) und Phase 3 (Terminal) sind
  voneinander **und** von Phase 1 unabhängig (alle nur auf Phase 0 aufsetzend). **Empfehlung:** Phase 2
  **vor** 3 machen — geringeres Risiko, hoher visueller Payoff, etabliert das Polling/Push-Muster; Phase 3
  ist wegen node-pty-Rebuild die riskanteste frühe Phase.
- **Was ist parallelisierbar?** {1}, {2}, {3} sind ein **paralleles Bündel** (Milestone 1). Sie teilen sich
  nur Phase 0. Zwei können gleichzeitig entwickelt werden.
- **Was blockiert was (harte Kette)?** 1 → 4 → 5 → 6 → 7 → 8. (7 braucht Kontext aus 4/5/6; 8 braucht 7 **und** 3.)
- **Voice (9):** hängt nur an 7, unabhängig von 8/10 → jederzeit nach 7 einschiebbar.
- **Agents (10):** hängt an 8; **optional** und nur bei nachgewiesenem Bedarf.
- **Empfohlene reale Reihenfolge:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → (9) → (10), wobei 1/2/3 zeitlich
  überlappen dürfen.

---

## G) MVP-MEILENSTEINE

**MILESTONE 1 — „Echtes lokales Developer Command Center (ohne KI)"** → Phasen 0,1,2,3
- **Nutzwert:** Projekte verwalten, echtes System-Monitoring, echtes Terminal — W/-ONE ersetzt schon jetzt
  mehrere Alltags-Tools.
- **Demo:** „Projekt hinzufügen → Git-Status & Stack sehen → in VS Code öffnen → integriertes Terminal im
  Projekt starten → CPU/RAM live beobachten."

**MILESTONE 2 — „W/-ONE kennt Projekte & frühere Sessions"** → Phasen 4,5 (+6 Grundlage)
- **Nutzwert:** strukturierter Projektkontext + festgehaltene Arbeitsstände; „woran habe ich zuletzt
  gearbeitet?" **manuell** beantwortbar.
- **Demo:** „Session zu Webma One beenden mit Done/Open/Next → später Projekt öffnen → letzte Session +
  Kontext (Struktur/TODOs) sehen."

**MILESTONE 3 — „Intelligente Antworten mit Projekt-/Memory-Kontext"** → Phasen 6,7
- **Nutzwert:** dein Eingangs-Szenario wird real — W/-ONE lädt relevanten Kontext und antwortet fundiert;
  fasst Sessions zusammen, schlägt Pläne vor. **Keine Ausführung.**
- **Demo:** „‚Woran habe ich bei Webma One zuletzt gearbeitet?' → kontextbasierte Antwort inkl. offenem
  Problem (Slide 01 / Orb) + ContextPreview, welche Einträge genutzt wurden."

**MILESTONE 4 — „Kontrollierte Aktionen"** → Phase 8
- **Nutzwert:** W/-ONE handelt — sicher, mit Approval & Audit.
- **Demo:** „‚Öffne das Projekt und analysiere den Stand' → KI liest (READ, auto) Dateien/Git → schlägt
  Terminal-Befehl vor → ich bestätige (EXECUTE) → Ergebnis; `rm -rf` würde blockiert."

**MILESTONE 5 — „Sprachbedienung"** → Phase 9
- **Nutzwert:** freihändige Nutzung; PTT-Frage → gesprochene Antwort.
- **Demo:** „PTT halten, fragen, gesprochene Antwort — Aktionen weiterhin nur mit Approval."

**MILESTONE 6 — „Multi-Agent nur wenn sinnvoll"** → Phase 10 (optional)
- **Nutzwert:** entweder dokumentierte Entscheidung *dagegen* oder ein minimaler CORE+SCOUT-Flow, der eine
  reale Aufgabe messbar besser löst.
- **Demo:** „Komplexe Recherche-+Umsetzungsaufgabe: Single- vs. CORE+SCOUT im direkten Vergleich (Qualität/
  Kosten/Latenz)."

---

## H) ZEIT- & KOMPLEXITÄTSSCHÄTZUNG (realistisch, nicht optimistisch)

> Annahme: du entwickelst neben anderem, lernst Systems-Architektur unterwegs. „Umfang" = grobe
> Netto-Bauzeit für eine solide, getestete Umsetzung.

| Phase | Schwierigkeit /10 | Risiko /10 | Umfang | Größte Lernkurve | Wahrscheinlichster Stolperpunkt |
|---|---|---|---|---|---|
| 0 Foundation | 5 | 4 | 3–5 Tage | typed IPC sauber designen | Über-Engineering des IPC-Layers |
| 1 Projects | 4 | 3 | 4–7 Tage | Git via `execFile`, Path-Safety | Cross-Platform „open in editor/terminal" |
| 2 System | 4 | 3 | 3–5 Tage | Sampler-Lifecycle über IPC | Battery/Temp/Prozess-Unterschiede OS |
| 3 Terminal | **7** | **7** | 5–10 Tage | **node-pty Native-Rebuild** | Rebuild gegen Electron-ABI (macOS **&** Windows) |
| 4 Context | 6 | 4 | 6–10 Tage | Analyzer + SQLite-Migrationen | Große Repos / Performance / Limits |
| 5 Sessions | 4 | 3 | 3–5 Tage | Markdown-als-SoT + Index | Frontmatter-Schema stabil halten |
| 6 Memory | **7** | 5 | 8–14 Tage | Vault↔Index-Konsistenz, Watcher | Memory-Chaos ohne strikte Schemata |
| 7 AI | **8** | **7** | 10–18 Tage | **Context-Assembly/Retrieval** | Zu viel Kontext → Kosten/Latenz; Key-Sicherheit |
| 8 Tools | **9** | **9** | 12–20 Tage | Policy/Approval/Sandbox | Prompt-Injection→Aktion; sichere Ausführung |
| 9 Voice | 6 | 5 | 5–9 Tage | Audio-Pipeline, STT/TTS | Mikrofon-Permissions, lokale Modelle |
| 10 Agents | **8** | 6 | 6–12 Tage (optional) | Orchestrierung vs. Nutzen | Komplexität ohne Mehrwert (Falle) |

**Rote Zonen (hier bleibst du am ehesten hängen):** Phase 3 (node-pty-Rebuild), Phase 7 (Context-Assembly),
Phase 8 (Sicherheit richtig). Plane hier bewusst Puffer + kleine Claude-Aufträge.

---

## I) CLAUDE-UMSETZUNGSSTRATEGIE (kleine, kontrollierbare Aufträge je Phase)

> Prinzip: **nie „baue Phase X komplett".** Jeder Auftrag hat 1 klares Ziel, minimalen Scope, eigene DoD,
> löst **keine** unnötigen Refactorings aus. Reihenfolge = Umsetzungsreihenfolge.

**PHASE 0**
1. Typed-IPC-Contract + `IpcResult` + `client.ts` anlegen (Muster, 1 Beispiel-Channel). DoD: 1 typsicherer
   Roundtrip end-to-end.
2. Preload auf Domänen-Namespaces umstellen (window-Controls migrieren, Verhalten unverändert).
3. Service-Pattern + `registerIpc()` + Zod-Validierung als Skelett. DoD: Ping-Service typsicher erreichbar.
4. Zustand einführen (1 Feature-Store als Vorlage). DoD: Store hydriert via IPC.

**PHASE 1 — Projects**
1. `Project`-Datenmodell + JSON-Store (atomar) definieren.
2. Sichere Folder-Auswahl (`dialog`) + `projects:pickFolder`.
3. Project-Registry-Service (add/list/remove) + IPC.
4. Git-Detection (`gitDetect.ts`, read-only `execFile`).
5. `package.json`/README/Stack-Detection (`stackDetect.ts`).
6. Bestehende `ProjectList`/`ProjectContextCard` an echte Daten binden.
7. „Open in VS Code" + „Open Terminal" (OS-Adapter).
8. Fehlerfälle/Tests (fehlender Pfad, kein Git, großes Repo).

**PHASE 2 — System**
1. `SystemService.snapshot()` (CPU/RAM/Uptime nativ).
2. `systeminformation` für Disk/Netz/Battery/Prozesse ergänzen.
3. `system:subscribe`/`tick` + Sampler-Lifecycle (an Sichtbarkeit gekoppelt).
4. `useMockMetrics`→`useSystemMetrics` (gleiche Datenform), Panel bleibt.
5. Prozessliste + Battery/Temp-Fallbacks + Tests (idle/minimiert/Leak).

**PHASE 3 — Terminal**
1. `node-pty` integrieren + `electron-rebuild` in `postinstall` (macOS zuerst). DoD: Rebuild grün.
2. `TerminalService` single Session (create/input/data/close) + IPC.
3. `useTerminalStream`→`useTerminalSession`, xterm an echte Shell.
4. Resize/Fit ↔ `pty.resize`; Exit-Codes.
5. Mehrere Sessions/Tabs + CWD/Projektbindung.
6. IPC-Batching, Cleanup, Windows-Rebuild + Tests (vim/Ctrl-C/großes Output).

**PHASE 4 — Context**
1. SQLite (`better-sqlite3`) + Migrations-Runner (`user_version`) + Backup.
2. `structure`/`manifest`/`git`-Analyzer (ignore-aware, Limits).
3. `framework`/`dependency`/`todo`/`readme`-Analyzer.
4. `ProjectContext`-Persistenz + Change-Detection (mtime).
5. `context:reindex` + Progress; `ProjectContextView`/`TodoList` anschließen.
6. Tests (Monorepo/Non-Node/5k Dateien/gitignore).

**PHASE 5 — Sessions**
1. Vault-Ordner + `Session`-Schema + `gray-matter`.
2. `sessions:start/update/end` (Markdown schreiben + SQLite-Index).
3. `ActiveSessionCard` echt + `SessionEditor` (4 Felder).
4. `SessionList`/`SessionDetail`/History; „letzte Session je Projekt".
5. Index-Rebuild aus Markdown + Tests (Crash-Recovery/Sonderzeichen).

**PHASE 6 — Memory**
1. Vault-Struktur + Memory-Typen + Frontmatter-Schemata (Zod) + Templates.
2. `MemoryService` CRUD (Markdown) + FTS5-Index.
3. `memory:search` (FTS + Typ/Tag-Filter) + `MemoryBrowser`/`MemorySearch`.
4. Backlinks (`[[…]]`) + `BacklinkPanel`.
5. `chokidar`-Watcher + `memory:reindex` (inkrementell) + Tests (extern editieren/1k Einträge).
6. Sessions/Projects in Memory verlinken.

**PHASE 7 — AI**
1. `SecretsService` (safeStorage) + Key-Setup-UI (Key nie zurückgeben).
2. `LLMProvider`-Interface + Anthropic-Provider + Streaming end-to-end (ohne Kontext).
3. `contextAssembler` deterministisch (Scope + jüngste Sessions + FTS-Top-K + Pins).
4. Token-Budgeting + Cancellation + Fehler/Retry.
5. Conversation-Storage (SQLite) + `ChatPanel`/`ContextPreview` im Command-Panel.
6. Session-Summary-Feature; (optional) zweiter Provider; (optional, bei Bedarf) Embeddings via sqlite-vec.

**PHASE 8 — Tools**
1. Tool-Registry + Zod-Schemas + `Risk`-Klassifizierung; **nur READ-Tools** + Audit.
2. Policy-Engine (Allow/Blocklist, Path-Confinement) — deterministisch, getrennt vom Modell.
3. Approval-UI (`ApprovalDialog`) + `DiffPreview` + `CommandPreview`.
4. WRITE-Tools (Datei erstellen/ändern mit Diff-Approval).
5. EXECUTE-Tools (Command mit Preview + Allowlist, via PTF/execFile).
6. DESTRUCTIVE-Block + globaler Kill-Switch; KI-Tool-Loop verdrahten.
7. Security-Tests (Path-Escape, injizierte Datei-Instruktion, `rm -rf`, Timeout, Reject/Cancel).

**PHASE 9 — Voice**
1. `PushToTalkButton` + `MediaRecorder`-Aufnahme + `globalShortcut`.
2. `SpeechProvider`-Abstraktion + STT (Cloud zuerst) → Transcript ins Panel.
3. TTS (OS zuerst) + `VoiceIndicator`/State + Consent.
4. Voice-Settings + (später) lokale Provider (whisper.cpp/Piper) + Tests (Permission/offline).

**PHASE 10 — Agents (nur bei Nachweis)**
1. **Messen:** konkrete Fälle dokumentieren, wo Single-Agent scheitert. (Kein Code, wenn keiner scheitert.)
2. SCOUT als read-only Retrieval-Tool (eigener Kontext/Budget) für CORE.
3. CORE→SCOUT-Turn-Loop + Turn-/Kosten-Limits + `AgentActivityView`.
4. Vergleichstest Single vs. Multi (Qualität/Kosten/Latenz); FORGE nur falls nötig; SENTINEL bleibt Policy.

---

## LEITPLANKEN (durchgängig)
- Kein Code/Redesign in der Planungsphase. Nicht alles auf einmal. Keine KI in 1–6 erzwingen.
- Kein Multi-Agent, solange Single-Agent+Tools reicht. **Sicherheit vor Autonomie.** Lokal-first, wo sinnvoll.
- Keine unnötigen Dependencies (jede neue Lib in diesem Plan ist einzeln begründet). Bestehendes wiederverwenden.
- Jede Phase hat eigenständigen Nutzwert. Der Plan ist Auftrag-für-Auftrag mit Claude Code umsetzbar.
