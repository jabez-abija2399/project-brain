import SignInButton from "@/app/sign-in-button";
import { PageHeader } from "@/components/shell/page-header";
import { type SessionUser, getSessionUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { deviceView } from "@/server/device";
import { AppError } from "@/server/errors";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { DeviceApproval } from "./device-approval";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect your terminal | Codeceipt" };

// `npx codeceipt` sends the user here with the code it shows in the terminal. Signing in comes back to the same code.
export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const raw = (await searchParams).code;
  const code =
    (Array.isArray(raw) ? raw[0] : raw)
      ?.toUpperCase()
      .replace(/[^A-Z-]/g, "")
      .slice(0, 9) ?? "";
  const user = await getSessionUser(new Request("http://localhost/", { headers: await headers() }));
  return (
    <main className="page page-narrow stack stack-lg">
      <PageHeader
        title="Connect your terminal"
        purpose={
          <>
            Approve the code from <code>npx codeceipt</code> so this computer can send receipts to
            your project.
          </>
        }
      />
      {!user ? (
        <div className="card stack stack-lg">
          {code ? (
            <div className="device-code-box">
              <span className="muted">Code in your terminal</span>
              <strong className="device-code mono">{code}</strong>
            </div>
          ) : null}
          <p className="m0">
            Sign in with GitHub to approve it. You come back to this page with the same code.
          </p>
          <SignInButton tone="primary" callbackURL={`/device${code ? `?code=${code}` : ""}`} />
        </div>
      ) : (
        await approval(user, code)
      )}
    </main>
  );
}

// Too many code lookups in a minute (the page is rate limited like approving): say so instead of failing.
async function approval(user: SessionUser, code: string) {
  let view: Awaited<ReturnType<typeof deviceView>>;
  try {
    view = await deviceView(getDb(), user, code);
  } catch (err) {
    if (err instanceof AppError && err.status === 429) {
      return (
        <p className="card" role="alert">
          Too many tries: wait a minute, then reload this page.
        </p>
      );
    }
    throw err;
  }
  return <DeviceApproval initialCode={code} view={view} />;
}
