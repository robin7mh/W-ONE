import { DEFAULT_AI_SETTINGS, EFFORTS, MODELS, type AiSettings, type AiStatus } from '@shared/types/ai'
import type { SettingsService } from '../settings/SettingsService'
import type { SecretStore } from './SecretStore'
import { AnthropicProvider } from './AnthropicProvider'
import { aiError, type LlmProvider } from './llm'

const KEY = 'anthropic_api_key'

export interface ProviderFactory {
  create(apiKey: string): LlmProvider & { verify(model: string): Promise<void> }
}

const anthropic: ProviderFactory = { create: (key) => AnthropicProvider.fromKey(key) }

/**
 * The assistant's configuration: API key (environment first, else the secret
 * store), model and effort. Hands out a provider for the current key; the key
 * itself never leaves the core.
 */
export class AiService {
  private cached?: { key: string; provider: LlmProvider }

  constructor(
    private readonly deps: {
      settings: SettingsService
      secrets: SecretStore
      env?: NodeJS.ProcessEnv
      factory?: ProviderFactory
    }
  ) {}

  settings(): AiSettings {
    return { ...DEFAULT_AI_SETTINGS, ...this.deps.settings.get().ai }
  }

  async status(): Promise<AiStatus> {
    const { key, source } = await this.key()
    return { configured: !!key, source, ...(key ? { keyHint: key.slice(-4) } : {}), settings: this.settings() }
  }

  /** Verifies the key with Anthropic (no tokens spent), then stores it. */
  async setKey(key: string): Promise<AiStatus> {
    const trimmed = key.trim()
    if (!/^\S{20,}$/.test(trimmed)) throw aiError('bad-key', 'That does not look like an API key')
    await this.factory().create(trimmed).verify(this.settings().model)
    await this.deps.secrets.set(KEY, trimmed)
    return this.status()
  }

  async clearKey(): Promise<AiStatus> {
    await this.deps.secrets.set(KEY, null)
    return this.status()
  }

  async configure(patch: Partial<AiSettings>): Promise<AiStatus> {
    const next = { ...this.settings(), ...patch }
    if (!MODELS.some((m) => m.id === next.model)) throw aiError('bad-model', `Unknown model: ${next.model}`)
    if (!EFFORTS.includes(next.effort)) throw aiError('bad-effort', `Unknown effort: ${next.effort}`)
    await this.deps.settings.update({ ai: next })
    return this.status()
  }

  /** A provider for the current key, or a `no-key` error the UI turns into setup. */
  async provider(): Promise<LlmProvider> {
    const { key } = await this.key()
    if (!key) throw aiError('no-key', 'No Anthropic API key configured — add one in Settings → AI')
    if (this.cached?.key !== key) this.cached = { key, provider: this.factory().create(key) }
    return this.cached.provider
  }

  private factory(): ProviderFactory {
    return this.deps.factory ?? anthropic
  }

  private async key(): Promise<{ key?: string; source: AiStatus['source'] }> {
    const fromEnv = (this.deps.env ?? process.env).ANTHROPIC_API_KEY?.trim()
    if (fromEnv) return { key: fromEnv, source: 'env' }
    const stored = await this.deps.secrets.get(KEY)
    return stored ? { key: stored, source: 'stored' } : { source: null }
  }
}
