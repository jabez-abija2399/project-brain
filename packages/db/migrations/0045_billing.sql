-- FEAT-025 (2026-11-04): plans and billing. Additive only. One subscription row per user, written only from Stripe's
-- verified webhook; no card data is stored (Stripe Checkout and the customer portal hold it). stripe_events keeps the
-- ids of handled webhook events so a redelivered event is applied once.
CREATE TABLE "subscriptions" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "plan" text NOT NULL,
  "status" text NOT NULL,
  "founding" boolean NOT NULL DEFAULT false,
  "stripe_customer_id" text NOT NULL,
  "stripe_subscription_id" text NOT NULL,
  "current_period_end" timestamptz,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_uniq" ON "subscriptions" ("stripe_subscription_id");
CREATE INDEX "subscriptions_founding_idx" ON "subscriptions" ("founding") WHERE "founding";
CREATE TABLE "stripe_events" (
  "id" text PRIMARY KEY NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now()
);
-- One Stripe customer per user, made before the first checkout, so every checkout and subscription shares it.
CREATE TABLE "billing_customers" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- AI-judged receipts per user per month: only ever counted up (deleting receipts or projects does not give any back).
CREATE TABLE "judged_usage" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "month" date NOT NULL,
  "n" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("user_id", "month")
);
