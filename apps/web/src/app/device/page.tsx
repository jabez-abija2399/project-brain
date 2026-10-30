import SignInButton from "@/app/sign-in-button";
import { getSessionUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { deviceView } from "@/server/device";
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
        <DeviceApproval initialCode={code} view={await deviceView(getDb(), user, code)} />
      )}
    </main>
  );
}
