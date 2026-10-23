import { getAuth } from "@/server/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import SignInButton from "./sign-in-button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session?.user) redirect("/projects");

  return (
    <main
      style={{
        padding: "48px 32px",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Project Brain</h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>
        A living blueprint of every AI-built app, with a receipt for every change.
      </p>
      <SignInButton />
    </main>
  );
}
