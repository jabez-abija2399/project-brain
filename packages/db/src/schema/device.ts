import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, id } from "./columns";
import { projects } from "./projects";

// `npx codeceipt` device approval (0029). Only a hash of the CLI's device code is stored.
export const deviceCodes = pgTable(
  "device_codes",
  {
    id: id(),
    deviceCodeHash: text("device_code_hash").notNull().unique(),
    userCode: text("user_code").notNull(),
    status: text("status", { enum: ["pending", "approved", "denied", "used"] })
      .notNull()
      .default("pending"),
    suggestedName: text("suggested_name"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => ({
    pendingUserCode: uniqueIndex("device_codes_pending_user_code_uniq")
      .on(t.userCode)
      .where(sql`${t.status} = 'pending'`),
    expiresIdx: index("device_codes_expires_idx").on(t.expiresAt),
  }),
);

export type DeviceCode = typeof deviceCodes.$inferSelect;
