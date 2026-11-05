# Native CLI releases (D-027)

The `codeceipt` CLI ships as one self-contained executable per platform (built with `bun build --compile`, no
Node.js needed). This page lists what a human has to set up once, and what to do for each release.

Targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`,
`windows-x64` (files `codeceipt-<target>`, `.exe` on Windows).

## How the trust chain works

1. A tag `cli-v<version>` runs `.github/workflows/release-cli.yml`. It builds every target, smoke-tests each one on
   its own runner, signs and notarises where the secrets exist, and hands the files to the publish job (the build
   jobs cannot write to the release).
2. The publish job (the only one that can write to the release or read the signing key) uploads the files, writes
   `manifest.json` (version, and the SHA-256 and size of every file) and `SHA256SUMS`, signs
   the manifest with the Ed25519 release key (`manifest.json.sig`), uploads them and publishes the release.
3. The binary's self-updater downloads `manifest.json` and `.sig` from the latest release over HTTPS, accepts it only
   when the signature matches the public key compiled into the binary (`packages/cli/src/native/release-key.ts`) and
   the version is newer, then downloads its own file, checks SHA-256 and size, runs `--version` on it and swaps it in.
4. The website installers (`/install.sh`, `/install.ps1`) do not trust GitHub alone: they pin one version and every
   file's SHA-256 from `apps/web/src/lib/cli-release.json`, which only changes through a reviewed PR.

## One-time setup (human)

### 1. Release signing key (required)

```bash
node packages/cli/scripts/release-keys.mjs
```

It writes the private key to a file only you can read and prints the public key.

- Put the public key (base64) in `packages/cli/src/native/release-key.ts` (`RELEASE_PUBLIC_KEY`) through a PR.
  Without it the binaries never update themselves (they report that updates are not set up).
- Create a GitHub Environment named `release` (Settings → Environments): deployment branches and tags "Selected"
  with only the tag pattern `cli-v*`, and yourself as a required reviewer. Add the private key (the whole PEM text)
  as the **environment** secret `CODECEIPT_RELEASE_SIGNING_KEY` there, not as a repository secret: then a workflow
  pushed on any other branch cannot read it. Delete the local file, or keep it offline.
- Protect the `cli-v*` tags with a tag ruleset (Settings → Rules → Rulesets: target tags `cli-v*`, restrict
  creation, update and deletion to yourself), so only you can start a release.
- Only the `publish` job uses the `release` environment; the build jobs have read-only access and hand their files
  over as workflow artifacts, so nothing they install can change the release before it is signed.
- The release fails when the secret is missing (the manifest cannot be signed), and waits for your approval of the
  `release` environment before signing anything.

### 2. macOS signing and notarisation (optional, recommended)

Needs a paid Apple Developer Program membership (99 USD a year) and a "Developer ID Application" certificate.

| Secret | What |
| --- | --- |
| `APPLE_CERT_P12` | The Developer ID Application certificate and key, exported as .p12, base64 |
| `APPLE_CERT_PASSWORD` | The .p12 password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | The Apple ID email used for notarisation |
| `APPLE_TEAM_ID` | The 10-character team id |
| `APPLE_APP_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com) |

Without them the macOS files are still published (ad-hoc signed by Bun), and installing with `install.sh` works
because `curl` does not set the quarantine flag; a file downloaded in a browser would be blocked by Gatekeeper.

### 3. Windows signing (optional, recommended)

Needs a code-signing certificate from a CA (OV or EV; EV certificates on hardware tokens need a cloud signing
service instead, see later.md).

| Secret | What |
| --- | --- |
| `WINDOWS_CERT_PFX` | The certificate and key as .pfx, base64 |
| `WINDOWS_CERT_PASSWORD` | The .pfx password |

Without them the .exe is unsigned and SmartScreen may warn the first time.

### 4. Add the workflow (human-owned file)

The workflow is kept at `docs/native-release/release-cli.yml` because workflow files are protected. Copy it into
place and commit it yourself with the guard override:

```bash
cp docs/native-release/release-cli.yml .github/workflows/release-cli.yml
```

```bash
git add .github/workflows/release-cli.yml
```

Then commit with the override variable set for that one command (see AGENTS.md: human-only), and push.

## Each release

1. Bump the version in both places `docs/publishing.md` lists (`packages/cli/package.json` and `CLI_VERSION` in
   `packages/cli/src/templates.ts`) through a PR, and merge it.
2. Tag the merge commit and push the tag:

   ```bash
   git tag cli-v0.3.1
   ```

   ```bash
   git push origin cli-v0.3.1
   ```

3. When the workflow finishes, its summary shows the JSON for `apps/web/src/lib/cli-release.json` (the version and
   each file's SHA-256). Open a PR with that file; once it merges and deploys, `install.sh` and `install.ps1` install
   that version, and the landing page and quickstart switch to the one-line installers.
4. Already-installed binaries pick up the release within a day (or now with `codeceipt update`).

## Local build

```bash
pnpm -C packages/cli build:native
```

builds every target into `packages/cli/dist-native/` (gitignored), with `manifest.json` and `SHA256SUMS`.
`node packages/cli/scripts/smoke-native.mjs packages/cli/dist-native/codeceipt-linux-x64` checks one file.

## Coming soon

Homebrew (a tap with a formula that pins the same SHA-256) and winget (a manifest PR to microsoft/winget-pkgs) are
listed as "coming soon" on the site until they are published.
