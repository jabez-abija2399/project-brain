import { and, asc, eq, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type Directive, type NewDirective, directives, projects } from "../schema";

export type ActivateResult =
  | { kind: "activated"; directive: Directive }
  | { kind: "not_found" }
  | { kind: "not_proposal"; status: Directive["status"] }
  | { kind: "over_budget"; budget: number };

export const directivesRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewDirective, "projectId">,
  ): Promise<Directive> {
    const [row] = await db
      .insert(directives)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert directives returned no row");
    return row;
  },

  // Every active directive of the project, oldest confirmation first (so the note keeps the same order).
  async listActive(db: BrainDb, projectId: string): Promise<Directive[]> {
    return db
      .select()
      .from(directives)
      .where(and(eq(directives.projectId, projectId), eq(directives.status, "active")))
      .orderBy(asc(directives.confirmedAt), asc(directives.id));
  },

  // Confirms one proposal. Runs in a transaction that locks the project row, so two confirmations cannot both pass
  // the budget check. The budget is the total characters of all active directives.
  async activate(
    db: BrainDb,
    projectId: string,
    directiveId: string,
    budget: number,
    now: Date,
  ): Promise<ActivateResult> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${projects} WHERE id = ${projectId} FOR UPDATE`);
      const [row] = await tx
        .select()
        .from(directives)
        .where(and(eq(directives.projectId, projectId), eq(directives.id, directiveId)))
        .limit(1);
      if (!row) return { kind: "not_found" };
      if (row.status !== "proposal") return { kind: "not_proposal", status: row.status };
      const [used] = await tx
        .select({ total: sql<number>`coalesce(sum(length(${directives.text})), 0)::int` })
        .from(directives)
        .where(and(eq(directives.projectId, projectId), eq(directives.status, "active")));
      if ((used?.total ?? 0) + row.text.length > budget) return { kind: "over_budget", budget };
      const [updated] = await tx
        .update(directives)
        .set({ status: "active", confirmedAt: now })
        .where(eq(directives.id, directiveId))
        .returning();
      if (!updated) throw new Error("update directives returned no row");
      return { kind: "activated", directive: updated };
    });
  },
};
