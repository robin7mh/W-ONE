// Mindeck core as a standalone server — the same services as the desktop app,
// headless, reachable by the web UI and the mobile app over HTTP + WebSocket.
//
//   node out/server/index.cjs          start (see README → "Web UI & server")
//   node out/server/index.cjs pair     print a one-time pairing code
//
// Configuration (environment):
//   MINDECK_HOME             data + vault root (default ~/Mindeck)
//   MINDECK_PORT             port (default 7420)
//   MINDECK_LAN=1            listen on all interfaces instead of 127.0.0.1
//   MINDECK_REMOTE_TERMINAL=1  allow paired devices to open shells (off by default)
//   MINDECK_WEB_ROOT         built web UI to serve (default: next to this file)
//   MINDECK_DB_URL           Postgres (default matches docker-compose.yml)
//   NODE_ENV=production   requires a Mindeck license (the Docker image); otherwise
//                         only with MINDECK_LICENSE=required. Dev: MINDECK_CLOUD_URL.
//   MINDECK_LICENSE=follower started by the desktop app (Remote-SSH, Dev Container):
//                         the desktop hands its entitlement over (cloud:adopt)
//   MINDECK_EXIT_WITH_STDIN=1  stop when stdin closes (the desktop's ssh / docker exec ended)

import { join } from 'node:path'
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@shared/types/server'
import { mindeckPaths } from '../electron/main/lib/paths'
import { headlessPlatform } from '../electron/main/platform/headless'
import { createCore, type Core } from '../electron/main/core/createCore'
import { AuthService } from '../electron/main/services/auth/AuthService'
import { cloudConfig } from '../electron/main/services/cloud/config'

declare const __MINDECK_VERSION__: string

const flag = (v: string | undefined) => v === '1' || v === 'true'

export function serverConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.MINDECK_PORT)
  return {
    enabled: true,
    lan: flag(env.MINDECK_LAN),
    port: env.MINDECK_PORT && Number.isInteger(port) && port >= 0 && port < 65536 ? port : DEFAULT_SERVER_CONFIG.port,
    remoteTerminal: flag(env.MINDECK_REMOTE_TERMINAL)
  }
}

function banner(code: string, urls: string[]): string {
  return [
    '',
    '  ┌─ Mindeck pairing ─────────────────────────────',
    `  │  Code:  ${code}   (valid 10 minutes, one use)`,
    ...urls.map((u) => `  │  Open:  ${u}`),
    '  └─────────────────────────────────────────────',
    ''
  ].join('\n')
}

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<Core | null> {
  const paths = mindeckPaths()
  const version = typeof __MINDECK_VERSION__ === 'string' ? __MINDECK_VERSION__ : '0.0.0'

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
    webRoot: env.MINDECK_WEB_ROOT || join(__dirname, '../web'),
    cloud: cloudConfig(env.NODE_ENV === 'production', env)
  })
  await core.server.start()
  const status = core.server.status()
  if (!status.running) {
    await core.dispose()
    throw new Error(`Mindeck server could not start: ${status.error}`)
  }
  console.log(`[server] Mindeck ${version} listening on ${status.urls.join(', ')}`)
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
      let stopping = false
      const stop = () => {
        if (stopping) return
        stopping = true
        console.log('[server] shutting down')
        void core.dispose().finally(() => process.exit(0))
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      // Started by the desktop app over ssh / docker exec: its end is ours.
      if (flag(process.env.MINDECK_EXIT_WITH_STDIN)) {
        process.stdin.on('end', stop).on('close', stop).resume()
      }
    },
    (err) => {
      console.error(err)
      process.exit(1)
    }
  )
}
/* v8 ignore stop */
