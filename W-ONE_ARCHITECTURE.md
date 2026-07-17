# W-ONE Architecture

**Status:** Authoritative steering document · **Created:** 2026-07-17
**Supersedes:** [`docs/MASTERPLAN.md`](docs/MASTERPLAN.md) (kept as reference — its security doctrine and phase templates remain valid and are carried over here; see §12 for the reconciliation table).

W-ONE evolves from a sci-fi command-center UI into a **modular, local-first personal intelligence system**: an AI assistant with long-term memory, a knowledge base, intelligent project workspaces, a permission-gated agent runtime, and live activity visibility — all running on the user's machine, on open formats.

Guiding doctrine (unchanged from the masterplan, restated because everything below depends on it):

1. **All privileged operations live in the Electron main process.** The renderer never gets Node access.
2. **Markdown is the source of truth for knowledge; SQLite is a rebuildable index plus structured data.** No ORM.
3. **Local-first.** Cloud LLM APIs are called from main; data stays on disk in open formats.
4. **Policy is code, never a model.** Permission decisions are made by a deterministic engine and the user — an LLM can request, never grant.
5. **No speculative architecture.** Interfaces are introduced when the first real consumer lands; schemas grow by additive migration.

---

## 1. Current Architecture

### 1.1 Stack

| Layer | Choice |
|---|---|
| Shell | Electron 31, frameless window, `contextIsolation: true`, `nodeIntegration: false` |
| Build | electron-vite 2 (CJS main/preload, Vite renderer), dual tsconfig (`typecheck:node` + `typecheck:web`) |
| Renderer | React 18, TypeScript 5.5, Zustand (one store per feature), Framer Motion |
| Design system | Tailwind driven by CSS custom properties (`src/index.css` + `tailwind.config.ts`); primitives `Panel`, `TechLabel`, `StatusDot`, `HudFrame`; Inter Variable + JetBrains Mono, bundled locally |
| Persistence | Atomic JSON (tmp + rename) under `userData/wone/` |
| Telemetry | `systeminformation` (main-process sampling, push stream) |

### 1.2 Load-bearing patterns (binding for all future work)

1. **Typed IPC contract** — `src/shared/ipc/contract.ts` is the single source of truth: the `IpcChannels` request/response map, the `IpcResult<T>` union (errors never cross the bridge as throws), and the runtime allowlists `IPC_CHANNELS` / `IPC_EVENTS`. A capability is added exactly once, here.
2. **Single preload bridge** — `electron/preload.ts` exposes only `window.wone` with allowlist-guarded `invoke`/`on`. The renderer never touches `ipcRenderer`.
3. **Main-process services** — `electron/main/services/<domain>/<Domain>Service.ts`, constructed in `registerServices()` (`electron/main.ts`) with injected dependencies (e.g. `ContextService` receives a `resolvePath` callback, not a `ProjectService` reference). Handlers bind via `handle<K>()` in `electron/ipc/registry.ts`; main→renderer push goes through `broadcast()`.
4. **Renderer feature slices** — `src/features/<name>/{store.ts, components/}`; view switching via `useState<ModuleId>` in `AppShell`, nav defined in `src/data/navigation.ts`. No router.

### 1.3 What exists today

| Area | State |
|---|---|
| Projects | ✅ Real. JSON registry, git/stack detection, open in editor/terminal, `projects:openFile` with path confinement |
| System monitor | ✅ Real. 1.5 s telemetry stream, pauses when window hidden |
| Project context | ✅ Backend real (commit `871ba6d`): bounded `.gitignore`-aware scan → tree/deps/configs/TODOs/README → JSON cache → `context:get`/`context:reindex` + progress event. **No UI yet** |
| Command interface | 🎭 Display-only (`MainCommandPanel`) — the seam for the assistant (P6) |
| Terminal | 🎭 xterm.js mounted, fake stream — real PTY is optional phase PT |
| Bottom dashboard | 🎭 Mock agents/events/timeline — becomes real in P9 (Agent Activity) |
| Memory / Agents / Settings nav | 🎭 Placeholders |
| LLM integration | ❌ None anywhere yet (by design — lands in P6) |

**Assessment: everything is kept.** The design system, IPC contract, service pattern, store pattern, and security baseline carry the target architecture without modification. Mock data in `src/data/` is deliberately isolated and gets replaced surgically, phase by phase.

