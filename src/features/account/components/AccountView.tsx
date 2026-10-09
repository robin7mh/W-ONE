import { Languages, Server, UserRound } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { Card } from '@/components/ui/Card'
import { StatusDot } from '@/components/ui/StatusDot'
import { LanguageSwitch } from '@/components/ui/LanguageSwitch'
import { useT } from '@/lib/i18n'
import { useSession } from '@/features/session/store'

/** Profile: the W-ONE account (licence, trial), the UI language and the connected core. */
export function AccountView() {
  const t = useT()
  const info = useSession((s) => s.info)
  const rows: [string, string][] = info
    ? [
        [t.account.mode, info.mode === 'desktop' ? t.account.desktop : t.account.server],
        [t.account.version, `v${info.version}`],
        [t.account.host, info.hostname],
        [t.account.database, info.db.connected ? t.account.dbOnline : t.account.dbOffline]
      ]
    : []
  return (
    <Panel title={t.account.title} corners flush className="min-h-0 flex-1" bodyClassName="min-h-0 overflow-y-auto">
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        <Card icon={UserRound} title={t.account.accountCard}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-hud/70 text-text-muted">
              <UserRound size={18} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="font-sans text-[14px] font-medium text-text-primary">{t.account.signedOut}</p>
              <p className="font-sans text-[12px] text-text-muted">{t.account.signedOutHint}</p>
            </div>
          </div>
        </Card>

        <Card icon={Languages} title={t.account.languageCard}>
          <LanguageSwitch />
          <p className="mt-2 font-sans text-[11.5px] text-text-muted">{t.account.languageHint}</p>
        </Card>

        <Card icon={Server} title={t.account.coreCard}>
          {info ? (
            <dl className="space-y-1">
              {rows.map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-wider text-text-muted">{k}</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 break-words font-mono text-[12px] text-text-secondary">
                    {k === t.account.database && <StatusDot tone={info.db.connected ? 'ok' : 'warn'} pulse={false} />}
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="font-mono text-[11px] text-text-muted">{t.account.linking}</p>
          )}
        </Card>
      </div>
    </Panel>
  )
}
