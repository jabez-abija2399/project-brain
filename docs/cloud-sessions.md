# Codeceipt in Claude Code on the web (cloud sessions)

Claude Code on the web (claude.ai/code and the Claude app) runs each session in a fresh cloud copy of your
repository. The repository's own `.claude/settings.json` hooks run there, but the login on your computer does not
exist there, so Codeceipt needs a key in the cloud environment instead.

## What works where

| Where you build | How Codeceipt sees it |
| --- | --- |
| Claude Code, Cursor, Codex on your computer | `npx codeceipt` once per repository; receipts after every session |
| Claude Code on the web | the steps below (CLI 0.3.11 or later; 0.3.12 recommended); receipts after every session |
| Lovable, Bolt, Replit, anything that pushes to GitHub | Connect GitHub on the project's Connect tab; receipts on push and, if turned on, on pull requests |

## Set it up (works from a phone)

1. **Hooks in the repository.** Run `npx codeceipt` once in the repository on any computer (or in a local Claude Code
   session) and commit the `.claude` folder it writes. The hooks fall back to `npx -y codeceipt@<version>`, so nothing
   has to be installed in the cloud.
2. **A key.** In Codeceipt, open the project, **Tokens** tab, **Create token**, copy it.
3. **The cloud environment.** In Claude Code on the web, open the environment's settings and add two environment
   variables:
   - `CODECEIPT_TOKEN` = the token from step 2
   - `CODECEIPT_PROJECT_ID` = the project id (shown on the project's **Connect** tab)
4. **Network.** If the environment's network access is limited, allow `codeceipts.vercel.app` and
   `registry.npmjs.org`.
5. Optional, faster hooks: add `npm install -g codeceipt` to the environment's **setup script**.
6. Start a session, ask for a change, and open the project's **Receipts** tab when it ends. If a session says the
   Codeceipt tools are missing, start a new one: tools load only when a session starts.

`codeceipt doctor` in a cloud session (0.3.12 or later) says "Using the project key from this environment" and treats
running through npx as normal. `codeceipt init --claude` also writes `CLAUDE.md` with `@AGENTS.md`, so Claude Code
reads the Codeceipt section.

## Safety

- The key is used only when the repository has no saved login (a login on your computer always wins), and only for
  the project id next to it.
- The key is only ever sent to `https://codeceipts.vercel.app`. `CODECEIPT_API_URL` is ignored for it, because a
  repository's own settings can set environment variables for the agent; a repository can never redirect the key.
- The repository fingerprint still goes with every upload, so a key used in a different repository is refused.
- Malformed values (spaces, line breaks, an odd project id) are ignored. The key is never printed or logged.
- Anyone who can edit the cloud environment can read the key. Revoke it on the Tokens tab if it leaks.
- **Every command that runs in that environment can read the key**: the agent itself, and the hooks and tools of
  whichever repository is open. Use one environment per repository, a token made only for it, and open only
  repositories you trust in that environment.
- A project adopts the first repository that uploads to it. Connect the project from your computer first, or start
  the first cloud session in the right repository.

Not available in cloud sessions: the pre-edit boundary check (it needs a cached list on your computer); `codeceipt
guard` and the review commands still work when you run them.
