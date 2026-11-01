import { ConnectedComputers } from "@/components/account/connected-computers";
import { DeleteAccount } from "@/components/account/delete-account";
import { SignOutEverywhere } from "@/components/account/sign-out-everywhere";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { accountView } from "@/server/account";
import { pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account | Codeceipt", robots: { index: false } };

// The account page (2026-11-01): who you are, the computers that can send receipts, signing out everywhere, your data
// as a download, and deleting the account for good. A suspended user can still export and delete.
export default async function AccountPage() {
  const user = await pageUser({ allowSuspended: true });
  const a = await accountView(getDb(), user);
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
            {a.email} · signed in with GitHub since {a.createdAt.slice(0, 10)}
          </p>
        </div>
      </section>

      <section className="stack" aria-labelledby="computers">
        <h2 id="computers" className="section-title">
          Connected computers
        </h2>
        <p className="muted m0">
          Each time you approve <code>npx codeceipt</code>, that computer gets a key for one
          project. Revoke a key you no longer use; that computer then has to run{" "}
          <code>npx codeceipt</code> again.
        </p>
        <ConnectedComputers initial={a.computers} />
      </section>

      <section className="stack" aria-labelledby="sessions">
        <h2 id="sessions" className="section-title">
          Sessions
        </h2>
        <p className="muted m0">
          Signed in on another computer and want it out? This signs you out of every browser,
          including this one.
        </p>
        <SignOutEverywhere />
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
        ) : (
          <DeleteAccount name={a.name} />
        )}
      </section>
    </main>
  );
}
