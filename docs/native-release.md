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
5. After the GitHub release is published, the `publish-npm` job publishes the same version as the npm package
   `codeceipt` (`npx codeceipt`, and the hooks' fallback `npx -y codeceipt@<version>`). It uses npm trusted publishing:
   npm accepts a short-lived OIDC token only from this repository, `release-cli.yml` and the `release` environment, so
   no npm token is stored anywhere. npm attaches a provenance attestation that links the package to this workflow
   run. The package itself is built by `build-npm`, which has read-only access; `publish-npm` installs nothing.

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

### 4. Add or update the workflow (human-owned file)

The workflow is kept at `docs/native-release/release-cli.yml` because workflow files are protected. Agents change
that copy through a PR; you copy it into `.github/workflows/release-cli.yml` yourself.

**From the GitHub website** (after the PR that changed the copy is merged):

1. Open the repository on github.com, make sure the branch selector (top left) says `main`, and open
   `docs/native-release/release-cli.yml`.
2. Click the **Copy raw file** button (the two-squares icon in the bar above the file, next to **Raw**).
3. Go back to the repository's main page and open `.github/workflows/release-cli.yml`.
4. Click the pencil icon (**Edit this file**). Click inside the editor, press Ctrl+A (Cmd+A on a Mac), then Ctrl+V
   (Cmd+V), so the whole file is replaced by what you copied.
5. Click **Commit changes...** (top right). Message: `ci: release-cli publishes to npm (trusted publishing)`.
   Choose **Commit directly to the main branch** and click **Commit changes**.
6. Check: open the **Actions** tab. The `verify` run for that commit must turn green (it lints the workflows with
   zizmor). Pushing to `main` does not start a release; only a `cli-v*` tag does.

**From a terminal** (instead of the website):

```bash
cp docs/native-release/release-cli.yml .github/workflows/release-cli.yml
```

```bash
git add .github/workflows/release-cli.yml
```

Then commit with the override variable set for that one command (see AGENTS.md: human-only), and push.

### 5. npm trusted publishing (required for the npm package)

The `publish-npm` job has no npm token; npm must be told to trust this workflow. The package `codeceipt` already
exists on npm (0.1.2 is published), so this is a setting on it. Do this shortly before you push the next
`cli-v*` tag: npm drops a new trusted publisher that has not published within 2 days.

1. Sign in at https://www.npmjs.com as the owner of `codeceipt`.
2. Open https://www.npmjs.com/package/codeceipt and click **Settings** (or: your avatar → **Packages** →
   `codeceipt` → **Settings**).
3. In the **Trusted publishing** section click **Add trusted publisher**, then under **Select your publisher**
   click **GitHub Actions**.
4. Fill in exactly (these are case-sensitive and cannot be edited later; to change one, delete it and add it again):

   | Field | Value |
   | --- | --- |
   | Organization or user | `jabez-abija2399` |
   | Repository | `project-brain` |
   | Workflow filename | `release-cli.yml` (the file name only, not `.github/workflows/...`) |
   | Environment name | `release` |

5. Under **Allowed actions**, tick direct **npm publish** (new trusted publishers allow only `npm stage publish` by
   default; the workflow runs `npm publish`). Leave **Allow npm dist-tag** off.
6. Save. npm does not test the setting when you save it; a mistake shows up only as a failed `publish-npm` job
   (`404` or `ENEEDAUTH` / "OIDC token exchange failed"). Compare the four values above if that happens.
7. After the first release has published to npm from the workflow, lock the package to it: package **Settings** →
   **Publishing access** → select **Require two-factor authentication and disallow tokens** → **Update Package
   Settings**. Trusted publishing keeps working; any old npm access token can no longer publish. Then delete
   unused tokens at your avatar → **Access Tokens**.
8. Check the provenance: https://www.npmjs.com/package/codeceipt shows a **Provenance** section ("Built and signed
   on GitHub Actions") linking to the workflow run. It appears only because the repository and the package are
   public; the job fails rather than publish without it.

## Each release

1. Bump the version in both places `docs/publishing.md` lists (`packages/cli/package.json` and `CLI_VERSION` in
   `packages/cli/src/templates.ts`) through a PR, and merge it.
2. Tag the merge commit and push the tag:

   ```bash
   git tag cli-v0.3.4
   ```

   ```bash
   git push origin cli-v0.3.4
   ```

3. Approve the `release` environment when the workflow asks (**Review deployments** → tick `release` → **Approve
   and deploy**). It asks twice: once for `publish` (GitHub release and signed manifest) and, after that finishes,
   once for `publish-npm` (npm). Each approval runs only that job.
4. When the workflow finishes, its summary shows the JSON for `apps/web/src/lib/cli-release.json` (the version and
   each file's SHA-256). Open a PR with that file; once it merges and deploys, `install.sh` and `install.ps1` install
   that version, and the landing page and quickstart switch to the one-line installers.
5. Check npm: `npm view codeceipt version` shows the new version (the `publish-npm` summary links it). If the
   version was already on npm (for example published by hand), the job notes that and publishes nothing.
6. Already-installed binaries pick up the release within a day (or now with `codeceipt update`).

## Local build

```bash
pnpm -C packages/cli build:native
```

builds every target into `packages/cli/dist-native/` (gitignored), with `manifest.json` and `SHA256SUMS`.
`node packages/cli/scripts/smoke-native.mjs packages/cli/dist-native/codeceipt-linux-x64` checks one file.

## Coming soon

Homebrew (a tap with a formula that pins the same SHA-256) and winget (a manifest PR to microsoft/winget-pkgs) are
listed as "coming soon" on the site until they are published.
