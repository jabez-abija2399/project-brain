import SignInButton from "@/app/sign-in-button";
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
    <main className="page stack" style={{ maxWidth: 560 }}>
      <h1>Connect your terminal</h1>
      {!user ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>
            Sign in to approve the code shown in your terminal
            {code ? (
              <>
                : <strong className="mono">{code}</strong>
              </>
            ) : null}
            .
          </p>
          <SignInButton callbackURL={`/device${code ? `?code=${code}` : ""}`} />
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
