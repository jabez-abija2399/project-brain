import { CelebrateToggle } from "@/components/account/celebrate-toggle";
import { ConnectedComputers } from "@/components/account/connected-computers";
import { DeleteAccount } from "@/components/account/delete-account";
import { OAuthConnections } from "@/components/account/oauth-connections";
import { SessionList } from "@/components/account/session-list";
import { SignOutEverywhere } from "@/components/account/sign-out-everywhere";
import { BillingButton } from "@/components/billing-button";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { When } from "@/components/ui/when";
import { CELEBRATE_COOKIE, celebrationsOn } from "@/lib/celebrate";
import { formatDay } from "@/lib/when";
import { accountView, sessionsView } from "@/server/account";
import { pageShowsAdminLink } from "@/server/admin";
import { currentSessionId } from "@/server/auth";
import { pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { connectionsFor } from "@/server/mcp-oauth";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account | Codeceipt", robots: { index: false } };

// The account page (2026-11-01): who you are, the computers that can send receipts, signing out everywhere, your data
// as a download, and deleting the account for good. A suspended user can still export and delete.
// FEAT-033: this browser's celebrations choice (on unless turned off; on when no cookies can be read).
async function celebrateOn(): Promise<boolean> {
  try {
    return celebrationsOn((await cookies()).get(CELEBRATE_COOKIE)?.value);
  } catch {
    return true;
  }
}

export default async function AccountPage() {
  const user = await pageUser({ allowSuspended: true });
  const [a, apps, browsers, admin, thisBrowser] = await Promise.all([
    accountView(getDb(), user),
    connectionsFor(getDb(), user),
    sessionsView(getDb(), user),
    pageShowsAdminLink(user),
    currentSessionId(new Request("http://localhost/", { headers: await headers() })),
  ]);
  return (
    <main className="page page-narrow stack stack-lg">
      <PageHeader
        title="Account"
        purpose="Your GitHub sign-in, the computers that can send receipts, and your data."
      />
      {a.suspended ? (
        <output className="card result block">
          <StatusBadge status="missed" label="Suspended" /> Your account is suspended. You can still
          export your data below; deleting it waits until the suspension is lifted.
        </output>
      ) : null}

      <section className="card account-id" aria-labelledby="who">
        {a.image ? (
          <img className="avatar" src={a.image} alt="" width={56} height={56} />
        ) : (
          <span className="avatar avatar-initial" aria-hidden="true">
            {a.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <h2 id="who" className="section-title">
            {a.name}
          </h2>
          <p className="muted m0">
            {a.email} · signed in with GitHub since <When iso={a.createdAt} format="day" />
          </p>
          {admin ? (
            <p className="m0">
              <Link href="/admin">Admin</Link>
            </p>
          ) : null}
        </div>
      </section>

      <section className="card stack" aria-labelledby="plan" data-testid="plan-card">
        <h2 id="plan" className="section-title">
          Plan
        </h2>
        {a.billing.beta ? (
          <p className="muted m0" data-testid="beta-usage">
            {/* FEAT-041: a limit can be "no limit" (null), set by an admin. */}
            Free beta:{" "}
            {a.billing.beta.projectLimit === null
              ? `${a.billing.beta.projects} projects (no limit)`
              : `${a.billing.beta.projects} of ${a.billing.beta.projectLimit} projects`}
            ,{" "}
            {a.billing.beta.judgedLimit === null
              ? `${a.billing.beta.judged} AI-checked receipts this month (no limit)`
              : `${a.billing.beta.judged} of ${a.billing.beta.judgedLimit} AI-checked receipts this month`}{" "}
            (resets on the 1st).
          </p>
        ) : (
          <p className="muted m0">
            You are on the {a.billing.plan} plan
            {a.billing.endsAt ? `; it ends on ${formatDay(a.billing.endsAt)}, then Free` : ""}.
          </p>
        )}
        {a.billing.beta ? null : a.billing.subscribed ? (
          <BillingButton action="portal" label="Manage billing" />
        ) : (
          <Link className="btn self-start" href="/pricing">
            See plans
          </Link>
        )}
      </section>

      <section className="stack" aria-labelledby="computers">
        <h2 id="computers" className="section-title">
          Connection keys
        </h2>
        <p className="muted m0">
          When you run <code>npx codeceipt</code> and approve it, that computer gets a connection
          key that sends receipts for one project. Remove any key you no longer use; that computer
          then has to run <code>npx codeceipt</code> again.
        </p>
        <ConnectedComputers initial={a.computers} />
      </section>

      <section className="stack" aria-labelledby="apps">
        <h2 id="apps" className="section-title">
          Connected apps
        </h2>
        <p className="muted m0">
          Apps such as Claude Desktop, a claude.ai connector or VS Code that you connected by
          signing in. Each one can reach only the project you approved. Revoke one you no longer
          use.
        </p>
        <OAuthConnections initial={apps} />
      </section>

      <section className="stack" aria-labelledby="sessions">
        <h2 id="sessions" className="section-title">
          Signed-in browsers
        </h2>
        <p className="muted m0">
          The browsers signed in to this account. Sign one out, or sign out of every browser,
          including this one.
        </p>
        <SessionList sessions={browsers} current={thisBrowser} />
        <SignOutEverywhere />
      </section>

      {/* FEAT-039: preferences come after the plan, keys and browsers. */}
      <section className="stack" aria-labelledby="celebrate">
        <h2 id="celebrate" className="section-title">
          Celebrations
        </h2>
        <CelebrateToggle on={await celebrateOn()} />
      </section>

      <section className="stack" aria-labelledby="export">
        <h2 id="export" className="section-title">
          Export my data
        </h2>
        <p className="muted m0">
          A JSON file with your projects, features, requests, checklists, receipts and decisions. It
          never contains tokens or their hashes. Your source code is not in it because Codeceipt
          never had it.
        </p>
        <a className="btn self-start" href="/api/account/export" download>
          Download my data (JSON)
        </a>
      </section>

      <section className="stack danger-zone" aria-labelledby="delete">
        <h2 id="delete" className="section-title">
          Delete my account
        </h2>
        <p className="m0">
          This deletes your account, every project and everything in them: receipts, features,
          requests, decisions, tokens, sessions and your waitlist entry.{" "}
          <strong>It cannot be undone.</strong> Export your data first if you want a copy. See{" "}
          <Link href="/privacy#deleting-your-data">Deleting your data</Link>.
        </p>
        {a.suspended ? (
          <p className="muted m0">Not available while your account is suspended.</p>
        ) : a.billing.subscribed && !a.billing.endsAt ? (
          // FEAT-029: a paid plan is cancelled first, so nobody is charged for a deleted account.
          <div className="stack" data-testid="delete-needs-cancel">
            <p className="m0">
              Cancel your plan in Manage billing first, then delete the account. You are never
              charged again after cancelling.
            </p>
            <BillingButton action="portal" label="Manage billing" />
          </div>
        ) : (
          <DeleteAccount name={a.name} />
        )}
      </section>
    </main>
  );
}
