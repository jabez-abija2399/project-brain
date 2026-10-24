import { sql } from "drizzle-orm";
import { text, timestamp } from "drizzle-orm/pg-core";

export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().default(sql`now()`);
