import { BillingButton } from "@/components/billing-button";
import { DocPage } from "@/components/landing/doc-page";
import { BETA, FOUNDING, PLANS } from "@brain/core";

const n = (v: number | null) => (v === null ? "Unlimited" : v.toLocaleString("en-US"));

// FEAT-025: the pricing page's content (plans, and the founding offer while it is on sale).
export function PricingBody({ signedIn, founding }: { signedIn: boolean; founding: boolean }) {
  return (
    <DocPage signedIn={signedIn} title="Pricing">
      <p>
        Every plan makes a receipt for every change, with the secret, Supabase RLS and test checks.
        Plans differ in projects and in how many receipts a month are checked by AI. Past that
        number, receipts are still made from git, without the AI check, and say so.
      </p>
      {founding ? (
        <section className="card stack" aria-labelledby="founding">
          <h2 id="founding">Founding offer</h2>
          <p className="m0">
            Builder for ${FOUNDING.priceUsd} a month for your first {FOUNDING.months} months (then $
            {PLANS.builder.priceUsd}), for the first {FOUNDING.max} subscribers.
          </p>
          <BillingButton action="checkout" plan="founding" label="Get the founding offer" primary />
        </section>
      ) : null}
      <h2>Plans</h2>
      <ul className="stack">
        {Object.values(PLANS).map((p) => (
          <li key={p.id} className="card stack">
            <strong>
              {p.name}: {p.priceUsd === 0 ? "free" : `$${p.priceUsd} a month`}
            </strong>
            <span>
              {n(p.projects)} project{p.projects === 1 ? "" : "s"}; {n(p.judgedPerMonth)} AI-checked
              receipts a month
            </span>
            {p.id === "free" ? null : (
              <BillingButton action="checkout" plan={p.id} label={`Choose ${p.name}`} />
            )}
          </li>
        ))}
      </ul>
      <h2>Cancelling</h2>
      <p>
        Cancel any time from your account page (Manage billing). Your plan stays until the end of
        the period you paid for, then the account is on Free. Nothing is deleted.
      </p>
    </DocPage>
  );
}

// FEAT-027: the free beta. No prices or checkout while billing is not set up; the same limits as everywhere else.
export function BetaPricingBody({ signedIn }: { signedIn: boolean }) {
  return (
    <DocPage signedIn={signedIn} title="Pricing">
      <p>Codeceipt is free during the beta. Every account gets:</p>
      <ul>
        <li>
          <strong>{BETA.projects} projects</strong>, each with a receipt for every change and the
          secret, Supabase RLS and test checks.
        </li>
        <li>
          <strong>{BETA.judgedPerMonth} AI-checked receipts a month</strong>. Past that, receipts
          are still made from git, without the AI check, and say so. The count resets on the 1st.
        </li>
      </ul>
      <p>
        Paid plans come after the beta. We will tell you by email before anything you rely on starts
        to cost money, and nothing you made during the beta is deleted.
      </p>
      <a className="btn btn-primary self-start" href={signedIn ? "/start" : "/sign-in"}>
        Start free
      </a>
    </DocPage>
  );
}
