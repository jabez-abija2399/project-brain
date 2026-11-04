import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt } from "./columns";

// FEAT-025: one subscription per user (migration 0045), written only from Stripe's verified webhook.
export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),
    status: text("status").notNull(),
    founding: boolean("founding").notNull().default(false),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "date" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    subscriptionUniq: uniqueIndex("subscriptions_stripe_subscription_uniq").on(
      t.stripeSubscriptionId,
    ),
    foundingIdx: index("subscriptions_founding_idx").on(t.founding),
  }),
);

// Handled webhook event ids, so a redelivered event is applied once.
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const billingCustomers = pgTable("billing_customers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  createdAt: createdAt(),
});

export const judgedUsage = pgTable(
  "judged_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: date("month", { mode: "string" }).notNull(),
    n: integer("n").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.month] }) }),
);

export type Subscription = typeof subscriptions.$inferSelect;
