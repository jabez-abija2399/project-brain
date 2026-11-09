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

## Re-checked 2026-11-08 (before Phase 4a)
Sources:
- Claude Code: https://code.claude.com/docs/en/hooks
- Cursor: https://cursor.com/docs/agent/hooks
- Codex: https://learn.chatgpt.com/docs/hooks
- OpenCode: https://docs.opencode.ai/docs/plugins
- Antigravity: https://antigravity.google/docs/hooks

| Agent | Stop: input, continue with | Pre-tool: what it sees, how to deny | Prompt hook in the background |
|---|---|---|---|
| Claude Code | `stop_hook_active`, `last_assistant_message`. Strict: `{"decision":"block","reason"}`. Gentle: `hookSpecificOutput.additionalContext`. Cap: 8 in a row, reset on any tool call. 10,000-character output. | `tool_name`, `tool_input.file_path` (absolute), `command`. Deny: `permissionDecision:"deny"` plus a reason. A timeout lets the tool run unless `onFailure:"block"`. | Yes: `async:true`, which cannot block. |
| Cursor | `status`, `loop_count`. Continue: `{"followup_message"}`. `loop_limit` 5 by default. | `preToolUse`: `tool_name`, `tool_input`. Deny: `permission:"deny"`. `ask` is not enforced. `beforeShellExecution`. | No. |
| Codex | `stop_hook_active`, `last_assistant_message`. Continue: `{"decision":"block","reason"}` (sent as a new prompt). Output capped at about 2,500 tokens. | Bash and `apply_patch` (the patch text is in `tool_input.command`). Deny: `permissionDecision:"deny"`. | No. |
| OpenCode | Only `session.idle`; no documented way to continue. | `tool.execute.before` (blocking by throwing is undocumented). | No. |
| Antigravity | `executionNum`, `terminationReason`. Continue: `{"decision":"continue","reason"}`. 30 s timeout. No loop limit. | `toolCall.args.TargetFile` / `CommandLine`. Decisions: allow, deny, ask, and more. | No prompt hook. |

**What Phase 4a does with this:**
- The gate answers in each agent's own format: `gateAnswer` in `packages/cli/src/stop-gate.ts`.
- Codex and Antigravity get Stop hooks.
- The local cap of 2 is also checked against Cursor's `loop_count`.
- OpenCode stays "report only": it has no documented way to continue.

