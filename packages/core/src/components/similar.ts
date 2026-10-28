// Lexical similarity (D-005): name tokens first, then path and prop tokens. No LLM, no embeddings.

export type SimilarCandidate = { name: string; path: string; signature?: string | null };

export type SimilarMatch<T extends SimilarCandidate> = { component: T; score: number };

export type SimilarOptions = { threshold?: number; limit?: number };

export const SIMILARITY_THRESHOLD = 0.3;
export const DEFAULT_SIMILAR_LIMIT = 5;
const MAX_QUERY = 200;
// The database name pre-filter takes at most 20 words (symbolsRepo MAX_NAME_TOKENS); scoring uses the same ones.
const MAX_QUERY_TOKENS = 20;
const NAME_WEIGHT = 0.8;
const CONTEXT_WEIGHT = 0.2;

// Path and type words that say nothing about what a component does.
const NOISE = new Set([
  "src",
  "app",
  "apps",
  "component",
  "components",
  "index",
  "tsx",
  "jsx",
  "ts",
  "js",
  "lib",
  "string",
  "number",
  "boolean",
  "void",
  "null",
  "undefined",
  "any",
  "unknown",
  "react",
  "props",
  "prop",
  "type",
]);

export function nameTokens(text: string): string[] {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const out = new Set<string>();
  for (const w of words) {
    if (!w) continue;
    out.add(w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return [...out];
}

function queryTokens(query: string): string[] {
  return nameTokens(query.slice(0, MAX_QUERY)).slice(0, MAX_QUERY_TOKENS);
}

function contextTokens(c: SimilarCandidate): Set<string> {
  const tokens = [...nameTokens(c.path), ...nameTokens(c.signature ?? "")];
  return new Set(tokens.filter((t) => !NOISE.has(t)));
}

export function similarityScore(
  query: string[],
  c: SimilarCandidate,
  skipWithoutNameMatch = false,
): number {
  if (query.length === 0) return 0;
  const name = new Set(nameTokens(c.name));
  const shared = query.filter((t) => name.has(t)).length;
  if (shared === 0 && skipWithoutNameMatch) return 0;
  const union = new Set([...query, ...name]).size;
  const context = contextTokens(c);
  const inContext = query.filter((t) => context.has(t)).length;
  const score = NAME_WEIGHT * (shared / union) + CONTEXT_WEIGHT * (inContext / query.length);
  return Math.round(score * 1000) / 1000;
}

/** Query tokens that a candidate's name must contain to possibly match (for a database prefilter). */
export function similarNameFilter(
  query: string,
  options: SimilarOptions = {},
): string[] | undefined {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  return threshold > CONTEXT_WEIGHT ? queryTokens(query) : undefined;
}

// Best matches at or above the threshold, best first. Nothing similar enough -> [] (never the closest unrelated one).
export function findSimilarComponent<T extends SimilarCandidate>(
  query: string,
  components: readonly T[],
  options: SimilarOptions = {},
): SimilarMatch<T>[] {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const limit = options.limit ?? DEFAULT_SIMILAR_LIMIT;
  const q = queryTokens(query);
  // Path and props alone can never reach the threshold: a candidate must share a name token.
  const needsName = threshold > CONTEXT_WEIGHT;
  const matches: SimilarMatch<T>[] = [];
  for (const component of components) {
    const score = similarityScore(q, component, needsName);
    if (score > 0 && score >= threshold) matches.push({ component, score });
  }
  matches.sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name));
  return matches.slice(0, limit);
}
