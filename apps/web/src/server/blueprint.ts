import {
  type BlueprintSnapshot,
  type Proof,
  SNAPSHOT_LIMITS,
  buildSnapshot,
  checkBlueprint,
  maskSecretsIn,
  parseEars,
  parseSnapshot,
  plainText,
  proofStatus,
  snapshotHash,
} from "@brain/core";
import {
  BlueprintConflictError,
  type BlueprintTx,
  type BrainDb,
  type LiveBlueprint,
  blueprintRepo,
  boundariesRepo,
  criteriaRepo,
  decisionsRepo,
  directivesRepo,
  filesRepo,
} from "@brain/db";
import { z } from "zod";
import { type SessionUser, requireProjectAccess } from "./auth";
import { AppError } from "./errors";
import { blueprintEnabled } from "./migration-check";

// Roadmap Phase 3a: the Project Blueprint, owner side (dashboard routes, session auth only). Every function checks the
// session user owns the project first; agents never reach these (they propose through MCP, blueprint-agent.ts).

const text300 = z.string().trim().min(1).max(300);
const id = z.string().min(1).max(100);
const pattern = z.string().trim().min(1).max(200);
const kind = z.enum(["behaviour", "must_never", "security"]);
const op = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("setPurpose"),
      featureId: id,
      purpose: z.string().trim().max(300).nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal("setBuildOrder"),
      featureId: id,
      buildOrder: z.number().int().min(0).max(10_000).nullable(),
    })
    .strict(),
  z
    .object({ op: z.literal("setDependencies"), featureId: id, dependsOn: z.array(id).max(50) })
    .strict(),
  z
    .object({ op: z.literal("setAreas"), featureId: id, patterns: z.array(pattern).max(50) })
    .strict(),
  z.object({ op: z.literal("addCriterion"), featureId: id, text: text300, kind }).strict(),
  z
    .object({ op: z.literal("editCriterion"), id, text: text300.optional(), kind: kind.optional() })
    .strict(),
  z.object({ op: z.literal("retireCriterion"), id }).strict(),
  z
    .object({
      op: z.literal("linkTest"),
      criterionId: id,
      fileId: id,
      testName: z.string().trim().max(200).nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal("addBoundary"),
      kind: z.enum(["protected_path", "allowed_dependency", "disallowed_dependency"]),
      pattern,
      note: z.string().trim().max(300).nullable(),
    })
    .strict(),
  z.object({ op: z.literal("dismissBoundary"), id }).strict(),
]);
export const editSchema = z
  .object({ baseVersion: z.number().int().min(0), ops: z.array(op).min(1).max(50) })
  .strict();
export type BlueprintOp = z.infer<typeof op>;
const decideSchema = z
  .object({
    kind: z.enum(["criterion", "boundary"]),
    id,
    accept: z.boolean(),
    baseVersion: z.number().int().min(0),
  })
  .strict();
const restoreSchema = z
  .object({ version: z.number().int().min(1), baseVersion: z.number().int().min(0) })
  .strict();
// Restore runs inside the project's lock; past this many rows the owner edits instead (batched restore: later.md).
export const MAX_RESTORE_ROWS = 2_000;

// Saved text is one line, without invisible marks, masked (AGENTS.md: secrets are masked before they are stored).
const clean = (value: string, max = 300) => maskSecretsIn(plainText(value)).slice(0, max);
export const cleanBlueprintText = (value: string) => clean(value);

function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) fields[i.path.join(".") || "_"] = i.message;
  throw new AppError(400, "invalid_input", "input validation failed", fields);
}

export async function blueprintReady(db: BrainDb, user: SessionUser, projectId: string) {
  const project = await requireProjectAccess(db, projectId, user);
  if (!(await blueprintEnabled(db))) {
    throw new AppError(
      404,
      "blueprint_not_ready",
      "the Blueprint is being set up; try again later",
    );
  }
  return project.id;
}

// The snapshot of the live rows plus the active rules and the newest decisions.
async function snapshotFor(db: BlueprintTx, projectId: string, live: LiveBlueprint) {
  const [directives, decisions] = await Promise.all([
    directivesRepo.listActive(db as BrainDb, projectId),
    decisionsRepo.listNewest(db as BrainDb, projectId, 20),
  ]);
  return toSnapshot(
    live,
    directives.map((d) => ({ id: d.id, text: clean(d.text) })),
    decisions.map((d) => d.id),
  );
}