---

## 2. Target Architecture

```
┌─────────────────────────── RENDERER (React, no Node) ───────────────────────────┐
│  Command Center · Projects · Knowledge · Memory · Agents · Files ·              │
│  Automations · System · Settings          (features/<x>/{store,components})     │
└──────────────────────────────────┬───────────────────────────────────────────────┘
                    window.wone (preload, allowlisted invoke/on)
┌──────────────────────────────────┴───────────────────────────────────────────────┐
│                    TYPED IPC  (contract.ts · IpcResult · broadcast)              │
└──────────────────────────────────┬───────────────────────────────────────────────┘
┌──────────────────────────────────┴──────────────── MAIN PROCESS (W-ONE CORE) ───┐
│  ProjectService   ContextService   SystemService          (existing)            │
│  SettingsService  VaultService     MemoryStore/Service    (P2/P5)               │
│  KnowledgeService (P4)             ContextEngine (P6)     AIProvider (P6)       │
│  ToolRegistry + PolicyEngine (P7)  AgentRuntime (P8)      AutomationService(P11)│
│                                                                                  │
│  Cross-cutting spines:                                                           │
│   • EventBus — every service emits WoneEvents → persisted → broadcast (P2)      │
│   • Entity graph — EntityRef {kind,id} + typed links table (P2)                 │
│   • Permission gate — deterministic policy in front of every tool call (P7)     │
└──────────────────────────────────┬───────────────────────────────────────────────┘
┌──────────────────────────────────┴───────────────────────── DATA LAYER ─────────┐
│  Markdown vault (~/W-ONE/vault, Obsidian-compatible — SoT for knowledge)        │
│  SQLite wone.db (memories, entities, links, events, indexes, FTS5)              │
│  VectorIndex interface (FTS5 fallback now → sqlite-vec / pgvector / Qdrant)     │
│  JSON (settings, project registry, context cache) · safeStorage (API keys)      │
└──────────────────────────────────┬───────────────────────────────────────────────┘
┌──────────────────────────────────┴──────────────────── INTEGRATIONS / TOOLS ────┐
│  Filesystem · Git · Web search · Browser · Terminal · Calendar · APIs           │
│  — reachable ONLY through registered tools behind the permission gate           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

The three spines are what turn separate features into one system:

- **EventBus** (§10): every meaningful action becomes a structured `WoneEvent` — persisted as the activity log, broadcast to the renderer, consumed by the Agent Activity UI and automations.
- **Entity graph** (§4): every domain object is addressable as `EntityRef {kind, id}`; typed edges in a `links` table connect memories ↔ projects ↔ knowledge ↔ people ↔ decisions. This is how "open project W-ONE and know everything about it" works, and it *is* the knowledge graph's data layer.
- **Permission gate** (§9): tools are the only way agents touch the system, and the policy engine fronts every tool call.

---

## 3. Module Map

| Nav module | Feature dir | Backing services | Real in |
|---|---|---|---|
| Home / Command Center (`core`) | `features/assistant` | ContextEngine, AIProvider, ConversationStore | P6 |
| Projects | `features/projects` (+ `context`) | ProjectService, ContextService | done / P3 |
| Knowledge | `features/knowledge` | VaultService, KnowledgeService | P4 |
| Memory | `features/memory` | MemoryService | P5 |
| Agents | `features/agents` | AgentRuntime, ToolRegistry, PolicyEngine | P7–P9 |
| Files | `features/files` | FileService | P10 |
| Automations | `features/automations` | AutomationService | P11 |
| System | `features/system` | SystemService | done |
| Terminal | `features/terminal` | TerminalService (node-pty) | optional PT |
| Settings | `features/settings` | SettingsService | P2 onward |

`ModuleId` (`src/types/index.ts`) and `NAV_ITEMS` (`src/data/navigation.ts`) grow one phase at a time — never in bulk. New views reuse `Panel`/`TechLabel`/`StatusDot` and the token palette exclusively; a new module must look like it was always there.

---

## 4. Data Model

All shared types live in `src/shared/types/` and are **pure** — no Node, DOM, or Electron imports — so they compile under both tsconfigs. The dual `typecheck` script is the guard.

### 4.1 The universal relation currency

```ts
type EntityKind =
  | 'project' | 'memory' | 'knowledge' | 'person' | 'concept' | 'task'
  | 'decision' | 'conversation' | 'agent' | 'tool' | 'file' | 'automation'

