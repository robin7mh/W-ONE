import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { shellCommand, shellEnv, shellQuote } from '../terminal/TerminalService'
import { shellArgs } from '../../lib/shellArgs'
import { pythonFor } from '../tools/catalog'
import type { DapLaunch, DapTransport } from './Dap'

/** Start a program like the user's terminal would (their PATH), with extra environment. */
export function spawnInShell(command: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  const { file } = shellCommand()
  const line = [command, ...args].map(shellQuote).join(' ')
  return spawn(file, shellArgs(line), {
    cwd,
    env: { ...shellEnv(), ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

export function stdioTransport(proc: Pick<ChildProcess, 'stdin' | 'stdout' | 'on' | 'kill'>): DapTransport {
  return {
    write: (data) => void proc.stdin!.write(data),
    onData: (fn) => void proc.stdout!.on('data', fn),
    onClose: (fn) => void proc.on('exit', fn),
    close: () => void proc.kill()
  }
}

export function socketTransport(socket: Socket): DapTransport {
  return {
    write: (data) => void socket.write(data),
    onData: (fn) => void socket.on('data', fn),
    onClose: (fn) => void socket.on('close', fn),
    close: () => void socket.destroy()
  }
}

export interface AdapterContext {
  root: string
  /** The program, absolute. */
  program: string
  args: string[]
  /** Where the language's debugger is (from Settings → Languages). */
  debugger: string
  /** Output the adapter's process prints that isn't protocol (Delve: the program's own output). */
  output: (stream: 'stdout' | 'stderr', text: string) => void
}

export type Spawn = (command: string, args: string[], cwd: string, env?: Record<string, string>) => ChildProcess

/** Languages debugged through a debug adapter (Node runs on its own inspector). */
export const DAP_LANGUAGES = ['python', 'go']

/** Start the language's debug adapter and say how to launch the program with it. */
export async function startAdapter(language: string, ctx: AdapterContext, run: Spawn = spawnInShell): Promise<{ transport: DapTransport; launch: DapLaunch }> {
  if (language === 'python') {
    // debugpy lives in W-ONE's tools folder; the project's virtualenv runs the program.
    const python = pythonFor(ctx.root)
    const proc = run(python, ['-m', 'debugpy.adapter'], ctx.root, { PYTHONPATH: ctx.debugger })
    return {
      transport: stdioTransport(proc),
      launch: {
        adapterID: 'debugpy',
        kill: () => void proc.kill(),
        arguments: { type: 'python', request: 'launch', name: 'W-ONE', program: ctx.program, args: ctx.args, cwd: ctx.root, python: [python], console: 'internalConsole', justMyCode: true, redirectOutput: true }
      }
    }
  }
  // Go: Delve's DAP server on a local port; its stdout carries the program's output.
  const proc = run(ctx.debugger, ['dap', '--listen=127.0.0.1:0'], ctx.root)
  const port = await new Promise<number>((resolve, reject) => {
    let listening = false
    proc.stdout!.on('data', (d: Buffer) => {
      const text = d.toString()
      const match = /listening at:? *\[?[\d.:a-f]*?\]?:?(\d+)\s*$/im.exec(text)
      if (!listening && match) {
        listening = true
        return resolve(Number(match[1]))
      }
      if (listening) ctx.output('stdout', text)
    })
    proc.stderr!.on('data', (d: Buffer) => ctx.output('stderr', d.toString()))
    proc.on('exit', () => !listening && reject(Object.assign(new Error('Delve did not start'), { code: 'debug' })))
    proc.on('error', reject)
  })
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })
  return {
    transport: socketTransport(socket),
    launch: {
      adapterID: 'go',
      kill: () => void proc.kill(),
      arguments: { request: 'launch', mode: 'debug', program: dirname(ctx.program), args: ctx.args, cwd: ctx.root }
    }
  }
}
