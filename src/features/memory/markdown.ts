import { Marked, type TokenizerAndRendererExtension } from 'marked'
import DOMPurify from 'dompurify'
import { isImageTarget } from '@shared/types/memory'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * `[[Target#Heading|Alias]]` and `![[embed]]`: an embedded picture becomes
 * an <img> the note view fills from the vault (`![[bild.png|300]]` = 300 px
 * wide); other embeds render as links.
 */
const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => src.match(/!?\[\[/)?.index,
  tokenizer(src) {
    const m = /^!?\[\[([^\]\n|#^]+)((?:[#^][^\]\n|]*)?)(?:\|([^\]\n]*))?\]\]/.exec(src)
    if (!m) return undefined
    return { type: 'wikilink', raw: m[0], embed: m[0].startsWith('!'), target: m[1].trim(), anchor: m[2], alias: m[3]?.trim() }
  },
  renderer(token) {
    if (token.embed && isImageTarget(token.target)) {
      const width = Number(token.alias) || 0
      return `<img class="embed" data-embed="${esc(token.target)}" alt="${esc(token.target)}"${width ? ` width="${width}"` : ''}>`
    }
    const label = token.alias || `${token.target}${token.anchor ? token.anchor.replace(/^[#^]/, ' › ') : ''}`
    return `<a class="wikilink" data-target="${esc(token.target)}">${esc(label)}</a>`
  }
}

/** Inline `#tag` (same rule as the indexer: not purely numeric, preceded by space). */
const tag: TokenizerAndRendererExtension = {
  name: 'tag',
  level: 'inline',
  start(src) {
    const m = /(^|[\s(,])#[\p{L}\p{N}_\-/]/u.exec(src)
    return m ? m.index + m[1].length : undefined
  },
  tokenizer(src) {
    const m = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(src)
    if (!m) return undefined
    return { type: 'tag', raw: m[0], name: m[1] }
  },
  renderer(token) {
    return `<span class="md-tag">#${esc(token.name)}</span>`
  }
}

const marked = new Marked({ gfm: true, breaks: false, extensions: [wikilink, tag] })

/**
 * Note body → sanitized HTML. Notes may come from anywhere (an existing
 * Obsidian vault, a sync), so raw HTML in them is untrusted: DOMPurify strips
 * scripts, handlers and javascript: URLs before anything reaches the DOM.
 * Pictures never load from where the note says: their source moves to
 * `data-embed`, and the note view fills them from the vault (no tracking
 * pixels, no files from elsewhere on the disk).
 */
export function renderMarkdown(body: string, links: Record<string, string | null>): string {
  const html = marked.parse(body, { async: false }) as string
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
  // Mark unresolved wikilinks after sanitizing (class only — no new markup).
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  doc.querySelectorAll<HTMLAnchorElement>('a.wikilink').forEach((a) => {
    const target = a.dataset.target ?? ''
    if (!links[target]) a.classList.add('unresolved')
  })
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')!
    if (src.startsWith('data:image/')) return
    img.setAttribute('data-embed', src)
    img.removeAttribute('src')
  })
  return doc.body.innerHTML
}
