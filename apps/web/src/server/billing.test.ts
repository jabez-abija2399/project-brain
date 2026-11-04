// FEAT-025: plans and billing. Checkout and the portal go through Stripe (a fake gateway here); the plan only changes
// from Stripe's webhook with a valid signature (checked by the real stripe SDK below). Attacker tests: "attack: ...".
import { POST as checkoutRoute } from "@/app/api/billing/checkout/route";
import { POST as webhookRoute } from "@/app/api/billing/webhook/route";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { PricingBody } from "@/components/pricing-body";
import { type Llm, receiptView } from "@brain/core";
import {
  billingRepo,
  projectTokensRepo,
  projects,
  projectsRepo,
  receipts,
  receiptsRepo,
  requestsRepo,
  subscriptions,
  users,
} from "@brain/db";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "./account";
import type { SessionUser } from "./auth";
import {
  type BillingGateway,
  type CheckoutArgs,
  foundingAvailable,
  openPortal,
  planOf,
  startCheckout,
} from "./billing";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Built at runtime: no key-shaped literal in the repo.
const KEY = ["sk", "test", "billing", "Xq81Lm"].join("_");
const WEBHOOK_SECRET = ["whsec", "billingTestSecret81"].join("_");
const ORIGIN = "https://codeceipt.example.com";

let world: TestWorld;
let user: SessionUser;
let checkouts: CheckoutArgs[];
const fakeGateway = (): BillingGateway => ({
  checkout: async (args) => {
    checkouts.push(args);
    return "https://checkout.stripe.test/c/pay_1";
  },
  portal: async () => "https://billing.stripe.test/p/session_1",
  event: () => {
    throw new Error("not used");
  },
});

beforeEach(async () => {
  world = await createTestWorld();
  user = await world.createUser({ name: "maker" });
  checkouts = [];
  vi.stubEnv("STRIPE_SECRET_KEY", KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("STRIPE_PRICE_BUILDER", "price_builder");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_pro");
  vi.stubEnv("STRIPE_PRICE_AGENCY", "price_agency");
  vi.stubEnv("STRIPE_COUPON_FOUNDING", "coupon_founding");
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setLlmForTests(undefined);
  await world.teardown();
});

let eventSeq = 0;
function signed(type: string, object: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify({
    id: `evt_${++eventSeq}`,
    object: "event",
    type,
    data: { object },
  });
  const header = new Stripe(KEY).webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}
const deliver = (e: { payload: string; header: string }) =>
  webhookRoute(
    new Request(`${ORIGIN}/api/billing/webhook`, {
      method: "POST",
      headers: { "stripe-signature": e.header, "content-type": "application/json" },
      body: e.payload,
    }),
  );
const completed = (userId: string, plan: string, founding = false, sub = "sub_1") =>
  signed("checkout.session.completed", {
    object: "checkout.session",
    mode: "subscription",
    client_reference_id: userId,
    customer: `cus_${userId.slice(0, 8)}`,
    subscription: sub,
    metadata: { user_id: userId, plan, founding: String(founding) },
  });
const subscription = (
  type: string,
  over: { status?: string; cancelAt?: boolean; end?: Date; price?: string; id?: string } = {},
) =>
  signed(type, {
    object: "subscription",
    id: over.id ?? "sub_1",
    status: over.status ?? "active",
    cancel_at_period_end: over.cancelAt ?? false,
    items: {
      data: [
        {
          price: { id: over.price ?? "price_builder" },
          current_period_end: Math.floor(
            (over.end ?? new Date(Date.now() + 20 * 86400_000)).getTime() / 1000,
          ),
        },
      ],
    },
  });
const createProject = (name: string) =>
  createProjectRoute(
    new Request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name }),
    }),
  );

