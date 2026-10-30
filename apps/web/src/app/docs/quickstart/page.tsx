import { DocPage } from "@/components/landing/doc-page";
import { TerminalSnippet } from "@/components/landing/terminal-snippet";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quickstart | Codeceipt",
  description: "Set up Codeceipt with one command: npx codeceipt.",
};

// Launch part 6: the whole setup is one command. The troubleshooting answers quote the CLI's own messages.
const TROUBLE: { q: string; a: React.ReactNode }[] = [
  {
    q: "No browser opened",
    a: (
      <>
        The terminal prints <q>Open this address in your browser</q> followed by the address. Open
        it on any device where you can sign in with GitHub, and check that the code on the page
        matches the one in your terminal.
      </>
    ),
  },
  {
    q: "“Run `npx codeceipt` inside your app's git repository”",
    a: (
      <>
        Codeceipt links one project to one git repository. Run the command in your app&apos;s
        folder; if it has no git repository yet, run <code>git init</code> there first.
      </>
    ),
  },
  {
    q: "The code expired or was denied",
    a: (
      <>
        Codes last 10 minutes and work once. Run <code>npx codeceipt</code> again for a new one.
      </>
    ),
  },
  {
    q: "“This repo is not linked to a Codeceipt project”",
    a: (
      <>
        Each repo has its own project. Run <code>npx codeceipt</code> in that repo to link it; your
        other repos keep their own projects.
      </>
    ),
  },
  {
    q: "My agent does not see Codeceipt",
    a: (
      <>
        Start a new Claude Code or Cursor session in the repo. The agents run the{" "}
        <code>codeceipt</code> command, so it must be installed: if the summary says so, run{" "}
        <code>npm install -g codeceipt</code> once. You never need to set a token yourself.
      </>
    ),
  },
];

export default function QuickstartPage() {
  return (
    <DocPage title="Quickstart">
      <p>In your app&apos;s folder, run:</p>
      <TerminalSnippet command="npx codeceipt" />
      <ol>
        <li>
          Your browser opens a page showing the same short code as your terminal. Sign in with
          GitHub.
        </li>
        <li>Pick a project, or create one, and approve.</li>
        <li>
          Codeceipt links this repo to the project, indexes your code on your machine and sets up
          Claude Code and Cursor. It ends with a short summary.
        </li>
      </ol>
      <p>
        That&apos;s it. Start a Claude Code or Cursor session in the repo; receipts appear in your
        dashboard when a session ends.
      </p>

      <h2>Troubleshooting</h2>
      <div className="lp-faq">
        {TROUBLE.map((t) => (
          <details key={t.q}>
            <summary>{t.q}</summary>
            <p>{t.a}</p>
          </details>
        ))}
      </div>
    </DocPage>
  );
}
