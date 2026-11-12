// The public address of the site for robots.txt and the sitemap: BETTER_AUTH_URL's origin, or the production address.
export const DEFAULT_SITE_URL = "https://codeceipts.vercel.app";

export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  try {
    return env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).origin : DEFAULT_SITE_URL;
  } catch {
    return DEFAULT_SITE_URL;
  }
}
