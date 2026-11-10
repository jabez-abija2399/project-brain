import { request } from "./api";
import type { CliConfig } from "./config";
import { START_NOTE_WAIT_MS, clean } from "./hooks";

// Roadmap Phase 5c: when the user sends a request, Claude Code and Codex get its definition of done (the matching
// feature's owner-approved criteria, must-never rules, protected paths and tests) before the agent starts. A
// deterministic server read, never AI; it waits no longer than the start note does, and anything unexpected means
// no note (the prompt is never held up or blocked).
const MAX_NOTE = 1_500;
const MAX_ANSWER_BYTES = 16 * 1024;
const MAX_REQUEST = 8_000;

export async function definitionOfDoneAnswer(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  config: CliConfig,
  agent: string,
  prompt: string,
  ms = START_NOTE_WAIT_MS,
): Promise<string | null> {
  if (agent !== "claude" && agent !== "codex") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      request<{ note?: unknown }>(
        (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) }),
        config,
        "POST",
        `/api/hooks/${encodeURIComponent(config.projectId)}/definition-of-done`,
        { request: prompt.slice(0, MAX_REQUEST) },
        undefined,
        MAX_ANSWER_BYTES,
      ),
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error("timeout")), ms);
        timer.unref?.();
      }),
    ]);
    if (typeof res.note !== "string" || res.note.trim() === "") return null;
    // Server text is data: one plain line per line, direction marks removed, and the length capped.
    const note = clean(res.note, MAX_NOTE);
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: note },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
