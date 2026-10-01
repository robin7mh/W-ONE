# W-ONE Architecture

**Status:** Authoritative steering document · **Created:** 2026-07-17 · **Revised:** 2026-07-17 (v1.1 — P2 split into A/B/C, search abstractions separated, event persistence classes, scoped permission grants, binding layering rules)
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
| Shell | Electron 37 (31.7.7's notarization is revoked by Apple — Gatekeeper trashes it on macOS 27), frameless window, `contextIsolation: true`, `nodeIntegration: false` |
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
| Core dashboard | ✅ Real. `features/dashboard`: greeting with the OS account name (`system:user`), HUD clock (seconds/minutes/day rings), tiles for projects (live git), brain (vault) and a system verdict |
| Terminal | ✅ Real (PT). `TerminalService`: node-pty login shell per tab (Home or a project), layouts single / side by side / stacked / 2×2 (panes only re-positioned, never remounted), output batched per frame, bounded scrollback for re-attach; xterm.js views stay mounted across modules; links clickable; theme-aware. Prebuilt N-API binaries (no compiler); `scripts/fix-node-pty.cjs` restores the spawn-helper exec bit on install |
| Bottom dashboard | Collapsible Command Deck, empty — demo cards removed; filled for real in P9 (Agent Activity) |
| Memory | ✅ Real (§12.3). Obsidian-compatible vault: `VaultService` + in-memory `MemoryIndex` (wikilinks, backlinks, tags, search), live `fs.watch` for external edits, force-directed graph colored by folder or one accent |
| Agents / Settings nav | 🎭 Placeholders |
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
│  SettingsService (P2A)  VaultService (P2C)  Repos + MemoryService (P2B/P5)      │
│  KnowledgeService (P4)             ContextEngine (P6)     AIProvider (P6)       │
│  ToolRegistry + PolicyEngine (P7)  AgentRuntime (P8)      AutomationService(P11)│
│                                                                                  │
│  Cross-cutting spines:                                                           │
│   • EventBus — distributes all WoneEvents; persists per catalog class (P2A/P2B) │
│   • Entity graph — EntityRef {kind,id} + typed links table (P2B)                │
│   • Permission gate — deterministic policy in front of every tool call (P7)     │
└──────────────────────────────────┬───────────────────────────────────────────────┘
┌──────────────────────────────────┴───────────────────────── DATA LAYER ─────────┐
│  Markdown vault (~/W-ONE/vault, Obsidian-compatible — SoT for knowledge)        │
│  SQLite wone.db (memories, entities, links, events, indexes, FTS5)              │
│  Search: TextSearchIndex (FTS5, P2B) · EmbeddingIndex (P13) · RetrievalService  │
│  JSON (settings, project registry, context cache) · safeStorage (API keys)      │
└──────────────────────────────────┬───────────────────────────────────────────────┘
┌──────────────────────────────────┴──────────────────── INTEGRATIONS / TOOLS ────┐
│  Filesystem · Git · Web search · Browser · Terminal · Calendar · APIs           │
│  — reachable ONLY through registered tools behind the permission gate           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

The three spines are what turn separate features into one system:

- **EventBus** (§10): every meaningful action becomes a structured `WoneEvent` — distributed to all subscribers, persisted according to its catalog class (`activity`/`audit`), consumed by the Agent Activity UI and automations.
- **Entity graph** (§4): every domain object is addressable as `EntityRef {kind, id}`; typed edges in a `links` table connect memories ↔ projects ↔ knowledge ↔ people ↔ decisions. This is how "open project W-ONE and know everything about it" works, and it *is* the knowledge graph's data layer.
- **Permission gate** (§9): tools are the only way agents touch the system, and the policy engine fronts every tool call.

### 2.1 Layering rules (binding)

- **Services** implement business capabilities.
- **Repositories** implement persistence — nothing else.
- **IPC handlers** contain no business logic; they bind contract channels to service calls.
- **Tools** orchestrate approved service calls; they never touch `fs`/`child_process` directly.
- **Renderer stores** contain no domain logic; they hold view state and call typed IPC.

The one permitted flow:

```
Renderer → IPC handler → domain/application service
         → repository or capability service
         → SQLite / filesystem / external API
```

---

## 3. Module Map

| Nav module | Feature dir | Backing services | Real in |
|---|---|---|---|
| Home / Command Center (`core`) | `features/dashboard` — a personal HUD by user decision; the assistant surface (`features/assistant`) gets its own place in P6 | SystemService, ProjectService, VaultService (read-only) | done |
| Editor *(planned)* | `features/editor` — Monaco in its own tab, project files; VS Code stays one click away | ProjectService (confined file read/write) | next |
| Projects | `features/projects` (+ `context`) | ProjectService, ContextService | done / P3 |
| ~~Knowledge~~ | merged into Memory (§12.3) | — | — |
| Memory | `features/memory` | VaultService, MemoryIndex; MemoryService pipeline later | vault ✅ / pipeline P5 |
| Agents | `features/agents` | AgentRuntime, ToolRegistry, PolicyEngine | P7–P9 |
| Files | `features/files` | FileService | P10 |
| Automations | `features/automations` | AutomationService | P11 |
| System | `features/system` | SystemService | done |
| Terminal | `features/terminal` | TerminalService (node-pty) | tabs + split layouts (side by side, stacked, 2×2) ✅ |
| Settings | `features/settings` | SettingsService | P2A onward |

`ModuleId` (`src/types/index.ts`) and `NAV_ITEMS` (`src/data/navigation.ts`) grow one phase at a time — never in bulk. New views reuse `Panel`/`TechLabel`/`StatusDot` and the token palette exclusively; a new module must look like it was always there.

---

## 4. Data Model

All shared types live in `src/shared/types/` and are **pure** — no Node, DOM, or Electron imports — so they compile under both tsconfigs. The dual `typecheck` script is the guard.

### 4.1 The universal relation currency

```ts
// v1 — only kinds with real consumers today. Grows additively as each module
// lands (task, decision, person, concept, conversation, agent, tool, file,
// automation); the SQLite column stays TEXT, so additions are type-level only.
type EntityKind = 'project' | 'memory' | 'knowledge'

interface EntityRef { kind: EntityKind; id: string }

type LinkType =
  | 'related_to' | 'belongs_to' | 'created_by'
  | 'depends_on' | 'mentioned_in' | 'decided_in'

interface EntityLink { id: string; from: EntityRef; to: EntityRef; type: LinkType; createdAt: string }
```

Every cross-entity relation in the system — memory→project, knowledge→person, decision→conversation — is an `EntityLink` row. The graph view (P12), project workspaces (P3), and backlinks (P4) are all queries over this one table.

**Binding rule: the `links` table is the only persistent source of truth for relations.** Persistent domain models never carry redundant relation fields (no `relatedEntities` arrays, no `relatedProject` columns). Relations surface only in computed read models:

```ts
interface MemoryEntryWithRelations extends MemoryEntry {
  relatedEntities: EntityRef[]   // computed from links
  project?: EntityRef            // memory —belongs_to→ project
}
```

### 4.2 Canonical types and their storage home

| Type | Source of truth | Indexed in |
|---|---|---|
| `MemoryEntry` / note | Markdown file in the vault — entry fields live in frontmatter (§12.3) | in-memory `MemoryIndex` today; SQLite `memories` + FTS5 later, as a rebuildable index |
| `Project` | JSON `projects.json` (today) | mirrored into `entities` from P3 |
| `WoneEvent` | SQLite `events`, per persistence class (§10); audit rows immutable | — |
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
  importance: number           // 0..1 — drives context ranking
  confidence: number           // 0..1 — how certain the fact is
  createdAt: string
  updatedAt: string
  lastAccessedAt?: string      // updated on retrieval
}
```

No relation fields in the persistent model — relations live exclusively in `links` (§4.1): `memory —belongs_to→ project`, `memory —related_to→ <entity>`, `memory —decided_in→ conversation`. Read models (`MemoryEntryWithRelations`) compute them at query time.

### 5.2 Memory pipeline

Nothing is stored blindly. Every candidate passes through:

```
input → analyze → relevance? → classify type → search existing memories
      → create new OR update existing → link related entities → store → emit memory.* event
