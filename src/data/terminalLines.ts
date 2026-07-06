/**
 * Fake log stream written into xterm. ANSI color codes are used so the terminal
 * feels alive. Swap this for a node-pty bridge later (see README).
 */
const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[38;2;56;214;232m',
  blue: '\x1b[38;2;74;132;255m',
  purple: '\x1b[38;2;158;122;255m',
  green: '\x1b[38;2;96;220;150m',
  amber: '\x1b[38;2;245;191;96m',
  dim: '\x1b[38;2;96;112;133m',
  white: '\x1b[38;2;226;236;247m'
}

const ts = () => `${C.dim}[${new Date().toLocaleTimeString('en-GB')}]${C.reset}`

export const BANNER: string[] = [
  '',
  `${C.cyan}   ██╗    ██╗      ██████╗ ███╗   ██╗███████╗${C.reset}`,
  `${C.cyan}   ██║    ██║     ██╔═══██╗████╗  ██║██╔════╝${C.reset}`,
  `${C.blue}   ██║ █╗ ██║     ██║   ██║██╔██╗ ██║█████╗  ${C.reset}`,
  `${C.blue}   ██║███╗██║     ██║   ██║██║╚██╗██║██╔══╝  ${C.reset}`,
  `${C.purple}   ╚███╔███╔╝     ╚██████╔╝██║ ╚████║███████╗${C.reset}`,
  `${C.purple}    ╚══╝╚══╝       ╚═════╝ ╚═╝  ╚═══╝╚══════╝${C.reset}`,
  '',
  `${C.dim}   command center · local mode · display-only shell${C.reset}`,
  ''
]

/** Recurring lines streamed to keep the terminal feeling active. */
export const STREAM_LINES: (() => string)[] = [
  () => `${ts()} ${C.green}✓${C.reset} core.status ${C.dim}→${C.reset} nominal ${C.dim}(4 agents)${C.reset}`,
  () => `${ts()} ${C.cyan}»${C.reset} scheduler: idle tick, queue depth ${C.white}0${C.reset}`,
  () => `${ts()} ${C.green}✓${C.reset} vault.index ${C.dim}→${C.reset} snapshot cached`,
  () => `${ts()} ${C.blue}i${C.reset} net.link ${C.dim}→${C.reset} LOCAL ${C.dim}(no outbound)${C.reset}`,
  () => `${ts()} ${C.amber}!${C.reset} sys.thermal ${C.dim}→${C.reset} 68% envelope ${C.dim}nominal${C.reset}`,
  () => `${ts()} ${C.purple}»${C.reset} agent FORGE ${C.dim}→${C.reset} standby, awaiting objective`,
  () => `${ts()} ${C.green}✓${C.reset} objective.plan ${C.dim}→${C.reset} 3 steps resolved`,
  () => `${ts()} ${C.cyan}»${C.reset} hud.compositor ${C.dim}→${C.reset} 60fps, 0 dropped`
]

export { C as TERM_COLORS }
