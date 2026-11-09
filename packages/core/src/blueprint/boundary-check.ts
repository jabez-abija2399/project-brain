// Roadmap Phase 4c: each receipt checked against the Blueprint's active boundaries: changed files under a protected
// path, packages the owner disallowed, and (when the owner keeps an allowed list) packages that are not on it.
// Deterministic, no AI, paths and package names only. Matching never builds a regular expression from stored text.

export const MAX_BOUNDARY_HITS = 20;

export type BoundaryHitKind = "protected_path" | "disallowed_dependency" | "not_allowed_dependency";
export type BoundaryHit = { kind: BoundaryHitKind; subject: string; pattern: string };

/**
 * Glob match without regular expressions: `**` matches across folders (also nothing), `*` and `?` stay within one
 * folder. A pattern without a slash also matches the last part of a path (".env*" matches "apps/web/.env.local").
 * Dynamic programming over pattern x path, so a hostile pattern cannot take exponential time.
 */
export function globMatch(pattern: string, path: string): boolean {
  if (!pattern.includes("/") && match(pattern, path.slice(path.lastIndexOf("/") + 1))) return true;
  return match(pattern, path);
}

function match(p: string, s: string): boolean {
  // ok[j] = the pattern so far matches s[0..j)
  let ok: boolean[] = Array.from({ length: s.length + 1 }, (_, j) => j === 0);
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    const next: boolean[] = new Array(s.length + 1).fill(false);
    if (c === "*" && p[i + 1] === "*") {
      // "**" (and "**/"): anything, slashes included, or nothing.
      const skipSlash = p[i + 2] === "/";
      let any = false;
      for (let j = 0; j <= s.length; j++) {
        any = any || ok[j] === true;
        next[j] = any;
      }
      ok = next;
      // "a/**/b" also matches "a/b": the "/" after ** is part of the "**/" step.
      i += skipSlash ? 2 : 1;
      continue;
    }
    if (c === "*") {
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
  const of = (kind: string) =>
    input.boundaries.filter((b) => b.kind === kind).map((b) => b.pattern);
  const protectedPaths = of("protected_path");
  for (const file of input.files) {
    const pattern = protectedPaths.find((p) => globMatch(p, file));
    if (pattern !== undefined) hits.push({ kind: "protected_path", subject: file, pattern });
  }
  const disallowed = of("disallowed_dependency");
  const allowed = of("allowed_dependency");
  for (const name of input.dependencies) {
    const bad = disallowed.find((p) => globMatch(p, name));
    if (bad !== undefined)
      hits.push({ kind: "disallowed_dependency", subject: name, pattern: bad });
    else if (allowed.length > 0 && !allowed.some((p) => globMatch(p, name))) {
      hits.push({ kind: "not_allowed_dependency", subject: name, pattern: "" });
    }
  }
  return hits.slice(0, MAX_BOUNDARY_HITS);
}
