import {
  TESTS_KEY,
  discoverBlueprint,
  groupBy,
  mustNeverCoverage,
  receiptView,
  rlsFindings,
  safetyCheck,
} from "@brain/core";
import { type BrainDb, blueprintRepo, dbSchemaRepo, discoverRepo, receiptsRepo } from "@brain/db";
import type { SessionUser } from "./auth";
import { blueprintReady } from "./blueprint";

// Roadmap Phase 3b: Discover (the as-built Blueprint, confirmed one feature at a time with the owner's own edits) and
// the safety check shown with it. Owner session only; read-only; no AI; index metadata only (never source code).

const RECENT_RECEIPTS = 10;
const RLS_TYPES = new Set([
  "rls_disabled",
  "rls_cannot_be_confirmed",
  "policy_allows_everyone_to_write",
]);

export async function discoverView(db: BrainDb, user: SessionUser, projectId: string) {
  const pid = await blueprintReady(db, user, projectId);
  const raw = await discoverRepo.input(db, pid);
  const filesBy = groupBy(raw.files, (f) => f.featureId);
  const criteriaBy = groupBy(raw.criteria, (c) => c.featureId);
  const testsFeature = raw.features.find((f) => f.key === TESTS_KEY);
  const view = discoverBlueprint({
    features: raw.features.map((f) => ({
      ...f,
      key: f.key ?? "",
      files: (filesBy.get(f.id) ?? []).map((r) => r.path),
      criteria: criteriaBy.get(f.id) ?? [],
    })),
    symbols: raw.symbols,
    testPaths: testsFeature ? (filesBy.get(testsFeature.id) ?? []).map((r) => r.path) : [],
  });
  // Honest about limits: a cut-off read says so, so "nothing found" is never "nothing there".
  return { ...view, truncated: raw.truncated };
}

export async function safetyView(db: BrainDb, user: SessionUser, projectId: string) {
  const pid = await blueprintReady(db, user, projectId);
  const [tables, receipts, live] = await Promise.all([
    dbSchemaRepo.listWithPolicies(db, pid),
    receiptsRepo.list(db, pid, RECENT_RECEIPTS),
    blueprintRepo.live(db, pid),
  ]);
  // Newest receipt first; one entry per file, so an old finding repeated by later receipts counts once.
  const views = receipts.map((r) => receiptView(r.summaryJson));
  const seen = new Set<string>();
  const secrets = views
    .flatMap((v) => v.findings.filter((f) => !RLS_TYPES.has(f.type)))
    .filter((f) => !seen.has(`s:${f.file}`) && seen.add(`s:${f.file}`));
  const testChecks = views
    .flatMap((v) => v.testChecks)
    .filter((c) => !seen.has(`t:${c.file}`) && seen.add(`t:${c.file}`));
  const names = new Map(live.features.map((f) => [f.id, f.name]));
  const uncovered = mustNeverCoverage(
    live.features
      .filter((f) => !(f.key ?? "").startsWith("@"))
      .map((f) => ({ id: f.id, criteria: live.criteria.filter((c) => c.featureId === f.id) })),
  ).map((w) => ({ featureId: w.featureId, name: names.get(w.featureId) ?? "" }));
  return {
    risks: safetyCheck({ rls: rlsFindings(tables), secrets, testChecks, uncovered }),
    // The newest receipts only: older findings fixed since are not counted, unfixed ones reappear in new receipts.
    receiptsChecked: receipts.length,
    receiptsLimit: RECENT_RECEIPTS,
    tablesChecked: tables.length,
  };
}
