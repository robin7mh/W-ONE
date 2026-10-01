/**
 * Pure text edits on note markdown: rewrite, remove or add links. Code (fenced
 * blocks and inline `code`) is never touched — same rule as the parser.
 */

const FENCE = /(^(```|~~~)[^\n]*\n[\s\S]*?^\2[ \t]*$)/gm
const WIKI = /(!?\[\[)([^\]\n|#^]+)((?:[#^][^\]\n|]*)?)((?:\|[^\]\n]*)?)(\]\])/g
const MD = /(\[)([^\]\n]*)(\]\(<?)([^)\s>]+\.md)(>?(?:#[^)]*)?\))/gi
const INLINE_CODE = /(`[^`\n]*`)/g

const decode = (s: string) => {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

/** Apply `fn` to every non-code stretch of `text`. */
function outsideCode(text: string, fn: (prose: string) => string): string {
  return text
    .split(FENCE)
    .map((part, i) => {
      // split() with 2 capture groups yields [prose, fence, fenceMarker, prose, …]
      if (i % 3 === 1) return part
      if (i % 3 === 2) return ''
      return part
        .split(INLINE_CODE)
        .map((seg, j) => (j % 2 === 1 ? seg : fn(seg)))
        .join('')
    })
    .join('')
}

/**
 * Rewrite link targets. `map` gets each target as written (wikilink text, or
 * the decoded .md path of a markdown link) and returns the new target, or null
 * to leave it alone. Anchors and aliases are preserved.
 */
export function rewriteLinks(raw: string, map: (target: string) => string | null): string {
  return outsideCode(raw, (prose) =>
    prose
      .replace(WIKI, (all, open, target, anchor, alias, close) => {
        const next = map(target.trim())
        return next === null ? all : `${open}${next}${anchor}${alias}${close}`
      })
      .replace(MD, (all, a, text, b, href, c) => {
        const next = map(decode(href))
        return next === null ? all : `${a}${text}${b}${encodeURI(`${next}.md`)}${c}`
      })
  )
}

const LINK_ONLY_LINE = /^[ \t]*(?:[-*+][ \t]+)?(!?\[\[[^\]\n]+\]\]|\[[^\]\n]*\]\([^)\s]+\.md[^)]*\))[ \t]*$/

/**
 * Remove links whose target matches. A line that is nothing but the link (e.g.
 * a "- [[Note]]" list item) disappears; inside a sentence the link becomes its
 * plain text, so the sentence stays readable. An emptied "## Verbindungen"
 * section is removed too.
 */
export function removeLinks(raw: string, isTarget: (target: string) => boolean): string {
  const wikiTarget = (link: string) => /^!?\[\[([^\]\n|#^]+)/.exec(link)?.[1].trim() ?? ''
  const mdTarget = (link: string) => decode(/\]\(<?([^)\s>]+\.md)/i.exec(link)?.[1] ?? '')

  const lines = raw.split('\n').filter((line) => {
    const m = LINK_ONLY_LINE.exec(line)
    if (!m) return true
    const target = m[1].startsWith('[') && !m[1].startsWith('[[') ? mdTarget(m[1]) : wikiTarget(m[1])
    return !isTarget(target)
  })

  let text = outsideCode(lines.join('\n'), (prose) =>
    prose
      .replace(WIKI, (all, _open, target, anchor, alias) => {
        if (!isTarget(target.trim())) return all
        const label = alias ? alias.slice(1) : `${target.trim().split('/').pop()}${anchor ? anchor.replace(/^[#^]/, ' › ') : ''}`
        return label.trim()
      })
      .replace(MD, (all, _a, label, _b, href) => (isTarget(decode(href)) ? label : all))
  )

  // Drop a "## Verbindungen" heading whose section is now empty.
  text = text.replace(/\n*^##[ \t]+Verbindungen[ \t]*\n(?=\s*(?:^#|$(?![\s\S])))/gm, '\n')
  return text.replace(/\n{3,}/g, '\n\n')
}

/** Add `[[target]]` as a list item under "## Verbindungen" (created if missing). */
export function appendLink(raw: string, target: string): string {
  const item = `- [[${target}]]`
  const heading = /^##[ \t]+Verbindungen[ \t]*$/m.exec(raw)
  if (heading) {
    const start = heading.index + heading[0].length
    const rest = raw.slice(start)
    const next = /^#{1,6}[ \t]/m.exec(rest)
    const end = next ? start + next.index : raw.length
    const section = raw.slice(start, end).replace(/\s+$/, '')
    return `${raw.slice(0, start)}${section}\n${item}\n${next ? `\n${raw.slice(end)}` : ''}`
  }
  const body = raw.replace(/\s+$/, '')
  return `${body}${body ? '\n\n' : ''}## Verbindungen\n${item}\n`
}
