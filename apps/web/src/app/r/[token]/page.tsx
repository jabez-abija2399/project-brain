import { ReceiptCard } from "@/components/receipt-card";
import { getDb } from "@/server/db";
import { sharedReceipt } from "@/server/share-links";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// FEAT-021: a receipt someone shared. Read-only, no sign-in, nothing else from the project; never indexed, and links
// from it send no referrer (the address holds the token).
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Receipt by Codeceipt",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function SharedReceiptPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const receipt = await sharedReceipt(getDb(), token);
  if (!receipt) notFound();
  return (
    <main className="page page-narrow stack stack-lg">
      <p className="row gap-6">
        <span className="badge">Receipt by Codeceipt</span>
        <a href="/" rel="noreferrer">
          What is this?
        </a>
      </p>
      <ReceiptCard receipt={{ ...receipt, projectId: "", fixPrompt: null }} expanded readOnly />
      <p className="muted">
        Built from git, not the agent&apos;s word. Codeceipt never sees the source code: only file
        names, counts and short summaries.
      </p>
    </main>
  );
}
