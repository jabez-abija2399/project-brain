import SignInButton from "@/app/sign-in-button";
import { AgentTabs } from "./agent-tabs";
import { CommandBox } from "./command-box";
import { CHECKS, COMMAND, COMPARISON, FAQ, NEVER_SENT, SENT, STUDY_URL } from "./content";
import { HowTerminal } from "./how-terminal";
import { InlineCode } from "./inline-code";
import { PrivacyToggle } from "./privacy-toggle";
import { HeroReceipt } from "./receipt";
import { ReceiptStates } from "./receipt-states";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// The public landing page (2026-11-01 redesign): Codeceipt checks whether your AI agent did what you asked. Server
// rendered; only the tabs, the terminal, the receipt states, the privacy toggle, the copy boxes and the menu are
// client islands. Only what is built today; no invented numbers, logos or testimonials.

const PROBLEMS = [
  "It says done when it isn't.",
  "It changes files you didn't ask about.",
  "It skips or deletes tests.",
];

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="lp-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="lp-container">
        <h2 id={`${id}-title`} className="lp-h2">
          {title}
        </h2>
        {lead ? <p className="lp-lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function Landing({ notice }: { notice?: string } = {}) {
  return (
    <div className="lp" id="top">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        {notice ? (
          <div className="lp-container">
            <output className="notice block">{notice}</output>
          </div>
        ) : null}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <h1 id="hero-title" className="lp-display">
                Your AI agent says it's done. Codeceipt checks.
              </h1>
              <p className="lp-sub">
                Every session with Claude Code, Cursor, Codex or OpenCode ends with a receipt: what
                you asked, what changed, what's missing. Built from git, not the agent's word. Your
                code never leaves your machine.
              </p>
              <div className="lp-actions">
                <CommandBox command={COMMAND} />
                <SignInButton />
              </div>
              <p className="lp-note">Free during the beta. Works in any git repository.</p>
            </div>
            <HeroReceipt />
          </div>
        </section>

        <Section id="agents" title="Works with your agent">
          <AgentTabs />
          <p className="lp-aside">Lovable, Bolt and Replit projects connect through GitHub.</p>
        </Section>

        <Section id="problem" title="Agents are fast. They are not careful.">
          <ul className="problems">
            {PROBLEMS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="research" data-cited="true">
            In a 2026 study of real coding-agent sessions, agents wrote over 99% of the committed
            code in 41% of cases but asked a clarifying question in only 3% of turns.{" "}
            <a href={STUDY_URL} rel="noopener noreferrer">
              Source: arXiv 2604.20779
            </a>
          </p>
        </Section>

        <Section
          id="how"
          title="How it works"
          lead="Three steps. Pick one to see what your terminal shows."
        >
          <HowTerminal />
        </Section>

        <Section
          id="read"
          title="Read a receipt"
          lead="Every line has a state, an icon and a word. Pick a state to see what it means."
        >
          <ReceiptStates />
        </Section>

        <Section
          id="privacy"
          title="What leaves your machine"
          lead="Receipts are built on your computer from git. Only code-free evidence is sent."
        >
          <div className="privacy-columns">
            <div className="privacy-col" data-kind="sent">
              <h3>Sent</h3>
              <ul>
                {SENT.map((s) => (
                  <li key={s}>
                    <span aria-hidden="true">✓</span> {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="privacy-col" data-kind="never">
              <h3>Never sent</h3>
              <ul>
                {NEVER_SENT.map((s) => (
                  <li key={s}>
                    <span aria-hidden="true">✕</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <PrivacyToggle />
        </Section>

        <Section id="checks" title="Checks built in" lead="Open a check to see an example line.">
          <div className="checks">
            {CHECKS.map((c) => (
              <details key={c.id} className="check">
                <summary>{c.title}</summary>
                <div className="check-body">
                  <p>{c.text}</p>
                  <p className="check-example">
                    <span className="lp-visually-hidden">Example receipt line: </span>
                    <code>{c.example}</code>
                  </p>
                </div>
              </details>
            ))}
          </div>
        </Section>

        <Section id="fit" title="Where it fits">
          <p className="fit-line">
            Tests check that code runs. Code review checks the code. Codeceipt checks that the agent
            did what you asked.
          </p>
          <table className="fit-table">
            <caption className="lp-visually-hidden">What each kind of check tells you</caption>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Tells you</th>
                <th scope="col">Doesn't tell you</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((r) => (
                <tr key={r.name} data-ours={r.name === "Codeceipt"}>
                  <th scope="row">{r.name}</th>
                  <td>{r.checks}</td>
                  <td>{r.misses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section id="faq" title="Questions">
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>
                  <InlineCode text={f.a} />
                </p>
              </details>
            ))}
          </div>
        </Section>

        <section className="lp-final" id="get-started" aria-labelledby="final-title">
          <div className="lp-container lp-final-inner">
            <h2 id="final-title" className="lp-h2">
              Build with AI. Keep the receipts.
            </h2>
            <p>Run one command in your app's folder. Free during the beta.</p>
            <div className="lp-actions">
              <CommandBox command={COMMAND} tone="ink" />
              <SignInButton />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
