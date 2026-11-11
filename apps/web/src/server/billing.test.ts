// FEAT-025: plans and billing. Checkout, the portal and reading a subscription go through a fake gateway; webhook
// signatures are checked by the real stripe SDK. The plan only changes from a validly signed webhook, and then to the
// subscription's state as Stripe has it now. Attacker tests are named "attack: ...".
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
  type StripeSubscription,
  foundingAvailable,
  judgeAllowed,
  openPortal,
  planOf,
  setBillingGatewayForTests,
  startCheckout,
} from "./billing";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Built at runtime: no key-shaped literal in the repo.
const KEY = ["sk", "test", "billing", "Xq81Lm"].join("_");
const WEBHOOK_SECRET = ["whsec", "billingTestSecret81"].join("_");
const ORIGIN = "https://codeceipt.example.com";
const stripe = new Stripe(KEY);

let world: TestWorld;
let user: SessionUser;
let checkouts: CheckoutArgs[];
let customersMade: number;
// Stripe's side: subscriptions as Stripe has them now.
let stripeSubs: Map<string, StripeSubscription>;

const gateway: BillingGateway = {
  customer: async () => `cus_${++customersMade}`,
  subscription: async (id) => stripeSubs.get(id) ?? null,
  checkout: async (args) => {
    checkouts.push(args);
    return "https://checkout.stripe.test/c/pay_1";
  },
  portal: async () => "https://billing.stripe.test/p/session_1",
  event: (body, signature) => {
    if (!signature) throw new Error("unsigned");
    return stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  },
};

