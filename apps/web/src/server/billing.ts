// FEAT-025: plans and billing (D-029). Stripe Checkout and the customer portal hold every card; the plan changes only
// from Stripe's webhook after its signature is verified, and prices come from server env, never from the client.
// Limits apply only when STRIPE_SECRET_KEY is set, so a self-hosted or test deployment is unlimited.
import { FOUNDING, PLANS, type PlanId, effectivePlan, isPlanId, monthStart } from "@brain/core";
import { type BrainDb, billingRepo, projectsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { z } from "zod";
import type { SessionUser } from "./auth";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";

export type CheckoutArgs = {
  priceId: string;
  couponId: string | null;
  userId: string;
  email: string;
  customerId: string;
  plan: PlanId;
  founding: boolean;
  successUrl: string;
  cancelUrl: string;
};
/** A subscription as Stripe has it now (read back on every event, so event order and replays do not matter). */
export type StripeSubscription = {
  id: string;
  customerId: string;
  status: string;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, string>;
};
export type BillingGateway = {
  customer(email: string, userId: string): Promise<string>;
  subscription(id: string): Promise<StripeSubscription | null>;
  checkout(args: CheckoutArgs): Promise<string>;
  portal(customerId: string, returnUrl: string): Promise<string>;
  /** The verified event; throws when the signature or the body is not Stripe's. */
  event(body: string, signature: string | null): Stripe.Event;
};

export const billingEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

const priceEnv: Record<Exclude<PlanId, "free">, string> = {
  builder: "STRIPE_PRICE_BUILDER",
  pro: "STRIPE_PRICE_PRO",
  agency: "STRIPE_PRICE_AGENCY",
};

/** A price id from Stripe back to the plan it sells (only our own configured prices count). */
export function planForPrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const [plan, name] of Object.entries(priceEnv)) {
    if (process.env[name] && process.env[name] === priceId) return plan as PlanId;
  }
  return null;
}

export function stripeGateway(): BillingGateway {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new AppError(503, "billing_not_configured", "billing is not set up");
  const stripe = new Stripe(key);
  return {
    async customer(email, userId) {
      const c = await stripe.customers.create({ email, metadata: { user_id: userId } });
      return c.id;
    },
    async subscription(subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        const item = sub.items.data[0] as
          | (Stripe.SubscriptionItem & { current_period_end?: number })
          | undefined;
        const end = item?.current_period_end;
        return {
          id: sub.id,
          customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          status: sub.status,
          priceId: item?.price.id ?? null,
          currentPeriodEnd: typeof end === "number" ? new Date(end * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          metadata: sub.metadata ?? {},
        };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async checkout(a) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: a.priceId, quantity: 1 }],
        client_reference_id: a.userId,
        customer: a.customerId,
        ...(a.couponId ? { discounts: [{ coupon: a.couponId }] } : {}),
        metadata: { user_id: a.userId, plan: a.plan, founding: String(a.founding) },
        subscription_data: {
          metadata: { user_id: a.userId, plan: a.plan, founding: String(a.founding) },
        },
        success_url: a.successUrl,
        cancel_url: a.cancelUrl,
      });
      if (!session.url)
        throw new AppError(502, "billing_unavailable", "Stripe gave no checkout page");
      return session.url;
    },
    async portal(customerId, returnUrl) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return session.url;
    },
    event(body, signature) {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret || !signature) throw new Error("unsigned");
      return stripe.webhooks.constructEvent(body, signature, secret);
    },
  };
}

let testGateway: BillingGateway | null = null;
/** Tests only: a gateway in place of Stripe's API (signatures are still checked by the real SDK in the tests). */
export function setBillingGatewayForTests(g: BillingGateway | null): void {
  testGateway = g;
}
export const billingGateway = (): BillingGateway => testGateway ?? stripeGateway();

export async function planOf(db: BrainDb, userId: string, now = new Date()): Promise<PlanId> {
  return effectivePlan(await billingRepo.forUser(db, userId), now);
}

/** The founding offer is on sale while fewer than 200 founding subscriptions exist. */
export async function foundingAvailable(db: BrainDb): Promise<boolean> {
  return (await billingRepo.foundingCount(db)) < FOUNDING.max;
}

const checkoutSchema = z
  .object({ plan: z.enum(["builder", "pro", "agency", "founding"]) })
  .strict();

export async function startCheckout(
  db: BrainDb,
  user: SessionUser,
  raw: unknown,
  origin: string,
  gateway: BillingGateway = billingGateway(),
): Promise<{ url: string }> {
  if (!billingEnabled()) throw new AppError(503, "billing_not_configured", "billing is not set up");
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError(400, "invalid_input", "pick builder, pro, agency or founding");
  await rateLimit(db, `checkout:${user.id}`, 10);
  const founding = parsed.data.plan === "founding";
  const plan: Exclude<PlanId, "free"> = founding ? "builder" : (parsed.data.plan as "builder");
  if (founding && !(await foundingAvailable(db))) {
    throw new AppError(409, "founding_sold_out", "the founding offer has sold out");
  }
  const current = await billingRepo.forUser(db, user.id);
  if (effectivePlan(current, new Date()) !== "free" && current?.status !== "canceled") {
    throw new AppError(
      409,
      "already_subscribed",
      "you already have a plan: change it in Manage billing",
    );
  }
  const customerId =
    current?.stripeCustomerId ??
    (await billingRepo.customerFor(db, user.id)) ??
    (await billingRepo.saveCustomer(db, user.id, await gateway.customer(user.email, user.id)));
  const priceId = process.env[priceEnv[plan]];
  const couponId = founding ? (process.env.STRIPE_COUPON_FOUNDING ?? null) : null;
  if (!priceId || (founding && !couponId)) {
    throw new AppError(503, "billing_not_configured", "this plan is not on sale yet");
  }
  const url = await gateway.checkout({
    priceId,
    couponId,
    userId: user.id,
    email: user.email,
    customerId,
    plan,
    founding,
    successUrl: `${origin}/account?billing=success`,
    cancelUrl: `${origin}/pricing`,
  });
  return { url };
}

