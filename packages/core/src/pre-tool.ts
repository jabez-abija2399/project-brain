// Roadmap Phase 5b: protected paths blocked before an agent edits them, through each agent's pre-tool-use hook.
// Pure: the CLI passes the hook's JSON input, the repo root and the Blueprint's boundaries (kept on disk); this reads
// which files the tool would write, checks them against the owner's protected paths and answers in the agent's own
// format. Shell commands are not parsed (a command can write anywhere): `codeceipt guard` checks those at commit time.
import { globMatch } from "./blueprint/boundary-check";
import { safePath } from "./fix-prompt";

export type PreToolAgent = "claude" | "cursor" | "codex" | "antigravity";
export type PreToolMode = "strict" | "gentle";
export type PreToolHit = { path: string; pattern: string };

const MAX_TARGETS = 50;
const MAX_PATH = 1024;
const PATH_KEYS = ["file_path", "notebook_path", "path", "target_file", "TargetFile", "filePath"];

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** File paths named in an apply_patch text (Codex): added, updated, deleted and moved-to files. */
export function patchTargets(patch: string): string[] {
  const out: string[] = [];
  for (const line of patch.split("\n")) {
    const m = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line.trimEnd());
    if (m?.[1]) out.push(m[1].trim());
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

/** The files the tool call would write, as the agent sent them (absolute or relative). */
export function toolTargets(input: unknown): string[] {
  const top = obj(input);
  const args = { ...obj(top.tool_input), ...obj(obj(top.toolCall).args) };
  const out: string[] = [];
  for (const key of PATH_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  // MultiEdit-style lists of edits, each with its own path.
  for (const list of [args.edits, args.files]) {
    if (!Array.isArray(list)) continue;
    for (const e of list.slice(0, MAX_TARGETS)) {
      for (const key of PATH_KEYS) {
        const v = obj(e)[key];
        if (typeof v === "string" && v.length > 0) out.push(v);
      }
    }
  }
  // Codex apply_patch: the patch text names every file it writes.
  for (const text of [args.command, args.patch, args.input]) {
    if (typeof text === "string" && text.includes("*** Begin Patch"))
      out.push(...patchTargets(text));
    if (Array.isArray(text)) {
      for (const part of text) {
        if (typeof part === "string" && part.includes("*** Begin Patch"))
          out.push(...patchTargets(part));
      }
    }
  }
  return [...new Set(out)].slice(0, MAX_TARGETS);
}

/**
 * A target as a path inside the repo ("a/b.ts"), or null when it is outside it. Absolute paths must start with the
 * repo root; "..", "." and repeated slashes are resolved, so "src/../supabase/x.sql" is checked as "supabase/x.sql".
 */
export function repoRelative(target: string, root: string, cwd: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const t = norm(target);
  const r = norm(root).replace(/\/+$/, "");
  const abs =
    t.startsWith("/") || /^[A-Za-z]:\//.test(t) ? t : `${norm(cwd).replace(/\/+$/, "")}/${t}`;
  const parts: string[] = [];
  for (const seg of abs.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const lead = /^[A-Za-z]:$/.test(parts[0] ?? "") ? "" : "/";
  const full = `${lead}${parts.join("/")}`;
  const cmp = (s: string) =>
    /^[A-Za-z]:\//.test(s) || /^[A-Za-z]:\//.test(full) ? s.toLowerCase() : s;
  if (cmp(full) === cmp(r) || !cmp(full).startsWith(`${cmp(r)}/`)) return null;
  const rel = full.slice(r.length + 1);
  return rel.length > 0 && rel.length <= MAX_PATH ? rel : null;
}

/** The first target under a protected path, or null. A target too long to check counts as a hit (never a pass). */
export function preToolHit(
  targets: string[],
  boundaries: { kind: string; pattern: string }[],
): PreToolHit | null {
  const protectedPaths = boundaries
    .filter((b) => b.kind === "protected_path")
    .map((b) => b.pattern);
  if (protectedPaths.length === 0) return null;
  for (const path of targets) {
    if (path.length > MAX_PATH)
      return { path: path.slice(0, 120), pattern: "(path too long to check)" };
    const pattern = protectedPaths.find((p) => globMatch(p, path));
    if (pattern !== undefined) return { path, pattern };
  }
  return null;
}

/**
 * The hook's answer in the agent's own format, or null for "say nothing" (the tool runs). Strict denies the edit;
 * gentle asks the person where the agent supports asking (Claude Code, Antigravity) and otherwise only tells the agent.
 */
export function preToolAnswer(
  agent: PreToolAgent,
  mode: PreToolMode,
  hit: PreToolHit,
): string | null {
  const where = safePath(hit.path);
  const reason = `Codeceipt: ${where} is protected by the owner (${safePath(hit.pattern)}). Do not change it; if the change is really needed, ask the owner to allow it in the Blueprint.`;
  if (agent === "claude" || agent === "codex") {
    if (mode === "gentle" && agent === "codex") return null;
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: mode === "strict" ? "deny" : "ask",
        permissionDecisionReason: reason,
      },
    });
  }
  if (agent === "cursor") {
    return JSON.stringify(
      mode === "strict"
        ? { permission: "deny", user_message: reason, agent_message: reason }
        : { permission: "allow", agent_message: reason },
    );
  }
  return JSON.stringify({ decision: mode === "strict" ? "deny" : "ask", reason });
}
