// Phase 3b: Discover. An as-built Blueprint from the index only (paths, routes, component names, test file names):
// never source code. The owner confirms one feature at a time; suggestions are plain EARS sentences they can keep,
// reword or drop. Deterministic: no AI.
import { testSubjects } from "../features/placement";
import { maskSecretsIn } from "../mask";
import { plainText } from "../text";
import type { CriterionKind } from "./coverage";

export const DISCOVER_LIST_MAX = 10;
const AUTO_PREFIX = "@";

export type DiscoverInput = {
  features: {
    id: string;
    key: string;
    name: string;
    purpose: string | null;
    status: string;
    buildOrder: number | null;
    files: string[];
    criteria: { kind: string; status: string }[];
  }[];
  symbols: { path: string; kind: string; name: string; signature: string | null }[];
  testPaths: string[];
};

export type Suggestion = { text: string; kind: CriterionKind; why: string };

export type DiscoveredFeature = {
  featureId: string;
  name: string;
  purpose: string | null;
  status: string;
  confirmed: boolean;
  files: number;
  routes: string[];
  routesTotal: number;
  components: string[];
  componentsTotal: number;
  tests: number;
  suggestions: Suggestion[];
};

const clean = (value: string, max = 120) => maskSecretsIn(plainText(value)).slice(0, max);

function suggestionsFor(name: string, apiRoutes: string[], kinds: Set<string>): Suggestion[] {
  const out: Suggestion[] = [];
  // Names go into a sentence the owner may accept: only plain name characters, and a name carrying sentence keywords
  // gets a neutral word instead, so a name can never add or change a clause.
  const plainName = clean(name, 80)
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim();
  const thing =
    plainName && !/\b(shall|then|when|if|while|not)\b/i.test(plainName)
      ? plainName
      : "this feature's";
  if (!kinds.has("must_never") && !kinds.has("security")) {
    out.push({
      kind: "must_never",
      text: `THE SYSTEM SHALL NOT show one user's ${thing} data to another user`,
      why: "Every feature needs at least one thing that must never happen.",
    });
  }
  const api = apiRoutes[0];
  if (api && !kinds.has("security")) {
    out.push({
      kind: "security",
      text: `IF a request to ${clean(api, 120).replace(/[^\w/[\]().:@-]/g, "")} comes from someone who is not signed in, THEN THE SYSTEM SHALL refuse it`,
      why: "This feature has an API route; who may call it should be written down.",
    });
  }
  return out;
}

export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** The as-built view: each feature with what the index found, in build order; `next` is the first unconfirmed one. */
export function discoverBlueprint(input: DiscoverInput): {
  features: DiscoveredFeature[];
  next: string | null;
} {
  // Grouped once (push, never copy), so the work grows with the number of rows, not its square.
  const symbolsByPath = groupBy(input.symbols, (s) => s.path);
  const testsByPath = new Map<string, Set<string>>();
  for (const t of input.testPaths) {
    for (const p of [t, ...testSubjects(t)]) {
      const set = testsByPath.get(p) ?? new Set<string>();
      set.add(t);
      testsByPath.set(p, set);
    }
  }

  const features = input.features
    .filter((f) => !f.key.startsWith(AUTO_PREFIX))
    .map((f): DiscoveredFeature => {
      const files = new Set(f.files);
      const syms = f.files.flatMap((p) => symbolsByPath.get(p) ?? []);
      const routes = [
        ...new Set(syms.filter((s) => s.kind === "route").map((s) => clean(s.name))),
      ].sort();
      const apiRoutes = syms
        .filter((s) => s.kind === "route" && s.signature === "route")
        .map((s) => s.name)
        .sort();
      const components = [
        ...new Set(syms.filter((s) => s.kind === "component").map((s) => clean(s.name))),
      ].sort();
      const related = new Set<string>();
      for (const p of files) for (const t of testsByPath.get(p) ?? []) related.add(t);
      const tests = related.size;
      const active = f.criteria.filter((c) => c.status === "active");
      return {
        featureId: f.id,
        name: clean(f.name),
        purpose: f.purpose ? clean(f.purpose, 300) : null,
        status: f.status,
        confirmed: active.length > 0,
        files: files.size,
        routes: routes.slice(0, DISCOVER_LIST_MAX),
        routesTotal: routes.length,
        components: components.slice(0, DISCOVER_LIST_MAX),
        componentsTotal: components.length,
        tests,
        suggestions: suggestionsFor(f.name, apiRoutes, new Set(active.map((c) => c.kind))),
      };
    });
  const order = new Map(
    input.features.map((f, i) => [f.id, [f.buildOrder ?? Number.MAX_SAFE_INTEGER, i]]),
  );
  features.sort((a, b) => {
    const [ao = 0, ai = 0] = order.get(a.featureId) ?? [];
    const [bo = 0, bi = 0] = order.get(b.featureId) ?? [];
    return ao - bo || ai - bi;
  });
  return { features, next: features.find((f) => !f.confirmed)?.featureId ?? null };
}
