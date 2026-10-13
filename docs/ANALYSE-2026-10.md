# Mindeck: Analyse, Sicherheitsbefunde und Roadmap

**Stand:** 2026-10-11 · **Branch:** `develop` (Commit `86c326b`) · **Version:** 0.1.0
**Umfang:** `electron/` (Core, ~9.800 Zeilen), `server/`, `src/` (Renderer), Tests, CI/CD, Build- und Release-Konfiguration, Doku.

Das Dokument ist eine Bestandsaufnahme mit konkreten Fundstellen. Jeder Befund nennt Schweregrad,
Voraussetzung und einen Lösungsvorschlag. Die Prioritäten am Ende (§9) lassen sich direkt als Tickets
übernehmen.

---

## Inhalt

1. [Kurzfazit](#1-kurzfazit)
2. [Was schon richtig gut ist](#2-was-schon-richtig-gut-ist)
3. [Sicherheitslücken](#3-sicherheitslücken)
4. [Bugs und Fehler](#4-bugs-und-fehler)
5. [Code-Qualität und technische Schulden](#5-code-qualität-und-technische-schulden)
6. [Verbesserungsvorschläge (Produkt und UX)](#6-verbesserungsvorschläge-produkt-und-ux)
7. [Erweiterungen (neue Features)](#7-erweiterungen-neue-features)
8. [Kundengewinnung und Positionierung](#8-kundengewinnung-und-positionierung)
9. [Was vor dem Launch noch fehlt](#9-was-vor-dem-launch-noch-fehlt)
10. [Priorisierte Roadmap](#10-priorisierte-roadmap)

---

## 1. Kurzfazit

Mindeck ist technisch auf einem für Version 0.1 ungewöhnlich hohen Niveau: Es gibt einen sauberen,
typisierten Core, eine einzige Dispatch-Stelle für alle Kanäle (Router mit Zod-Validierung), Path-Confinement
in allen Dateizugriffen, verschlüsselte Secrets, ein Permission-Gate für Agenten-Tools und eine Testabdeckung
von 100 %. Das Produkt hat ein klares Alleinstellungsmerkmal: ein Cockpit für die Coding-Agenten, die
Nutzer ohnehin bezahlen (Claude Code, Codex, Gemini), mit einem gemeinsamen Gedächtnis über alle Anbieter.

Die größten Baustellen vor einem öffentlichen Launch:

| # | Thema | Schwere |
|---|---|---|
| 1 | Gekoppelte Remote-Geräte können trotz „Remote shells aus“ beliebige Dateien lesen und schreiben (und damit Code ausführen) | **Hoch** |
| 2 | Das Electron-Fenster hat keinen Navigationsschutz: Ein Link in einer Agenten-Antwort kann eine fremde Seite mit vollem `window.mindeck`-Zugriff laden | **Hoch** |
| 3 | Electron 37 bekommt keine Sicherheitsupdates mehr (aktuell ist 44) | **Hoch** |
| 4 | Netzwerk-API im LAN nur über Klartext-HTTP; Tokens im Query-String und in `localStorage` | Mittel |
| 5 | Kein Rollenmodell für Geräte: Jedes Gerät darf neue Geräte koppeln, andere entfernen und den API-Key tauschen | Mittel |
| 6 | Eine einzelne beschädigte Transkript-Datei verhindert den Start des Cores | Mittel (Bug) |
| 7 | Release läuft nur lokal; Windows und Linux fehlen; kein Linting, kein Crash-Reporting | Produkt-Risiko |
| 8 | Rechtliches für den Verkauf (Impressum, AGB/EULA, Datenschutz, Drittanbieter-Lizenzen) ist im Repo nicht sichtbar | Launch-Blocker |

---

## 2. Was schon richtig gut ist

Diese Punkte sind auch Verkaufsargumente und sollten bei allen Änderungen erhalten bleiben.

- **Ein Core, drei Oberflächen.** Desktop, Web-UI und künftige Mobile-App sprechen denselben `Router`
  (`electron/ipc/router.ts`). Validierung, Lizenzprüfung und Zugriffsregeln existieren nur einmal.
- **Typisierter Vertrag.** `src/shared/ipc/contract.ts` klassifiziert jeden Kanal genau einmal
  (`CHANNEL_ACCESS`). Ein neuer Kanal ohne Klassifizierung ist ein Typfehler.
- **Path-Confinement.** `confine()` (`electron/main/lib/confine.ts`) folgt Symlinks und prüft den
  tiefsten existierenden Vorfahren. Der Vault nutzt eine eigene, ebenso strenge Normalisierung.
- **Electron-Basis.** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, eine
  Allowlist im Preload.
- **Secrets.** API-Key und Cloud-Session werden über `safeStorage` (Keychain) verschlüsselt und
  gehen nie an Clients.
- **Pairing.** Einmal-Codes mit 10 Minuten Gültigkeit, gehasht gespeichert, Rate-Limit pro IP,
  Gerätetoken nur als SHA-256 auf der Platte, `devices.json` mit Modus 0600.
- **Lokaler Agent-Endpunkt.** `LocalAgentServer` bindet nur 127.0.0.1, prüft Host- und Origin-Header
  (Schutz vor DNS-Rebinding) und vergleicht Tokens in konstanter Zeit.
- **Git ohne Shell.** `GitService` übergibt Argumente immer als Array; `remoteWebUrl` entfernt
  Zugangsdaten aus Remote-URLs.
- **Markdown wird bereinigt.** Vault-Notizen und Chat-Ausgaben laufen durch DOMPurify.
- **Web-UI-Header.** Strikte CSP (ohne `unsafe-inline` für Skripte), `X-Frame-Options: DENY`,
  `nosniff`, `no-referrer`.
- **Lizenz-Entitlements** sind Ed25519-signiert; eine Lifetime-Lizenz funktioniert offline.
- **Tests.** 584 Unit-Tests, eine 100-%-Schwelle für Zeilen, Zweige, Funktionen und Anweisungen,
  dazu E2E-Tests mit Stellvertretern für Claude Code und die Messages API.
- **Doku.** README zweisprachig, Architekturdokument mit datierten Abweichungen, API-Referenz für
  die Mobile-App.

---

## 3. Sicherheitslücken

Die Schweregrade beziehen sich auf das Bedrohungsmodell der App. Ein lokaler Angreifer mit den Rechten
des Nutzers gilt als außerhalb des Modells. Wer ein gekoppeltes Gerät oder dessen Token besitzt, ist
dagegen ein relevanter Angreifer, denn genau dafür gibt es den Schalter „Remote shells“.

### 3.1 HOCH: Remote-Geräte umgehen „Remote shells aus“

**Voraussetzung:** Der Netzwerk-Server läuft (Desktop: Settings → *Run the API server*, oder Docker/Server),
ein Gerät ist gekoppelt (oder sein Token ist gestohlen), Remote-Shells sind **aus**.

**Lesen beliebiger Dateien.** Folgende Kanäle sind für Remote-Clients auf `'any'` gesetzt:

- `fs:dirs` (`contract.ts:249`) listet beliebige Ordner der Maschine,
- `projects:add` (`contract.ts:203`) registriert jeden beliebigen Ordner als Projekt, etwa `~` oder `~/.ssh`,
- `files:read` (`contract.ts:245`) liest danach jede Datei in diesem „Projekt“ (bis 5 MB).

Damit kann jedes gekoppelte Gerät z. B. `~/.ssh/id_ed25519`, `~/.aws/credentials` oder `.env`-Dateien lesen.

**Schreiben beliebiger Dateien und damit Code-Ausführung.** `files:write` ist korrekt auf `'terminal'`
beschränkt. Der Weg über den Assistenten ist es nicht:

1. `projects:add` mit `~` als Ordner,
2. `ai:send` (`'any'`, `contract.ts:263`) mit dem Auftrag, `~/.zshrc` zu schreiben. Das Tool
   `project_write_file` hat das Risiko `write`. Die Sperre `remoteShell()` in
   `AssistantService.execute()` greift nur bei `execute`,
3. `permission:respond` (`'any'`, `contract.ts:268`): Das Gerät genehmigt seine eigene Anfrage
   (oder setzt „Always allow“).

Die nächste Shell des Nutzers führt dann den eingeschleusten Code aus. Zusätzlich kann ein Remote-Gerät
`permission:respond` auch für **Bash-Anfragen einer Claude-Code-Sitzung** nutzen, die am Desktop
gestartet wurde. Freigaben vom Handy sind gewollt, sie sind aber faktisch Shell-Rechte.

**Vorschlag:**

- `projects:add`, `fs:dirs` und `memory:setVault` für Remote nur auf freigegebene Wurzeln erlauben
  (z. B. `~/Projects`, im Docker-Image `/projects`), konfigurierbar am Desktop. Home, Dotfolders und
  Systempfade grundsätzlich ablehnen.
- Remote-`files:read` auf Projekte beschränken, die **am Desktop** hinzugefügt wurden, oder eine
  Deny-Liste anwenden (`.ssh`, `.aws`, `.gnupg`, `.env*`, `*.pem`, `id_*`, Keychains).
- Schreib-Tools des Assistenten aus Remote-Sitzungen wie `execute` behandeln (also an `remoteTerminal`
  koppeln) oder auf den Vault beschränken.
- `permission:respond` für `risk: 'execute'` nur erlauben, wenn Remote-Shells an sind.
- Einen Test ergänzen, der genau diese Kette (add → send → respond) für Remote erwartet abzulehnen.

### 3.2 HOCH: Kein Navigationsschutz im Hauptfenster

`electron/main.ts` setzt nur `setWindowOpenHandler` (Zeile 92). Es fehlen ein `will-navigate`- und ein
`will-redirect`-Handler, und die IPC-Handler prüfen `event.senderFrame` nicht (`electron/ipc/registry.ts`).

Die Chat-Ausgabe der Agenten wird als HTML gerendert (`ChatThread.tsx:79`, `Markdown`) **ohne
Klick-Handler**. Ein normaler Link `[Doku](https://evil.example)` in einer Agenten-Antwort navigiert beim
Klick das Hauptfenster. Das Preload-Skript läuft auch auf der fremden Seite und stellt dort
`window.mindeck.invoke` bereit, mit allen Rechten des IPC-Transports (`terminal:create`, `terminal:write`,
`files:write` …). Der Link kann per Prompt-Injection entstehen (Web-Fetch, README eines fremden Repos,
Vault-Notiz aus einer Sync).

Die Vault-Vorschau (`NoteEditor.tsx:91`) fängt Klicks bereits korrekt ab. Der Chat tut das nicht.

**Vorschlag:**

```ts
// electron/main.ts – createWindow()
const allowed = (url: string) => (DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://'))
win.webContents.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); openSafe(url) } })
win.webContents.on('will-redirect', (e, url) => { if (!allowed(url)) e.preventDefault() })
win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
```

- In `registry.ts` jede Anfrage verwerfen, deren `event.senderFrame.url` nicht die eigene App ist.
- `setWindowOpenHandler` → `shell.openExternal` nur für `https:`, `http:` und `mailto:`
  (`openSafe`). Heute geht jede URL ungeprüft an das Betriebssystem (auch `file:`, `smb:`, eigene Schemes).
- Im Chat denselben Klick-Handler wie in der Notiz-Vorschau verwenden, oder per DOMPurify-Hook allen
  Links `target="_blank" rel="noopener noreferrer"` geben.

### 3.3 HOCH: Electron 37 ist ohne Sicherheitsupdates

Installiert ist `electron@37.10.3`, aktuell ist 44.x. Electron pflegt nur die drei neuesten Major-Versionen.
Chromium- und V8-Lücken werden für 37 nicht mehr geschlossen. Für eine App, die Markdown aus fremden
Quellen rendert und Agenten-Ausgaben anzeigt, ist das relevant.

**Vorschlag:** Auf eine unterstützte Version wechseln (die Notarisierungs-Thematik aus
`Mindeck_ARCHITECTURE.md` §1.1 betrifft 31.x, nicht neuere Versionen). Danach einen Renovate- oder
Dependabot-Job für Electron einrichten.

### 3.4 MITTEL: Klartext-HTTP im LAN, Token-Handling

- Der Server spricht nur HTTP (`HttpServer.ts`). Mit `lan: true` bzw. `MINDECK_BIND=0.0.0.0` gehen der
  Pairing-Code und danach jeder Bearer-Token unverschlüsselt durchs WLAN (Café, Hotel, Firmennetz).
- Der WebSocket übergibt den Token im Query-String (`/api/events?token=…`). So landet er in Proxy-,
  Zugriffs- und Browser-Logs.
- Die Web-UI speichert den Token in `localStorage` (`session/store.ts`). Die CSP macht XSS schwer, ein
  Token-Diebstahl hätte aber dauerhafte Wirkung, weil Tokens **nie ablaufen**.

**Vorschlag:** TLS anbieten (selbstsigniertes Zertifikat mit Fingerprint im QR-Code, oder in der Doku
Tailscale bzw. einen Reverse-Proxy mit HTTPS empfehlen). Den WS-Token nach dem Verbinden als erste
Nachricht schicken oder ein kurzlebiges WS-Ticket über `POST /api/rpc/…` ausstellen. Tokens nach
X Tagen Inaktivität ablaufen lassen, `lastSeenAt` gibt es bereits.

### 3.5 MITTEL: Kein Rollenmodell für Geräte

Remote-Geräte dürfen u. a. `server:createPairingCode`, `server:revokeDevice`, `ai:setKey`,
`ai:clearKey`, `cloud:login`, `cloud:logout` und `permission:revoke` aufrufen. Ein kompromittiertes
Handy kann so weitere Geräte koppeln (Persistenz), den Desktop-Besitzer aussperren oder den Core mit
einem anderen Cloud-Konto verbinden.

**Vorschlag:** Rollen pro Gerät, z. B. `viewer` (lesen und Freigaben ansehen), `operator` (Freigaben
erteilen, Assistent) und `admin` (Geräte, Keys, Konto). Admin-Kanäle standardmäßig nur `desktop`.
Beim headless Server bekommt das erste gekoppelte Gerät die Admin-Rolle.

### 3.6 MITTEL: CSP der Desktop-App erlaubt Inline-Skripte

`index.html` hat `script-src 'self' 'unsafe-inline'`. Die vom Server ausgelieferte CSP ist bereits
strenger (ohne `unsafe-inline`). Weil der Build denselben Renderer nutzt, sollte die strenge Variante auch
in Electron funktionieren. Zusätzlich `object-src 'none'`, `base-uri 'none'` und `frame-ancestors 'none'`
setzen.

### 3.7 MITTEL: „Always allow“ gilt global und ist für ACP-Agenten fehlerhaft

- Grants werden pro `agentId + toolName` gespeichert (`PermissionService`), nicht pro Projekt oder Pfad.
  Wer einmal „Always allow Write“ für Claude Code wählt, erlaubt das in **jedem** Projekt. Das
  Architekturdokument nennt „scoped permission grants“ als Ziel.
- Bei Codex und Gemini wird `toolName = call.title` verwendet (`AgentSessionService.ts:523`). ACP-Titel
  sind dynamisch (z. B. „Edit src/app.ts“). Ein Grant greift deshalb praktisch nie wieder, und
  `grants.json` wächst mit jedem „Always“. Siehe auch §4.2.

**Vorschlag:** Grants um `projectId` (optional `pathPrefix`) erweitern. Für ACP `call.kind`
(`edit`, `read`, …) als Schlüssel nehmen. In den Settings anzeigen, wofür ein Grant gilt.

### 3.8 MITTEL: Lizenzprüfung lässt sich per Umgebungsvariable abschalten

`server/main.ts:68` erzwingt die Lizenz nur, wenn `NODE_ENV === 'production'` gilt. Das Docker-Image setzt
den Wert zwar, `docker run -e NODE_ENV=development …` schaltet die Prüfung aber zur Laufzeit ab. Ohne
eingebauten `MINDECK_CLOUD_KEY` holt der Core den öffentlichen Schlüssel außerdem beim ersten Start aus der
Cloud (Trust on first use). Wer den Netzverkehr kontrolliert, kann dann eigene Entitlements signieren.

Da der Code öffentlich einsehbar ist, lässt sich ein Umgehen nie ganz verhindern. Die einfachen Wege
sollten aber verschlossen sein: Die Release-Entscheidung zur Build-Zeit festlegen (`define`, wie bei
der Desktop-App über `app.isPackaged`) und im Release-Build einen fehlenden Schlüssel als Build-Fehler
behandeln.

### 3.9 NIEDRIG

| Befund | Stelle | Vorschlag |
|---|---|---|
| `grants.json`, `sessions.json`, Transkripte und Unterhaltungen werden ohne `0600` geschrieben. Sie enthalten Prompts, Dateiinhalte und Tool-Ausgaben | `PermissionService.ts:110`, `AgentSessionService.persist`, `ConversationStore` | Überall `writeAtomic(…, 0o600)` nutzen und `~/Mindeck/data` mit `0700` anlegen |
| Ohne verfügbares `safeStorage` (z. B. Linux ohne Keyring) speichert der Core Secrets stillschweigend im Klartext | `electronCipher()` | In den Settings warnen und den Klartext-Modus bestätigen lassen |
| Codex-Adapter wird zur Laufzeit per `npx -y @zed-industries/codex-acp@0.16` geladen (Bereich `0.16.x`, kein Integritätscheck) | `acp.ts:15` | Exakte Version pinnen, optional mit der App ausliefern |
| Bearer-Token der Agent-Sitzung steht in den Prozess-Argumenten (`--settings`, `--mcp-config`) und ist per `ps` sichtbar | `claudeLaunch.ts` | Konfiguration als temporäre Datei mit `0600` übergeben |
| Fehlermeldungen (inkl. absoluter Pfade) gehen ungefiltert an Remote-Clients | `HttpServer.handle`, `Router.dispatch` | Für `remote` generische Meldungen, Details nur ins Log |
| `/api/health` verrät die Version ohne Authentifizierung | `HttpServer.ts` | Version erst nach dem Pairing zeigen |
| Rate-Limit über `socket.remoteAddress`: Hinter einem Reverse-Proxy teilen sich alle Clients eine IP | `HttpServer.pair` | `X-Forwarded-For` nur bei konfiguriertem Trusted Proxy auswerten |
| Kein globales Limit für gleichzeitige Verbindungen oder RPCs (8 MB Body pro Request) | `HttpServer.ts` | Einfaches Token-Bucket pro Gerät |
| macOS-Entitlements erlauben `disable-library-validation` und `allow-unsigned-executable-memory` | `build/entitlements.mac.plist` | Prüfen, ob node-pty (mit der App signiert) ohne `disable-library-validation` läuft, dann entfernen |
| DOMPurify-Version in `monaco-editor` ist laut `npm audit` verwundbar (2× low) | `node_modules/monaco-editor/node_modules/dompurify` | Monaco-Update abwarten oder `overrides` in `package.json` |
| MCP-Schreibtools laufen ohne eigene Mindeck-Freigabe und verlassen sich darauf, dass der Agent fragt. Mit `--dangerously-skip-permissions` in der Claude-Konfiguration des Nutzers greift Mindecks Gate nicht | `mcp.ts` | Schreibtools im MCP-Handler selbst über `PermissionService.ask` laufen lassen |
| Es gibt keine Blocklist für destruktive Befehle (`rm -rf /`, `git push --force`, `curl … \| sh`), wie sie im Masterplan §D.9 vorgesehen ist | `builtin.ts` (`shell_run`), Freigabe-UI | Heuristik plus deutliche Warnung in der Freigabekarte |

---

## 4. Bugs und Fehler

### 4.1 Eine beschädigte Transkript-Datei verhindert den Start (Mittel)

`AgentSessionService.init()` (Zeile 142):

```ts
const messages = JSON.parse(await readFile(this.file(r.session.id), 'utf8').catch(() => '[]'))
```

Ein `.catch` gibt es nur fürs Lesen, nicht fürs Parsen. Eine abgeschnittene oder von Hand editierte
`<id>.json` (volle Platte, Sync-Konflikt) wirft also. `createCore()` scheitert, und die App startet
nicht mehr. Die `sessions.json`-Liste ist bereits abgesichert, die einzelnen Transkripte sind es nicht.
**Fix:** `try/catch` pro Datei, bei Fehler `[]` verwenden und die Datei nach `*.corrupt` verschieben.

### 4.2 „Always allow“ greift bei Codex und Gemini nicht (Mittel)

Siehe §3.7: Grants werden unter dem dynamischen Titel gespeichert, deshalb wird der Nutzer immer wieder
gefragt, und `grants.json` füllt sich. **Fix:** stabilen Schlüssel (`kind`) verwenden und alte Einträge
migrieren.

### 4.3 Fenster schließen beendet auch Agent-Sitzungen und Remote-Shells (Mittel, UX)

`electron/main.ts:58` ruft beim Schließen des Fensters `terminal.killAll()` auf. Unter macOS läuft die App
weiter, aber alle PTYs sterben, auch die von Claude Code und die Shells, die ein gekoppeltes Handy gerade
nutzt. Nutzer erwarten unter macOS, dass ein geschlossenes Fenster nichts abbricht.
**Fix:** Nur Terminal-Tabs ohne Agent beenden (`kind !== 'agent'`), oder vorher fragen, wenn Agenten
laufen. Remote-Sitzungen nur beim Beenden der App schließen.

### 4.4 Unit-Tests laufen lokal nicht grün (Mittel)

`npx vitest run` am 2026-10-11 auf macOS: **5 von 584 Tests schlagen fehl.**

| Test | Ursache |
|---|---|
| `git.test.ts` „a branch and origin: pushed, landed …“ | Timeout (5 s) unter Last. Läuft isoliert grün |
| `agent-sessions.test.ts` (2 Tests zu eigenen Arbeitsordnern) | Timeout (5 s) unter Last. Läuft isoliert grün |
| `vault.test.ts` (Watcher-Test) | Zeitabhängig (`fs.watch` und Flush-Delay), flaky unter Last |
| `memory-editor.test.tsx` „header: … properties formatting“ | **Schlägt auch isoliert fehl.** Erwartet `1.1.2026, 12:00:00`, das Ergebnis hängt von Zeitzone und Locale der Maschine ab |

**Fix:** In `vitest.config.ts` `process.env.TZ = 'UTC'` und eine feste Locale setzen, das Datum im Test
mit `toLocaleString` berechnen. Für Git- und Worktree-Tests `testTimeout` erhöhen oder diese Dateien mit
`poolOptions.threads.singleThread` laufen lassen. Ohne das bleibt die 100-%-Schwelle lokal unzuverlässig.

### 4.5 Veraltete Reste nach dem Entfernen der Datenbank (Niedrig)

Commit `98c2616` hat Postgres und SQLite entfernt. Es sind aber Reste übrig:

- `.github/workflows/ci.yml:51` heißt noch „E2E (Electron + Docker DB …)“, und Zeile 78 führt bei
  Fehlern `docker compose logs db` aus. Den Dienst `db` gibt es nicht mehr, der Schritt scheitert also selbst.
- `server/main.ts:13` dokumentiert `MINDECK_DB_URL` (Postgres).
- `EventBus.ts:11` erwähnt „Postgres“, `paths.ts:61` „SQLite files“.
- `Mindeck_ARCHITECTURE.md` §2 zeigt im Diagramm noch `SQLite mindeck.db`, §1.2 verweist auf
  `registerServices()` in `main.ts` und `handle<K>()` in `registry.ts` (beides gibt es so nicht mehr),
  §1.1 nennt `userData/mindeck/` als Speicherort.
- `README.md:225–229` führt „Installer, Signierung, Auto-Update“ als „Noch nicht gebaut“, obwohl
  `electron-builder`, Notarisierung und `UpdateService` existieren.

### 4.6 Kleinere Fehler

- `ProjectService.requireProject` und `openFile` werfen `new Error(...)` ohne `code`. Clients bekommen
  dann `error` statt `not-found` oder `outside-project`, anders als in allen anderen Services.
- `PermissionService.respond` mit zwei parallelen „Always“ kann sich beim Lesen, Ändern und Schreiben
  von `grants.json` überschneiden, weil es keine Schreib-Queue gibt (`writeAtomic` würde das lösen).
- `AuthService` sammelt Pairing-Codes ohne Obergrenze. Ein Admin-Gerät (§3.5) könnte die Datei
  aufblähen. Auf z. B. 20 offene Codes begrenzen.
- `HttpServer.serveStatic` gibt bei kaputtem Percent-Encoding (`/%E0%A4%A`) einen 500 statt 400 zurück.

---

## 5. Code-Qualität und technische Schulden

| Thema | Befund | Vorschlag |
|---|---|---|
| **Linting/Formatierung** | Kein ESLint, kein Prettier. Trotzdem gibt es `eslint-disable`-Kommentare (`UpdateService.ts`) | ESLint mit `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-security`, Prettier und einen CI-Job |
| **Abhängigkeiten** | Viele Major-Versionen im Rückstand: Electron 37→44, Vite 5→8, electron-vite 2→5, React 18→19, Tailwind 3→4, Vitest 3→5, xterm 5→6, TypeScript 5.9→7 | Zuerst Electron (Sicherheit), dann Vite und electron-vite, danach React 19. Renovate mit Gruppierung einrichten |
| **Große Klassen** | `AgentSessionService` hat 719 Zeilen und vereint Claude-PTY, ACP, Worktrees, Journal, Freigaben und Persistenz | Aufteilen in `ClaudeRunner`, `AcpRunner`, `WorktreeManager`, `SessionStore` |
| **Duplikate** | `coded()` steht in ~12 Dateien, `AGENT_NAMES` dreimal. Atomares Schreiben ist viermal selbst gebaut (`AuthService`, `CloudService`, `PermissionService`, `AgentSessionService`), obwohl `writeAtomic` existiert | `lib/errors.ts`, eine Quelle für Agentennamen, überall `writeAtomic` |
| **Logging** | Nur `console.*`, im gepackten Build ohne Datei | Kleiner Logger mit Rotation unter `~/Mindeck/logs`, dazu „Diagnose exportieren“ in den Settings |
| **Crash-Reporting** | Keins (Main und Renderer) | Opt-in-Crash-Reports (z. B. Sentry, selbst gehostet möglich) |
| **CI/CD** | `cd.yml` testet nicht (Begründung: PRs sind getestet). Direkte Pushes auf `develop` landen ungetestet im Image. Die Desktop-Releases baut und signiert jemand lokal | Branch-Protection aktivieren, Release-Workflow auf einem macOS-Runner mit Secrets |
| **Plattformen** | `electron-builder.yml` kennt nur `mac`, der Code behandelt Windows aber bereits (PowerShell, `windowsHide`) | Windows- und Linux-Targets ergänzen (NSIS bzw. AppImage/deb), CI-Matrix |
| **100-%-Schwelle** | Sehr hohe Hürde, führt zu `v8 ignore` und Tests für Trivialcode | Beibehalten, wenn es zur Arbeitsweise passt. Sonst 95 % global und 100 % für `services/`, `ipc/`, `server/` |
| **Doku-Drift** | Siehe §4.5. `MASTERPLAN.md` ist abgelöst, liegt aber prominent in `docs/` | `MASTERPLAN.md` nach `docs/archive/` verschieben, ARCHITECTURE §1/§2 aktualisieren |
| **i18n** | Deutsch und Englisch (~650 Zeilen je Sprache), Typsicherheit gegeben. Fehlermeldungen aus dem Core sind meist englisch | Fehler-Codes im Client übersetzen (bei Cloud-Fehlern passiert das schon) |

---

## 6. Verbesserungsvorschläge (Produkt und UX)

### Onboarding und erster Eindruck

- **Einrichtungsassistent beim ersten Start:** Konto bzw. Trial, dann erkannte Agenten (`agents:detect`)
  mit einem Klick für `claude auth login`, dann das erste Projekt, dann ein Vault mit Starter-Notizen,
  dann optional das Handy koppeln. Heute muss man sich die Schritte über mehrere Module zusammensuchen.
- **Beispielprojekt und geführte Tour** (ca. 60 Sekunden): Agent starten, Freigabe erteilen, Diff ansehen,
  Journal in der Memory öffnen. Das ist der Aha-Moment, der verkauft.
- **Leere Zustände** mit einer klaren nächsten Aktion in jedem Modul.
- Die Boot-Sequenz ist schön, verzögert aber den Start. Ab dem zweiten Start standardmäßig überspringen
  oder deutlich verkürzen.

### Bedienung

- **Command-Palette (⌘K):** Projekt öffnen, Agent starten, Notiz suchen, Terminal öffnen, Setting finden.
  Bisher gibt es keine.
- **Globaler Hotkey / Quick-Ask** aus jeder App heraus (Spotlight-artig) an den Assistenten oder einen Agenten.
- **Freigaben mit Kontext:** Bei `Edit`/`Write` direkt einen Diff in der Karte zeigen, bei `Bash` den
  Befehl mit Risikomarkierung (destruktive Muster hervorheben, §3.9).
- **Freigaberegeln statt Einzelklicks:** z. B. „`npm test` in Projekt X immer erlauben“
  (Präfix-Regeln pro Projekt). Das senkt die Klickmüdigkeit, ohne `Bash` pauschal freizugeben.
- **Sitzungsübersicht als Kanban** (läuft, wartet auf mich, fertig, übernommen).
- **Kosten- und Kontingentanzeige** pro Sitzung (Tokens beim Assistenten, Plan-Limits bei Claude Code,
  soweit die CLI das liefert).
- **Benachrichtigungen aufs Handy** (Push) bei Freigaben, nicht nur Desktop-Notifications.
- **Barrierefreiheit:** Fokus-Reihenfolge, ARIA-Labels in den HUD-Komponenten, Kontrast im hellen
  Modus prüfen, Tastaturbedienung im Graph.

### Zuverlässigkeit

- **Backup und Export:** Ein Klick für „`~/Mindeck` als ZIP exportieren“, optional ein Git-Auto-Commit im Vault.
- **Wiederherstellung:** Beschädigte Dateien beim Start isolieren statt abzustürzen (§4.1). Gilt
  sinngemäß für alle JSON-Stores.
- **Update-Kanäle:** `beta` und `stable` (electron-updater unterstützt `channel`).

---

## 7. Erweiterungen (neue Features)

Nach Hebel für Kunden sortiert. Die Phasennummern beziehen sich auf `Mindeck_ARCHITECTURE.md` §12.2.

| Priorität | Feature | Warum |
|---|---|---|
| ★★★ | **Windows- und Linux-Builds** | Verdoppelt bis verdreifacht den adressierbaren Markt. Der Core ist bereits plattformneutral |
| ★★★ | **Mobile-App** (React Native, API existiert) | Freigaben und Status unterwegs. Starkes Demo- und Marketing-Feature |
| ★★★ | **Pull Request direkt aus dem Worktree** (`gh pr create`, Titel und Text aus dem Journal) | Schließt den Kreis „Agent arbeitet isoliert → PR“. `gh` wird schon für den PR-Status genutzt |
| ★★★ | **Aufgabe an mehrere Agenten parallel** (Claude vs. Codex vs. Gemini im Worktree), Ergebnisse vergleichen | Einzigartig, weil Mindeck die Agenten mehrerer Anbieter vereint |
| ★★☆ | **Ticket → Agent:** GitHub Issues, Linear, Jira als Quelle. Agent starten, Status zurückschreiben | Passt in Team-Workflows |
| ★★☆ | **Automations (P11):** geplante Agenten-Läufe (nächtlicher Dependency-Check, wöchentliche TODO-Auswertung) | Wiederkehrender Nutzen, Grund für ein Abo |
| ★★☆ | **Semantische Suche / Embeddings (P13)** im Vault, lokal (z. B. über einen lokalen Embedding-Server) | Stärkt das Gedächtnis-Versprechen |
| ★★☆ | **Gedächtnis-Pipeline (P5):** Entscheidungen und Learnings automatisch aus Journalen extrahieren, Duplikate zusammenführen | Macht den Vault mit der Zeit wertvoller |
| ★★☆ | **Weitere Assistenten-Provider:** OpenAI, lokale Modelle (Ollama/LM Studio) | Datenschutz-Kunden wollen „nichts verlässt den Rechner“ |
| ★★☆ | **Eigene MCP-Server** für den Assistenten und die Agenten (Datenbank, Browser, Kalender) | Erweiterbarkeit ohne eigenen Plugin-Store |
| ★☆☆ | **Git-UI:** Commit, Push, Branch wechseln, Konflikte auflösen | Weniger Kontextwechsel zu GitHub Desktop |
| ★☆☆ | **Team-Vault:** geteilte Notizen über Git oder Mindeck Cloud, Rechte pro Ordner | Grundlage für einen Team-Plan |
| ★☆☆ | **Audit-Export** (Freigaben, Befehle, geänderte Dateien) als PDF/JSON | Compliance-Argument für Firmen |
| ★☆☆ | **Playbooks/Vorlagen:** wiederverwendbare Aufträge mit Projekt-Kontext („Release vorbereiten“, „Security-Review“) | Schneller Einstieg, teilbar in der Community |
| ★☆☆ | **VS-Code-Erweiterung** als Brücke (Freigaben und Sitzungsstatus in der Statusleiste) | Erreicht Nutzer dort, wo sie arbeiten |

---

## 8. Kundengewinnung und Positionierung

### 8.1 Alleinstellungsmerkmale (so kommunizieren)

1. **„Bring your own agent.“** Kein zusätzliches KI-Abo: Mindeck nutzt das Claude-, Codex- oder
   Gemini-Konto, das der Kunde schon hat. Das senkt die Einstiegshürde und den Preisvergleich mit
   KI-Editoren deutlich.
2. **Ein Cockpit für alle Agenten.** Mehrere Anbieter, parallel und isoliert in Worktrees, mit Freigaben
   an einem Ort.
3. **Gemeinsames Gedächtnis über Anbieter hinweg.** Der nächste Agent (egal von wem) liest das Journal
   des letzten. Damit hebt sich Mindeck von reinen Agent-Runnern ab.
4. **Kontrolle statt Blackbox.** Jede Schreib- und Ausführungsaktion geht durch eine Freigabe, es gibt Diffs
   seit Sitzungsbeginn und Übernahme erst auf Knopfdruck.
5. **Local-first und DSGVO-freundlich.** Alle Daten sind lesbare Dateien unter `~/Mindeck`, der Vault ist
   Obsidian-kompatibel, es gibt keine Datenbank auf dem Rechner und keinen Lock-in. Entwicklung in Deutschland.
6. **Unterwegs dabei.** Freigaben und Status vom Handy (sobald die Mobile-App da ist).
7. **Qualitätsbeleg.** 100 % Testabdeckung, Quellcode zur Einsicht, signiert und notarisiert.

### 8.2 Zielgruppen

| Segment | Schmerz | Botschaft |
|---|---|---|
| Freelancer und Indie-Hacker | Viele Projekte, viele Terminals, Agenten gehen im Fenster-Chaos unter | „Alle Projekte und Agenten in einem Fenster, mit Gedächtnis“ |
| Agenturen und kleine Dev-Teams (5–30) | Mehrere Kundenprojekte parallel, Nachvollziehbarkeit | „Parallel arbeiten lassen, jede Änderung freigeben, Journal pro Projekt“ |
| Datenschutz-sensible Firmen (DACH, Mittelstand) | KI ja, aber kontrolliert und lokal | „Local-first, Freigaben, Audit, made in Germany“ |
| Power-User von Claude Code | Terminal-UI stößt bei mehreren Sitzungen an Grenzen | „Dein Claude Code, unverändert, aber mit Cockpit“ |

### 8.3 Kanäle und Maßnahmen

- **Demo-Video (60–90 s):** Drei Agenten starten, eine Freigabe vom Handy, Diff übernehmen, Journal öffnen.
  Auf Landingpage, X/LinkedIn, YouTube, Reddit (r/ClaudeAI, r/ChatGPTCoding, r/LocalLLaMA).
- **Launch:** Product Hunt, „Show HN“, dazu deutschsprachig heise Developer, t3n, Golem-Leserforen und
  Dev-Discords.
- **Content:** Erfahrungsberichte („Wie ich mit 3 parallelen Agenten ein Feature in 1 h baue“),
  Vergleiche als ehrliche Positionierung (Editor-Agenten vs. Terminal-Agenten vs. Agent-Cockpit, ohne
  ungeprüfte Behauptungen über Wettbewerber).
- **Community:** Discord oder GitHub Discussions, öffentliche Roadmap mit Voting.
- **Vertrauen:** Security-Seite mit Bedrohungsmodell und den behobenen Punkten aus §3, Datenschutzseite,
  Hinweis auf den einsehbaren Quellcode.
- **Empfehlungsprogramm:** zusätzliche Trial-Stunden oder Rabatt für Werber und Geworbene.
- **Bildung:** Rabatt für Studierende und Bootcamps (Multiplikatoren).

### 8.4 Preis und Monetarisierung

- Heute: 7 Stunden aktive Trial-Nutzung, danach **Lifetime**. Die nutzungsbasierte Trial ist fair und ein
  gutes Argument. Lifetime allein finanziert aber keine laufenden Cloud-Kosten (Konto, Lizenz-Heartbeat,
  künftig Push, Sync).
- **Vorschlag:**
  - **Personal Lifetime** (wie jetzt) mit 1 Jahr Updates, danach optionaler Update-Pass,
  - **Pro (Abo)** mit Cloud-Features: Push aufs Handy, Vault-Sync, Automations,
  - **Team (Abo pro Sitzplatz)** mit geteiltem Vault, zentraler Lizenzverwaltung, Audit-Export, Rollen.
- Launch-Rabatt (Early Bird) für die ersten N Kunden, um Feedback und Testimonials zu sammeln.
- **Messen:** Opt-in-Produktanalyse (Trial-Start → erster Agent → erste Freigabe → Kauf), damit sich
  der Funnel optimieren lässt. Sonst ist Wachstum Blindflug.

---

## 9. Was vor dem Launch noch fehlt

### Technik

- [ ] Befunde §3.1–§3.3 beheben (Remote-Zugriff, Navigationsschutz, Electron-Update)
- [ ] §4.1 und §4.4 beheben (Startabsturz bei kaputter Datei, rote Tests)
- [ ] Release-Pipeline in GitHub Actions (macOS-Runner: Build, Signierung, Notarisierung, Veröffentlichung)
- [ ] Branch-Protection für `main` und `develop`, CI als Pflicht-Check
- [ ] ESLint und Prettier in CI
- [ ] Logging in Datei, „Diagnose exportieren“, Opt-in-Crash-Reporting
- [ ] Monitoring und Backups für Mindeck Cloud (Lizenzserver = Single Point of Failure für Trials),
      Statusseite. Kulanzzeit, wenn die Cloud für Trial-Nutzer nicht erreichbar ist
- [ ] Windows-Build (mindestens als Beta)
- [ ] Changelog (`CHANGELOG.md`) und Versionierung nach SemVer, Release Notes im Update-Dialog

### Recht und Organisation (Deutschland/EU)

- [ ] **Impressum** und **Datenschutzerklärung** (Website und App: Cloud-Konto, Lizenz-Heartbeat,
      Gerätename und -ID, Stripe)
- [ ] **AGB/EULA** passend zur `LICENSE` (Source-available), mit **Widerrufsbelehrung** für digitale
      Inhalte (Zustimmung zum vorzeitigen Erlöschen beim Kauf)
- [ ] **AV-Vertrag** für Geschäftskunden (die Cloud verarbeitet personenbezogene Daten)
- [ ] **Drittanbieter-Lizenzhinweise** (`THIRD_PARTY_NOTICES`) für alle ausgelieferten Bibliotheken und
      Schriften (MIT, Apache-2.0, OFL bei Inter und JetBrains Mono) in App und Website
- [ ] Umsatzsteuer für digitale Leistungen in der EU (OSS-Verfahren, Stripe Tax)
- [ ] **Nutzungsbedingungen der Agenten-Anbieter** prüfen (Anthropic, OpenAI, Google): Ist das Steuern der
      offiziellen CLIs durch eine Drittanwendung mit Verbraucher-Abos zulässig, und wie dürfen deren Marken
      im Marketing genannt werden? Das Geschäftsmodell hängt an dieser Frage, deshalb früh klären.
- [ ] Markenrecherche bzw. -anmeldung „Mindeck“ (DPMA/EUIPO)

### Marketing und Support

- [ ] Landingpage mit Demo-Video, Screenshots, Preisen, FAQ und Download (`releases/latest/download/…`)
- [ ] Dokumentation für Endnutzer (Installation, erste Schritte, Handy koppeln, Sicherheit)
- [ ] Support-Kanal (E-Mail und Community) sowie In-App-Feedback
- [ ] Hinweis im README, dass der Quellcode zur Ansicht da ist und es fertige Builds auf der Website gibt
      (das README erklärt heute vor allem `npm run dev`, was die Lizenz ohne Lizenzschlüssel untersagt)

---

## 10. Priorisierte Roadmap

### P0: sofort (Sicherheit und Stabilität, ca. 1–2 Wochen)

1. Remote-Rechte härten (§3.1): Wurzel-Allowlist für `projects:add`, `fs:dirs` und `memory:setVault`,
   Remote-Schreibtools an `remoteTerminal` koppeln, `permission:respond` für `execute` absichern, Tests ergänzen.
2. Navigationsschutz und `senderFrame`-Prüfung (§3.2), Scheme-Allowlist für `openExternal`,
   Klick-Handler im Chat.
3. Electron auf eine unterstützte Version heben (§3.3).
4. Startabsturz bei beschädigter Transkript-Datei beheben (§4.1).
5. Tests deterministisch machen (TZ/Locale, Timeouts) (§4.4). Veraltete DB-Reste entfernen (§4.5).

### P1: vor dem Launch (ca. 3–6 Wochen)

6. Geräterollen (§3.5), Token-Ablauf, WS-Ticket statt Query-Token (§3.4), Doku zu TLS bzw. Tailscale.
7. Grants pro Projekt und ACP-Grant-Fix (§3.7, §4.2). Dateirechte `0600`/`0700` (§3.9).
8. Lizenz-Enforcement zur Build-Zeit festlegen (§3.8).
9. ESLint/Prettier, Logging, Crash-Reporting, Release-Pipeline in CI, Branch-Protection.
10. Onboarding-Assistent, Command-Palette, Diff in Freigabekarten.
11. Rechtliches und Landingpage (§9).

### P2: nach dem Launch (Wachstum)

12. Windows- und Linux-Builds.
13. Mobile-App mit Push-Freigaben.
14. PR aus dem Worktree, Multi-Agent-Vergleich.
15. Automations (P11), Embeddings (P13), Gedächtnis-Pipeline (P5).
16. Team-Plan: geteilter Vault, Rollen, Audit-Export.
17. Abhängigkeits-Upgrades (React 19, Vite 8, Tailwind 4), `AgentSessionService` aufteilen.

---

*Erstellt mit statischer Analyse des Repos, `npm audit --omit=dev`, `npm outdated`, `npm run typecheck`
(grün) und `npx vitest run` (579/584 grün, siehe §4.4) am 2026-10-11. Die Befunde in §3 sind aus dem Code
abgeleitet und nicht gegen eine laufende Instanz ausgenutzt worden. Vor der Behebung sollte sie jeweils
ein Test nachstellen.*