function toSnapshot(
  live: LiveBlueprint,
  directives: { id: string; text: string }[],
  decisions: string[],
): BlueprintSnapshot {
  const active = live.criteria.filter((c) => c.status === "active");
  return buildSnapshot({
    features: live.features.map((f) => ({
      id: f.id,
      name: f.name,
      purpose: f.description,
      buildOrder: f.buildOrder,
      dependsOn: live.dependencies.filter((d) => d.featureId === f.id).map((d) => d.dependsOnId),
      areas: live.areas.filter((a) => a.featureId === f.id).map((a) => a.pattern),
      criteria: active
        .filter((c) => c.featureId === f.id)
        .map((c) => ({
          id: c.id,
          text: c.text,
          ears: parseEars(c.text),
          kind: c.kind,
          tests: live.tests
            .filter((t) => t.criterionId === c.id)
            .map((t) => ({ fileId: t.fileId, testName: t.testName })),
        })),
    })),
    boundaries: live.boundaries
      .filter((b) => b.status === "active")
      .map((b) => ({ id: b.id, kind: b.kind, pattern: b.pattern, note: b.note })),
    directives,
    decisions,
  });
}

/** The Blueprint as the dashboard shows it: live rows, version, flags per feature and proof per criterion. */
export async function blueprintView(db: BrainDb, user: SessionUser, projectId: string) {
  const pid = await blueprintReady(db, user, projectId);
  const [live, version, items] = await Promise.all([
    blueprintRepo.live(db, pid),
    blueprintRepo.currentVersion(db, pid),
    criteriaRepo.itemStatuses(db, pid),
  ]);
  const checks = checkBlueprint({
    features: live.features.map((f) => ({
      id: f.id,
      criteria: live.criteria.filter((c) => c.featureId === f.id),
    })),
  });
  const contradicted = new Set(checks.flatMap((c) => c.contradictions.flatMap((x) => [x.a, x.b])));
  const proof: Record<string, Proof> = {};
  for (const c of live.criteria) {
    // Honest evidence: a linked test with no recorded result is not proof (results arrive in Phase 4).
    const tests = live.tests
      .filter((t) => t.criterionId === c.id)
      .map(() => ({ present: true, lastResult: null }));
    // Phase 3b: a linked checklist item that receipts (or the owner) marked done is "done, not proven".
    proof[c.id] = proofStatus({
      tests,
      itemStatus: items.get(c.id) ?? null,
      contradicted: contradicted.has(c.id),
    });
  }
  return { version, ...live, checks, proof };
}

function cycle(edges: { featureId: string; dependsOnId: string }[]): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.featureId, [...(next.get(e.featureId) ?? []), e.dependsOnId]);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    for (const m of next.get(n) ?? []) if (visit(m)) return true;
    state.set(n, 2);
    return false;
  };
  return [...next.keys()].some(visit);
}

