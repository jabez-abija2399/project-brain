import { BillingButton } from "@/components/billing-button";
import { DocPage } from "@/components/landing/doc-page";
import { FOUNDING, PLANS } from "@brain/core";

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