```

The pipeline **interface** exists from P5; its stages are deterministic at first (explicit "remember this" commands, rule-based classification) and become model-assisted in P6 (analyze/summarize/dedupe via LLM) — a drop-in upgrade, not a rewrite.

### 5.3 Retrieval

1. **From P2B:** lexical search via `TextSearchIndex` (SQLite FTS5, bm25) over title/content/summary/tags; type/tag filters on `memories`, project scope resolved through `links`; `lastAccessedAt` updated on access.
2. **From P5/P6:** the `RetrievalService` (§11.3) is created with its first real consumer (MemoryService or Context Engine) and blends FTS score, `importance`, recency, project scope, and entity links into one ranking.
3. **P13:** an `EmbeddingIndex` implementation adds semantic similarity; the `RetrievalService` combines lexical and vector results — its consumers never change.

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
  → memory + knowledge retrieval via the RetrievalService (§11.3 — FTS,
    importance, recency, project scope, entity links; embeddings from P13)
  → recent conversation window
  → assemble sections under a hard token budget, most-valuable-first, each section
    carrying entity IDs so answers can cite their sources
```

`AssembledContext` is a structured object (ordered sections with provenance), serialized to the prompt at the last moment. The deterministic project context that already ships today is the structural feed — nothing built so far is thrown away.

