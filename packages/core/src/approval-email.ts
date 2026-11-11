import { maskSecretsIn } from "./mask";
import { plainText } from "./text";

// Owner action 12 (Postmark): the hourly email that tells an owner their agents are waiting for an approval. Plain
// text only, and only counts, project names and links to the Approvals tab: the request text an agent wrote is never
// put in an email (it could pose as instructions or a phishing link); the owner reads it on the signed-in page.

export type ApprovalEmailProject = { id: string; name: string; count: number };

const MAX_PROJECTS = 20;
const MAX_NAME = 80;

const cleanName = (name: string) => {
  const one = maskSecretsIn(plainText(name));
  return [...one].length > MAX_NAME ? `${[...one].slice(0, MAX_NAME - 1).join("")}…` : one;
};

/** Subject and plain-text body; null when nothing waits. `appUrl` is the app's own origin (BETTER_AUTH_URL). */
export function renderApprovalEmail(
  appUrl: string,
  projects: ApprovalEmailProject[],
): { subject: string; text: string } | null {
  const waiting = projects.filter((p) => p.count > 0);
  if (waiting.length === 0) return null;
  const total = waiting.reduce((n, p) => n + p.count, 0);
  const shown = waiting.slice(0, MAX_PROJECTS);
  const lines = shown.map(
    (p) =>
      `- ${cleanName(p.name)}: ${p.count} waiting\n  ${appUrl}/projects/${encodeURIComponent(p.id)}/approvals`,
  );
  if (waiting.length > shown.length)
    lines.push(`- and ${waiting.length - shown.length} more projects`);
  return {
    // A fixed subject: nothing an agent or a project name sets reaches the header.
    subject:
      total === 1
        ? "Codeceipt: 1 request waits for your approval"
        : `Codeceipt: ${total} requests wait for your approval`,
    text: [
      "Your agents asked for something that needs your approval:",
      "",
      ...lines,
      "",
      "Open the link to see each request and approve or reject it. Requests expire after 24 hours.",
      "You get at most one of these emails an hour.",
    ].join("\n"),
  };
}
