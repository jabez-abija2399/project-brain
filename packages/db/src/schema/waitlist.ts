import { index, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";

// The landing page's beta waitlist (0029): one row per email, stored trimmed and lowercased.
export const waitlist = pgTable(
  "waitlist",
  {
    id: id(),
    email: text("email").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => ({ createdIdx: index("waitlist_created_idx").on(t.createdAt) }),
);

export type WaitlistEntry = typeof waitlist.$inferSelect;
