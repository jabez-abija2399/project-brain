import { Landing } from "@/components/landing/landing";
import { getSessionUser } from "@/server/auth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TITLE = "Project Brain: receipts for AI-built code";
const DESCRIPTION =
  "Project Brain remembers your app across every AI coding session and checks each change against what you asked for, with a receipt for every change.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Project Brain" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

// Signed-in users go straight to their projects, as before; everyone else sees the landing page.
export default async function HomePage() {
  const user = await getSessionUser(new Request("http://localhost/", { headers: await headers() }));
  if (user) redirect("/projects");
  return <Landing />;
}
