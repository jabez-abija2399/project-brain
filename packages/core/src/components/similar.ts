// Lexical similarity (D-005): name tokens first, then path and prop tokens, each word weighted by how rare it is
// among the candidates' names (KI-020). No LLM, no embeddings.

export type SimilarCandidate = { name: string; path: string; signature?: string | null };

// reason: one line saying why it matched, e.g. "name shares 'button'; props include 'primary'".
export type SimilarMatch<T extends SimilarCandidate> = { component: T; score: number; reason: string };

export type SimilarOptions = { threshold?: number; limit?: number };

// Lowered from 0.3 (real-test Q): a component that shares a common word such as "Button" and a distinctive word in
// its path or props ("primary") scores about 0.29 in a project with many Buttons.
export const SIMILARITY_THRESHOLD = 0.15;
export const DEFAULT_SIMILAR_LIMIT = 3;
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

// UI words that many components share, so they say little about which component is meant (KI-020). They count
// half, on top of the rarity weighting.
const GENERIC = new Set([
  "list",
  "page",
  "form",
  "button",
  "card",
  "item",
  "view",
  "modal",
  "dialog",
  "table",
  "panel",
  "input",
  "layout",
]);
const GENERIC_FACTOR = 0.5;

// Singular form, so token/tokens, category/categories and box/boxes are one word. Words ending in ss, us or is
// (address, status, analysis) are already singular.
function singular(w: string): string {
  if (w.length <= 3 || !w.endsWith("s") || /(ss|us|is)$/.test(w)) return w;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(sses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  return w.slice(0, -1);
}

export function nameTokens(text: string): string[] {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const out = new Set<string>();
  for (const w of words) if (w) out.add(singular(w));
  return [...out];
}

function queryTokens(query: string): string[] {
  return nameTokens(query.slice(0, MAX_QUERY)).slice(0, MAX_QUERY_TOKENS);
}

function contextTokens(c: SimilarCandidate): Set<string> {
  const tokens = [...nameTokens(c.path), ...nameTokens(c.signature ?? "")];
  return new Set(tokens.filter((t) => !NOISE.has(t)));
}

export type WordWeight = (token: string) => number;

/**
 * Rarity weights (smoothed IDF) of the query words from the candidates' names: a query word many of them share
 * counts less than a rare one. The server passes every component whose name contains a query word, so these counts
 * are the words' counts in the whole project. Other words (a candidate's own words, query words no name has) weigh
 * 1: they do not tell the candidates apart by rarity.
 */
export function rarityWeights(query: readonly string[], names: readonly string[]): WordWeight {
  const wanted = new Set(query);
  const df = new Map<string, number>();
  for (const name of names) {
    for (const t of nameTokens(name)) if (wanted.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = names.length;
  return (t) => {
    const count = df.get(t);
    const w = count === undefined ? 1 : Math.log((n + 1) / (count + 1)) + 1;
    return GENERIC.has(t) ? w * GENERIC_FACTOR : w;
  };
}

const equalWeights: WordWeight = (t) => (GENERIC.has(t) ? GENERIC_FACTOR : 1);

type Scored = { score: number; reason: string };

// Scores one candidate. `strict` (the default lookup, threshold > 0) requires a shared name token. A shared word
// that is common (GENERIC, e.g. "button") is not enough on its own: the candidate must also be the query's whole name
// ("Button" for "PrimaryButton" is covered), or the query must hold no distinctive word, or a distinctive query word
// must be in its path or props ("primary" in ui/button.tsx). So "TextInput" does not match "PasswordStrengthInput".
function scoreCandidate(
  query: string[],
  c: SimilarCandidate,
  strict: boolean,
  weight: WordWeight,
): Scored | null {
  if (query.length === 0) return null;
  const sum = (tokens: Iterable<string>) => {
    let total = 0;
    for (const t of tokens) total += weight(t);
    return total;
  };
  const name = new Set(nameTokens(c.name));
  const shared = query.filter((t) => name.has(t));
  if (shared.length === 0 && strict) return null;
  const union = new Set([...query, ...name]);
  const context = contextTokens(c);
  const inContext = query.filter((t) => context.has(t));
  if (strict && shared.length > 0 && shared.every((t) => GENERIC.has(t))) {
    const queryIsGeneric = query.every((t) => GENERIC.has(t));
    const nameIsCovered = [...name].every((t) => query.includes(t));
    const contextIsDistinctive = inContext.some((t) => !GENERIC.has(t));
    if (!queryIsGeneric && !nameIsCovered && !contextIsDistinctive) return null;
  }
  const raw =
    NAME_WEIGHT * (sum(shared) / sum(union)) + CONTEXT_WEIGHT * (sum(inContext) / sum(query));
  const score = Math.round(raw * 1000) / 1000;
  if (score <= 0) return null;

  const path = new Set(nameTokens(c.path).filter((t) => !NOISE.has(t)));
  const props = new Set(nameTokens(c.signature ?? "").filter((t) => !NOISE.has(t)));
  const quoted = (words: string[]) => words.map((t) => `'${t}'`).join(", ");
  const inPath = query.filter((t) => !name.has(t) && path.has(t));
  const inProps = query.filter((t) => !name.has(t) && !path.has(t) && props.has(t));
  const parts: string[] = [];
  if (shared.length > 0) parts.push(`name shares ${quoted(shared)}`);
  if (inPath.length > 0) parts.push(`path has ${quoted(inPath)}`);
  if (inProps.length > 0) parts.push(`props include ${quoted(inProps)}`);
  return { score, reason: parts.join("; ") };
}

export function similarityScore(
  query: string[],
  c: SimilarCandidate,
  skipWithoutNameMatch = false,
  weight: WordWeight = equalWeights,
): number {
  return scoreCandidate(query, c, skipWithoutNameMatch, weight)?.score ?? 0;
}

/**
 * Words a candidate's name must contain (case-insensitive substring) to possibly match, for a database prefilter.
 * A word ending in y is sent without it, so "category" also finds "Categories". Nothing is sent when the threshold is
 * 0 (a raw ranking that also looks at path and props alone).
 */
export function similarNameFilter(
  query: string,
  options: SimilarOptions = {},
): string[] | undefined {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  if (threshold <= 0) return undefined;
  return queryTokens(query).map((t) => (t.length > 3 && t.endsWith("y") ? t.slice(0, -1) : t));
}

// Best matches at or above the threshold, best first, at most `limit` (3 by default). Ties by name. Nothing similar
// enough -> [] (never the closest unrelated one).
export function findSimilarComponent<T extends SimilarCandidate>(
  query: string,
  components: readonly T[],
  options: SimilarOptions = {},
): SimilarMatch<T>[] {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const limit = options.limit ?? DEFAULT_SIMILAR_LIMIT;
  const q = queryTokens(query);
  const strict = threshold > 0;
  const weight = rarityWeights(
    q,
    components.map((c) => c.name),
  );
  const matches: SimilarMatch<T>[] = [];
  for (const component of components) {
    const hit = scoreCandidate(q, component, strict, weight);
    if (hit && hit.score >= threshold) matches.push({ component, score: hit.score, reason: hit.reason });
  }
  matches.sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name));
  return matches.slice(0, limit);
}