export async function openPortal(
  db: BrainDb,
  user: SessionUser,
  origin: string,
  gateway: BillingGateway = billingGateway(),
): Promise<{ url: string }> {
  const current = await billingRepo.forUser(db, user.id);
  if (!current) throw new AppError(404, "not_found", "no subscription to manage");
  await rateLimit(db, `portal:${user.id}`, 10);
  return { url: await gateway.portal(current.stripeCustomerId, `${origin}/account`) };
}

const MAX_WEBHOOK_BYTES = 256 * 1024;
const id = (v: unknown) => (typeof v === "string" ? v : (v as { id?: unknown } | null)?.id);
const str = (v: unknown) => (typeof v === "string" && v.length <= 255 ? v : null);

/** Stripe's webhook: the signature is checked before anything else; each event id is applied once. */
export async function handleStripeWebhook(
  db: BrainDb,
  req: Request,
  gateway: BillingGateway = billingGateway(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = await req.text();
  if (body.length > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "too_large" } };
  let event: Stripe.Event;
  try {
    event = gateway.event(body, req.headers.get("stripe-signature"));
  } catch {
    return { status: 400, body: { error: "bad_signature" } };
  }
  const applied = await db.transaction(async (tx) => {
    const t = tx as unknown as BrainDb;
    if (!(await billingRepo.markEvent(t, event.id))) return false;
    await applyEvent(t, event, gateway);
    return true;
  });
  return { status: 200, body: { ok: true, ...(applied ? {} : { duplicate: true }) } };
}

/**
 * Every subscription event (and a completed checkout) is applied by reading the subscription back from Stripe and
 * writing its current state, so a late, retried or out-of-order event can never bring back an old state (security
 * review). The user comes from the row already stored, or from metadata our own server set at checkout.
 */
async function applyEvent(
  db: BrainDb,
  event: Stripe.Event,
  gateway: BillingGateway,
): Promise<void> {
  const obj = event.data.object as unknown as Record<string, unknown>;
  let subId: string | null = null;
  if (event.type === "checkout.session.completed") {
    if (obj.mode === "subscription") subId = str(id(obj.subscription));
  } else if (event.type.startsWith("customer.subscription.")) {
    subId = str(obj.id);
  }
  if (!subId) return;
  const sub = await gateway.subscription(subId);
  if (!sub) return;
  const existing = await billingRepo.forSubscription(db, sub.id);
  const userId = existing?.userId ?? str(sub.metadata.user_id);
  const plan = planForPrice(sub.priceId);
  if (!userId || !plan) return;
  const current = existing ?? (await billingRepo.forUser(db, userId));
  // A second live subscription for the same user (two checkouts at once) never replaces the first one's row; both
  // are on the same Stripe customer, so the portal shows and cancels either.
  if (current && current.stripeSubscriptionId !== sub.id && effectivePlan(current) !== "free") {
    console.warn("[billing]", JSON.stringify({ event: "second_subscription_ignored" }));
    return;
  }
  await billingRepo.upsert(db, userId, {
    plan,
    status: sub.status,
    founding: sub.metadata.founding === "true",
    stripeCustomerId: sub.customerId,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  });
}

/** Project creation: the plan's project count (only when billing is on). */
export async function assertCanCreateProject(db: BrainDb, userId: string): Promise<void> {
  if (!billingEnabled()) return;
  const plan = PLANS[await planOf(db, userId)];
  if (plan.projects === null) return;
  if ((await billingRepo.ownedProjects(db, userId)) >= plan.projects) {
    throw new AppError(
      402,
      "plan_limit",
      `Your ${plan.name} plan allows ${plan.projects} project${plan.projects === 1 ? "" : "s"}. Upgrade on /pricing.`,
    );
  }
}

/**
 * Creates a project within the owner's plan limit. The check and the insert run under one per-owner lock in one
 * transaction (backlog 2026-11-11), so parallel creates cannot pass the limit together. `then` runs inside the same
 * transaction (the device flow records its decision there, so a refused decision rolls the project back).
 */
export async function createProjectWithinLimit<T = void>(
  db: BrainDb,
  userId: string,
  name: string,
  then?: (tx: BrainDb, projectId: string) => Promise<T>,
): Promise<{
  id: string;
  project: Awaited<ReturnType<typeof projectsRepo.create>>;
  result: T | undefined;
}> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as BrainDb;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`projects:${userId}`}, 0))`,
    );
    await assertCanCreateProject(t, userId);
    const project = await projectsRepo.create(t, userId, { name });
    const result = then ? await then(t, project.id) : undefined;
    return { id: project.id, project, result };
  });
}

/**
 * Counts one AI-judged receipt against the project owner's plan for this month; false when the month's are used up
 * (always true without billing). The count never goes down, so deleting receipts or projects gives none back.
 */
export async function judgeAllowed(
  db: BrainDb,
  projectId: string,
  now = new Date(),
): Promise<boolean> {
  if (!billingEnabled()) return true;
  const ownerId = await billingRepo.ownerOf(db, projectId);
  if (!ownerId) return false;
  const plan = PLANS[await planOf(db, ownerId, now)];
  const month = monthStart(now).toISOString().slice(0, 10);
  return billingRepo.reserveJudged(db, ownerId, month, plan.judgedPerMonth);
}

export const PLAN_LIMIT_NOTE =
  "Not checked by AI: your plan's AI-judged receipts for this month are used up. Upgrade on /pricing.";
