import { getAuth } from "@/server/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session?.user) redirect("/projects");

  // Sign-in landing. The href posts to the better-auth sign-in endpoint which
  // redirects the browser into GitHub's OAuth flow.
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
      <form action="/api/auth/sign-in/social" method="post" style={{ marginTop: 32 }}>
        <input type="hidden" name="provider" value="github" />
        <input type="hidden" name="callbackURL" value="/projects" />
        <button
          type="submit"
          style={{
            background: "var(--text)",
            color: "var(--surface)",
            border: 0,
            borderRadius: 8,
            padding: "12px 20px",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Sign in with GitHub
        </button>
      </form>
    </main>
  );
}