### 6.1 Provider abstraction

The internal model for messages, tool calls, and streaming deltas is **provider-neutral**. `LLMProvider` is the only surface the Context Engine, assistant, and agent runtime know:

```ts
interface LLMProvider {
  stream(req: LLMRequest): AsyncIterable<LLMDelta>   // internal, provider-neutral types
}
```

Anthropic is the first provider; its adapter translates the internal format to and from the Anthropic API — including the tool-use wire format. Nothing outside the adapter imports a provider SDK.

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
- Every step emits structured events (`agent.plan.created`, `agent.step.started`, `agent.step.completed`, `agent.status.updated`, `tool.started`, …) — the run is fully observable and auditable after the fact.
- **No raw internal model reasoning is ever stored or displayed.** Status and plan events carry user-comprehensible descriptions of what the agent is doing and why an action is needed — never private chain-of-thought text.
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
  inputSchema: Record<string, unknown>   // JSON Schema — provider-neutral
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

### 8.1 Command execution (binding)

Non-interactive commands run through one capability service using `execFile` with structured arguments — never a shell string:

```ts
interface CommandRequest {
  executable: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}
```

- `shell: false` by default; arguments are an array — **no string concatenation from model or user input, ever**.
- `cwd` is validated and confined (the `projects:openFile` realpath guard in `ProjectService` is the template).
- Hard timeout and output-size limit per command; cancellation via `AbortSignal`.
- `env` is an explicit allowlist — the full process environment (and its secrets) is never passed through.
- Interactive processes are out of scope here; they require the optional PTY layer (phase PT).
- The JSON-Schema shape is provider-neutral; each provider adapter (§6.1) translates it into its wire format (Anthropic first).

---

## 9. Permission Model

Three user-facing classes, mapped from the masterplan's four internal classes (READ→safe, WRITE/EXECUTE→confirm, DESTRUCTIVE→dangerous):

| Level | Meaning | Examples |
|---|---|---|
| `safe` | Auto-allowed, logged | read file in project scope, search memory/knowledge/web |
| `confirm` | Allow Once, or a **scoped** Always Allow | write/create file, terminal command, git push |
| `dangerous` | Allow Once only, with strong warning — **never** Always Allow | delete files, `git push --force`, system settings |

Decision flow — deterministic code, end to end:

```
tool call → policy engine classifies (level + scope checks, blocklist)
          → persisted grants lookup (scoped "Always Allow": agent + tool + scope)
          → if needed: ApprovalDialog in renderer
            (shows: which agent, which tool, exactly what will happen, why)
            [ Allow Once ] [ Always Allow (scoped) ] [ Deny ]
          → "always" decisions persisted as scoped grants · audit event either way
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

/** Persisted only for "Always Allow" — and always with a scope. */
interface PermissionGrant {
  id: string
  agentId: string
  toolName: string
  scope: {
    projectId?: string    // valid only inside this project
    pathRoot?: string     // valid only under this directory
    operation?: string    // valid only for this operation variant
  }
  createdAt: string
  expiresAt?: string
}
```

