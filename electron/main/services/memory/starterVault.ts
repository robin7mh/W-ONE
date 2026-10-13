import { randomUUID } from 'node:crypto'

/** Frontmatter `type` for notes created inside the starter folders. */
export const FOLDER_TYPES: Record<string, string> = {
  Ich: 'personal',
  Projekte: 'project',
  Entscheidungen: 'decision',
  Wissen: 'knowledge'
}

export function frontmatter(fields: { type?: string; tags?: string[] }, created = new Date()): string {
  const lines = ['---', `id: ${randomUUID()}`]
  if (fields.type) lines.push(`type: ${fields.type}`)
  lines.push(`created: ${created.toISOString()}`)
  lines.push(`tags: [${(fields.tags ?? []).join(', ')}]`)
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * Seed notes for a brand-new vault, so the graph has shape on first open and
 * the folder structure shows how the memory is meant to grow. Plain Obsidian
 * markdown — the user can edit or delete all of it.
 */
export function starterNotes(): { path: string; content: string }[] {
  return [
    {
      path: 'Willkommen.md',
      content:
        frontmatter({ type: 'knowledge', tags: ['mindeck'] }) +
        `Das ist dein **Mindeck Gedächtnis** – ein ganz normaler Obsidian-Vault. Jede Notiz ist eine Markdown-Datei in diesem Ordner.

## So funktioniert's
- Verbinde Notizen mit \`[[Wikilinks]]\`, z. B. [[Über mich]] oder [[Mindeck]].
- Jeder Link wird im **Graph** zu einer Linie. Im bunten Modus bekommt jeder Ordner seine eigene Farbe.
- Tags wie \`#idee\` oder \`#todo\` machen Notizen auffindbar.
- Du kannst diesen Ordner zusätzlich in Obsidian öffnen – Änderungen erscheinen in Mindeck sofort.

## Bereiche
- [[Über mich]] – wer du bist, was dir wichtig ist
- [[Vorlieben]] – wie du arbeitest und was du magst
- [[Mindeck]] – dein Command Center als Projekt
- Entscheidungen – was entschieden wurde und warum, z. B. [[2026-10-01 Electron 37]]

Später liest deine KI genau diese Notizen, um dich zu kennen – und schreibt neue Erinnerungen hierher.
`
    },
    {
      path: 'Ich/Über mich.md',
      content:
        frontmatter({ type: 'personal' }) +
        `- **Name:**
- **Was ich mache:**
- **Was mir wichtig ist:**

Wie ich am liebsten arbeite, steht in [[Vorlieben]].
`
    },
    {
      path: 'Ich/Vorlieben.md',
      content:
        frontmatter({ type: 'preference' }) +
        `- Ruhige, übersichtliche Oberfläche statt Daueranimation – siehe [[2026-10-01 Ruhigere Oberfläche]].
- Lieber Schritt für Schritt als alles auf einmal.
- Werte in der UI müssen echt sein und mit dem Gerät übereinstimmen.

Gehört zu [[Über mich]].
`
    },
    {
      path: 'Projekte/Mindeck.md',
      content:
        frontmatter({ type: 'project', tags: ['projekt'] }) +
        `Mein persönliches Command Center mit eigenem KI-Gedächtnis (Electron + React).

## Entscheidungen
- [[2026-10-01 Electron 37]]
- [[2026-10-01 Ruhigere Oberfläche]]

Passt zu meinen [[Vorlieben]].
`
    },
    {
      path: 'Entscheidungen/2026-10-01 Electron 37.md',
      content:
        frontmatter({ type: 'decision' }) +
        `**Entscheidung:** Mindeck läuft auf Electron 37 statt 31.

**Warum:** macOS 27 hat die Notarisierung von Electron 31.7.7 widerrufen – Gatekeeper hat die App als Malware in den Papierkorb verschoben.

Projekt: [[Mindeck]]
`
    },
    {
      path: 'Entscheidungen/2026-10-01 Ruhigere Oberfläche.md',
      content:
        frontmatter({ type: 'decision' }) +
        `**Entscheidung:** Demo-Inhalte raus, Command Deck einklappbar, nur echte Werte anzeigen.

**Warum:** Es war zu viel gleichzeitig los – siehe [[Vorlieben]].

Projekt: [[Mindeck]]
`
    }
  ]
}
