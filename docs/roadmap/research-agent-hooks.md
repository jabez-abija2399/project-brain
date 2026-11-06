# Agent hook capabilities (research, 2026-11-06)

Read from each agent's official docs on 2026-11-06, for Phases 4, 5, 10 and 12. "Not documented" means we found no
documentation, not that the feature doesn't exist. Re-check before building on a row.

Sources: Claude Code https://code.claude.com/docs/en/hooks · Cursor https://cursor.com/docs/agent/hooks · Codex
https://learn.chatgpt.com/docs/hooks · OpenCode https://docs.opencode.ai/docs/plugins (v1) and
https://opencode.ai/docs/build/plugins/server (v2) · Antigravity https://antigravity.google/docs/hooks · Windsurf
https://docs.devin.ai/desktop/cascade/hooks · Copilot https://docs.github.com/en/copilot/reference/hooks-configuration

| Agent | Pre-tool hook, can block | Stop, can continue | Final summary / tokens | Transcript |
|---|---|---|---|---|
| Claude Code | `PreToolUse`: exit 2 or `permissionDecision` deny/ask/allow; reason shown | `Stop`: `decision:"block"` + `reason`; `stop_hook_active`; max 8 in a row | `last_assistant_message` in Stop input | `transcript_path` (`~/.claude/projects/<proj>/<session>.jsonl`), written async |
| Cursor | `preToolUse` (allow/deny, `agent_message`), `beforeShellExecution`, `beforeReadFile`; `afterFileEdit` observe-only | `stop`: `followup_message`; `loop_limit` default 5 | not documented | `transcript_path` (may be null) |
| Codex | `PreToolUse` (Bash, apply_patch, MCP): exit 2 or `permissionDecision:"deny"`; `ask` not supported | `Stop`: `decision:"block"` + `reason`; `stop_hook_active` | `last_assistant_message`; `PostModelRequest.token_usage` | `transcript_path`, format "not stable" |
| OpenCode | `tool.execute.before` (throwing blocks, per example) | `session.idle` only; continuation not documented | not documented | not documented |
| Antigravity | `PreToolUse`: `decision` deny/allow/ask/…, `reason` | `Stop`: `decision:"continue"` + `reason`; loop limit not documented | not documented | `~/.gemini/antigravity*/brain/<conv>/.system_generated/logs/transcript.jsonl` |
| Windsurf (Devin) | `PreToolUse`: exit 2 or `decision:"block"` | `Stop` exists; continuation not documented | not documented | not documented |
| Copilot | `preToolUse`: `permissionDecision` allow/deny/ask | `agentStop`: `decision:"block"`; max 8 | not documented | `transcriptPath` |

Notes:
- Claude Code: hook timeouts fail open unless `"onFailure":"block"`; context injection via `additionalContext`
  (10,000-char cap); `"async": true` runs a hook in the background (use for the prompt hook so it never blocks).
  SessionEnd hooks share a 1.5 s budget (raisable to 60 s).
- Cursor: `sessionStart` is fire-and-forget; `beforeSubmitPrompt` cannot inject context; failures fail open unless
  `failClosed: true`.
- Codex: hooks on by default; project hooks in `<repo>/.codex/` need the project to be trusted; SessionEnd 1 s (max 3 s).
- Antigravity: one forum report says Stop and PostToolUse never fire on IDE 1.107.0 on Windows.
- Codeceipt today uses: Claude Code SessionStart/UserPromptSubmit/Stop/SessionEnd; Cursor sessionStart/
  beforeSubmitPrompt/stop/sessionEnd; Codex start/prompt/end (no Stop yet); OpenCode `session.created`; Antigravity
  SessionStart. Gaps to fill: PreToolUse everywhere (Phase 5), Stop for Codex and Antigravity (Phase 4),
  `last_assistant_message` for the claim checker (Phase 10), Codex token usage (Phase 12).
