// Roadmap Phase 5b: what main.ts passes to the pre-tool hook when the agent's input was larger than it reads, so the
// hook can refuse the edit instead of letting it through unread. A NUL byte never starts real JSON input.
export const PRE_TOOL_INPUT_TOO_LARGE = "\u0000codeceipt:input-too-large";
// The pre-tool hook's input carries the whole file being written: it may be read up to this size.
export const PRE_TOOL_MAX_INPUT = 8 * 1024 * 1024;
