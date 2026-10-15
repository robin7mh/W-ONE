// The Files module: the machine's files, like Finder — browse, preview, move,
// open. Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

export interface FinderEntry {
  name: string
  /** Absolute path. */
  path: string
  kind: 'dir' | 'file'
  /** Bytes (files); 0 for folders. */
  size: number
  mtimeMs: number
  /** Starts with a dot. */
  hidden: boolean
  /** A symbolic link (`kind` is what it points to). */
  link?: boolean
  /** A macOS bundle (.app, …): shown and opened like a file. */
  bundle?: boolean
}

export interface FinderListing {
  path: string
  /** null at the root. */
  parent: string | null
  entries: FinderEntry[]
  /** The folder holds more than Mindeck lists. */
  truncated: boolean
}

/** The usual places — each only when it exists. */
export type FinderPlaceId = 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'movies' | 'music'

export interface FinderPlaces {
  home: string
  places: { id: FinderPlaceId; path: string }[]
  /** External drives and partitions. */
  volumes: { name: string; path: string }[]
}

export interface FinderPreview {
  entry: FinderEntry
  type: FileType | 'dir'
  /** 'dir': how many entries it holds. */
  items?: number
  /** 'text': the beginning of the file. */
  text?: string
  truncated?: boolean
}

export type FileType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'binary'

const TYPES: Record<Exclude<FileType, 'text' | 'binary'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'heic', 'tif', 'tiff'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus'],
  pdf: ['pdf']
}

const TEXT = new Set([
  'txt', 'md', 'markdown', 'mdx', 'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'env', 'csv', 'tsv', 'log', 'xml', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'graphql', 'gql', 'proto',
  'lua', 'dart', 'r', 'scala', 'ex', 'exs', 'erl', 'clj', 'hs', 'ml', 'tf', 'dockerfile', 'gitignore', 'editorconfig', 'lock', 'conf', 'cfg'
])

/** The file's extension in lower case, without the dot ('' when it has none; dotfiles count as their name). */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  if (dot === 0) return name.slice(1).toLowerCase()
  return name.slice(dot + 1).toLowerCase()
}

/** What a file is, by its name: media for the viewer, text for the reader, else binary. */
export function fileType(name: string): FileType {
  const ext = extOf(name)
  for (const [type, exts] of Object.entries(TYPES)) if (exts.includes(ext)) return type as FileType
  if (TEXT.has(ext) || /^(readme|license|makefile|dockerfile|procfile)$/i.test(name)) return 'text'
  return 'binary'
}
