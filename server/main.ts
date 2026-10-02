// W-ONE core as a standalone server — the same services as the desktop app,
// headless, reachable by the web UI and the mobile app over HTTP + WebSocket.
//
//   node out/server/index.cjs          start (see README → "Web UI & server")
//   node out/server/index.cjs pair     print a one-time pairing code
//
// Configuration (environment):
//   WONE_HOME             data + vault root (default ~/W-ONE)
//   WONE_PORT             port (default 7420)
//   WONE_LAN=1            listen on all interfaces instead of 127.0.0.1
//   WONE_REMOTE_TERMINAL=1  allow paired devices to open shells (off by default)
//   WONE_WEB_ROOT         built web UI to serve (default: next to this file)
//   WONE_DB_URL           Postgres (default matches docker-compose.yml)

import { join } from 'node:path'
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@shared/types/server'
import { wonePaths } from '../electron/main/lib/paths'
import { headlessPlatform } from '../electron/main/platform/headless'
import { createCore, type Core } from '../electron/main/core/createCore'
import { AuthService } from '../electron/main/services/auth/AuthService'

declare const __WONE_VERSION__: string

const flag = (v: string | undefined) => v === '1' || v === 'true'

export function serverConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.WONE_PORT)
  return {
    enabled: true,
    lan: flag(env.WONE_LAN),
    port: env.WONE_PORT && Number.isInteger(port) && port >= 0 && port < 65536 ? port : DEFAULT_SERVER_CONFIG.port,
    remoteTerminal: flag(env.WONE_REMOTE_TERMINAL)
  }
}

function banner(code: string, urls: string[]): string {
  return [
    '',
    '  ┌─ W-ONE pairing ─────────────────────────────',
    `  │  Code:  ${code}   (valid 10 minutes, one use)`,
    ...urls.map((u) => `  │  Open:  ${u}`),
    '  └─────────────────────────────────────────────',
    ''
  ].join('\n')
}

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<Core | null> {
  const paths = wonePaths()
  const version = typeof __WONE_VERSION__ === 'string' ? __WONE_VERSION__ : '0.0.0'

  if (argv[0] === 'pair') {
    const { code } = await new AuthService(paths.devicesFile).createPairingCode()
    const config = serverConfigFromEnv(env)
    console.log(banner(code, [`http://127.0.0.1:${config.port}`]))
    return null
  }

  const core = await createCore({
    mode: 'server',
    version,
    paths,
    platform: headlessPlatform,
    serverConfig: serverConfigFromEnv(env),
    webRoot: env.WONE_WEB_ROOT || join(__dirname, '../web')
  })
  await core.server.start()
  const status = core.server.status()
  if (!status.running) {
    await core.dispose()
    throw new Error(`W-ONE server could not start: ${status.error}`)
  }
  console.log(`[server] W-ONE ${version} listening on ${status.urls.join(', ')}`)
  if (!(await core.auth.hasDevices())) {
    const { code, urls } = await core.server.createPairingCode()
    console.log(banner(code, urls))
  }
  return core
}

/* v8 ignore start -- process entry point, exercised by the web E2E suite */
if (require.main === module) {
  run(process.argv.slice(2)).then(
    (core) => {
      if (!core) return
      const stop = () => {
        console.log('[server] shutting down')
        void core.dispose().finally(() => process.exit(0))
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    },
    (err) => {
      console.error(err)
      process.exit(1)
    }
  )
}
/* v8 ignore stop */
