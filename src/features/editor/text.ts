const BLANK = /^[ \t]*\r?$/

/**
 * The Blank Line Organizer's cleanup: runs of blank lines become one
 * (`keepOne`) or disappear; whitespace on blank lines goes; a final newline
 * stays as it was.
 */
export function tidyBlankLines(text: string, keepOne: boolean): string {
  const final = text.endsWith('\n') ? (text.endsWith('\r\n') ? '\r\n' : '\n') : ''
  const lines = (final ? text.slice(0, -final.length) : text).split('\n')
  const out: string[] = []
  let run = 0
  for (const line of lines) {
    if (!BLANK.test(line)) {
      run = 0
      out.push(line)
      continue
    }
    run += 1
    if (keepOne && run === 1) out.push(line.endsWith('\r') ? '\r' : '')
  }
  // No blank lines at the very end either (the final newline comes back below).
  while (out.length && BLANK.test(out[out.length - 1])) out.pop()
  return out.join('\n') + final
}