describe("FEAT-025 plans and billing", () => {
  it("AC-025-01 a signed-in user picks a plan, pays through Stripe Checkout, and the plan is active after the verified webhook", async () => {
    const { url } = await startCheckout(world.db, user, { plan: "pro" }, ORIGIN, fakeGateway());
    expect(url).toBe("https://checkout.stripe.test/c/pay_1");
    expect(checkouts[0]).toMatchObject({
      priceId: "price_pro",
      couponId: null,
      userId: user.id,
      plan: "pro",
      successUrl: `${ORIGIN}/account?billing=success`,
    });
    // Paying is not enough by itself: only the webhook changes the plan.
    expect(await planOf(world.db, user.id)).toBe("free");
    expect((await deliver(completed(user.id, "pro"))).status).toBe(200);
    expect(await planOf(world.db, user.id)).toBe("pro");
    const portal = await openPortal(world.db, user, ORIGIN, fakeGateway());
    expect(portal.url).toBe("https://billing.stripe.test/p/session_1");
  });

  it("AC-025-02 plan limits: Free has 1 project, Builder 5; over the monthly AI-judged receipts a receipt is made from git without the judge, and says so", async () => {
    world.signInAs(user);
    expect((await createProject("one")).status).toBe(201);
    const second = await createProject("two");
    expect(second.status).toBe(402);
    expect(((await second.json()) as { message: string }).message).toMatch(
      /Free plan allows 1 project/,
    );
    await deliver(completed(user.id, "builder"));
    for (const name of ["two", "three", "four", "five"])
      expect((await createProject(name)).status).toBe(201);
    expect((await createProject("six")).status).toBe(402);

    // Free owner with 20 AI-judged receipts this month.
    const free = await world.createUser({ name: "free" });
    const pid = (await projectsRepo.create(world.db, free.id, { name: "app" })).id;
    for (let i = 0; i < 20; i++)
      await receiptsRepo.insert(world.db, pid, { summaryJson: { llm_calls: 1 } });
    let judged = 0;
    const llm: Llm = {
      async complete() {
        judged++;
        return "1 | done | src/a.ts";
      },
    };
    setLlmForTests(llm);
    const token = (await projectTokensRepo.create(world.db, pid)).row;
    const { request } = await requestsRepo.createWithItems(
      world.db,
      pid,
      { featureId: null, text: "Add a footer" },
      [{ text: "Add a footer", needsClarification: false }],
    );
    const receipt = await generateReceipt(world.db, token, {
      projectId: pid,
      requestId: request.id,
      changedFiles: ["src/a.ts"],
    });
    expect(judged).toBe(0);
    const [row] = await world.db
      .select()
      .from(receipts)
      .where(eq(receipts.id, String(receipt.receipt_id)));
    const view = receiptView(row?.summaryJson);
    expect(view.judgeSkipped).toBe(true);
    expect(view.items.map((i) => i.status)).toEqual(["not_verified"]);
  });

  it("AC-025-03 attack: the plan changes only from a validly signed webhook; a client cannot set its own plan or price", async () => {
    const forged = completed(user.id, "agency");
    const wrongSecret = signed(
      "checkout.session.completed",
      JSON.parse(forged.payload).data.object,
      "whsec_wrong",
    );
    expect((await deliver(wrongSecret)).status).toBe(400);
    expect((await deliver({ payload: forged.payload, header: "" })).status).toBe(400);
    // A valid signature over a different body does not carry over.
    expect(
      (await deliver({ payload: forged.payload.replace("agency", "pro"), header: forged.header }))
        .status,
    ).toBe(400);
    expect(await planOf(world.db, user.id)).toBe("free");
    for (const body of [
      { plan: "pro", price: "price_1" },
      { plan: "pro", priceId: "price_free" },
      { plan: "enterprise" },
      { plan: "free" },
      null,
    ]) {
      await expect(
        startCheckout(world.db, user, body, ORIGIN, fakeGateway()),
        JSON.stringify(body),
      ).rejects.toMatchObject({ status: 400 });
    }
    world.signInAs(user);
    const res = await checkoutRoute(
      new Request(`${ORIGIN}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ plan: "agency", amount: 1 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await planOf(world.db, user.id)).toBe("free");
    // A redelivered event is applied once.
    const once = completed(user.id, "builder");
    await deliver(once);
    const again = await deliver(once);
    expect(await again.json()).toMatchObject({ duplicate: true });
  });

  it("AC-025-04 the founding offer is shown and sold only while fewer than 200 founding subscriptions exist", async () => {
    const page = (founding: boolean) =>
      renderToStaticMarkup(createElement(PricingBody, { signedIn: true, founding }));
    expect(await foundingAvailable(world.db)).toBe(true);
    expect(page(true)).toMatch(/Builder for \$8 a month for your first 12 months/);
    await startCheckout(world.db, user, { plan: "founding" }, ORIGIN, fakeGateway());
    expect(checkouts[0]).toMatchObject({
      priceId: "price_builder",
      couponId: "coupon_founding",
      founding: true,
    });
    const ids = Array.from({ length: 200 }, (_, i) => `founder-${i}`);
    await world.db
      .insert(users)
      .values(ids.map((id) => ({ id, name: id, email: `${id}@example.com` })));
    await world.db.insert(subscriptions).values(
      ids.map((id, i) => ({
        userId: id,
        plan: "builder",
        status: "active",
        founding: true,
        stripeCustomerId: `cus_${i}`,
        stripeSubscriptionId: `sub_f${i}`,
      })),
    );
    expect(await foundingAvailable(world.db)).toBe(false);
    expect(page(false)).not.toContain("Founding offer");
    await expect(
      startCheckout(world.db, user, { plan: "founding" }, ORIGIN, fakeGateway()),
    ).rejects.toMatchObject({
      status: 409,
      code: "founding_sold_out",
    });
  });

  it("AC-025-05 cancelling in the portal keeps the plan to the end of the paid period, then Free; data is kept", async () => {
    world.signInAs(user);
    await deliver(completed(user.id, "builder"));
    await createProject("a");
    await createProject("b");
    const end = new Date(Date.now() + 10 * 86400_000);
    await deliver(subscription("customer.subscription.updated", { cancelAt: true, end }));
    expect(await planOf(world.db, user.id)).toBe("builder");
    expect((await billingRepo.forUser(world.db, user.id))?.cancelAtPeriodEnd).toBe(true);
    await deliver(
      subscription("customer.subscription.deleted", {
        status: "canceled",
        end: new Date(Date.now() - 1000),
      }),
    );
    expect(await planOf(world.db, user.id)).toBe("free");
    const owned = await world.db.select().from(projects).where(eq(projects.ownerId, user.id));
    expect(owned).toHaveLength(2);
  });

  it("attack: an account with a paid plan cannot be deleted until the plan is cancelled (no charging a deleted account)", async () => {
    await deliver(completed(user.id, "pro"));
    await expect(deleteAccount(world.db, user, { confirm: "maker" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("without Stripe configured there are no limits and no checkout", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    world.signInAs(user);
    expect((await createProject("one")).status).toBe(201);
    expect((await createProject("two")).status).toBe(201);
    await expect(
      startCheckout(world.db, user, { plan: "pro" }, ORIGIN, fakeGateway()),
    ).rejects.toMatchObject({ status: 503 });
  });
});
