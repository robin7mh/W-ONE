/**
 * Static banner written into xterm. ANSI color codes match the HUD palette.
 * Live output arrives once a node-pty bridge exists (see README).
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
