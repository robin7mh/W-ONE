# Director's brief: W-ONE product film (45 s)

Status: **draft, waiting for Robin's OK**. No code before that.

## Frame
- **Duration** 45 s · **master** 1920×1080, 60 fps, 2× supersampled · **also** 1080×1920 (9:16) and 1080×1350 (4:5), recomposed from the SAME timeline (never cropped).
- **Languages** EN and DE: two films, one dictionary, UI captured in the matching language.
- **Subject / promise** "Your coding agents. One command center." / "Deine Coding-Agents. Ein Command Center."
- **Audience** developers who already pay for Claude Code, Codex or Gemini and juggle terminals, editor and notes.
- **Channels** website, X, LinkedIn, YouTube. Muted first: the type carries the story, Robin adds VO himself later.
- **Reference style** *Linear launch film*: ink background, ONE accent (W-ONE cyan `#38D6E8`), one continuous camera over the real UI, Inter titles, mono HUD labels, springs with damping ≥ 0.72, one thing moves at a time.
- **Never**: price, trial length, invented features, mobile app shown as released, rainbow gradients, particles, emoji.

## Story = one chain (each step produces what the next one uses)
Beat grid assumes ~120 BPM (1 beat = 0.5 s, 1 bar = 2 s); final times snap to the measured track.

| # | Time | State | Type (EN / DE) |
|---|---|---|---|
| 1 | 0.0–4.0 | **Hook, the mess.** Ink void. Small windows pop in one per beat, slightly overlapping: a `claude` terminal, a `codex` terminal, a `gemini` terminal, a code editor, a notes app, a system monitor. Camera drifts back. | "Agents in one terminal." "Code in another app." "Notes somewhere else." / "Agents im einen Terminal." "Code in der nächsten App." "Notizen irgendwo anders." |
| 2 | 4.0–8.0 | **Gather.** The windows spring together, their outlines merge into ONE rounded frame (shared element), a cyan border beam runs once around it. | "Your coding agents." → "One command center." / "Deine Coding-Agents." → "Ein Command Center." |
| 3 | **8.0** | **DROP: the window turns on.** The frame becomes the real W-ONE Core screen: greeting, clock, telemetry gauges count up, cards cascade. | small label `W-ONE` |
| 4 | 8.0–11.0 | Cursor glides to **Agents** in the sidebar, click on the beat, camera pushes in. | |
| 5 | 11.0–20.0 | **Agent cockpit.** New chat: picker shows Claude Code · Codex · Gemini, cursor picks one, project chosen, the task is typed. The agent streams its plan; an **approval card** slides in for a shell command, cursor clicks *Allow*. | "Claude Code, Codex, Gemini." → "With the plans you already have." → "Every command asks first." / "Claude Code, Codex, Gemini." → "Mit den Abos, die du schon hast." → "Jeder Befehl fragt vorher." |
| 6 | 20.0–26.0 | **Changes → Editor.** The changed-file chip grows into a Monaco diff (green lines cascade), camera widens to the Editor module with tree and tabs. | "Every change as a diff." → "In a real editor." / "Jede Änderung als Diff." → "In einem echten Editor." |
| 7 | 26.0–33.0 | **Memory.** The session's log note (`Agents/<project>/…`) lifts off, flies into the Memory graph and lands as a new node, links draw to its neighbours. A second session with a *different* agent opens and shows it read that note. | "One memory." → "Every agent reads it." / "Ein Gedächtnis." → "Jeder Agent liest mit." |
| 8 | 33.0–38.0 | **Everywhere.** Camera pulls back: the desktop window slides left, a phone (paired browser, QR) and a server/Docker card join. | "Desktop. Browser. Your own server." / "Desktop. Browser. Dein eigener Server." |
| 9 | 38.0–45.0 | **Website.** Everything collapses into the W1 mark; the mark stretches into a browser address bar, the domain is typed letter by letter, Enter, the real website hero wipes in below. End card: mark + domain, last 1.5 s alive with a micro drift. | domain only, e.g. `w-one.app` (TBD) |

## Layers (back to front)
1. Ink void `#04060B` + very faint HUD grid (from the app's look), slow drift.
2. App window (screenshot base at 2× for the static chrome).
3. Rebuilt animated UI in the app's tokens: chat bubbles, approval card, diff lines, graph nodes/links, gauges, typing, address bar.
4. macOS cursor.
5. Kinetic captions (masked word rise, Inter 600, one line each, inside the 9:16 safe square).
6. Vignette.

## Screens (real, captured fresh, EN + DE)
From an isolated demo instance with Robin's real projects and vault (same method as the website screenshots):
- Agents: new-chat dialog, a running session with plan + approval, the Changes tab.
- Editor (current develop, with a diff open), Memory graph, Core.
- Website hero (W-ONE-Web, EN `/en` and DE `/`).

Static chrome = the screenshot; everything that moves is rebuilt in code on top, checked side by side against the screenshot.

## Sound plan
- One Mixkit track (free commercial), ~110–122 BPM, minimal electronic/tech, mid energy so a VO fits later. The **drop lands on 8.0 s** (window turns on), found by band energy.
- Few soft SFX, placed by measured peak: ticks on the hook windows, whoosh on the gather, one low hit on the drop, clicks on cursor clicks, keys while typing, a soft check on *Allow*.
- Delivered: `mix.wav` (−14 LUFS), plus stems `music.wav` and `sfx.wav`, so Robin can duck the music under his VO.

## Next steps after OK
1. Capture screens (EN + DE) and the website hero.
2. Pick the track, measure the drop, write `BEATMAP.md`.
3. 4 stills (hook, drop, approval, end card) → Robin's OK.
4. 540p draft → critique pass → 60 fps master → audio → EN + DE in 3 formats.
