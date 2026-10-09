import { ExternalLink, Github, Gitlab, type LucideIcon } from 'lucide-react'

/** "GitHub", "GitLab" — or the host — and an icon, for a link to a repo's web page. */
export function repoLink(url: string): { label: string; Icon: LucideIcon } {
  const host = new URL(url).hostname
  if (host === 'github.com') return { label: 'GitHub', Icon: Github }
  if (host.startsWith('gitlab.')) return { label: 'GitLab', Icon: Gitlab }
  return { label: host, Icon: ExternalLink }
}
