# codeceipt

A receipt for every AI change. Codeceipt remembers your app across every Claude Code and Cursor session and checks
each change against what you asked for.

## Set up

In your app's folder (a git repository), run:

```bash
npx codeceipt
```

1. Your browser opens a page with the same short code as your terminal. Sign in with GitHub.
2. Pick a project, or create one, and approve.
3. Codeceipt links this repo to the project, indexes your code on your machine and sets up Claude Code and Cursor,
   then prints a short summary.

Your agents run the `codeceipt` command, so install it once if the summary asks you to:

```bash
npm install -g codeceipt
```

No token or environment variable to set: the agents get the project's token from Codeceipt's own config on your
computer, and only for the server that issued it. Each repository has its own project.

## What leaves your machine

Your source code never does. Codeceipt uploads file paths, hashes, component and function names, and short
summaries; secrets found in your code are masked (first 4 characters + `***`). The project link is stored in
`.git/codeceipt/project.json` (never committed); the token stays in your user config folder.

## Commands

| Command | What it does |
| --- | --- |
| `codeceipt` | Connects this repo (browser approval), indexes it and sets up the agents |
| `codeceipt index [dir]` | Re-indexes the repo and uploads metadata only |
| `codeceipt init [--claude] [--cursor]` | Sets up Claude Code and Cursor again |
| `codeceipt scan-secrets [files...]` | Scans changed (or named) files for secrets; prints masked findings |
| `codeceipt login [--api-url <url>]` | Saves a token you copied from the dashboard (read from stdin) |
| `codeceipt help` | Shows all commands |

`--api-url` (or `CODECEIPT_API_URL`) points the CLI at another Codeceipt server, for example a local one.

## Help

Troubleshooting: https://codeceipts.vercel.app/docs/quickstart. Privacy: https://codeceipts.vercel.app/privacy.

Requires Node.js 20 or newer and git.