async function applyOp(tx: BlueprintTx, pid: string, o: BlueprintOp, featureIds: Set<string>) {
  const feature = (fid: string) => {
    if (!featureIds.has(fid))
      throw new AppError(404, "not_found", "no such feature in this project");
  };
  const criterion = async (cid: string) => {
    const c = await criteriaRepo.get(tx, pid, cid);
    if (!c) throw new AppError(404, "not_found", "no such criterion in this project");
    return c;
  };
  switch (o.op) {
    case "setPurpose":
      feature(o.featureId);
      return blueprintRepo.setPurpose(tx, pid, o.featureId, o.purpose ? clean(o.purpose) : null);
    case "setBuildOrder":
      feature(o.featureId);
      return blueprintRepo.setBuildOrder(tx, pid, o.featureId, o.buildOrder);
    case "setDependencies":
      feature(o.featureId);
      for (const d of o.dependsOn) feature(d);
      return blueprintRepo.setDependencies(
        tx,
        pid,
        o.featureId,
        [...new Set(o.dependsOn)].filter((d) => d !== o.featureId),
      );
    case "setAreas":
      feature(o.featureId);
      return blueprintRepo.setAreas(tx, pid, o.featureId, [
        ...new Set(o.patterns.map((p) => clean(p, SNAPSHOT_LIMITS.pattern))),
      ]);
    case "addCriterion": {
      feature(o.featureId);
      const text = clean(o.text);
      await criteriaRepo.insert(tx, pid, {
        featureId: o.featureId,
        text,
        ears: parseEars(text),
        kind: o.kind,
        createdBy: "owner",
        status: "active",
      });
      return;
    }
    case "editCriterion": {
      await criterion(o.id);
      const text = o.text ? clean(o.text) : undefined;
      return criteriaRepo.update(tx, pid, o.id, {
        ...(text ? { text, ears: parseEars(text) } : {}),
        ...(o.kind ? { kind: o.kind } : {}),
        proposedChange: null,
        proposedAt: null,
      });
    }
    case "retireCriterion":
      await criterion(o.id);
      return criteriaRepo.update(tx, pid, o.id, {
        status: "retired",
        proposedChange: null,
        proposedAt: null,
      });
    case "linkTest": {
      await criterion(o.criterionId);
      const [file] = await filesRepo.byIds(tx as BrainDb, pid, [o.fileId]);
      if (!file) throw new AppError(404, "not_found", "no such file in this project");
      return criteriaRepo.linkTest(
        tx,
        pid,
        o.criterionId,
        o.fileId,
        o.testName ? clean(o.testName) : null,
      );
    }
    case "addBoundary":
      await boundariesRepo.insert(tx, pid, {
        kind: o.kind,
        pattern: clean(o.pattern, SNAPSHOT_LIMITS.pattern),
        note: o.note ? clean(o.note) : null,
        createdBy: "owner",
        status: "active",
      });
      return;
    case "dismissBoundary":
      if (!(await boundariesRepo.get(tx, pid, o.id))) throw new AppError(404, "not_found");
      return boundariesRepo.setStatus(tx, pid, o.id, "dismissed");
  }
}

export async function commitBlueprint(
  db: BlueprintTx,
  userId: string,
  pid: string,
  baseVersion: number,
  reason: "edit" | "accept_proposal" | "restore" | "plan_approve",
  apply: (tx: BlueprintTx) => Promise<void>,
  restoredFrom?: number,
) {
  try {
    let snap: BlueprintSnapshot | null = null;
    const version = await blueprintRepo.commit(db, pid, {
      userId,
      baseVersion,
      reason,
      restoredFrom,
      apply: async (tx) => {
        await apply(tx);
        const live = await blueprintRepo.live(tx, pid);
        if (cycle(live.dependencies))
          throw new AppError(
            400,
            "invalid_input",
            "features cannot depend on each other in a circle",
          );
        const built = await snapshotFor(tx, pid, live);
        // A version that could not be restored later is refused now (all or nothing).
        try {
          parseSnapshot(built);
        } catch {
          throw new AppError(
            413,
            "blueprint_too_large",
            "the Blueprint would be too large to save; retire criteria or tests first",
          );
        }
        snap = built;
      },
      snapshot: () => {
        if (!snap) throw new Error("snapshot not built");
        return { snapshot: snap, hash: snapshotHash(snap) };
      },
    });
    return { ok: true as const, version };
  } catch (err) {
    if (err instanceof BlueprintConflictError) {
      throw new AppError(
        409,
        "blueprint_changed",
        "the Blueprint changed since you opened it; reload to see it",
      );
    }
    throw err;
  }
}

/** Owner edits, all or nothing, as one new version. */
export async function editBlueprint(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  raw: z.input<typeof editSchema>,
) {
  const pid = await blueprintReady(db, user, projectId);
  const input = parseInput(editSchema, raw);
  return commitBlueprint(db, user.id, pid, input.baseVersion, "edit", async (tx) => {
    const featureIds = new Set((await blueprintRepo.live(tx, pid)).features.map((f) => f.id));
    for (const o of input.ops) await applyOp(tx, pid, o, featureIds);
  });
}