Grant rules: `safe` is auto-allowed and logged. `confirm` supports Allow Once or a **scoped** Always Allow. `dangerous` supports Allow Once only — a persistent grant is never offered or stored. **A grant never widens automatically:** a request outside the stored scope re-prompts, and any scope expansion is an explicit new user decision.

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

Event type families: `app.*`, `db.*`, `project.*`, `memory.*`, `knowledge.*`, `agent.*` (started / plan.created / step.started / step.completed / status.updated / completed / failed / cancelled), `tool.*` (started/completed/failed/denied), `permission.*` (requested/granted/denied), `automation.*`. There is deliberately no `agent.thinking` — raw model reasoning is never an event payload (§7).

Not every event is stored. Every event type is classified centrally in the **event catalog**:

```ts
type EventPersistence = 'ephemeral' | 'activity' | 'audit'
```

| Class | Persisted? | Examples |
|---|---|---|
| `ephemeral` | never — broadcast only | streaming deltas, scan/reindex progress |
| `activity` | `events` table | agent plan/steps, memory/knowledge changes, project actions |
| `audit` | `events` table, immutable | permission decisions, dangerous tool calls |

Flow: any service → `EventBus.emit()` → (a) in-main subscribers (automations later), (b) persistence per catalog class (`activity`/`audit`; `ephemeral` is never written), (c) broadcast on the single push channel `events:event`. The event store is append-only and exposes **no update or delete methods for audit events**.

Consumers:
- **Agent Activity UI (P9):** renders curated event streams as a calm, technical timeline (the removed mock `CommandTimeline`/`EventLog` components, recoverable from git at `47cddbf`, are the visual template) — not raw logs.
- **Audit:** the audit-classified rows in `events` *are* the audit trail for §9 — append-only, no update/delete API.
- **Automations (P11):** event triggers subscribe on the bus.

---

## 11. Storage Strategy

### 11.1 What lives where

Everything W-ONE keeps lives under one user-visible root, **`~/W-ONE/`** (override: `WONE_HOME`) — findable in Finder, identical for `npm run dev` and the packaged app, backed up by copying one folder. Changed 2026-10-02 from the hidden `userData/wone/` (which was named after the dev package and would have differed in a release build); on first start the old folder is **copied** to `~/W-ONE/data` and left in place as a backup (`paths.ts → migrateLegacyData`). Chromium's own profile (cache, `localStorage`) stays in `userData`. Don't put `~/W-ONE/data` in a live-sync folder (iCloud/Dropbox) — SQLite + WAL files don't sync safely.

| Store | Location | Content | Rebuildable? |
|---|---|---|---|
| Markdown vault | `~/W-ONE/vault` (default; configurable via settings) | the memory notes, Obsidian-compatible (§12.3) | **is** the source of truth |
| SQLite `wone.db` | `~/W-ONE/data/` | memories, entities, links, events, knowledge index, FTS5 tables; later: conversations, runs, grants | knowledge index: yes; rest: primary data |
| JSON | `~/W-ONE/data/` | `settings.json`, `projects.json`, `context/<id>.json` | context cache: yes |
| safeStorage | OS keychain | LLM API keys (P6) | — |

### 11.2 Vault & Obsidian compatibility

- Default root `~/W-ONE/vault` — user-visible, so the folder can be opened in Obsidian, synced, and backed up. Path configurable (`settings.vaultRoot`). Created lazily on first write, never at boot.
- Notes are plain Markdown with standard YAML frontmatter (`id`, `type`, `title`, `tags`, `created`, `updated`, `aliases?`, `project?`, `summary?`) and `[[wikilinks]]` in the body — a stock Obsidian vault.
- **W-ONE is the primary system; Obsidian is optional.** External edits are legitimate: files win over the index, and the index is always rebuildable from the files.
- Filenames = the note title, because Obsidian resolves `[[wikilinks]]` by filename (a slug would break every hand-written link). Only characters forbidden by Obsidian or the filesystem are stripped (`\ / : * ? " < > | # ^ [ ]`), ≤ 120 chars, ` 2` suffix on collision; daily notes `YYYY-MM-DD.md`. *(Changed from kebab-case slugs, 2026-10-01.)*

