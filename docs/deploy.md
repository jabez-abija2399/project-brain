# Deploying Codeceipt to production

This runbook takes you from nothing to a working production site: Vercel hosts the app (`apps/web`) and Neon
hosts the database. Do the steps in order. Wherever you see `https://YOUR-DOMAIN`, use your real address with no
slash at the end, for example `https://codeceipt.vercel.app`.

What you need first: accounts at vercel.com, neon.tech, github.com, console.anthropic.com and inngest.com. On your
laptop you need this repository, Node 20 or newer, and pnpm (`npm install -g pnpm`), then run `pnpm install` once in
the repository folder.

Never paste a secret into a chat, an issue, a commit or a screenshot. Each value goes in exactly two places: Vercel's
Environment Variables page, and (for the GitHub webhook secret only) the GitHub App settings.

## 1. Create the production database (Neon)

1. In the Neon console, click **New project**. Name it `codeceipt` and pick the region closest to your Vercel region
   (for example AWS US East for Vercel's default `iad1`).
2. Neon creates a branch called `main`. That is production. Your development database stays on its own `dev`
   branch or project, so production data never mixes with test data.
3. Open **Connect** on the `main` branch. You need two connection strings:
   - **Pooled** (the host name contains `-pooler`): this is `DATABASE_URL` for Vercel.
   - **Direct** (turn the "Connection pooling" switch off): use this one only to run migrations from your laptop.

   Both end in `?sslmode=require`. Keep them somewhere safe, such as a password manager.

## 2. Create the tables (migrations, from your laptop)

Run this one command in the repository folder, with the **direct** connection string from step 1.3:

```bash
DATABASE_URL="postgresql://...direct connection string..." pnpm --filter @brain/db migrate
```

It prints `applied N migration(s): ...` the first time and `no new migrations to apply.` afterwards. It is safe to run
again. Run it again before each deploy that adds a file to `packages/db/migrations`.

Tip: start the command with a space, so most shells keep it out of your history.

## 3. Create the GitHub OAuth app (sign-in)

This is what "Sign in with GitHub" uses.

1. GitHub > **Settings** > **Developer settings** > **OAuth Apps** > **New OAuth App**.
2. Fill in:
   - Application name: `Codeceipt`
   - Homepage URL: `https://YOUR-DOMAIN`
   - Authorization callback URL: `https://YOUR-DOMAIN/api/auth/callback/github`
3. Click **Register application**, then **Generate a new client secret**.
4. Note the **Client ID** (`GITHUB_CLIENT_ID`) and the secret (`GITHUB_CLIENT_SECRET`). GitHub shows the secret only once.

## 4. Create the GitHub App (repository access and push webhooks)

This lets users connect a repository so every push is re-indexed.

1. GitHub > **Settings** > **Developer settings** > **GitHub Apps** > **New GitHub App**.
2. Basic information:
   - GitHub App name: `Codeceipt` (or `codeceipt-yourname` if the name is taken). The URL name GitHub shows afterwards,
     `github.com/apps/<slug>`, is `GITHUB_APP_SLUG`.
   - Homepage URL: `https://YOUR-DOMAIN`
3. Identifying and authorizing users:
   - Callback URL: `https://YOUR-DOMAIN/api/github/callback`
   - Turn on **Request user authorization (OAuth) during installation**.
4. Post installation:
   - Setup URL: `https://YOUR-DOMAIN/api/github/callback` (GitHub may grey this field out once step 3's switch is on;
     the callback URL is then used, which is the same address).
5. Webhook:
   - Turn on **Active**.
   - Webhook URL: `https://YOUR-DOMAIN/api/github/webhook`
   - Webhook secret: make one with `openssl rand -hex 32`. This is `GITHUB_WEBHOOK_SECRET`; paste the same value into
     Vercel in step 7.
6. Permissions > Repository permissions:
   - **Contents: Read-only** (to read the files a push changed)
   - **Metadata: Read-only** (GitHub requires it)

   Leave everything else at **No access**.
7. Subscribe to events: **Push**. (Installation events are always sent to the app; you don't tick anything for them.)
8. Where can this GitHub App be installed: **Any account**, so your users can install it.
9. Click **Create GitHub App**. On the app's page, note:
   - **App ID**: `GITHUB_APP_ID`
   - **Client ID**: `GITHUB_APP_CLIENT_ID`
   - **Generate a new client secret**: `GITHUB_APP_CLIENT_SECRET`
10. Scroll to **Private keys** > **Generate a private key**. A `.pem` file downloads. Its whole contents are
    `GITHUB_APP_PRIVATE_KEY`. Paste it into Vercel as is, with its real line breaks. The one-line form with `\n` in
    place of each line break also works.

## 5. Get the AI key (Anthropic)

1. console.anthropic.com > **API keys** > **Create key**, named `codeceipt-production`.
2. The key is `ANTHROPIC_API_KEY`. Set a monthly spend limit under **Billing** too. Codeceipt also caps AI calls per
   project per day (2,000 by default; see `AI_CALLS_PER_PROJECT_PER_DAY` below).

## 6. Create the Vercel project

1. vercel.com > **Add New** > **Project** > import this GitHub repository.
2. Settings on the import screen:
   - **Root Directory**: `apps/web`. Leave **Include files outside the root directory** on (the default); the app uses
     the shared packages in `packages/`.
   - **Framework Preset**: Next.js (detected).
   - **Install Command** and **Build Command**: leave the defaults. Vercel finds `pnpm-lock.yaml` at the repository
     root, installs the whole pnpm workspace, and builds with `next build`. This is the same as
     `pnpm --filter @brain/web build` on your laptop.
   - **Node.js version** (Settings > General): 22.x.
3. Don't deploy yet: add the environment variables first (step 7). If Vercel already started a deploy, let it fail;
   you redeploy in step 9.
4. Note the address Vercel gives the project (Settings > Domains), or add your own domain there. That address is
   `YOUR-DOMAIN`. If it differs from what you used in steps 3 and 4, update those URLs on GitHub.

## 7. Environment variables (Vercel > Project > Settings > Environment Variables)

Add each variable for the **Production** environment. Add them for **Preview** too only if you point Preview at a
separate Neon branch: never let a preview deploy write to the production database.

Required. In production the app refuses to start without them and logs one line naming what is missing, never a value:

| Variable | Value | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string | Step 1.3 |
| `BETTER_AUTH_SECRET` | a long random string | Run `openssl rand -base64 32` once and keep it. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | `https://YOUR-DOMAIN` | Step 6.4 (https, no trailing slash) |
| `GITHUB_CLIENT_ID` | OAuth app client ID | Step 3.4 |
| `GITHUB_CLIENT_SECRET` | OAuth app client secret | Step 3.4 |
| `GITHUB_APP_ID` | GitHub App ID (a number) | Step 4.9 |
| `GITHUB_APP_PRIVATE_KEY` | the whole `.pem` file | Step 4.10 (real newlines or `\n`) |
| `GITHUB_WEBHOOK_SECRET` | the webhook secret | Step 4.5 (same value on GitHub and Vercel) |
| `ANTHROPIC_API_KEY` | Anthropic API key | Step 5 |
| `INNGEST_EVENT_KEY` | Inngest event key | Step 8 |
| `INNGEST_SIGNING_KEY` | Inngest signing key | Step 8 |

Needed for the GitHub App install flow. Without them the app still starts, but `/api/health` reports
`githubApp: false` and the startup log names them:

| Variable | Value | Where it comes from |
| --- | --- | --- |
| `GITHUB_APP_SLUG` | the app's URL name | Step 4.2 (`github.com/apps/<slug>`) |
| `GITHUB_APP_CLIENT_ID` | GitHub App client ID | Step 4.9 |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App client secret | Step 4.9 |

Optional limits (leave empty for the defaults):

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_CALLS_PER_PROJECT_PER_DAY` | 2000 | AI calls per project per UTC day |
| `INDEX_MAX_FILES_PER_PROJECT` | 10000 | stored files per project |
| `INDEX_MAX_SYMBOLS_PER_PROJECT` | 100000 | stored symbols per project |

Optional owner access:

| Variable | Value | Meaning |
| --- | --- | --- |
| `ADMIN_GITHUB_LOGINS` | e.g. `your-login` (comma separated) | who may open `/admin/waitlist`, the landing page's beta emails. Empty: nobody. |

Not for Vercel: `CODECEIPT_API_URL` and `CODECEIPT_TOKEN` belong to the CLI on a user's own machine.

## 8. Connect Inngest (background jobs)

Pushes are indexed by an Inngest job that Inngest calls at `https://YOUR-DOMAIN/api/inngest`.

1. Easiest: Vercel > **Integrations** > **Inngest** > **Add**, and choose this project. The integration adds
   `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to the project for you and syncs the app after each deploy.
2. Without the integration: in Inngest, open **Manage** > **Event Keys** > **Create**, and copy the key into Vercel as
   `INNGEST_EVENT_KEY`. Then copy **Manage** > **Signing Key** into Vercel as `INNGEST_SIGNING_KEY`. After the first
   deploy, go to **Apps** > **Sync new app** and enter `https://YOUR-DOMAIN/api/inngest`.
3. The app shows up in Inngest under the id `project-brain`. That internal id was kept on purpose (D-019); renaming it
   would register the jobs as a new app.

## 9. Deploy

1. Vercel > **Deployments** > **Redeploy** (or push to `main`).
2. If the deploy succeeds but every page fails, open the deployment's **Logs**. A line starting with
   `Codeceipt cannot start:` names each missing or malformed variable. Fix them in step 7, then redeploy.

## 10. Post-deploy checklist

Tick each one off:

1. **Health:** open `https://YOUR-DOMAIN/api/health`. Expected:
   `{"ok":true,"db":true,"services":{"githubApp":true,"inngest":true,"ai":true}}`. `db:false` means `DATABASE_URL` or
   Neon is wrong; any service `false` means its variables are missing.
2. **Landing page:** `https://YOUR-DOMAIN` shows the Codeceipt landing page when you are signed out.
3. **Sign-in:** click **Sign in**, approve on GitHub, and you land on **Projects**. A GitHub error page here means the
   callback URL from step 3 doesn't match exactly.
4. **Project and token:** create a project, open its **Tokens** tab, and create a token. Copy it right away; it is shown
   once and stored only as a hash.
5. **CLI login.** Until the `codeceipt` npm package is published, build the CLI from this repository with
   `pnpm --filter @brain/cli build` and run it as `node packages/cli/dist/codeceipt.mjs`. Once published, the same
   commands work as `npx codeceipt ...`. In the folder of an app you want to track:
   ```bash
   node /path/to/repo/packages/cli/dist/codeceipt.mjs login --api-url https://YOUR-DOMAIN
   ```
   Paste the token when asked. Expected output: `Logged in as project <id>`.
6. **Index:** in the same folder, run `codeceipt index`. It reports the files and components it found; the project's
   **Features** tab now shows them.
7. **Init:** run `codeceipt init`. It reports what it set up for Claude Code and Cursor. Start a Claude Code session in
   that folder: the session-start hook shows the handoff note.
8. **GitHub App:** while signed in, open `https://YOUR-DOMAIN/api/github/install?projectId=PROJECT-ID`. The project id
   is the last part of the project's address, `/projects/PROJECT-ID`. (There is no dashboard button for this yet.)
   Install the app on one repository, choose it on the page that follows, then push a small change. Within a minute,
   Inngest shows a successful `index-push` run and the project's files update.
9. **Receipt:** end an agent session after changing a file. A receipt appears on the **Receipts** tab.

## Updating later

- **Code changes:** merge to `main`; Vercel deploys automatically.
- **Changes that add a migration:** run step 2 against production **before** merging.
- **Rotating a secret:** change it in Vercel and, for the webhook secret, in the GitHub App too, then redeploy.
  Rotating `BETTER_AUTH_SECRET` signs every user out.
