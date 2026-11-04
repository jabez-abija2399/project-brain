import { PricingBody } from "@/components/pricing-body";
import { foundingAvailable } from "@/server/billing";
import { getDb } from "@/server/db";
import { isSignedIn } from "@/server/signed-in";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing | Codeceipt",
  description:
    "Free for one project. Builder, Pro and Agency for more projects and more AI-checked receipts.",
};

// FEAT-025: the plans, and the founding offer while it lasts. Paying happens on Stripe's own page.
export default async function PricingPage() {
  const [signedIn, founding] = await Promise.all([isSignedIn(), foundingAvailable(getDb())]);
  return <PricingBody signedIn={signedIn} founding={founding} />;
}
