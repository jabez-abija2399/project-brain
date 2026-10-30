import { normalizeWaitlistEmail } from "@/components/landing/waitlist-email";
import { type BrainDb, waitlistRepo } from "@brain/db";
import { assertSameOrigin } from "./auth";
import { clientKey } from "./device";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";

// Launch part 5: tries per minute from one address (hashed; the IP itself is never stored).
export const WAITLIST_PER_MINUTE = 5;

/** Saves the email once. The answer is the same whether or not it was already on the list. */
export async function joinWaitlist(db: BrainDb, req: Request, raw: unknown, now = new Date()) {
  assertSameOrigin(req);
  await rateLimit(db, `waitlist:ip:${clientKey(req)}`, WAITLIST_PER_MINUTE, now);
  const email = normalizeWaitlistEmail((raw as { email?: unknown } | null)?.email);
  if (!email) {
    throw new AppError(
      400,
      "invalid_email",
      "Enter an email address, for example you@example.com.",
    );
  }
  await waitlistRepo.add(db, email);
  return { ok: true as const };
}
