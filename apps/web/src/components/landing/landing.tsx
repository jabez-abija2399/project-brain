import SignInButton from "@/app/sign-in-button";
import type { ReactNode } from "react";
import { KeyIcon, PackageIcon, ScopeIcon, ShieldIcon, TestIcon } from "./icons";
import { Receipt } from "./receipt";
import { SiteHeader } from "./site-header";
import { TerminalSnippet } from "./terminal-snippet";
import { WaitlistForm } from "./waitlist-form";

// The public landing page ("Calm ledger"): quiet type and spacing everywhere, the printing receipt as the one bold
// element, the final call to action as the only dark band. No invented numbers, logos or testimonials.

const PROBLEMS = [
  {
    title: "It forgets.",
    text: "Every new chat starts from zero. Your agent rebuilds context, guesses at decisions you already made, and burns tokens doing it.",
  },
  {
    title: "It duplicates.",
    text: "It can't see the Button you already have, so it writes another one. And another.",
  },
  {
    title: "It says done.",
    text: "It reports success, but it skipped part of your request, edited a file it shouldn't have, or deleted a test that was failing.",
  },
];

const STEPS: { title: string; command: string; note?: string; text: string }[] = [
  {
    title: "Index your project",
    command: "projectbrain index",
    text: "Your code is read on your machine. Only names, paths and hashes are uploaded.",
  },
  {
    title: "Connect your agent",
    command: "projectbrain init",
    text: "One command sets up Claude Code and Cursor. Every session starts with a note about where you stopped and what was decided.",
  },
  {
    title: "Get a receipt for every change",
    command: "projectbrain hook session-end",
    note: "Runs on its own when a session ends.",
    text: "When the session ends, Project Brain checks the changed files from git, not from the agent's word, and writes the receipt.",
  },
];

const CHECKS: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <KeyIcon />,
    title: "Leaked secrets",
    text: "Your code is scanned on your machine; only masked values like sb_s*** ever leave it.",
  },
  {
    icon: <ShieldIcon />,
    title: "Supabase RLS",
    text: 'Your migrations run in a sandboxed Postgres to see which tables are really protected; anything unclear is reported as "cannot confirm", never "safe".',
  },
  {
    icon: <TestIcon />,
    title: "Weakened tests",
    text: "Deleted tests, skipped tests and removed assertions are flagged in the receipt.",
  },
  {
    icon: <PackageIcon />,
    title: "Risky packages",
    text: "New dependencies are checked for brand-new, missing or made-up packages before you install them.",
  },
  {
    icon: <ScopeIcon />,
    title: "Scope creep",
    text: "Files changed outside the feature you asked about are listed.",
  },
];

const PRIVACY_FACTS = [
  "Only file names, paths, hashes and short summaries are stored.",
  "Secrets are masked before anything is sent.",
  "Access tokens are stored as hashes and never written into your repo.",
];

const FAQ = [
  {
    q: "Do you store my code?",
    a: "No. Your code is indexed on your machine; Project Brain stores only metadata (file names, paths, hashes, symbol names) and short summaries.",
  },
  {
    q: "Which agents does it work with?",
    a: "Claude Code and Cursor, through MCP and session hooks. Lovable, Bolt and Replit projects connect through the GitHub App.",
  },
  {
    q: "Do I need to change how I work?",
    a: "No. Run one command in your project; your agent uses Project Brain on its own.",
  },
  { q: "What does it cost?", a: "It's free during the beta." },
  {
    q: "Is it safe to connect GitHub?",
    a: "The GitHub App gets read-only access to the repositories you choose, and nothing else.",
  },
];

export function Landing() {
  return (
    <div className="lp" id="top">
      <SiteHeader />
      <main>
        <section className="lp-container lp-hero" aria-labelledby="lp-title">
          <h1 id="lp-title">Your AI agent says it's done. Get the receipt.</h1>
          <p className="lp-sub">
            Project Brain remembers your app across every AI session and checks each change against
            what you asked for, so you can trust what Claude Code, Cursor and Lovable build.
          </p>
          <div className="lp-ctas">
            <a className="btn btn-primary lp-btn-lg" href="#join">
              Join the beta
            </a>
            <a className="btn lp-btn-lg" href="#receipt">
              See a sample receipt
            </a>
          </div>
          <Receipt />
        </section>

        <p className="lp-container lp-works-with">
          Works with Claude Code and Cursor today. Lovable, Bolt and Replit projects connect through
          GitHub.
        </p>

        <section className="lp-container lp-section" aria-labelledby="lp-problem">
          <h2 id="lp-problem" className="lp-visually-hidden">
            The problem
          </h2>
          <div className="lp-columns">
            {PROBLEMS.map((p) => (
              <div key={p.title} className="lp-column">
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-container lp-section" id="how" aria-labelledby="lp-how">
          <h2 id="lp-how">How it works</h2>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li key={s.title} className="lp-step">
                <h3>{s.title}</h3>
                <p>{s.text}</p>
                <TerminalSnippet command={s.command} note={s.note} />
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-container lp-section" aria-labelledby="lp-checks">
          <h2 id="lp-checks">Checks built in</h2>
          <ul className="lp-checks">
            {CHECKS.map((c) => (
              <li key={c.title} className="lp-check">
                <span className="lp-check-icon">{c.icon}</span>
                <div>
                  <h3>{c.title}</h3>
                  <p>{c.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-privacy" id="privacy" aria-labelledby="lp-privacy">
          <div className="lp-container">
            <h2 id="lp-privacy">Your source code never leaves your machine.</h2>
            <ul className="lp-facts">
              {PRIVACY_FACTS.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-container lp-section" id="faq" aria-labelledby="lp-faq">
          <h2 id="lp-faq">FAQ</h2>
          <div className="lp-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final" id="join" aria-labelledby="lp-join">
          <div className="lp-container lp-final-inner">
            <h2 id="lp-join">Build with AI. Keep the receipts.</h2>
            <WaitlistForm />
          </div>
        </section>
      </main>
      <footer className="lp-container lp-footer">
        <span className="lp-wordmark">Project Brain</span>
        <nav className="lp-footer-links" aria-label="Footer">
          <SignInButton variant="link" />
          <a href="#privacy">Privacy</a>
          <span>
            {"©"} {new Date().getFullYear()}
          </span>
        </nav>
      </footer>
    </div>
  );
}