beforeEach(async () => {
  world = await createTestWorld();
  user = await world.createUser({ name: "maker" });
  checkouts = [];
  customersMade = 0;
  stripeSubs = new Map();
  setBillingGatewayForTests(gateway);
  vi.stubEnv("STRIPE_SECRET_KEY", KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("STRIPE_PRICE_BUILDER", "price_builder");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_pro");
  vi.stubEnv("STRIPE_PRICE_AGENCY", "price_agency");
  vi.stubEnv("STRIPE_COUPON_FOUNDING", "coupon_founding");
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
});
afterEach(async () => {
  setBillingGatewayForTests(null);
  vi.unstubAllEnvs();
  setLlmForTests(undefined);
  await world.teardown();
});

function setSub(
  id: string,
  userId: string,
  over: Partial<StripeSubscription> & { founding?: boolean } = {},
) {
  const { founding, ...rest } = over;
  stripeSubs.set(id, {
    id,
    customerId: `cus_${userId.slice(0, 8)}`,
    status: "active",
    priceId: "price_builder",
    currentPeriodEnd: new Date(Date.now() + 20 * 86400_000),
    cancelAtPeriodEnd: false,
    metadata: { user_id: userId, founding: String(founding ?? false) },
    ...rest,
  });
}

let eventSeq = 0;
function signed(type: string, object: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify({
    id: `evt_${++eventSeq}`,
    object: "event",
    type,
    data: { object },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
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
const completed = (subId: string) =>
  signed("checkout.session.completed", {
    object: "checkout.session",
    mode: "subscription",
    subscription: subId,
  });
const subEvent = (type: string, subId: string) =>
  signed(type, { object: "subscription", id: subId, status: "active" });
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
    const { url } = await startCheckout(world.db, user, { plan: "pro" }, ORIGIN);
    expect(url).toBe("https://checkout.stripe.test/c/pay_1");
    expect(checkouts[0]).toMatchObject({
      priceId: "price_pro",
      couponId: null,
      userId: user.id,
      customerId: "cus_1",
      plan: "pro",
      successUrl: `${ORIGIN}/account?billing=success`,
    });
    // Paying is not enough by itself: only the webhook changes the plan.
    expect(await planOf(world.db, user.id)).toBe("free");
    setSub("sub_1", user.id, { priceId: "price_pro" });
    expect((await deliver(completed("sub_1"))).status).toBe(200);
    expect(await planOf(world.db, user.id)).toBe("pro");
    expect((await openPortal(world.db, user, ORIGIN)).url).toBe(
      "https://billing.stripe.test/p/session_1",
    );
  });

  it("AC-025-02 plan limits: Free has 1 project, Builder 5; over the monthly AI-judged receipts a receipt is made from git without the judge, and says so", async () => {
    world.signInAs(user);
    expect((await createProject("one")).status).toBe(201);
    const second = await createProject("two");
    expect(second.status).toBe(402);
    expect(((await second.json()) as { message: string }).message).toMatch(
      /Free plan allows 1 project/,
    );
    setSub("sub_1", user.id);
    await deliver(completed("sub_1"));
    for (const name of ["two", "three", "four", "five"])
      expect((await createProject(name)).status).toBe(201);
    expect((await createProject("six")).status).toBe(402);

    // A Free owner who has used this month's 20 AI-judged receipts.
    const free = await world.createUser({ name: "free" });
    const pid = (await projectsRepo.create(world.db, free.id, { name: "app" })).id;
    for (let i = 0; i < 20; i++) expect(await judgeAllowed(world.db, pid)).toBe(true);
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

  it("BL-11 attack: parallel creates cannot pass the plan's project limit together", async () => {
    world.signInAs(user);
    const results = await Promise.all(["a", "b", "c", "d"].map((n) => createProject(n)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 402, 402, 402]);
    const { items } = await projectsRepo.listByOwner(world.db, user.id, { limit: 10, offset: 0 });
    expect(items).toHaveLength(1);
  });

  it("AC-025-03 attack: the plan changes only from a validly signed webhook; a client cannot set its own plan or price", async () => {
    setSub("sub_1", user.id, { priceId: "price_agency" });
    const real = completed("sub_1");
    expect(
      (
        await deliver(
          signed("checkout.session.completed", JSON.parse(real.payload).data.object, "whsec_wrong"),
        )
      ).status,
    ).toBe(400);
    expect((await deliver({ payload: real.payload, header: "" })).status).toBe(400);
    // A valid signature over a different body does not carry over.
    expect(
      (await deliver({ payload: real.payload.replace("sub_1", "sub_2"), header: real.header }))
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
        startCheckout(world.db, user, body, ORIGIN),
        JSON.stringify(body),
      ).rejects.toMatchObject({
        status: 400,
      });
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
    // A subscription on a price that is not ours gives no plan.
    setSub("sub_3", user.id, { priceId: "price_someone_elses" });
    await deliver(completed("sub_3"));
    expect(await planOf(world.db, user.id)).toBe("free");
    // A redelivered event is applied once.
    await deliver(real);
    expect(await (await deliver(real)).json()).toMatchObject({ duplicate: true });
  });

  it("AC-025-04 the founding offer is shown and sold only while fewer than 200 founding subscriptions exist", async () => {
    const page = (founding: boolean) =>
      renderToStaticMarkup(createElement(PricingBody, { signedIn: true, founding }));
    expect(await foundingAvailable(world.db)).toBe(true);
    expect(page(true)).toMatch(/Builder for \$8 a month for your first 12 months/);
    await startCheckout(world.db, user, { plan: "founding" }, ORIGIN);
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
        stripeCustomerId: `cus_f${i}`,
        stripeSubscriptionId: `sub_f${i}`,
      })),
    );
    expect(await foundingAvailable(world.db)).toBe(false);
    expect(page(false)).not.toContain("Founding offer");
    await expect(startCheckout(world.db, user, { plan: "founding" }, ORIGIN)).rejects.toMatchObject(
      {
        status: 409,
        code: "founding_sold_out",
      },
    );
  });

  it("AC-025-05 cancelling in the portal keeps the plan to the end of the paid period, then Free; data is kept", async () => {
    world.signInAs(user);
    setSub("sub_1", user.id);
    await deliver(completed("sub_1"));
    await createProject("a");
    await createProject("b");
    setSub("sub_1", user.id, { cancelAtPeriodEnd: true });
    await deliver(subEvent("customer.subscription.updated", "sub_1"));
    expect(await planOf(world.db, user.id)).toBe("builder");
    expect((await billingRepo.forUser(world.db, user.id))?.cancelAtPeriodEnd).toBe(true);
    // Set to end: the account can be deleted (it is never charged again).
    setSub("sub_1", user.id, { status: "canceled" });
    await deliver(subEvent("customer.subscription.deleted", "sub_1"));
    expect(await planOf(world.db, user.id)).toBe("free");
    const owned = await world.db.select().from(projects).where(eq(projects.ownerId, user.id));
    expect(owned).toHaveLength(2);
  });

  it("attack (security review): a late or retried 'active' event cannot bring back a cancelled plan", async () => {
    setSub("sub_1", user.id);
    const early = subEvent("customer.subscription.updated", "sub_1");
    await deliver(completed("sub_1"));
    setSub("sub_1", user.id, { status: "canceled" });
    await deliver(subEvent("customer.subscription.deleted", "sub_1"));
    // The 'active' event Stripe retries after the deletion: the state is read back from Stripe.
    await deliver(early);
    expect(await planOf(world.db, user.id)).toBe("free");
    // An unpaid checkout (Stripe has the subscription as incomplete) gives no plan.
    const other = await world.createUser({ name: "unpaid" });
    setSub("sub_9", other.id, { status: "incomplete" });
    await deliver(completed("sub_9"));
    expect(await planOf(world.db, other.id)).toBe("free");
  });

  it("attack (security review): deleting receipts or projects gives no AI-judged receipts back; parallel calls stop at the limit", async () => {
    const pid = (await projectsRepo.create(world.db, user.id, { name: "app" })).id;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => judgeAllowed(world.db, pid)),
    );
    expect(results.filter(Boolean)).toHaveLength(20);
    await world.db.delete(receipts).where(eq(receipts.projectId, pid));
    await world.db.delete(projects).where(eq(projects.id, pid));
    const again = (await projectsRepo.create(world.db, user.id, { name: "app2" })).id;
    expect(await judgeAllowed(world.db, again)).toBe(false);
    expect(receiptsRepo).toBeDefined();
  });

  it("attack (security review): a second checkout uses the same Stripe customer, and its subscription never replaces the first", async () => {
    await startCheckout(world.db, user, { plan: "builder" }, ORIGIN);
    await startCheckout(world.db, user, { plan: "pro" }, ORIGIN);
    expect(customersMade).toBe(1);
    expect(checkouts.map((c) => c.customerId)).toEqual(["cus_1", "cus_1"]);
    setSub("sub_1", user.id);
    setSub("sub_2", user.id, { priceId: "price_pro" });
    await deliver(completed("sub_1"));
    await deliver(completed("sub_2"));
    expect((await billingRepo.forUser(world.db, user.id))?.stripeSubscriptionId).toBe("sub_1");
  });

  it("attack: an account with a paid plan cannot be deleted until the plan is cancelled (no charging a deleted account)", async () => {
    setSub("sub_1", user.id, { priceId: "price_pro" });
    await deliver(completed("sub_1"));
    await expect(deleteAccount(world.db, user, { confirm: "maker" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("without Stripe configured there are no limits and no checkout", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    world.signInAs(user);
    expect((await createProject("one")).status).toBe(201);
    expect((await createProject("two")).status).toBe(201);
    await expect(startCheckout(world.db, user, { plan: "pro" }, ORIGIN)).rejects.toMatchObject({
      status: 503,
    });
  });
});
