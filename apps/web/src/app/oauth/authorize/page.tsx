import SignInButton from "@/app/sign-in-button";
import { PageHeader } from "@/components/shell/page-header";
import { appOriginOf, getSessionUser } from "@/server/auth";
import { signInHref } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { type AuthorizeView, authorizePathFor, authorizeView } from "@/server/mcp-oauth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an app | Codeceipt", robots: { index: false } };

// A sign-in return path longer than this cannot be carried by the sign-in page (safeNextPath's limit).
const SIGN_IN_PATH_MAX = 300;

// An MCP client (Claude Desktop, a claude.ai connector, VS Code) sends the owner here to connect one project. Signed out:
// sign in and come back. Signed in: pick a project, then say what the app will be able to do, and Allow or Deny.
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const h = await headers();
  const user = await getSessionUser(new Request("http://localhost/", { headers: h }));
  if (!user) {
    const path = authorizePathFor(query);
    if (path.length > SIGN_IN_PATH_MAX) {
      return (
        <main className="page page-narrow stack stack-lg">
          <PageHeader title="Connect an app" purpose="Sign in to Codeceipt first." />
          <div className="card stack">
            <p className="m0">
              Sign in to Codeceipt first, then open this link again from the app that asked.
            </p>
            <SignInButton tone="primary" callbackURL="/projects" />
          </div>
        </main>
      );
    }
    redirect(signInHref(path));
  }
  const origin = pageOrigin(h);
  const view = await authorizeView(getDb(), user, origin, query);
  return (
    <main className="page page-narrow stack stack-lg">
      <PageHeader
        title="Connect an app"
        purpose="An MCP app asks to read and change one of your projects."
      />
      <ViewBody view={view} query={query} />
    </main>
  );
}

// The app's origin as this page sees it (BETTER_AUTH_URL when set, as everywhere else); a malformed Host header falls back.
function pageOrigin(h: Headers): string {
  try {
    return appOriginOf(new Request(`http://${h.get("host") ?? "localhost"}/`));
  } catch {
    return appOriginOf(new Request("http://localhost/"));
  }
}

function ViewBody({
  view,
  query,
}: {
  view: AuthorizeView;
  query: Record<string, string | undefined>;
}) {
  if (view.kind === "error") {
    return (
      <div className="card stack">
        <p className="m0" role="alert">
          {view.message}
        </p>
        <Link href="/projects">Back to your projects</Link>
      </div>
    );
  }
  if (view.kind === "pick") {
    if (view.projects.length === 0) {
      return (
        <div className="card stack">
          <p className="m0">
            You have no project yet. Run <code>npx codeceipt</code> in your repository first, then
            open this link again.
          </p>
        </div>
      );
    }
    return (
      <section className="card stack" aria-labelledby="pick">
        <h2 id="pick" className="section-title">
          Choose the project to connect
        </h2>
        <p className="muted m0">
          The app gets this one project only. You can pick another connection later.
        </p>
        <ul className="facts-list">
          {view.projects.map((p) => (
            <li key={p.id}>
              <a href={`/oauth/authorize?${new URLSearchParams({ ...query, project_id: p.id })}`}>
                {p.name}
              </a>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="card stack stack-lg" aria-labelledby="consent">
      <h2 id="consent" className="section-title">
        Connect {view.client.name} (redirects to {view.client.host}) to {view.project.name}?
      </h2>
      <p className="m0">{view.client.name} will be able to:</p>
      <ul className="facts-list">
        <li>
          <strong>Read</strong> the features, receipts, checklist items, open items and decisions of{" "}
          {view.project.name}.
        </li>
        <li>
          <strong>Change</strong> {view.project.name} only through the same tools the CLI uses:
          progress notes, decisions, checklist proposals and receipts.
        </li>
      </ul>
      <p className="muted m0">
        It cannot see your other projects or your GitHub account. It reaches Codeceipt from{" "}
        <code>{view.client.host}</code>, and the app chose its own name, so check where you started
        this connection. You can revoke it any time on your Account page.
      </p>
      <ConsentForm params={view.params} csrf={view.csrf} projectName={view.project.name} />
    </section>
  );
}