interface EntityRef { kind: EntityKind; id: string }

type LinkType =
  | 'related_to' | 'belongs_to' | 'created_by'
  | 'depends_on' | 'mentioned_in' | 'decided_in'

interface EntityLink { id: string; from: EntityRef; to: EntityRef; type: LinkType; createdAt: string }
```

Every cross-entity relation in the system — memory→project, knowledge→person, decision→conversation — is an `EntityLink` row. The graph view (P12), project workspaces (P3), and backlinks (P4) are all queries over this one table.

### 4.2 Canonical types and their storage home

| Type | Source of truth | Indexed in |
|---|---|---|
| `MemoryEntry` | SQLite `memories` | `memories_fts` (FTS5) |
| `KnowledgeNote` | Markdown file in vault | SQLite `knowledge_index` + `knowledge_fts` (rebuildable) |
| `Project` | JSON `projects.json` (today) | mirrored into `entities` from P3 |
| `WoneEvent` | SQLite `events` (append-only) | — |
| `AgentDefinition` / `ToolDescriptor` | code (built-ins) + SQLite (user-defined, later) | — |
| `Automation` | SQLite | — |
| `AppSettings` | JSON `settings.json` | — |
| Conversations | SQLite (P6) | — |

Tasks and decisions are **memory types** in v1, not separate tables. If P3's workspace view proves it needs structured task state, a `tasks` table arrives as an additive migration — no speculative schema now.

---

## 5. Memory Architecture

Memory is not chat history. It is a typed, curated store the assistant reads and writes deliberately.

### 5.1 Entry model

```ts
type MemoryType =
  | 'personal' | 'project' | 'conversation' | 'knowledge'
  | 'preference' | 'decision' | 'task'

type MemorySource =
  | { kind: 'user' }
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'agent'; agentId: string; runId?: string }
  | { kind: 'import'; detail?: string }

interface MemoryEntry {
  id: string
  type: MemoryType
  title: string
  content: string              // markdown
  summary?: string             // AI-generated from P6
  tags: string[]
  source: MemorySource
  relatedEntities: EntityRef[]
  relatedProject?: string
  importance: number           // 0..1 — drives context ranking
  confidence: number           // 0..1 — how certain the fact is
  createdAt: string
  updatedAt: string
  lastAccessedAt?: string      // updated on retrieval
}
```

### 5.2 Memory pipeline

Nothing is stored blindly. Every candidate passes through:

```
input → analyze → relevance? → classify type → search existing memories
      → create new OR update existing → link related entities → store → emit memory.* event
```

The pipeline **interface** exists from P5; its stages are deterministic at first (explicit "remember this" commands, rule-based classification) and become model-assisted in P6 (analyze/summarize/dedupe via LLM) — a drop-in upgrade, not a rewrite.

### 5.3 Retrieval

1. **Now → P12:** SQLite FTS5 (bm25) over title/content/summary/tags, filtered by type/project/tags; `lastAccessedAt` updated on access; ranking blends bm25 with `importance` and recency.
2. **P13:** embeddings behind the `VectorIndex` interface (§11.3) — hybrid lexical + semantic retrieval. Swapping FTS-fallback for sqlite-vec (or pgvector/Qdrant) changes a constructor call in `registerServices()`, nothing else.

---

## 6. Context Architecture

The Context Engine answers one question: *what does the model need to know for this request?* — without ever dumping the database into a prompt.

```ts
buildContext({ query, activeProject, conversation, user }): AssembledContext
```

Assembly pipeline (P6):

```
user input
  → intent signal (question / command / agent task — cheap heuristics first, model later)
  → active project → deterministic ProjectContext (the existing ContextService output:
    tree, stack, deps, TODOs, README, git state)
  → memory retrieval (top-K via §5.3, scored by relevance × importance × recency)
  → knowledge retrieval (top-K notes via knowledge_fts)
  → recent conversation window
  → assemble sections under a hard token budget, most-valuable-first, each section
    carrying entity IDs so answers can cite their sources
