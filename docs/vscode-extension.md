# Codeceipt in VS Code

A small extension that shows two things without leaving the editor: the last receipt, and the one next step.
It works in VS Code and in editors built on it (Cursor, Windsurf, Antigravity) from version 1.90.

Status: built and tested in this repository (`packages/vscode-extension`). It is **not published yet**: building the
`.vsix` file and putting it on a marketplace are owner steps ([owner-actions.md](owner-actions.md), action 15).

## What you see
- **Status bar (bottom left):** "Codeceipt: all done", "Codeceipt: 2 missed" or "Codeceipt: check the receipt".
  Hover for the next step. Click for a short summary with an "Open receipts" button.
- **Explorer side bar, "Codeceipt":** the next step (with its terminal command), then the last receipt: done, partly
  done, missed (with the missed items listed), not verified, security findings, test checks and contradicted claims.
- **Commands (Ctrl/Cmd+Shift+P):** "Codeceipt: Refresh", "Codeceipt: Show the last receipt", "Codeceipt: Open
  receipts in the browser", "Codeceipt: Open the next step in the browser".

It refreshes when it starts, every 5 minutes, and when you run Refresh.

## What it needs
- Codeceipt installed on the computer and the folder connected (`npx codeceipt` once; see
  [quickstart.md](quickstart.md)). The CLI must be version 0.3.7 or later (the first with `--json`).
- A trusted folder. In a folder VS Code marks as untrusted, the extension does nothing.

## How it works, and what it never does
- It runs the installed command twice, in the opened folder: `codeceipt status --json` and `codeceipt last --json`,
  and shows what they answer. That is all.
- It only uses a `codeceipt` installed on the computer (the install folder `~/.local/bin`, then the folders on PATH).
  It never runs a `codeceipt` that sits inside the opened folder or anywhere in the same repository, so a downloaded
  project cannot make the editor run its own program.
- The command gets a cleaned PATH with no folder from the project in it, and the CLI itself starts `git` by its
  full path. So the project cannot supply its own `git` either.
- No shell, and only those two fixed commands. Each has 15 seconds and 256 KB of output at most.
- It has no token and makes no network call itself; the CLI does that, as in the terminal, and only to an `https`
  address.
- The extension writes nothing, changes no settings, and has no web view. The command it runs keeps its usual small
  records (the repo's link file, the update check), exactly as when you run it in a terminal.
- It only works in a git repository that is connected to a project. In any other folder it shows nothing and runs
  nothing.
- Links open in the browser only when they are `https` (or `http` on this computer, for local development).
- Text from a receipt is shown as plain text, one line each, with control, invisible and direction characters
  removed.

## The data it reads
`codeceipt status --json` prints one line:
```json
{"next":{"id":"approvals","text":"…","url":"https://…","command":"codeceipt approvals","ask_agent":null}}
```
`codeceipt last --json` prints one line (`receipt` is `null` when there is none yet):
```json
{"receipt":{"id":"…","created_at":"…","counts":{"done":1,"partly_done":0,"missed":1,"not_verified":0,
"security_findings":0,"test_checks":0,"claims_contradicted":0},"missed":["…"]},"url":"https://…/receipts"}
```
Neither contains the token, source code or file contents. Other tools may read the same output.

## For developers
```bash
pnpm --filter codeceipt-vscode test
```
```bash
pnpm --filter codeceipt-vscode build
```
The build writes `packages/vscode-extension/dist/extension.js`. To try it: open `packages/vscode-extension` in
VS Code and press F5 (Run Extension), then open a connected folder in the window that appears.

Not covered by automated tests: the editor glue in `src/extension.ts` (status bar, tree, commands). Testing it needs
a real VS Code download and a display, which this project's CI does not have; it is checked by hand with F5
(owner action 15 lists the steps). Everything it shows comes from `src/model.ts` and `src/cli.ts`, which are tested.
