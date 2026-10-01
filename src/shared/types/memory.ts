// Memory = an Obsidian-compatible markdown vault (architecture §5, §11.2).
// Files are the source of truth; everything here is a read model computed from
// them. Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

/** Graph coloring: one color per top-level folder, or a single accent. */
export type GraphColorMode = 'colorful' | 'single'

/** Palette keys — mapped to CSS tokens in the renderer (`--graph-<key>`). */
export const GRAPH_COLORS = ['cyan', 'blue', 'purple', 'pink', 'amber', 'green', 'orange', 'lime'] as const
export type GraphColor = (typeof GRAPH_COLORS)[number]

export interface GraphStyle {
  mode: GraphColorMode
  /** Used in `single` mode. */
  color: GraphColor
}

export const DEFAULT_GRAPH_STYLE: GraphStyle = { mode: 'colorful', color: 'cyan' }

export interface VaultStatus {
  /** Absolute vault root (configured, or the default location). */
  root: string
  /** Where "Create W-ONE vault" puts a new vault. */
  defaultRoot: string
  /** Folder name shown in the UI. */
  name: string
  isDefault: boolean
  /** False until the vault folder exists (it is created lazily, never at boot). */
  exists: boolean
  noteCount: number
  graphStyle: GraphStyle
}

/** Vault-relative POSIX path, e.g. `Projekte/W-ONE.md`. Identity in the UI. */
export type NotePath = string

export interface NoteMeta {
  path: NotePath
  /** Filename without `.md` — what `[[wikilinks]]` resolve against. */
  title: string
  /** Top-level folder ('' for the vault root) — drives colorful graph groups. */
  folder: string
  tags: string[]
  /** Frontmatter `type` (personal, project, decision, …) if present. */
  type?: string
  modifiedAt: string
  /** Outgoing + incoming resolved links. */
  linkCount: number
}

export interface Note extends NoteMeta {
  /** Full file text, frontmatter included — what the editor edits. */
  raw: string
  /** Body without the frontmatter block — what the preview renders. */
  body: string
  /** Parsed YAML frontmatter (empty when absent or invalid). */
  frontmatter: Record<string, unknown>
  /** Notes linking here. */
  backlinks: NoteMeta[]
  /** Each outgoing link target as written → resolved note path (null = unresolved). */
  links: Record<string, NotePath | null>
}

export interface GraphNode {
  /** NotePath for files; `ghost:<target>` for unresolved links. */
  id: string
  title: string
  folder: string
  /** Unresolved `[[link]]` with no file behind it (Obsidian shows these too). */
  ghost: boolean
  degree: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface MemoryGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface SearchHit {
  path: NotePath
  title: string
  snippet: string
}

/** Pushed after any vault change (W-ONE's own writes or external edits). */
export interface MemoryChanged {
  /** Changed paths, or undefined after a full rescan. */
  paths?: NotePath[]
}
