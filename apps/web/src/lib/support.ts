// FEAT-029: where people ask for help. SUPPORT_EMAIL (server env) when set, else the project's public issue tracker.
export const SUPPORT_ISSUES_URL = "https://github.com/jabez-abija2399/project-brain/issues/new";

export function supportHref(): string {
  const email = (process.env.SUPPORT_EMAIL ?? "").trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? `mailto:${email}` : SUPPORT_ISSUES_URL;
}
