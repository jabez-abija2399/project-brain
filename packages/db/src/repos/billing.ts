import { and, count, eq, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { billingCustomers, judgedUsage, projects, stripeEvents, subscriptions } from "../schema";
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

  async forSubscription(db: BrainDb, subscriptionId: string): Promise<Subscription | null> {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
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

  /** Counts one AI-judged receipt for the user's month, only while under the limit (atomic; never counted back). */
  async reserveJudged(db: BrainDb, userId: string, month: string, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    const rows = await db
      .insert(judgedUsage)
      .values({ userId, month, n: 1 })
      .onConflictDoUpdate({
        target: [judgedUsage.userId, judgedUsage.month],
        set: { n: sql`${judgedUsage.n} + 1` },
        setWhere: sql`${judgedUsage.n} < ${limit}`,
      })
      .returning({ n: judgedUsage.n });
    return rows.length > 0;
  },

  async customerFor(db: BrainDb, userId: string): Promise<string | null> {
    const [row] = await db
      .select({ id: billingCustomers.stripeCustomerId })
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, userId))
      .limit(1);
    return row?.id ?? null;
  },

  /** Stores the user's Stripe customer; when another request stored one first, that one is returned. */
  async saveCustomer(db: BrainDb, userId: string, customerId: string): Promise<string> {
    await db
      .insert(billingCustomers)
      .values({ userId, stripeCustomerId: customerId })
      .onConflictDoNothing();
    return (await this.customerFor(db, userId)) ?? customerId;
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
};
