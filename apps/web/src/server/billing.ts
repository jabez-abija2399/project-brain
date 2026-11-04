// FEAT-025: plans and billing (D-029). Stripe Checkout and the customer portal hold every card; the plan changes only
// from Stripe's webhook after its signature is verified, and prices come from server env, never from the client.
// Limits apply only when STRIPE_SECRET_KEY is set, so a self-hosted or test deployment is unlimited.
import { FOUNDING, PLANS, type PlanId, effectivePlan, isPlanId, monthStart } from "@brain/core";
import { type BrainDb, billingRepo } from "@brain/db";
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
  customerId: string | null;
  plan: PlanId;
  founding: boolean;
  successUrl: string;
  cancelUrl: string;
};
export type BillingGateway = {
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
    async checkout(a) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: a.priceId, quantity: 1 }],
        client_reference_id: a.userId,
        ...(a.customerId ? { customer: a.customerId } : { customer_email: a.email }),
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
  gateway: BillingGateway = stripeGateway(),
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
    customerId: current?.stripeCustomerId ?? null,
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
  gateway: BillingGateway = stripeGateway(),
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
  gateway: BillingGateway = stripeGateway(),
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
    await applyEvent(t, event);
    return true;
  });
  return { status: 200, body: { ok: true, ...(applied ? {} : { duplicate: true }) } };
}

type SubLike = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
};

function periodEnd(sub: SubLike): Date | null {
  const end = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  return typeof end === "number" ? new Date(end * 1000) : null;
}

async function applyEvent(db: BrainDb, event: Stripe.Event): Promise<void> {
  const obj = event.data.object as unknown as Record<string, unknown>;
  if (event.type === "checkout.session.completed") {
    if (obj.mode !== "subscription") return;
    // Set by our own server when it made the session (startCheckout), and delivered in a signed event.
    const userId = str(obj.client_reference_id);
    const meta = (obj.metadata ?? {}) as Record<string, unknown>;
    const customerId = str(id(obj.customer));
    const subscriptionId = str(id(obj.subscription));
    if (!userId || !customerId || !subscriptionId || !isPlanId(meta.plan) || meta.plan === "free") {
      return;
    }
    await billingRepo.upsert(db, userId, {
      plan: meta.plan,
      status: "active",
      founding: meta.founding === "true",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    return;
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.created"
  ) {
    const sub = obj as unknown as SubLike;
    if (!str(sub.id)) return;
    const plan = planForPrice(sub.items?.data?.[0]?.price?.id);
    await billingRepo.updateBySubscription(db, sub.id, {
      ...(plan ? { plan } : {}),
      status: event.type === "customer.subscription.deleted" ? "canceled" : String(sub.status),
      currentPeriodEnd: periodEnd(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    });
  }
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

/** True while the project owner's plan still has AI-judged receipts this month (always true without billing). */
export async function judgeAllowed(
  db: BrainDb,
  projectId: string,
  now = new Date(),
): Promise<boolean> {
  if (!billingEnabled()) return true;
  const ownerId = await billingRepo.ownerOf(db, projectId);
  if (!ownerId) return false;
  const plan = PLANS[await planOf(db, ownerId, now)];
  return (await billingRepo.judgedSince(db, ownerId, monthStart(now))) < plan.judgedPerMonth;
}

export const PLAN_LIMIT_NOTE =
  "Not checked by AI: your plan's AI-judged receipts for this month are used up. Upgrade on /pricing.";
