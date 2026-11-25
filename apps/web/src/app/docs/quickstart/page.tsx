import { InstallOptions } from "@/components/install-options";
import { DocPage } from "@/components/landing/doc-page";
import { isSignedIn } from "@/server/signed-in";
import type { Metadata } from "next";

// Rendered per request: the header and footer depend on whether the visitor is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quickstart | Codeceipt",
  description: "Install Codeceipt with one line, then set it up with one command: codeceipt.",
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
        <code>codeceipt</code> app by its full path, or the published one through <code>npx</code>{" "}
        when it is not installed; the one-line installer makes them faster. If you set Codeceipt up
        with an older version, run <code>codeceipt init</code> in the repo to update the hooks, and{" "}
        <code>codeceipt doctor</code> to check everything. You never need to set a token yourself.
      </>
    ),
  },
  {
    q: "“This repository is not the one connected to project …”",
    a: (
      <>
        Each project belongs to one repository. A copied <code>.git</code> folder can carry another
        repo&apos;s link: run <code>codeceipt unlink</code>, then <code>npx codeceipt</code> to
        connect this repo to a new or existing project. If another repo&apos;s files already reached
        a project, run <code>codeceipt index --rebuild</code> in the right repo to rebuild the index
        from it alone.
      </>
    ),
  },
];

// A screenshot to add before launch (FEAT-029: nothing shows until the image exists; `of` says what it will show).
function Screenshot(_props: { of: string }) {
  return null;
}

// Journey part 6: the same steps, in the same words, as the start page, the terminal and the receipt.
export default async function QuickstartPage() {
  const signedIn = await isSignedIn();
  return (
    <DocPage signedIn={signedIn} title="Quickstart">
      <p>
        About five minutes from sign-in to your first receipt. Your source code stays on your
        machine.
      </p>

      {/* FEAT-038: the same three steps as the landing page (Set up, Work as usual, Get your receipt), and the
          working command first. */}
      <h2>1. Set up</h2>
      <p>
        Once per repository, about two minutes. Open a terminal in your app&apos;s folder (a git
        repository) and run this first:
      </p>
      <InstallOptions />
      <Screenshot of="the terminal showing the code and Waiting for approval" />
      <p>
        The terminal shows a short code, like BCDF-GHJK, and opens your browser. Check that the code
        on the page matches the one in your terminal, sign in with GitHub, pick a project or create
        one, and approve. Codeceipt then links this repo to the project, indexes your code on your
        machine (only names, paths and hashes are sent) and sets up the agents it finds.
      </p>
      <Screenshot of="the sign-in page and the approval page with the code and the project picker" />
      <Screenshot of="the Get your first receipt page with its steps ticking off" />
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

      <h2>2. Work as usual</h2>
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

      <h2>3. Get your receipt</h2>
      <p>
        The start page shows every step done and your first receipt, with what each part means: what
        you asked, the checklist (done, partly done or missed), files changed outside the request,
        security findings, test checks and what could not be verified.{" "}
        <strong>Done, no test proves it</strong> means the change is there but no test changed to
        show it works; <strong>Not verified</strong> means Codeceipt could not check it at all.
        Every receipt after that is on your project&apos;s Receipts tab.
      </p>
      <Screenshot of="the first receipt on the start page, with one item missed" />

      <h2>Troubleshooting</h2>
      {/* FEAT-038: numbered, so "see 3 in Troubleshooting" means one thing. */}
      <ol className="faq faq-numbered">
        {TROUBLE.map((t) => (
          <li key={t.q}>
            <details>
              <summary>{t.q}</summary>
              <p>{t.a}</p>
            </details>
          </li>
        ))}
      </ol>
    </DocPage>
  );
}
