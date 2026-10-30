// Shared by the landing form and the waitlist route: one rule for what counts as an email address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The address trimmed and lowercased, or null when it is not a plausible email (or longer than 254 characters). */
export function normalizeWaitlistEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  return value.length <= 254 && EMAIL.test(value) ? value : null;
}