```

`AssembledContext` is a structured object (ordered sections with provenance), serialized to the prompt at the last moment. The deterministic project context that already ships today is the structural feed — nothing built so far is thrown away.

---

## 7. Agent Architecture

```ts
interface AgentDefinition {
  id: string; name: string; description: string
  systemPrompt: string
  allowedTools: string[]                    // tool names — allowlist, not "all tools"
  memoryScope: 'none' | 'project' | 'global'
  maxIterations: number
  timeoutMs: number
  model?: string
}

interface AgentRun {
  id: string; agentId: string; goal: string; projectId?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
  startedAt: string; endedAt?: string; iterations: number; error?: string
}
```

The runtime (P8) is a **controlled loop**, never a free-running process:

```
goal → plan → pick tool → PERMISSION GATE → execute → observe result
     → next step or finish
```

Hard guarantees enforced by code:

- `maxIterations` and `timeoutMs` per run; the loop cannot exceed either.
- Cancellation via `AbortController` — the UI can stop any run instantly.
- Every iteration emits events (`agent.iteration`, `tool.started`, …) — the run is fully observable and auditable after the fact.
- Tool calls the agent is not allowlisted for are rejected before the policy engine is even consulted.
- Errors terminate the run with a persisted `error`; there are no silent retries-forever.

**Single-agent first.** Example roles (Personal, Coding, Research, Project agent) are `AgentDefinition` rows, not separate runtimes. Multi-agent orchestration stays deferred until a single agent demonstrably can't do the job (masterplan Phase-10 stance); the data model (agents as entities, runs logged) already leaves the door open.

---

## 8. Tool Architecture

Tools are the **only** way agents touch the system. Tools call existing services (ProjectService, VaultService, MemoryService, …) — never `fs`/`child_process` directly — so every capability exists exactly once.

```ts
// shared (renderer-visible descriptor — no execute)
interface ToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>   // JSON Schema — Anthropic tool-use compatible
  permission: PermissionLevel
}

// main only (P7, electron/main/services/tools/)
type ToolDefinition = ToolDescriptor & {
  execute(input: unknown, ctx: ToolContext): Promise<unknown>
}

registerTool({ name: 'read_file', description: '…', inputSchema, permission: 'safe', execute })
```

Registry rules:

- Code-defined registry in main; the renderer sees only descriptors.
- `inputSchema` is validated before `execute` runs — malformed model output never reaches a tool body.
- Planned categories: memory, knowledge, projects, filesystem, git, web search, browser, terminal, calendar. First tools (P7) are SAFE and read-only: search memory/knowledge, read project files, get project context.
- The JSON-Schema shape maps 1:1 onto the Anthropic tool-use API — no translation layer.

---

## 9. Permission Model

Three user-facing classes, mapped from the masterplan's four internal classes (READ→safe, WRITE/EXECUTE→confirm, DESTRUCTIVE→dangerous):

| Level | Meaning | Examples |
|---|---|---|
| `safe` | Auto-allowed, logged | read file in project scope, search memory/knowledge/web |
| `confirm` | Requires explicit approval | write/create file, terminal command, git push |
| `dangerous` | Blocked by default, approval with strong warning | delete files, `git push --force`, system settings |

Decision flow — deterministic code, end to end:

```
tool call → policy engine classifies (level + scope checks, blocklist)
          → persisted grants lookup ("Always Allow" for this agent+tool)
          → if needed: ApprovalDialog in renderer
            (shows: which agent, which tool, exactly what will happen, why)
            [ Allow Once ] [ Always Allow ] [ Deny ]
          → decision persisted where "always" · audit event emitted either way
```

Rules carried over verbatim from masterplan §D: blocklist for catastrophic commands regardless of approval, path confinement for all filesystem access (the `projects:openFile` guard is the template), prompt-injection defense (content from files/web is data, never instructions), append-only audit trail (the `events` table), and *the model can request, only code and the user can grant*.

```ts
type PermissionLevel = 'safe' | 'confirm' | 'dangerous'
type PermissionDecision = 'allow_once' | 'allow_always' | 'deny'

