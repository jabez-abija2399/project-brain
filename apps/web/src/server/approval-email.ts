import { renderApprovalEmail } from "@brain/core";
import { type BrainDb, approvalRequestsRepo, rateCountersRepo } from "@brain/db";
import { approvalsEnabled } from "./approvals";

// Owner action 12 (Postmark): once an hour, each owner whose agents asked for an approval in the last full hour gets
// one plain-text email with counts and links (see packages/core/src/approval-email.ts for what is never in it).
// Off until POSTMARK_API_KEY and POSTMARK_FROM are set; off before migration 0055. The key is only ever sent to
// Postmark, never logged.

export type Mail = { to: string; subject: string; text: string };
export type MailSender = (mail: Mail) => Promise<boolean>;

const HOUR_MS = 3_600_000;
const MAX_OWNERS_PER_RUN = 500;
const POSTMARK_URL = "https://api.postmarkapp.com/email";

/** The Postmark sender, or null when it is not configured. */
export function postmarkSender(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): MailSender | null {
  const key = env.POSTMARK_API_KEY?.trim();
  const from = env.POSTMARK_FROM?.trim();
  if (!key || !from) return null;
  return async (mail) => {
    try {
      const res = await fetchImpl(POSTMARK_URL, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-postmark-server-token": key,
        },
        body: JSON.stringify({
          From: from,
          To: mail.to,
          Subject: mail.subject,
          TextBody: mail.text,
          MessageStream: "outbound",
        }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}

/** The app's own origin for links, from BETTER_AUTH_URL; "" when unset or not a URL. */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  try {
    return env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).origin : "";
  } catch {
    return "";
  }
}

/**
 * One run (hourly): requests made in the last full hour, one email per owner. A per-owner, per-hour counter makes a
 * retried or doubled run send nothing twice.
 */
export async function sendApprovalEmails(
  db: BrainDb,
  sender: MailSender | null,
  appUrl: string,
  now = new Date(),
): Promise<{ sent: number; failed: number; skipped?: "not_configured" | "not_ready" }> {
  if (!sender || !appUrl) return { sent: 0, failed: 0, skipped: "not_configured" };
  if (!(await approvalsEnabled(db))) return { sent: 0, failed: 0, skipped: "not_ready" };
  const end = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const start = new Date(end.getTime() - HOUR_MS);
  const rows = await approvalRequestsRepo.newPendingByOwner(db, start, end);
  const byOwner = new Map<
    string,
    { email: string; projects: { id: string; name: string; count: number }[] }
  >();
  for (const r of rows) {
    const entry = byOwner.get(r.ownerId) ?? { email: r.email, projects: [] };
    entry.projects.push({ id: r.projectId, name: r.projectName, count: Number(r.count) });
    byOwner.set(r.ownerId, entry);
  }
  let sent = 0;
  let failed = 0;
  for (const [ownerId, { email, projects }] of [...byOwner].slice(0, MAX_OWNERS_PER_RUN)) {
    const mail = renderApprovalEmail(appUrl, projects);
    if (!mail) continue;
    // Counted before sending: a run that is retried after a send never sends the same hour twice.
    if ((await rateCountersRepo.add(db, `approval-email:${ownerId}`, start, 1)) > 1) continue;
    if (await sender({ to: email, ...mail })) sent++;
    else failed++;
  }
  console.info(
    "[approval-email]",
    JSON.stringify({ event: "run", owners: byOwner.size, sent, failed }),
  );
  return { sent, failed };
}
