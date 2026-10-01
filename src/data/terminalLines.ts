/**
 * Static banner written into xterm. Uses the standard ANSI palette slots, which
 * useTerminalStream maps to the theme tokens — so a theme switch recolors text
 * that is already on screen. Live output arrives once a node-pty bridge exists.
 */
const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  purple: '\x1b[35m',
  green: '\x1b[32m',
  amber: '\x1b[33m',
  dim: '\x1b[90m',
  white: '\x1b[97m'
}

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

export { C as TERM_COLORS }