interface PermissionRequest {
  id: string; agentId: string; agentName: string; toolName: string
  level: PermissionLevel
  action: string      // human-readable: what will happen
  reason: string      // why the agent wants it
  input: unknown
}
```

---

## 10. Event Architecture

One envelope for everything that happens:

```ts
interface WoneEvent<T = unknown> {
  id: string
  type: WoneEventType     // 'agent.started' | 'tool.completed' | 'memory.created' | …
  ts: string
  actor: { kind: 'user' | 'agent' | 'system'; id?: string }
  subject?: EntityRef     // primary entity concerned
  projectId?: string
  payload: T
}
```

Event type families: `app.*`, `db.*`, `project.*`, `memory.*`, `knowledge.*`, `agent.*` (started/iteration/completed/failed/cancelled), `tool.*` (started/completed/failed/denied), `permission.*` (requested/granted/denied), `automation.*`.

Flow: any service → `EventBus.emit()` → (a) in-main subscribers (automations later), (b) append-only insert into `events`, (c) broadcast on the single push channel `events:event`.

Consumers:
- **Agent Activity UI (P9):** renders curated event streams as a calm, technical timeline (the existing mock `CommandTimeline`/`EventLog` components are the visual template) — not raw logs.
- **Audit:** the `events` table *is* the audit trail for §9.
- **Automations (P11):** event triggers subscribe on the bus.

---

## 11. Storage Strategy

### 11.1 What lives where

| Store | Location | Content | Rebuildable? |
|---|---|---|---|
| Markdown vault | `~/W-ONE/vault` (default; configurable via settings) | knowledge notes under `knowledge/{projects,people,concepts,research,daily}` | **is** the source of truth |
| SQLite `wone.db` | `userData/wone/` | memories, entities, links, events, knowledge index, FTS5 tables; later: conversations, runs, grants | knowledge index: yes; rest: primary data |
| JSON | `userData/wone/` | `settings.json`, `projects.json`, `context/<id>.json` | context cache: yes |
| safeStorage | OS keychain | LLM API keys (P6) | — |

### 11.2 Vault & Obsidian compatibility

- Default root `~/W-ONE/vault` — user-visible, so the folder can be opened in Obsidian, synced, and backed up. Path configurable (`settings.vaultRoot`). Created lazily on first write, never at boot.
- Notes are plain Markdown with standard YAML frontmatter (`id`, `type`, `title`, `tags`, `created`, `updated`, `aliases?`, `project?`, `summary?`) and `[[wikilinks]]` in the body — a stock Obsidian vault.
- **W-ONE is the primary system; Obsidian is optional.** External edits are legitimate: files win over the index, and the index is always rebuildable from the files.
- Filenames: kebab-case slug of the title (ASCII-folded, Windows-reserved characters stripped, ≤ 80 chars, `-2` suffix on collision); daily notes `YYYY-MM-DD.md`.

### 11.3 Vector search abstraction

```ts
interface VectorIndex {
  readonly dimensions: number | null      // null = lexical fallback, no embeddings
  upsert(docs: VectorDoc[]): Promise<void>
  query(q: { namespace: string; text?: string; vector?: Float32Array; topK: number }): Promise<VectorHit[]>
  delete(namespace: string, ids: string[]): Promise<void>
}
```

Implementations: `Fts5FallbackIndex` (P2 — maps namespaces to FTS5 tables, bm25 ranking) → `SqliteVecIndex` (P13 — sqlite-vec extension, local embeddings) → optional pgvector/Qdrant adapters. All constructed in `registerServices()`; consumers depend only on the interface.

### 11.4 Migration policy

`PRAGMA user_version`; migrations are TypeScript modules exporting SQL strings, forward-only, one transaction each, with a file backup of the DB before every migration. Anything whose source of truth is files (knowledge index, FTS) can always be dropped and rebuilt.

---

## 12. Implementation Phases

### 12.1 Masterplan reconciliation

| MASTERPLAN phase | Status | Disposition |
|---|---|---|
| 0 Foundation | ✅ done | baseline, unchanged |
| 1 Projects | ✅ done | absorbed — extended into workspaces (new P3) |
| 2 System Monitor | ✅ done | kept as-is |
| 3 Terminal (node-pty) | not started | **kept as optional phase PT** — nothing depends on it (tools use `execFile`, not a PTY); highest native-module risk; schedule on demand |
| 4 Project Context | ✅ backend done (`871ba6d`) | absorbed → P3 lands the UI; output feeds the Context Engine |
| 5 Session Notes | — | superseded → daily notes (P4) + conversation/decision memories (P5/P6) |
| 6 Memory | — | split → Knowledge Base (P4) + Memory Core (P5) |
| 7 AI Layer | — | absorbed → P6 |
| 8 Tool Actions | — | superseded → P7 (tools + permissions) + P8 (runtime) + P9 (activity); §D security rules carried over verbatim |
| 9 Voice | — | deferred, optional PV (after P6) |
| 10 Multi-Agent | — | deferred; data model keeps the door open |

### 12.2 Definitive phase sequence

One deliberate re-ordering versus the original 14-phase directive: **the Permission System merges with the Tool Registry (P7) and precedes the Agent Runtime (P8)** — permission checks are a stated requirement *inside* the agent loop, so building the runtime first would mean immediate rework.

| Phase | Scope | Definition of done |
|---|---|---|
| **P1 Architecture** | this document | ✅ this commit |
| **P2 Core Data Models + Local Storage** | shared type vocabulary (entity/memory/knowledge/agent/tool/permission/events/automation/settings); SQLite via better-sqlite3 + migration runner + schema 001 (entities, links, memories + FTS, knowledge index + FTS, events); VaultService (frontmatter, wikilinks, slugs); `VectorIndex` + FTS fallback; SettingsService; `paths.ts`; EventBus; minimal IPC (`settings:get/update`, `vault:status`, `events:recent`, push `events:event`) | app boots unchanged; migration + dev self-check green; both typechecks green |
| **P3 Projects as Workspaces** | context UI lands (panel in project detail); projects mirrored into `entities`; project hub aggregating linked memories/knowledge/tasks as they arrive in later phases | opening a project shows its structural context |
| **P4 Knowledge Base** | KnowledgeService (CRUD, wikilink/backlink index, FTS, chokidar watcher for external edits); Knowledge module UI (explorer, markdown viewer/editor, search, tags, backlinks); nav entry | notes round-trip W-ONE ↔ Obsidian; backlinks live |
| **P5 Memory Core** | MemoryService + pipeline scaffold (deterministic stages); Memory module UI (browse, search, create, types); memory tools groundwork | "remember X" via UI persists a typed, linked, searchable memory |
| **P6 AI Foundation + Context Engine** | `LLMProvider` interface + Anthropic adapter (streaming, keys in safeStorage); `buildContext()`; assistant chat in the Command Center (text only, **no tools**); conversations persisted; memory pipeline stages become model-assisted | asking about the active project gets a context-aware streamed answer |
| **P7 Tool Registry + Permission System** | registry + schema validation; policy engine + grants store; ApprovalDialog (Allow Once / Always / Deny); audit events; first SAFE read-only tools | assistant can search memory/knowledge and read project files, gated and audited |
| **P8 Agent Runtime** | controlled loop (limits, timeout, cancellation); runs persisted; permission-gated tool calls; agent definitions (Personal/Coding/Research as data) | an agent completes a bounded multi-step task and is cancellable |
| **P9 Agent Activity** | Agents module UI: live run timeline from `events:event`, run history, cancel; dashboard mocks replaced | user watches an agent work step by step |
| **P10 Files** | Files module: scoped browsing/preview (markdown/text/JSON/code) via service + tools; file entities linkable to projects/knowledge | files are first-class, linkable entities |
| **P11 Automations** | Automation model + UI; manual + event triggers via EventBus; simple scheduler (no heavy infra) | "every morning summarize open projects" is expressible and runs |
| **P12 Knowledge Graph** | graph queries over `entities`/`links`; graph view (calm, HUD-styled) | graph renders real relations, click-through to entities |
| **P13 Optimization** | sqlite-vec embeddings behind `VectorIndex`; hybrid retrieval; perf passes; packaging | semantic search beats FTS on real queries |
| **PT Terminal** *(optional)* | node-pty + TerminalService; xterm goes live | any time after P2 |
| **PV Voice** *(optional)* | SpeechProvider abstraction (STT/TTS) | after P6 |

Each phase ships end-to-end (service + IPC + UI in W-ONE's design language), leaves the app bootable, and touches nothing outside its scope. The detailed P2 execution plan (types, schema DDL, file list, verification) is specified and approved; implementation starts on explicit release.