/** The owner accepts or dismisses an agent's proposal (a new criterion or boundary, or a change to a criterion). */
export async function decideProposal(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  raw: { kind: "criterion" | "boundary"; id: string; accept: boolean; baseVersion: number },
) {
  const pid = await blueprintReady(db, user, projectId);
  const input = parseInput(decideSchema, raw);
  return commitBlueprint(db, user.id, pid, input.baseVersion, "accept_proposal", async (tx) => {
    if (input.kind === "boundary") {
      const b = await boundariesRepo.get(tx, pid, input.id);
      if (!b || b.status !== "proposal") throw new AppError(404, "not_found", "no such proposal");
      return boundariesRepo.setStatus(tx, pid, input.id, input.accept ? "active" : "dismissed");
    }
    const c = await criteriaRepo.get(tx, pid, input.id);
    if (!c || (c.status !== "proposal" && !c.proposedChange))
      throw new AppError(404, "not_found", "no such proposal");
    if (c.status === "proposal") {
      return criteriaRepo.update(tx, pid, c.id, { status: input.accept ? "active" : "retired" });
    }
    const change = c.proposedChange ?? {};
    const text = input.accept && change.text ? clean(change.text) : undefined;
    return criteriaRepo.update(tx, pid, c.id, {
      ...(input.accept && change.retire ? { status: "retired" as const } : {}),
      ...(text ? { text, ears: parseEars(text) } : {}),
      proposedChange: null,
      proposedAt: null,
    });
  });
}

/** One-click restore: version N's spec becomes current as a new version. Nothing is deleted. */
export async function restoreVersion(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  raw: { version: number; baseVersion: number },
) {
  const pid = await blueprintReady(db, user, projectId);
  const input = parseInput(restoreSchema, raw);
  const row = await blueprintRepo.getVersion(db, pid, input.version);
  if (!row) throw new AppError(404, "not_found", "no such version");
  const snap = parseSnapshot(row.snapshot);
  const rows =
    snap.features.length +
    snap.boundaries.length +
    snap.features.reduce((n, f) => n + f.criteria.length, 0);
  if (rows > MAX_RESTORE_ROWS) {
    throw new AppError(
      413,
      "blueprint_too_large",
      "this version is too large to restore in one step",
    );
  }
  return commitBlueprint(
    db,
    user.id,
    pid,
    input.baseVersion,
    "restore",
    async (tx) => restoreInto(tx, pid, snap),
    input.version,
  );
}

async function restoreInto(tx: BlueprintTx, pid: string, snap: BlueprintSnapshot) {
  const live = await blueprintRepo.live(tx, pid);
  const existing = new Set(live.features.map((f) => f.id));
  const kept = new Set<string>();
  for (const f of snap.features) {
    if (!existing.has(f.id)) continue; // a feature deleted since then stays deleted (its criteria went with it)
    await blueprintRepo.setPurpose(tx, pid, f.id, f.purpose);
    await blueprintRepo.setBuildOrder(tx, pid, f.id, f.buildOrder);
    await blueprintRepo.setDependencies(
      tx,
      pid,
      f.id,
      f.dependsOn.filter((d) => existing.has(d)),
    );
    await blueprintRepo.setAreas(tx, pid, f.id, f.areas);
    for (const c of f.criteria) {
      kept.add(c.id);
      const row = await criteriaRepo.get(tx, pid, c.id);
      if (row) {
        await criteriaRepo.update(tx, pid, c.id, {
          text: c.text,
          ears: c.ears,
          kind: c.kind,
          status: "active",
          proposedChange: null,
          proposedAt: null,
        });
      } else {
        await criteriaRepo.insert(tx, pid, {
          id: c.id,
          featureId: f.id,
          text: c.text,
          ears: c.ears,
          kind: c.kind,
          createdBy: "owner",
          status: "active",
        });
      }
    }
  }
  // Active criteria the old version did not have are retired, never deleted (receipts and links keep working).
  for (const c of live.criteria)
    if (c.status === "active" && !kept.has(c.id))
      await criteriaRepo.update(tx, pid, c.id, { status: "retired" });
  const keptBoundaries = new Set(snap.boundaries.map((b) => b.id));
  for (const b of await boundariesRepo.all(tx, pid)) {
    const want = keptBoundaries.has(b.id)
      ? "active"
      : b.status === "active"
        ? "dismissed"
        : b.status;
    if (want !== b.status) await boundariesRepo.setStatus(tx, pid, b.id, want);
  }
  for (const b of snap.boundaries) {
    if (!(await boundariesRepo.get(tx, pid, b.id))) {
      await boundariesRepo.insert(tx, pid, {
        id: b.id,
        kind: b.kind,
        pattern: b.pattern,
        note: b.note,
        createdBy: "owner",
        status: "active",
      });
    }
  }
}

export async function versionHistory(db: BrainDb, user: SessionUser, projectId: string) {
  const pid = await blueprintReady(db, user, projectId);
  return { versions: await blueprintRepo.listVersions(db, pid) };
}
