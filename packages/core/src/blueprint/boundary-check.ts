// Roadmap Phase 4c: each receipt checked against the Blueprint's active boundaries: changed files under a protected
// path, packages the owner disallowed, and (when the owner keeps an allowed list) packages that are not on it.
// Deterministic, no AI, paths and package names only. Matching never builds a regular expression from stored text.

export const MAX_BOUNDARY_HITS = 20;

export type BoundaryHitKind = "protected_path" | "disallowed_dependency" | "not_allowed_dependency";
export type BoundaryHit = { kind: BoundaryHitKind; subject: string; pattern: string };

// Security review (Phase 4c): a receipt's matching work is capped (pattern length x path length summed over every
// pair), so paths and patterns sent by anyone who can push cannot hold the server's event loop.
export const MATCH_BUDGET = 2_000_000;
const MAX_PATH = 1024;

/** How an owner types a folder ("./supabase/", "/supabase", "supabase") is read the way they mean it. */
export function normalizePattern(pattern: string): string {
  let p = pattern.trim().replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);
  if (p.endsWith("/")) p = `${p}**`;
  return p;
}

const hasGlob = (p: string) => p.includes("*") || p.includes("?");

/**
 * Glob match without regular expressions: `**` matches across folders (also nothing), `*` and `?` stay within one
 * folder, and "**" followed by a slash only continues at the start of a folder. A pattern without a slash or glob also matches a
 * folder of that name or the last part of a path (".env*" matches "apps/web/.env.local"). Case-insensitive, so a
 * protected folder is protected however it is written. Dynamic programming over pattern x path (never exponential),
 * stopping as soon as nothing can match.
 */
export function globMatch(pattern: string, path: string): boolean {
  const p = normalizePattern(pattern).toLowerCase();
  const s = path.replace(/\\/g, "/").toLowerCase();
  if (!p || s.length > MAX_PATH) return false;
  if (!hasGlob(p)) {
    if (s === p || s.startsWith(`${p}/`)) return true;
    if (!p.includes("/")) return s.split("/").includes(p);
    return false;
  }
  if (!p.includes("/") && match(p, s.slice(s.lastIndexOf("/") + 1))) return true;
  return match(p, s);
}

function match(p: string, s: string): boolean {
  // ok[j] = the pattern so far matches s[0..j)
  let ok: boolean[] = Array.from({ length: s.length + 1 }, (_, j) => j === 0);
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    const next: boolean[] = new Array(s.length + 1).fill(false);
    if (c === "*" && p[i + 1] === "*") {
      const slashAfter = p[i + 2] === "/";
      let any = false;
      for (let j = 0; j <= s.length; j++) {
        any = any || ok[j] === true;
        // "**/" continues only at the start of a folder (or of the path): "**/.env" never matches "config.env".
        next[j] = any && (!slashAfter || j === 0 || s[j - 1] === "/");
      }
      i += slashAfter ? 2 : 1;
    } else if (c === "*") {
      let run = false;
      for (let j = 0; j <= s.length; j++) {
        if (ok[j]) run = true;
        next[j] = run;
        if (s[j] === "/") run = false;
      }
    } else {
      for (let j = 0; j < s.length; j++) {
        if (ok[j] && (c === "?" ? s[j] !== "/" : s[j] === c)) next[j + 1] = true;
      }
    }
    if (!next.includes(true)) return false;
    ok = next;
  }
  return ok[s.length] === true;
}

/** The receipt's boundary hits: protected paths first, then disallowed and not-allowed packages. */
export function checkBoundaries(input: {
  files: string[];
  dependencies: string[];
  boundaries: { kind: string; pattern: string }[];
}): BoundaryHit[] {
  const hits: BoundaryHit[] = [];
  let spent = 0;
  const within = (pattern: string, subject: string) => {
    spent += (pattern.length + 1) * (Math.min(subject.length, MAX_PATH) + 1);
    return spent <= MATCH_BUDGET && globMatch(pattern, subject);
  };
  const of = (kind: string) =>
    input.boundaries.filter((b) => b.kind === kind).map((b) => b.pattern);
  const protectedPaths = of("protected_path");
  for (const file of input.files) {
    const pattern = protectedPaths.find((p) => within(p, file));
    if (pattern !== undefined) hits.push({ kind: "protected_path", subject: file, pattern });
  }
  const disallowed = of("disallowed_dependency");
  const allowed = of("allowed_dependency");
  for (const name of input.dependencies) {
    const bad = disallowed.find((p) => within(p, name));
    if (bad !== undefined)
      hits.push({ kind: "disallowed_dependency", subject: name, pattern: bad });
    else if (allowed.length > 0 && !allowed.some((p) => within(p, name)) && spent <= MATCH_BUDGET) {
      hits.push({ kind: "not_allowed_dependency", subject: name, pattern: "" });
    }
  }
  return hits.slice(0, MAX_BOUNDARY_HITS);
}
