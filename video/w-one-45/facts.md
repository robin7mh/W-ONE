# Facts (every claim on screen must be listed here with its source)

Checked 2026-10-13 against W-ONE-Electron `develop` @ 8c866d1 and W-ONE-Web `src/i18n`.

| Claim on screen | Source |
|---|---|
| Works with Claude Code, Codex, Gemini CLI | README.md "Agents"; web `hero.points` |
| Uses your own subscription, no API key needed | README.md "Agents" ("W-ONE braucht dafür keinen API-Key") |
| Commands always ask for approval; file/memory tools can be allowed permanently | README.md "Agents" → Freigaben; web features "Approvals that remember" |
| "Changes" shows every edit of the agent as a diff in Monaco | README.md "Agents" → Changes |
| After every answer W-ONE writes a log note to `Agents/<project>/…`; the next agent, from any vendor, can read it | README.md "Agents" (Gedächtnis-Protokoll) |
| Obsidian-compatible memory vault with graph | README.md intro; screenshot `memory` |
| Editor like VS Code (Monaco) | README.md intro; screenshot `editor` |
| Real shells | README.md intro; screenshot `terminal` |
| Live telemetry (CPU, RAM, disk, network, battery, top processes) | web features "Live telemetry"; screenshot `core` |
| Runs on desktop, in the browser and as a Docker core | README.md "Loslegen" table |
| Phone access: pair the phone's browser (QR / one-time code) | README.md pairing; web `platforms.mobile` ("Already works in your phone's browser") |
| Mobile app | **"Soon" only**, never shown as released |
| Data stays on your machine | web hero `points` / features "Local & private" |
| English & German UI | web features "English & German" |

## Not on screen (Robin, 2026-10-13)
- No price, no trial length.

## Open
- Final website domain: `site.url` in W-ONE-Web is still a placeholder (`http://localhost:3000`). Needed for the end card.
- Screenshot data: the 2026-10-09 set comes from an isolated demo instance with Robin's real projects/vault. Fresh captures (agents, current editor, website hero) use the same kind of instance.
