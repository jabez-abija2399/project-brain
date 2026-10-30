import { and, desc, eq, gt, isNotNull, lt } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type DeviceCode, deviceCodes } from "../schema";
import { isUniqueViolation } from "./features";
import { projectTokensRepo } from "./project-tokens";

export type PollResult =
  | { status: "invalid" | "expired" | "denied" | "pending" | "slow_down" }
  | { status: "approved"; token: string; projectId: string };

export const deviceCodesRepo = {
  /** The project this user most recently linked with `npx codeceipt` (a code they approved and the CLI collected). */
  async lastLinkedProject(db: BrainDb, userId: string): Promise<string | null> {
    const [row] = await db
      .select({ projectId: deviceCodes.projectId })
      .from(deviceCodes)
      .where(
        and(
          eq(deviceCodes.userId, userId),
          eq(deviceCodes.status, "used"),
          isNotNull(deviceCodes.projectId),
        ),
      )
      .orderBy(desc(deviceCodes.createdAt), desc(deviceCodes.id))
      .limit(1);
    return row?.projectId ?? null;
  },

  /** A new pending code. Null when the user code is already taken by a pending code (the caller picks another). */
  async create(
    db: BrainDb,
    data: {
      deviceCodeHash: string;
      userCode: string;
      suggestedName: string | null;
      expiresAt: Date;
    },
    now: Date,
  ): Promise<DeviceCode | null> {
    // Codes expired for a day are removed as new ones are made, so the table stays small.
    await db
      .delete(deviceCodes)
      .where(lt(deviceCodes.expiresAt, new Date(now.getTime() - 86_400_000)));
    try {
      const [row] = await db.insert(deviceCodes).values(data).returning();
      return row ?? null;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  },

  /** The pending, unexpired code a user typed or followed (approval page). */
  async pendingByUserCode(db: BrainDb, userCode: string, now: Date): Promise<DeviceCode | null> {
    const [row] = await db
      .select()
      .from(deviceCodes)
      .where(
        and(
          eq(deviceCodes.userCode, userCode),
          eq(deviceCodes.status, "pending"),
          gt(deviceCodes.expiresAt, now),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /** Approves (for a project) or denies a pending, unexpired code; false when it is no longer pending. */
  async decide(
    db: BrainDb,
    userCode: string,
    decision: { userId: string; projectId: string } | { userId: string; deny: true },
    now: Date,
  ): Promise<boolean> {
    const rows = await db
      .update(deviceCodes)
      .set(
        "deny" in decision
          ? { status: "denied", userId: decision.userId }
          : { status: "approved", userId: decision.userId, projectId: decision.projectId },
      )
      .where(
        and(
          eq(deviceCodes.userCode, userCode),
          eq(deviceCodes.status, "pending"),
          gt(deviceCodes.expiresAt, now),
        ),
      )
      .returning({ id: deviceCodes.id });
    return rows.length > 0;
  },

  /**
   * The CLI's poll. Under a row lock: a poll sooner than `minIntervalMs` after the last is slow_down; an approved
   * code is marked used and a new project token is minted in the same transaction, so a code yields one token at most.
   */
  async poll(
    db: BrainDb,
    deviceCodeHash: string,
    now: Date,
    minIntervalMs: number,
  ): Promise<PollResult> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(deviceCodes)
        .where(eq(deviceCodes.deviceCodeHash, deviceCodeHash))
        .for("update");
      if (!row || row.status === "used") return { status: "invalid" };
      if (row.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
      if (row.status === "denied") return { status: "denied" };
      const tooSoon =
        row.lastPolledAt !== null && now.getTime() - row.lastPolledAt.getTime() < minIntervalMs;
      await tx.update(deviceCodes).set({ lastPolledAt: now }).where(eq(deviceCodes.id, row.id));
      if (tooSoon) return { status: "slow_down" };
      if (row.status === "pending" || !row.projectId) return { status: "pending" };
      await tx.update(deviceCodes).set({ status: "used" }).where(eq(deviceCodes.id, row.id));
      const { token } = await projectTokensRepo.create(tx as unknown as BrainDb, row.projectId);
      return { status: "approved", token, projectId: row.projectId };
    });
  },
};
