import { BetaPricingBody, PricingBody } from "@/components/pricing-body";
import { billingEnabled, foundingAvailable } from "@/server/billing";
import { getDb } from "@/server/db";
import { isSignedIn } from "@/server/signed-in";
import { BETA_SUMMARY } from "@brain/core";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing | Codeceipt",
  description: BETA_SUMMARY,
};

// FEAT-025: the plans, and the founding offer while it lasts. Paying happens on Stripe's own page.
export default async function PricingPage() {
  // FEAT-027: while billing is not set up (the free beta), no plan, price or checkout is shown.
  if (!billingEnabled()) return <BetaPricingBody signedIn={await isSignedIn()} />;
  const [signedIn, founding] = await Promise.all([isSignedIn(), foundingAvailable(getDb())]);
  return <PricingBody signedIn={signedIn} founding={founding} />;
}
