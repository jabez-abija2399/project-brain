import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { projects } from "./projects";
import { receipts } from "./receipts";

// FEAT-021: a read-only link to one receipt (migration 0044). Only the SHA-256 of the token is stored.
export const receiptShareLinks = pgTable(
  "receipt_share_links",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    tokenHashUniq: uniqueIndex("receipt_share_links_token_hash_uniq").on(t.tokenHash),
    projectIdx: index("receipt_share_links_project_idx").on(t.projectId, t.receiptId),
  }),
);

export type ReceiptShareLink = typeof receiptShareLinks.$inferSelect;
