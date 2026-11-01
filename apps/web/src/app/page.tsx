import { Landing } from "@/components/landing/landing";
import { getSessionUser } from "@/server/auth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TITLE = "Codeceipt: a receipt for every AI change";
const DESCRIPTION =
  "Codeceipt checks whether your AI agent did what you asked and gives you a receipt for every session, built from git, not the agent's word. Your code never leaves your machine.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Codeceipt" },
  // The image is app/opengraph-image.tsx (the hero receipt); Next.js adds its og:image tags.
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Signed-in users go straight to their projects, as before; everyone else sees the landing page.
export default async function HomePage() {
  const user = await getSessionUser(new Request("http://localhost/", { headers: await headers() }));
  if (user) redirect("/projects");
  return <Landing />;
}
