import { create } from 'zustand'

export interface FileLanguage {
  /** The language the core recognized (registry id), if any. */
  language?: string
  /** Its language server (or tsserver) runs for this file. */
  available: boolean
}

interface LanguagesState {
  /** Per `projectId:path` of the open files. */
  files: Record<string, FileLanguage>
  /** Bumped when Settings installed a language server — open files try again. */
  toolsVersion: number
  report: (key: string, status: FileLanguage) => void
  forget: (key: string) => void
  toolsChanged: () => void
}

/** Which language service each open file has — the status bar shows what is missing. */
export const useLanguages = create<LanguagesState>((set) => ({
  files: {},
  toolsVersion: 0,
  report: (key, status) => set((s) => ({ files: { ...s.files, [key]: status } })),
  forget: (key) =>
    set((s) => {
      const { [key]: _gone, ...files } = s.files
      return { files }
    }),
  toolsChanged: () => set((s) => ({ toolsVersion: s.toolsVersion + 1 }))
}))
