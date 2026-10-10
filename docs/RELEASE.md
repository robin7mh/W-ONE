# Releasing the desktop app

`npm run dist:mac` builds **W-ONE-arm64.dmg** (Apple silicon) and **W-ONE-x64.dmg** (Intel) plus the ZIPs the auto-updater uses, into `release/`. Configuration: [`electron-builder.yml`](../electron-builder.yml).

A build without the steps below runs on the machine that built it, but macOS blocks it on everyone else's ("damaged / can't be opened"). For customers it must be **signed and notarized**.

## One-time setup

1. **Apple Developer Program** (99 $/year, approval can take 1–2 days): <https://developer.apple.com/programs/enroll/>
2. **Certificate:** in Xcode → Settings → Accounts → *Manage Certificates* → `+` → **Developer ID Application**. Export it from the Keychain as `.p12` with a password.
3. **Notarization key:** App Store Connect → Users and Access → Integrations → *App Store Connect API* → new key with *Developer* access. Download the `.p8` (only once!), note the **Key ID** and the **Issuer ID**.
4. **GitHub token** with `repo` scope (publishes the release the updater reads).

## Each release

1. Bump `version` in `package.json` (e.g. `0.1.0` → `1.0.0` for the launch) and commit.
2. Get the cloud's public key: `curl -s https://api.<domain>/v1/meta | jq -r .entitlementPublicKey`
3. Build, sign, notarize and publish:

```bash
export WONE_CLOUD_URL=https://api.<domain>
export WONE_CLOUD_KEY="$(curl -s https://api.<domain>/v1/meta | jq -r .entitlementPublicKey)"
export CSC_LINK=/path/to/developer-id.p12        # or the file base64-encoded
export CSC_KEY_PASSWORD=…
export APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export GH_TOKEN=…
npm run release:mac
```

This creates a GitHub release with the DMGs, ZIPs and `latest-mac.yml`. Installed apps find it within four hours (or via Profile → *Check for updates*) and offer *Restart & update*.

4. Check once on a second Mac (or a fresh user account): download the DMG from the website, open it — no Gatekeeper warning — and sign in.

## What the build bakes in

- `WONE_CLOUD_URL` / `WONE_CLOUD_KEY` → where the app checks the license, and the key it verifies entitlements with. A packaged app always enforces the license and ignores these variables at runtime.
- The download links on the website point to `releases/latest/download/W-ONE-arm64.dmg` and `…-x64.dmg`; those names stay the same for every release.

## Local test build (unsigned)

```bash
WONE_CLOUD_URL=http://localhost:8080 CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac -- -c.mac.identity=null
```
