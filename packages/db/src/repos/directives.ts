import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type Directive, type NewDirective, directives, projects } from "../schema";

export type ActivateResult =
  | { kind: "activated"; directive: Directive }
  | { kind: "not_found" }
  | { kind: "not_proposal"; status: Directive["status"] }
  | { kind: "over_budget"; budget: number }
  | { kind: "too_many"; max: number };

// Caps the number of active directives, so the handoff note can always keep every one of them.
export const MAX_ACTIVE_DIRECTIVES = 50;

// Backlog (FEAT-010 [ASSUME]): a proposal not confirmed within 30 days is no longer offered.
export const PROPOSAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const directivesRepo = {
  /** Proposals still waiting for the owner, newest first (older than 30 days are left out). */
  async listProposals(db: BrainDb, projectId: string, now: Date, limit = 50): Promise<Directive[]> {
    return db
      .select()
      .from(directives)
      .where(
        and(
          eq(directives.projectId, projectId),
          eq(directives.status, "proposal"),
          gt(directives.createdAt, new Date(now.getTime() - PROPOSAL_MAX_AGE_MS)),
        ),
      )
      .orderBy(desc(directives.createdAt), desc(directives.id))
      .limit(limit);
  },

  /** The owner dismisses a proposal; false when there is no such proposal in this project. */
  async dismiss(
    db: BrainDb,
    projectId: string,
    directiveId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const rows = await db
      .update(directives)
      .set({ status: "dismissed" })
      .where(
        and(
          eq(directives.projectId, projectId),
          eq(directives.id, directiveId),
          eq(directives.status, "proposal"),
          gt(directives.createdAt, new Date(now.getTime() - PROPOSAL_MAX_AGE_MS)),
        ),
      )
      .returning({ id: directives.id });
    return rows.length > 0;
  },

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
      // A proposal past its 30 days is no longer offered, so it cannot be confirmed either (security review).
      if (row.createdAt.getTime() <= now.getTime() - PROPOSAL_MAX_AGE_MS)
        return { kind: "not_found" };
      // Lengths are counted in JavaScript units, the same units the note and the zod cap use.
      const active = await tx
        .select({ text: directives.text })
        .from(directives)
        .where(and(eq(directives.projectId, projectId), eq(directives.status, "active")));
      if (active.length >= MAX_ACTIVE_DIRECTIVES)
        return { kind: "too_many", max: MAX_ACTIVE_DIRECTIVES };
      const used = active.reduce((sum, d) => sum + d.text.length, 0);
      if (used + row.text.length > budget) return { kind: "over_budget", budget };
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
