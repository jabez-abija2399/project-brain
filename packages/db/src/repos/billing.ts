import { and, count, eq, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { projects, receipts, stripeEvents, subscriptions } from "../schema";
import type { Subscription } from "../schema/billing";

export type SubscriptionWrite = {
  plan: string;
  status: string;
  founding: boolean;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

// FEAT-025: subscriptions are written only by the verified Stripe webhook (apps/web/src/server/billing.ts).
export const billingRepo = {
  async forUser(db: BrainDb, userId: string): Promise<Subscription | null> {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    return row ?? null;
  },

  async forCustomer(db: BrainDb, customerId: string): Promise<Subscription | null> {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .limit(1);
    return row ?? null;
  },

  /** Founding subscriptions ever sold (a cancelled one still counts: the offer is for the first 200). */
  async foundingCount(db: BrainDb): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(subscriptions)
      .where(eq(subscriptions.founding, true));
    return row?.n ?? 0;
  },

  async ownerOf(db: BrainDb, projectId: string): Promise<string | null> {
    const [row] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return row?.ownerId ?? null;
  },

  async ownedProjects(db: BrainDb, userId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(projects)
      .where(eq(projects.ownerId, userId));
    return row?.n ?? 0;
  },

  /** Receipts the AI judged this month across the user's projects (FEAT-025 plan limit). */
  async judgedSince(db: BrainDb, userId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(receipts)
      .innerJoin(projects, eq(projects.id, receipts.projectId))
      .where(
        and(
          eq(projects.ownerId, userId),
          sql`${receipts.createdAt} >= ${since}`,
          sql`coalesce((${receipts.summaryJson}->>'llm_calls')::int, 0) > 0`,
        ),
      );
    return row?.n ?? 0;
  },

  /** True the first time an event id is seen; a redelivered event returns false and is not applied again. */
  async markEvent(db: BrainDb, eventId: string): Promise<boolean> {
    const rows = await db
      .insert(stripeEvents)
      .values({ id: eventId })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    return rows.length > 0;
  },

  async upsert(db: BrainDb, userId: string, data: SubscriptionWrite): Promise<void> {
    await db
      .insert(subscriptions)
      .values({ userId, ...data })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        // A founding price stays founding when the row is rewritten.
        set: {
          ...data,
          founding: sql`${subscriptions.founding} or ${data.founding}`,
          updatedAt: new Date(),
        },
      });
  },

  async updateBySubscription(
    db: BrainDb,
    subscriptionId: string,
    data: Partial<
      Pick<SubscriptionWrite, "plan" | "status" | "currentPeriodEnd" | "cancelAtPeriodEnd">
    >,
  ): Promise<boolean> {
    const rows = await db
      .update(subscriptions)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(subscriptions.stripeSubscriptionId, subscriptionId)))
      .returning({ id: subscriptions.userId });
    return rows.length > 0;
  },
};
