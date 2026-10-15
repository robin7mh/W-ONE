import { useEffect, useState } from 'react'
import { Check, Globe, Trash2 } from 'lucide-react'
import { ipc, isDesktop } from '@shared/ipc/client'
import { SEARCH_ENGINES, type BrowserSettings, type SearchEngine } from '@shared/types/browser'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { useT } from '@/lib/i18n'
import { Toggle } from './Toggle'

const ENGINE_LABELS: Record<SearchEngine, string> = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', ecosia: 'Ecosia', brave: 'Brave Search', kagi: 'Kagi' }

/** The browser: which search engine, where links from Mindeck open, the history. */
export function BrowserCard() {
  const t = useT()
  const [settings, setSettings] = useState<BrowserSettings>()
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    if (isDesktop()) void ipc('browser:settings').then(setSettings).catch(() => {})
  }, [])

  if (!settings) return null
  const configure = (patch: Partial<BrowserSettings>) => void ipc('browser:configure', patch).then(setSettings).catch(() => {})

  return (
    <Card icon={Globe} title={t.settings.browserCard}>
      <label className="block">
        <span className="mb-1 block font-sans text-[12px] text-text-secondary">{t.settings.searchEngine}</span>
        <Select
          label={t.settings.searchEngine}
          value={settings.searchEngine}
          options={SEARCH_ENGINES.map((e) => ({ value: e, label: ENGINE_LABELS[e] }))}
          onChange={(v) => configure({ searchEngine: v as SearchEngine })}
        />
      </label>
      <div className="mt-2">
        <Toggle label={t.settings.openLinks} hint={t.settings.openLinksHint} checked={settings.openLinksInMindeck} onChange={(v) => configure({ openLinksInMindeck: v })} />
      </div>
      <button
        type="button"
        onClick={() =>
          void ipc('browser:clearHistory')
            .then(() => setCleared(true))
            .catch(() => {})
        }
        className="mt-2 flex items-center gap-1.5 rounded-md border border-hud/60 px-2.5 py-1.5 font-sans text-[12px] text-text-secondary transition-colors hover:border-danger/50 hover:text-danger"
      >
        {cleared ? <Check size={12} className="text-green" /> : <Trash2 size={12} />}
        {cleared ? t.settings.historyCleared : t.settings.clearHistory}
      </button>
    </Card>
  )
}
