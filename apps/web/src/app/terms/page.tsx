import { DocPage } from "@/components/landing/doc-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms | Codeceipt",
  description: "The plain-language terms for using Codeceipt during the beta.",
};

// Launch part 6: plain language. [REVIEW] marks questions for a lawyer before the beta opens widely.
export default function TermsPage() {
  return (
    <DocPage title="Terms of use" updated="October 30, 2026">
      <p>
        These terms are the agreement between you and Codeceipt when you use the website, the
        dashboard or the <code>codeceipt</code> command. [REVIEW] The legal name and country of the
        company offering the service?
      </p>

      <h2>The beta</h2>
      <p>
        Codeceipt is free during the beta. It is new software: features change, and it can be down
        or lose data. Keep your own backups and your own git history. We will tell you before the
        beta ends and before anything you rely on starts to cost money.
      </p>

      <h2>Your code and your data</h2>
      <p>
        Your code stays yours. Codeceipt keeps only the facts about it described in the{" "}
        <a href="/privacy">privacy page</a>, and uses them only to run the service for you. You may
        delete your data at any time as described there.
      </p>

      <h2>Receipts are help, not a guarantee</h2>
      <p>
        A receipt checks an AI agent&apos;s work against what you asked for, but it can miss things
        or be wrong. Review changes before you ship them; you remain responsible for your app.
        [REVIEW] Disclaimer of warranties and limitation of liability wording?
      </p>

      <h2>Fair use</h2>
      <ul>
        <li>Use Codeceipt only for code you have the right to work on.</li>
        <li>
          Do not try to reach other people&apos;s projects, break the service, or get around its
          limits.
        </li>
        <li>Keep your project tokens private; anyone with a token can act on that project.</li>
      </ul>
      <p>We may suspend accounts that break these rules. [REVIEW] Notice and appeal?</p>

      <h2>Changes</h2>
      <p>
        If these terms change, we update this page and its date, and tell beta users by email before
        a change that matters takes effect. [REVIEW] Governing law and how disputes are resolved?
      </p>
    </DocPage>
  );
}