**Knowledge identity (binding):** a note's durable identity is `frontmatter.id` (UUID) — never the title, path, filename, or slug, all of which may change freely. Externally created Markdown files without an `id` are indexed as **unadopted**: readable and searchable, but not linkable as entities. Adoption is an explicit, controlled step that assigns a fresh UUID and writes it back into the frontmatter atomically, preserving the rest of the file byte-for-byte (the exact flow ships with P4). Identity is never derived from the path.

### 11.3 Search & retrieval abstractions

Lexical and vector search are deliberately **not** forced behind one low-level interface — they have different write paths, query shapes, and lifecycles. Three separate abstractions:

```ts
/** Lexical search — SQLite FTS5. First implementation in P2B (memories). */
interface TextSearchIndex {
  search(q: { namespace: string; text: string; topK: number }): Promise<SearchHit[]>
}

/** Vector search — arrives in P13 (sqlite-vec first; pgvector/Qdrant adaptable). */
interface EmbeddingIndex {
  upsert(docs: { id: string; namespace: string; vector: Float32Array }[]): Promise<void>
  query(q: { namespace: string; vector: Float32Array; topK: number }): Promise<SearchHit[]>
  delete(namespace: string, ids: string[]): Promise<void>
}

/** Composition layer — created with its first real consumer (P5/P6). */
interface RetrievalService {
  retrieve(q: RetrievalQuery): Promise<RetrievalResult>
}
```

The `RetrievalService` is where ranking lives: it blends FTS scores, embeddings (from P13), `importance`, recency, project scope, and entity links. It does not exist until MemoryService or the Context Engine actually needs it — no speculative layer.

### 11.4 Migration policy

`PRAGMA user_version`; migrations are TypeScript modules exporting SQL strings, forward-only, one transaction each, with a file backup of the DB before every migration (preceded by `wal_checkpoint(TRUNCATE)` so the backup is complete). Anything whose source of truth is files (knowledge index, FTS) can always be dropped and rebuilt.

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
| **P2A Core Foundation** | `paths.ts`; SettingsService; SQLite connection (better-sqlite3, WAL, pragmas); migration runner (`user_version`, pre-migration backup with WAL checkpoint); EventBus base (in-main pub/sub + injectable persistence sink — no-op until P2B); minimal shared core types (`entity` minimal, `events` + catalog, `settings`); dev-only DB health/self-check. **No new IPC channels, renderer untouched** | app boots unchanged; `wone.db` created (WAL, FK on, `user_version` 0); migration runner proven by scratch-DB self-check; settings roundtrip; both typechecks green |
| **P2B Core Storage** | migration 001: `entities`, `links`, `events`, `memories` + `memories_fts` (+ sync triggers); repository layer (EntityRepo, LinkRepo, EventRepo, MemoryRepo — persistence only, no business logic); `TextSearchIndex` over `memories_fts`; event persistence sink active (catalog-driven; audit append-only, no update/delete); storage IPC **only where a real UI consumer exists** | memory insert → FTS match → delete roundtrip; link CRUD; events persisted per class; audit rows immutable |
| **P2C Vault Foundation** | VaultService: markdown + YAML frontmatter, slugs, wikilink parsing, vault status, identity rules (§11.2); **no** KnowledgeService, **no** `knowledge_index`/`knowledge_fts` (→ P4) | note write/read roundtrip against a scratch root; vault opens cleanly in Obsidian |
| **P3 Projects as Workspaces** | context UI lands (panel in project detail); projects mirrored into `entities`; project hub aggregating linked memories/knowledge/tasks as they arrive in later phases | opening a project shows its structural context |
| **P4 Knowledge Base** | KnowledgeService (CRUD, wikilink/backlink index, chokidar watcher for external edits, adoption flow for unadopted notes); `knowledge_index` + `knowledge_fts` are created **here** with their first consumer (rebuildable from the vault); Knowledge module UI (explorer, markdown viewer/editor, search, tags, backlinks); nav entry | notes round-trip W-ONE ↔ Obsidian; backlinks live |
| **P5 Memory Core** | MemoryService + pipeline scaffold (deterministic stages); `RetrievalService` is introduced here or in P6 with its first real consumer; Memory module UI (browse, search, create, types) | "remember X" via UI persists a typed, linked, searchable memory |
| **P6 AI Foundation + Context Engine** | `LLMProvider` interface + Anthropic adapter (streaming, keys in safeStorage); `buildContext()`; assistant chat in the Command Center (text only, **no tools**); conversations persisted; memory pipeline stages become model-assisted | asking about the active project gets a context-aware streamed answer |
| **P7 Tool Registry + Permission System** | registry + schema validation; policy engine + grants store; ApprovalDialog (Allow Once / Always / Deny); audit events; first SAFE read-only tools | assistant can search memory/knowledge and read project files, gated and audited |
| **P8 Agent Runtime** | controlled loop (limits, timeout, cancellation); runs persisted; permission-gated tool calls; agent definitions (Personal/Coding/Research as data) | an agent completes a bounded multi-step task and is cancellable |
| **P9 Agent Activity** | Agents module UI: live run timeline from `events:event`, run history, cancel; Command Deck filled with live activity | user watches an agent work step by step |
| **P10 Files** | Files module: scoped browsing/preview (markdown/text/JSON/code) via service + tools; file entities linkable to projects/knowledge | files are first-class, linkable entities |
| **P11 Automations** | Automation model + UI; manual + event triggers via EventBus; simple scheduler (no heavy infra) | "every morning summarize open projects" is expressible and runs |
| **P12 Knowledge Graph** | graph queries over `entities`/`links`; graph view (calm, HUD-styled) | graph renders real relations, click-through to entities |
| **P13 Optimization** | `EmbeddingIndex` implementation (sqlite-vec); `RetrievalService` blends lexical + semantic; perf passes; packaging | semantic search beats FTS on real queries |
| **PT Terminal** *(optional)* | node-pty + TerminalService; xterm goes live | any time after P2A |
| **PV Voice** *(optional)* | SpeechProvider abstraction (STT/TTS) | after P6 |

