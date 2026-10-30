import { DocPage } from "@/components/landing/doc-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | Codeceipt",
  description: "What Codeceipt stores, what it never stores, and the services it uses.",
};

// Launch part 6: plain language. [REVIEW] marks questions for a lawyer before the beta opens widely.
export default function PrivacyPage() {
  return (
    <DocPage title="Privacy" updated="October 30, 2026">
      <p>
        Your source code never leaves your machine. Codeceipt reads your code on your own computer
        and sends only facts about it: names, paths, hashes and short summaries. This page lists
        everything we keep and why.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your GitHub name, email address, profile picture and GitHub
          account id, and your GitHub sign-in token (encrypted). Sign-in sessions keep the IP
          address and browser name they started from.
        </li>
        <li>
          <strong>Your project&apos;s index:</strong> file paths and hashes, the names and props of
          components and functions, which files import which, short AI-written summaries of
          components, feature groups, and the names of your database tables and their access rules.
        </li>
        <li>
          <strong>Your sessions:</strong> handoff notes, progress notes, decisions, the checklists
          made from your requests (your words, as you typed them), plans you draft, and receipts:
          changed file names, test names and counts.
        </li>
        <li>
          <strong>Project tokens:</strong> only a hash of each token, so a stolen copy of our
          database cannot be used to sign in as you.
        </li>
        <li>
          <strong>GitHub App (if you install it):</strong> the installation and the names of the
          repositories you chose, and the file paths changed by each push.
        </li>
        <li>
          <strong>Waitlist:</strong> the email address you entered.
        </li>
        <li>
          <strong>Abuse limits:</strong> counters keyed by a one-way hash of your IP address,
          deleted after two days.
        </li>
      </ul>

      <h2>What we never store</h2>
      <ul>
        <li>The contents of your source files.</li>
        <li>
          Secret values. When a key or password is found in your code, only its first four
          characters are kept, followed by <code>***</code>.
        </li>
        <li>
          Your project tokens in readable form. They live only on your computer, never in your repo.
        </li>
        <li>Your IP address next to anything you do (only the hashed counters above).</li>
      </ul>

      <h2>Services we use</h2>
      <ul>
        <li>
          <strong>Vercel</strong> runs the website and API. It keeps standard request logs. [REVIEW]
          Vercel log retention and data processing terms?
        </li>
        <li>
          <strong>Neon</strong> hosts the Postgres database that holds everything listed above.
          [REVIEW] Region and data processing terms?
        </li>
        <li>
          <strong>GitHub</strong> signs you in and, if you install the GitHub App, tells us about
          pushes to the repositories you chose.
        </li>
        <li>
          <strong>Inngest</strong> runs background jobs. It receives ids (project, push), not your
          data.
        </li>
        <li>
          <strong>Anthropic</strong> (the Claude API) writes the summaries, checklists, plans and
          receipts. It receives component names and props, file names, your requests and checklist
          items, never your source files. [REVIEW] Anthropic&apos;s API data retention and whether
          it is listed as a subprocessor?
        </li>
      </ul>
      <p>We do not use advertising or analytics trackers, and we do not sell your data.</p>

      <h2>Deleting your data</h2>
      <ul>
        <li>
          <strong>Tokens:</strong> revoke any project token from the project&apos;s page in the
          dashboard; it stops working at once.
        </li>
        <li>
          <strong>Your account and projects:</strong> there is no delete button yet. Email us from
          the address on your GitHub account and we delete your account, its projects and everything
          in them. [REVIEW] Contact address and how many days we promise?
        </li>
        <li>
          <strong>GitHub:</strong> revoke Codeceipt under GitHub Settings, Applications, and
          uninstall the GitHub App from the repositories you chose.
        </li>
        <li>
          <strong>Your computer:</strong> delete the <code>.git/codeceipt</code> folder in your repo
          and the <code>codeceipt</code> folder in your user config folder (for example{" "}
          <code>~/.config/codeceipt</code>).
        </li>
        <li>
          <strong>Waitlist:</strong> email us and we remove your address. [REVIEW] Contact address?
        </li>
      </ul>
      <p>
        [REVIEW] Legal basis for processing (GDPR), data controller name and address, and rights of
        people in the EU and California?
      </p>
    </DocPage>
  );
}
