// npm run db:backup — dumps the Docker database to ~/W-ONE/backups/ (or
// $WONE_HOME/backups). Plain SQL, restorable with `psql < file`.
const { spawn } = require('node:child_process')
const { createWriteStream, mkdirSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')

const dir = join(process.env.WONE_HOME || join(homedir(), 'W-ONE'), 'backups')
mkdirSync(dir, { recursive: true })
const file = join(dir, `wone-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
const user = process.env.WONE_DB_USER || 'wone'
const db = process.env.WONE_DB_NAME || 'wone'

const dump = spawn('docker', ['exec', 'w-one-db', 'pg_dump', '-U', user, '-d', db, '--clean', '--if-exists'], {
  stdio: ['ignore', 'pipe', 'inherit']
})
dump.stdout.pipe(createWriteStream(file))
dump.on('error', (err) => {
  console.error(`[db:backup] could not run docker: ${err.message}`)
  process.exit(1)
})
dump.on('close', (code) => {
  if (code === 0) console.log(`[db:backup] ${file}`)
  else console.error(`[db:backup] pg_dump failed (exit ${code}) — is the database running? npm run db:up`)
  process.exit(code ?? 1)
})
