import { count, desc } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type WaitlistEntry, waitlist } from "../schema";
import { type Page, type PageOptions, pageBounds, toPage } from "./page";

export const waitlistRepo = {
  /** Adds the email unless it is already there; the caller answers the same either way. */
  async add(db: BrainDb, email: string): Promise<void> {
    await db.insert(waitlist).values({ email }).onConflictDoNothing({ target: waitlist.email });
  },

  async list(db: BrainDb, opts: PageOptions): Promise<Page<WaitlistEntry> & { total: number }> {
    const { limit, offset } = pageBounds(opts);
    const rows = await db
      .select()
      .from(waitlist)
      .orderBy(desc(waitlist.createdAt), desc(waitlist.id))
      .limit(limit + 1)
      .offset(offset);
    const [total] = await db.select({ n: count() }).from(waitlist);
    return { ...toPage(rows, limit, offset), total: total?.n ?? 0 };
  },
};
