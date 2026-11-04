// FEAT-025: plans and their limits (pure; the web app applies them only when billing is configured, D-029).
export type PlanId = "free" | "builder" | "pro" | "agency";
export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  /** Projects the account can own; null is unlimited. */
  projects: number | null;
  /** AI-judged receipts a month, across the account's projects. */
  judgedPerMonth: number;
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", priceUsd: 0, projects: 1, judgedPerMonth: 20 },
  builder: { id: "builder", name: "Builder", priceUsd: 12, projects: 5, judgedPerMonth: 150 },
  pro: { id: "pro", name: "Pro", priceUsd: 29, projects: null, judgedPerMonth: 600 },
  agency: { id: "agency", name: "Agency", priceUsd: 79, projects: 25, judgedPerMonth: 2000 },
};

/** The founding offer: Builder for $8 a month, for 12 months, for the first 200 subscriptions. */
export const FOUNDING = { plan: "builder" as PlanId, priceUsd: 8, months: 12, max: 200 };

export const isPlanId = (v: unknown): v is PlanId =>
  typeof v === "string" && Object.hasOwn(PLANS, v);

// Stripe statuses in which the subscription is paid for (past_due: Stripe is still retrying the card).
const PAID = new Set(["active", "trialing", "past_due"]);

/**
 * The plan in force: a paid Stripe status keeps the plan. Cancelling in the portal keeps the subscription active to
 * the end of the paid period; Stripe then ends it ("canceled") and the account is on Free (its data is kept).
 */
export function effectivePlan(sub: { plan: string; status: string } | null, _now?: Date): PlanId {
  if (!sub || !isPlanId(sub.plan)) return "free";
  return PAID.has(sub.status) ? sub.plan : "free";
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