Each phase ships end-to-end (service + IPC + UI in W-ONE's design language), leaves the app bootable, and touches nothing outside its scope. The detailed P2A execution plan (file list, definition of done, dependencies, risks) is specified; implementation starts on explicit release.

### 12.3 Deviation (2026-10-01): Memory is the Obsidian vault

User decision: the AI memory should *be* an Obsidian vault — notes, `[[wikilinks]]`, graph — not a SQLite store beside one. Knowledge and Memory are therefore one module, and the vault is the source of truth for both.

- **Pulled forward and shipped:** P2C (`VaultService`: frontmatter, wikilinks, status, path confinement, atomic writes), the P4 core (backlinks, tags, search, external-edit watcher, read/edit UI) and a P12-lite graph (wikilink graph, colored by top-level folder or one accent; style persisted in `settings.graphStyle`).
- **Editing (2026-10-02):** the editor shows only the note text (`memory:writeBody` keeps the frontmatter byte-for-byte); the title is the filename and renames in place; connect/disconnect buttons write or remove `[[links]]` (new links go under `## Verbindungen`, disconnecting keeps inline mentions as plain text); notes and folders move by drag & drop. Renames and moves rewrite affected links in other notes (`linkEdit.ts`; planned before the move, while old names still resolve) — name-style links only change when the name does, path-style links follow the path.
- **Simplified for now:** the index is in-memory (`MemoryIndex`) and rebuilt from the files at open — no `knowledge_index`/FTS tables yet; `fs.watch` (recursive) instead of chokidar; no adoption flow — W-ONE writes `id`/`type`/`created`/`tags` frontmatter only on notes it creates, and graph links are wikilinks, not `links` rows.
- **Model mapping:** §5's `MemoryEntry` fields map onto frontmatter (`id`, `type`, `tags`, `created`, optional `importance`/`confidence`/`summary`). When P2B/P5 land, SQLite `memories` + FTS become a rebuildable index over the vault, and the memory pipeline writes notes. P6/P7 give the assistant read/write tools over this vault behind the permission gate.
