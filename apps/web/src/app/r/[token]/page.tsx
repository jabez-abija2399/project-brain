import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { ReceiptCard } from "@/components/receipt-card";
import { StateGuide } from "@/components/state-guide";
import { getDb } from "@/server/db";
import { sharedReceipt } from "@/server/share-links";
import { isSignedIn } from "@/server/signed-in";
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
  const signedIn = await isSignedIn();
  // FEAT-038: the public header and footer, a title and a purpose sentence, and what each state means.
  return (
    <div className="lp">
      <SiteHeader home="/" signedIn={signedIn} />
      <main id="content" className="page page-narrow stack stack-lg">
        <header className="stack gap-6">
          <span className="badge">Receipt by Codeceipt</span>
          <h1 className="m0">A receipt for an AI coding session</h1>
          <p className="purpose m0" data-testid="share-purpose">
            Someone shared this with you. It shows what they asked their AI agent for, what got
            done, what was missed and what needs a look, checked against their code.
          </p>
        </header>
        <ReceiptCard receipt={{ ...receipt, projectId: "", fixPrompt: null }} expanded readOnly />
        <StateGuide />
        <p className="muted">
          Built from git, not the agent&apos;s word. Codeceipt never sees the source code: only file
          names, counts and short summaries.{" "}
          <a href="/" rel="noreferrer">
            What is Codeceipt?
          </a>
        </p>
      </main>
      <SiteFooter signedIn={signedIn} />
    </div>
  );
}
