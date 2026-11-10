import { TESTS_KEY, safeDisplay } from "@brain/core";
import { type BrainDb, blueprintRepo } from "@brain/db";
import { blueprintEnabled } from "./migration-check";

// Roadmap Phase 8: what `codeceipt export` writes into the repo. Owner-approved content only: active criteria and
// active boundaries (never proposals), features in build order. DB reads only, no AI; text is one line, masked and
// capped. Before migration 0054 the Blueprint is not set up and nothing is exported.

const MAX_FEATURES = 500;
const MAX_CRITERIA = 30;
const MAX_BOUNDARIES = 100;

export async function hookExport(db: BrainDb, projectId: string) {
  if (!(await blueprintEnabled(db)))
    return { ready: false, version: 0, features: [], boundaries: [] };
  const [live, version] = await Promise.all([
    blueprintRepo.live(db, projectId),
    blueprintRepo.currentVersion(db, projectId),
  ]);
  const names = new Map(live.features.map((f) => [f.id, f.name]));
  const criteriaBy = new Map<string, { text: string; kind: string }[]>();
  for (const c of live.criteria) {
    if (c.status !== "active") continue;
    const list = criteriaBy.get(c.featureId) ?? [];
    if (list.length < MAX_CRITERIA) list.push({ text: safeDisplay(c.text, 300), kind: c.kind });
    criteriaBy.set(c.featureId, list);
  }
  const deps = new Map<string, string[]>();
  for (const d of live.dependencies) {
    const name = names.get(d.dependsOnId);
    if (!name) continue;
    deps.set(d.featureId, [...(deps.get(d.featureId) ?? []), safeDisplay(name, 100)].slice(0, 20));
  }
  // Planned features (a build order) and any feature with approved criteria; the index's test group is not one.
  const features = live.features
    .filter((f) => f.key !== TESTS_KEY && (f.buildOrder !== null || criteriaBy.has(f.id)))
    .slice(0, MAX_FEATURES)
    .map((f) => ({
      name: safeDisplay(f.name, 100),
      purpose: f.description ? safeDisplay(f.description, 300) : null,
      dependsOn: deps.get(f.id) ?? [],
      criteria: criteriaBy.get(f.id) ?? [],
    }))
    .filter((f) => f.name.length > 0);
  const boundaries = live.boundaries
    .filter((b) => b.status === "active")
    .slice(0, MAX_BOUNDARIES)
    .map((b) => ({ kind: b.kind, pattern: safeDisplay(b.pattern, 200) }));
  return { ready: true, version, features, boundaries };
}
