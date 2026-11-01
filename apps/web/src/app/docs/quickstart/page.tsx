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
    q: "I did not see the receipt after the session ended",
    a: (
      <>
        Claude Code does not show a session-end message once it has exited. Run{" "}
        <code>codeceipt last</code> in the repo to print the latest receipt and its link again.
      </>
    ),
  },
  {
    q: "My agent does not see Codeceipt",
    a: (
      <>
        Start a new Claude Code or Cursor session in the repo. The hooks run the installed{" "}
        <code>codeceipt</code> command, or the published one through <code>npx</code> when it is
        not installed; <code>npm install -g codeceipt</code> makes them faster. If you set Codeceipt
        up with an older version, run <code>npx codeceipt</code> again to update the hooks. You
        never need to set a token yourself.
      </>
    ),
  },
  {
    q: "“This repository is not the one connected to project …”",
    a: (
      <>
        Each project belongs to one repository. A copied <code>.git</code> folder can carry
        another repo&apos;s link: run <code>codeceipt unlink</code>, then <code>npx codeceipt</code>{" "}
        to connect this repo to a new or existing project. If another repo&apos;s files already
        reached a project, run <code>codeceipt index --rebuild</code> in the right repo to rebuild
        the index from it alone.
      </>
    ),
  },
];

// A screenshot to add before launch: the page is complete without it, the placeholder says what it will show.
function Screenshot({ of }: { of: string }) {
  return (
    <p className="lp-doc-screenshot muted" data-screenshot={of}>
      [SCREENSHOT: {of}]
    </p>
  );
}

// Journey part 6: the same steps, in the same words, as the start page, the terminal and the receipt.
export default function QuickstartPage() {
  return (
    <DocPage title="Quickstart">
      <p>
        About five minutes from sign-in to your first receipt. Your source code stays on your
        machine.
      </p>

      <h2>1. Sign in with GitHub</h2>
      <p>
        Sign in on the Codeceipt home page. You land on <strong>Get your first receipt</strong>,
        which shows the three steps below and ticks each one off by itself as it happens.
      </p>
      <Screenshot of="the Get your first receipt page with three waiting steps" />

      <h2>2. Run npx codeceipt in your project</h2>
      <p>In your app&apos;s folder (a git repository), run:</p>
      <TerminalSnippet command="npx codeceipt" />
      <p>The terminal shows a short code, like BCDF-GHJK, and opens your browser.</p>
      <Screenshot of="the terminal showing the code and Waiting for approval" />

      <h2>3. Approve in the browser</h2>
      <p>
        Check that the code on the page matches the one in your terminal, pick a project or create
        one, and approve. Codeceipt then links this repo to the project, indexes your code on your
        machine (only names, paths and hashes are sent) and sets up the agents it finds.
      </p>
      <Screenshot of="the approval page with the code and the project picker" />
      <p>The terminal ends with a short summary and what happens next:</p>
      <pre className="lp-doc-terminal">
        <code>
          {[
            "Codeceipt is set up for this repo.",
            "  Project: https://codeceipts.vercel.app/projects/…",
            "  Indexed: 42 files, 5 features",
            "  Agents:  Claude Code",
            "What happens next:",
            "  1. Start Claude Code in this folder.",
            "  2. Ask it for a change, and end the session when it is done.",
            "  3. See your receipt: run `codeceipt last`, or open https://codeceipts.vercel.app/projects/…/receipts",
          ].join("\n")}
        </code>
      </pre>
      <p>
        The files it added (agent settings, the Codeceipt skill, the AGENTS.md section) hold no
        token and never count as changes in your receipts.
      </p>

      <h2>4. Open Claude Code or Cursor and make a change</h2>
      <p>
        Start your agent in the same folder and ask for something small. It checks where you
        stopped, turns your request into a checklist and builds it. When it is done, end the
        session: the terminal prints the receipt in three lines.
      </p>
      <pre className="lp-doc-terminal">
        <code>
          {[
            "Codeceipt receipt: 1 done, 1 missed.",
            "Checks needing attention: none.",
            "Full receipt: https://codeceipts.vercel.app/projects/…/receipts#receipt-…",
          ].join("\n")}
        </code>
      </pre>
      <Screenshot of="the terminal after the session ends, with the three-line receipt" />
      <p>
        OpenCode and Antigravity have no session-end event: run <code>codeceipt receipt</code> when
        you finish instead.
      </p>

      <h2>5. Your first receipt</h2>
      <p>
        The start page shows all three steps done and your first receipt, with what each part means:
        what you asked, the checklist (done, partly done or missed), files changed outside the
        request, security findings, test checks and what could not be verified.{" "}
        <strong>Done, no test proves it</strong> means the change is there but no test changed to
        show it works; <strong>Not verified</strong> means Codeceipt could not check it at all.
        Every receipt after that is on your project&apos;s Receipts tab.
      </p>
      <Screenshot of="the first receipt on the start page, with one item missed" />

      <h2>Troubleshooting</h2>
      <div className="faq">
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
