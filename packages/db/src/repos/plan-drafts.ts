import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type PlanDraft,
  type PlanDraftJson,
  type PlanQuestion,
  checklistItems,
  features,
  planDrafts,
  requests,
} from "../schema";
import { MAX_FEATURES_PER_PROJECT } from "./features";

export type ApproveResult =
  | { ok: true; featureIds: string[]; existing: string[] }
  | { ok: false; reason: "not_found" | "changed" | "too_many_features" };

export const planDraftsRepo = {
  /** Stage 1: the idea and its questions. An older open question set of the project is replaced. */
  async saveQuestions(
    db: BrainDb,
    projectId: string,
    data: {
      ideaText: string;
      questions: { restated: string[]; questions: PlanQuestion[] };
      createdBy: string;
    },
  ): Promise<PlanDraft> {
    // One plan write per project at a time, so two parallel calls cannot both keep an open question set.
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan:${projectId}`}, 0))`,
      );
      await tx
        .update(planDrafts)
        .set({ status: "replaced" })
        .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.status, "questions")));
      const [row] = await tx
        .insert(planDrafts)
        .values({
          projectId,
          status: "questions",
          ideaText: data.ideaText,
          questionsJson: data.questions,
          createdBy: data.createdBy,
        })
        .returning();
      if (!row) throw new Error("insert plan_drafts returned no row");
      return row;
    });
  },

  async byId(db: BrainDb, projectId: string, id: string): Promise<PlanDraft | null> {
    const [row] = await db
      .select()
      .from(planDrafts)
      .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.id, id)))
      .limit(1);
    return row ?? null;
  },

  /**
   * Stage 2: the question set becomes the project's draft (not active). The previous unapproved draft is replaced
   * (AC-019-07). Null when the row is no longer an open question set (answered, replaced or approved meanwhile).
   */
  async saveDraft(
    db: BrainDb,
    projectId: string,
    id: string,
    data: { answers: Record<string, string>; draft: PlanDraftJson; hash: string },
  ): Promise<PlanDraft | null> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan:${projectId}`}, 0))`,
      );
      const [current] = await tx
        .select()
        .from(planDrafts)
        .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.id, id)))
        .for("update");
      if (!current || current.status !== "questions") return null;
      await tx
        .update(planDrafts)
        .set({ status: "replaced" })
        .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.status, "draft")));
      const [row] = await tx
        .update(planDrafts)
        .set({
          status: "draft",
          answersJson: data.answers,
          draftJson: data.draft,
          draftHash: data.hash,
        })
        .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.id, id)))
        .returning();
      return row ?? null;
    });
  },

  /** The project's unapproved draft (at most one), or its newest approved plan when `status` is "approved". */
  async latest(
    db: BrainDb,
    projectId: string,
    status: "draft" | "approved",
  ): Promise<PlanDraft | null> {
    const [row] = await db
      .select()
      .from(planDrafts)
      .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.status, status)))
      .orderBy(desc(planDrafts.createdAt), desc(planDrafts.id))
      .limit(1);
    return row ?? null;
  },

  /**
   * The owner approves the draft they were shown: it must still be the project's draft with the same hash. Its new
   * features (in build order), one request per feature and its checklist items are created in one transaction, under
   * the per-project feature lock and cap. A name that exists by then is counted as existing, never duplicated.
   */
  async approve(
    db: BrainDb,
    projectId: string,
    draftId: string,
    draftHash: string,
    userId: string,
    now: Date,
  ): Promise<ApproveResult> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`features:${projectId}`}, 0))`,
      );
      const [row] = await tx
        .select()
        .from(planDrafts)
        .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.id, draftId)))
        .for("update");
      if (!row) return { ok: false, reason: "not_found" };
      if (row.status !== "draft" || row.draftHash !== draftHash || !row.draftJson) {
        return { ok: false, reason: "changed" };
      }
      const planned = row.draftJson.features.filter((f) => !f.existing);
      const [n] = await tx
        .select({ n: count() })
        .from(features)
        .where(eq(features.projectId, projectId));
      if ((n?.n ?? 0) + planned.length > MAX_FEATURES_PER_PROJECT) {
        return { ok: false, reason: "too_many_features" };
      }
      // Names compare case-insensitively, as the draft check does: a feature indexed as "accounts" after drafting is
      // not created again as "Accounts".
      const taken = new Set(
        planned.length === 0
          ? []
          : (
              await tx
                .select({ name: sql<string>`lower(${features.name})` })
                .from(features)
                .where(
                  and(
                    eq(features.projectId, projectId),
                    inArray(
                      sql`lower(${features.name})`,
                      planned.map((f) => f.name.toLowerCase()),
                    ),
                  ),
                )
            ).map((f) => f.name),
      );
      const featureIds: string[] = [];
      const existing = row.draftJson.features.filter((f) => f.existing).map((f) => f.name);
      // A later plan continues after the build order already approved; it never jumps ahead of it.
      const [last] = await tx
        .select({ max: max(features.buildOrder) })
        .from(features)
        .where(eq(features.projectId, projectId));
      let order = last?.max ?? 0;
      for (const f of planned) {
        if (taken.has(f.name.toLowerCase())) {
          existing.push(f.name);
          continue;
        }
        order += 1;
        const [feature] = await tx
          .insert(features)
          .values({ projectId, name: f.name, status: "todo", buildOrder: order })
          .returning({ id: features.id });
        if (!feature) throw new Error("insert features returned no row");
        const [request] = await tx
          .insert(requests)
          .values({ projectId, featureId: feature.id, text: `Planned feature: ${f.name}` })
          .returning({ id: requests.id });
        if (!request) throw new Error("insert requests returned no row");
        await tx.insert(checklistItems).values(
          f.items.map((item, position) => ({
            projectId,
            requestId: request.id,
            text: item.text,
            position,
          })),
        );
        featureIds.push(feature.id);
      }
      await tx
        .update(planDrafts)
        .set({ status: "approved", approvedBy: userId, approvedAt: now })
        .where(and(eq(planDrafts.projectId, projectId), eq(planDrafts.id, draftId)));
      return { ok: true, featureIds, existing };
    });
  },
};
