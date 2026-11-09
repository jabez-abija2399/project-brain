import { formatEars, parseEars } from "@brain/core";
import { blueprintRepo } from "@brain/db";
import type { BrainDb } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";
import { blueprintView, versionHistory } from "./blueprint";
import { discoverView, safetyView } from "./blueprint-discover";
import { blueprintEnabled } from "./migration-check";

// Roadmap Phase 3c: what the Blueprint tab shows, shaped on the server so pages stay thin. Simple answers "how is
// each feature going and what needs me"; Detailed adds every criterion with its EARS form, proof, flags, dependencies,
// areas and boundaries. Text was masked and kept to one line when it was stored; React escapes it when it renders.

export type BlueprintMode = "simple" | "detailed";
export const VIEW_COOKIE = "codeceipt_view";

/** The remembered view, or null when the owner has not answered "Do you usually read the code your AI writes?". */
export function viewMode(
  cookie: string | undefined,
  query: string | undefined,
): BlueprintMode | null {
  const pick = query ?? cookie;
  return pick === "simple" || pick === "detailed" ? pick : null;
}

export async function blueprintPage(db: BrainDb, user: SessionUser, projectId: string) {
  const project = await requireProjectAccess(db, projectId, user);
  const head = { project: { id: project.id, name: project.name } };
  if (!(await blueprintEnabled(db))) return { ...head, ready: false as const };
  const v = await blueprintView(db, user, project.id);
  const names = new Map(v.features.map((f) => [f.id, f.name]));
  const flagsBy = new Map(v.checks.flatMap((c) => c.criteria.map((x) => [x.id, x.flags] as const)));
  const features = v.features
    .filter((f) => !(f.key ?? "").startsWith("@"))
    .map((f) => {
      const own = v.criteria.filter((c) => c.featureId === f.id);
      const active = own.filter((c) => c.status === "active");
      const check = v.checks.find((c) => c.featureId === f.id);
      return {
        id: f.id,
        name: f.name,
        purpose: f.description,
        status: f.status,
        rules: active.length,
        proven: active.filter((c) => v.proof[c.id] === "proven").length,
        doneNotProven: active.filter((c) => v.proof[c.id] === "done_not_proven").length,
        contradicted: active.filter((c) => v.proof[c.id] === "contradicted").length,
        noMustNever: check?.coverage !== null && check?.coverage !== undefined,
        dependsOn: v.dependencies
          .filter((d) => d.featureId === f.id)
          .map((d) => names.get(d.dependsOnId) ?? ""),
        areas: v.areas.filter((a) => a.featureId === f.id).map((a) => a.pattern),
        criteria: active.map((c) => ({
          id: c.id,
          text: c.text,
          kind: c.kind,
          ears: earsOf(c.text),
          proof: v.proof[c.id] ?? "not_proven",
          flags: (flagsBy.get(c.id) ?? []).map((x) => ({
            message: x.message,
            rewrite: x.rewrite ?? null,
          })),
          tests: v.tests.filter((t) => t.criterionId === c.id).length,
        })),
      };
    })
    .sort((a, b) => order(a, v) - order(b, v));
  const proposals = [
    ...v.criteria
      .filter((c) => c.status === "proposal" || c.proposedChange)
      .map((c) => ({
        kind: "criterion" as const,
        id: c.id,
        feature: names.get(c.featureId) ?? "",
        text:
          c.status === "proposal"
            ? c.text
            : c.proposedChange?.retire
              ? "Retire this rule"
              : (c.proposedChange?.text ?? c.text),
        change: c.status !== "proposal",
        current: c.status === "proposal" ? null : c.text,
      })),
    ...v.boundaries
      .filter((b) => b.status === "proposal")
      .map((b) => ({
        kind: "boundary" as const,
        id: b.id,
        feature: "",
        text: `${b.kind}: ${b.pattern}`,
        change: false,
        current: null,
      })),
  ];
  return {
    ...head,
    ready: true as const,
    version: v.version,
    features,
    proposals,
    boundaries: v.boundaries
      .filter((b) => b.status === "active")
      .map((b) => ({ id: b.id, kind: b.kind, pattern: b.pattern })),
  };
}

function order(
  f: { id: string },
  v: { features: { id: string; buildOrder: number | null }[] },
): number {
  return v.features.find((x) => x.id === f.id)?.buildOrder ?? Number.MAX_SAFE_INTEGER;
}

function earsOf(text: string): string | null {
  const e = parseEars(text);
  return e ? formatEars(e) : null;
}

async function head(db: BrainDb, user: SessionUser, projectId: string) {
  const project = await requireProjectAccess(db, projectId, user);
  return { project: { id: project.id, name: project.name }, ready: await blueprintEnabled(db) };
}

/** Discover and the safety check on one page, with the version an accepted suggestion is based on. */
export async function discoverPage(db: BrainDb, user: SessionUser, projectId: string) {
  const h = await head(db, user, projectId);
  if (!h.ready) return { ...h, ready: false as const };
  const [discover, safety, version] = await Promise.all([
    discoverView(db, user, h.project.id),
    safetyView(db, user, h.project.id),
    blueprintRepo.currentVersion(db, h.project.id),
  ]);
  return { ...h, ready: true as const, discover, safety, version };
}

export async function historyPage(db: BrainDb, user: SessionUser, projectId: string) {
  const h = await head(db, user, projectId);
  if (!h.ready) return { ...h, ready: false as const };
  const { versions } = await versionHistory(db, user, h.project.id);
  return { ...h, ready: true as const, versions, current: versions[0]?.version ?? 0 };
}
