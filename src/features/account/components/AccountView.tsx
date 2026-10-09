import { Languages, LogOut, RefreshCw, Server, ShoppingCart, UserRound } from 'lucide-react'
import type { CloudLicense, CloudStatus } from '@shared/types/cloud'
import { Panel } from '@/components/ui/Panel'
import { Card } from '@/components/ui/Card'
import { StatusDot } from '@/components/ui/StatusDot'
import { LanguageSwitch } from '@/components/ui/LanguageSwitch'
import { cn } from '@/lib/cn'
import { intlLocale, useT } from '@/lib/i18n'
import { useSession } from '@/features/session/store'
import { formatDuration, useCloud } from '@/features/cloud/store'
import { CloudNotice, primaryButton, quietButton, SignInForm } from '@/features/cloud/components/CloudForms'

function TrialMeter({ license }: { license: CloudLicense }) {
  const t = useT()
  const used = Math.min(100, (license.trialUsedSeconds / Math.max(1, license.trialLimitSeconds)) * 100)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-hud/60" role="progressbar" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-cyan" style={{ width: `${used}%` }} />
      </div>
      <p className="font-mono text-[11px] text-text-muted">{t.cloud.trialLeft(formatDuration(license.trialRemainingSeconds))}</p>
    </div>
  )
}

/** The W-ONE account on this core: who is signed in, the license, and what to do next. */
function AccountCard({ status }: { status: CloudStatus }) {
  const t = useT()
  const busy = useCloud((s) => s.busy)
  const { account, license } = status
  if (!account) {
    return (
      <div className="flex flex-col gap-3">
        <SignInForm />
        {!status.enforced && <p className="font-sans text-[11.5px] text-text-muted">{t.cloud.devBuild}</p>}
      </div>
    )
  }
  const lifetime = license?.plan === 'lifetime'
  const cloud = useCloud.getState()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan/50 font-sans text-[15px] font-semibold uppercase text-cyan">
          {(account.name ?? account.email).charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-[14px] font-medium text-text-primary">{account.name ?? account.email}</p>
          {account.name && <p className="truncate font-sans text-[12px] text-text-muted">{account.email}</p>}
        </div>
        {license && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider',
              lifetime ? 'border-cyan/50 bg-cyan/[0.08] text-cyan' : 'border-blue/50 bg-blue/[0.08] text-blue'
            )}
          >
            {lifetime ? t.cloud.lifetime : t.cloud.trial}
          </span>
        )}
      </div>
      {license && !lifetime && <TrialMeter license={license} />}
      {lifetime && status.validUntil && (
        <p className="font-mono text-[11px] text-text-muted">
          {t.cloud.offlineUntil(new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(status.validUntil)))}
        </p>
      )}
      <CloudNotice />
      <div className="flex flex-wrap gap-2">
        {!lifetime && (
          <button type="button" disabled={busy} onClick={() => void cloud.buy()} className={primaryButton}>
            <ShoppingCart size={14} /> {t.cloud.buy}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void cloud.refresh()} className={quietButton}>
          <RefreshCw size={13} /> {t.cloud.checkAgain}
        </button>
        <button type="button" disabled={busy} onClick={() => void cloud.logout()} className={quietButton}>
          <LogOut size={13} /> {t.cloud.signOut}
        </button>
      </div>
      {!status.enforced && <p className="font-sans text-[11.5px] text-text-muted">{t.cloud.devBuild}</p>}
    </div>
  )
}

/** Profile: the W-ONE account (license, trial), the UI language and the connected core. */
export function AccountView() {
  const t = useT()
  const info = useSession((s) => s.info)
  const cloud = useCloud((s) => s.status)
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
          {cloud ? <AccountCard status={cloud} /> : <p className="font-mono text-[11px] text-text-muted">{t.account.linking}</p>}
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
