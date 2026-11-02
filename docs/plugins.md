# Codeceipt agent plugins (D-028)

Codeceipt ships as a plugin for Claude Code, Cursor, Codex and Antigravity. A user installs it once per computer;
each repo then only needs its project link, which `npx codeceipt` (or `codeceipt connect`) writes inside `.git`.
`codeceipt init` stays as the fallback for agents or versions without plugin support.

## Where the plugins come from

- Source: `packages/agent-plugins` (generator) and `packages/cli/src/templates.ts` (the skill and rule text, shared
  with `codeceipt init`).
- Output: `packages/agent-plugins/marketplace`, the layout of the public marketplace repository:

```
.claude-plugin/marketplace.json      Claude Code marketplace  -> plugins/claude-code
.cursor-plugin/marketplace.json      Cursor marketplace       -> plugins/cursor
.agents/plugins/marketplace.json     Codex marketplace        -> plugins/codex
plugins/claude-code/  .claude-plugin/plugin.json, hooks/hooks.json, .mcp.json, skills/codeceipt/SKILL.md, scripts/codeceipt.sh
plugins/cursor/       .cursor-plugin/plugin.json, hooks/hooks.json, mcp.json, rules/codeceipt.mdc, scripts/codeceipt.sh
plugins/codex/        .codex-plugin/plugin.json, hooks/hooks.json, .mcp.json, skills/codeceipt/SKILL.md, scripts/codeceipt.sh
plugins/antigravity/  .antigravity-plugin/plugin.json, hooks.json, mcp_config.json, rules/codeceipt.md, skills/…, scripts/codeceipt.sh
README.md
```

- Regenerate after changing the source or the CLI version: `pnpm -C packages/agent-plugins generate`. A test fails
  when the committed folder differs from the generator's output.

## What a plugin does

- Every hook runs `scripts/codeceipt.sh hook <event> <agent>`. The script runs the installed `codeceipt`
  (`~/.local/bin/codeceipt`, then PATH) with fixed words and `--plugin`, and always exits 0, so a plugin never
  blocks or breaks a session. If `codeceipt` is not installed, the session-start hook prints one line with the
  one-line installer for the platform; nothing else is printed.
- In a repo that is not linked to a Codeceipt project, the hooks do nothing and say nothing.
- The MCP server is the CLI's stdio proxy (`codeceipt mcp-proxy --linked-only`). It sends the linked repo's project
  token from the user config on this computer. No plugin file holds a token.
- The skill (Claude Code, Codex, Antigravity) and the rule (Cursor, Antigravity) are the same workflow text that
  `codeceipt init` writes per repo, with one extra line: skip the steps in a repo without the Codeceipt tools.

## Where hooks may not run (tested by `codeceipt doctor`)

| Surface | Plugin hooks | What doctor says |
|---|---|---|
| Claude Code in a terminal, VS Code or JetBrains | run | "Claude Code hooks ran in the last session here" |
| Claude Code on claude.ai/code (cloud) | do not run: only organisation-managed plugins load | "Claude Code's last session here (…) ran no Codeceipt hooks", fix: run `codeceipt receipt` after the session |
| Claude Code with `allowManagedHooksOnly` set by an admin | do not run | same as above |
| Claude Code in VS Code | SessionEnd may not fire; Stop keeps the receipt current | — |
| Cursor (local agent) | run | "Cursor hooks last ran here …" |
| Cursor cloud agents | do not run | "its hooks have not run in this repo yet (… cloud agents do not run hooks)" |
| Codex | run only after you trust them in `/hooks` | "… only after you trust them in /hooks" |
| Antigravity | documented for its CLI only; SessionStart only (no prompt or session-end event) | "… documents plugin hooks for its CLI only"; run `codeceipt receipt` when you finish |

Doctor knows a Claude Code session happened from its transcript (`~/.claude/projects/<folder>/*.jsonl`); a
transcript newer than the last recorded hook run means that session ran no Codeceipt hooks. Every hook run is
recorded in `hook-runs.json` next to the user config (agent, event, time and a hash of the repo folder; no path,
token or session content).

## Human steps

### 1. Publish the marketplace repository

1. Create a public GitHub repository for the plugins (for example `codeceipt/plugins`).
2. Copy the contents of `packages/agent-plugins/marketplace` to its root, commit and push. Repeat after every
   regeneration (each CLI release).
3. Set its `owner/repo` in `packages/cli/src/plugin-marketplace.json` (`"repo": "codeceipt/plugins"`) through a PR.
   From the next CLI release on, `npx codeceipt` offers the plugin instead of writing per-repo files.

### 2. Claude Code

- Users install with `/plugin marketplace add <owner/repo>`, then `/plugin install codeceipt@codeceipt`
  (or `claude plugin install codeceipt@codeceipt --scope user` after adding the marketplace). `npx codeceipt` runs
  these for the user when they answer yes.
- Before publishing: `claude plugin validate packages/agent-plugins/marketplace/plugins/claude-code --strict`.
- Listing: the Claude Code docs read on 2026-11-02 describe distribution through your own marketplace repository
  only (code.claude.com/docs/en/plugin-marketplaces). Share the `/plugin marketplace add` line on the landing page
  and in the quickstart; check those docs again for a public directory before each release.

### 3. Cursor Marketplace

1. The marketplace repository must be public and contain `.cursor-plugin/marketplace.json` (it does).
2. Add a logo (`plugins/cursor/assets/logo.png`, square) and set `"logo": "./assets/logo.png"` in the Cursor manifest
   source (packages/agent-plugins), then regenerate.
3. Submit at cursor.com/marketplace/publish with the repository URL. The Cursor team reviews it.
4. Until it is listed, test with a local install: copy `plugins/cursor` to `~/.cursor/plugins/local/codeceipt` and
   run Developer: Reload Window.
5. Teams and Enterprise can add the repository as a team marketplace (Default Off, Default On or Required).

### 4. Codex

- Users run `codex plugin marketplace add <owner/repo>`, then install Codeceipt from the plugins directory in Codex.
- Codex's public plugin directory does not accept plugins with hooks, so Codeceipt is distributed through its own
  marketplace repository only. Users must trust the hooks once in `/hooks`.

### 5. Antigravity

1. Add a logo of at least 128 px (`plugins/antigravity/assets/logo.png`) and `"logo"` in the Antigravity manifest
   source, then regenerate.
2. Run `agy plugin validate --strict packages/agent-plugins/marketplace/plugins/antigravity`.
3. Submit through Google's Antigravity partner intake form (linked from antigravity.google/docs/build-plugins) with the
   repository, a README and the logo.
4. Users can install directly: `agy plugin install <repository URL>` (the plugin folder is `plugins/antigravity`).

### 6. After a user installs a plugin

In each repo that was set up before: `codeceipt init --remove-repo-files` removes the per-repo hooks, MCP entries,
skill and rule files that init wrote for that agent (only exact copies; edited files stay). `codeceipt doctor`
reports an agent that has both, because its hooks would run twice.
