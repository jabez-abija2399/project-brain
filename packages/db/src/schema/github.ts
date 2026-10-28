import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt } from "./columns";
import { projects } from "./projects";

// FEAT-009: each GitHub webhook delivery id is processed at most once (AC-009-04).
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    receivedIdx: index("webhook_deliveries_received_idx").on(t.receivedAt),
  }),
);

// The state of one install flow: bound to the user and project that started it, single use, short-lived.
export const githubInstallStates = pgTable(
  "github_install_states",
  {
    stateHash: text("state_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => ({
    expiresIdx: index("github_install_states_expires_idx").on(t.expiresAt),
  }),
);

export type GithubInstallState = typeof githubInstallStates.$inferSelect;
