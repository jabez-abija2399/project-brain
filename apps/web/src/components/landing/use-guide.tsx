import type { ReactNode } from "react";
import { BEFORE_YOU_START, STEPS } from "./content";
import { HowTerminal } from "./how-terminal";

// Owner, 2026-11-02: "How to use Codeceipt" as a written step-by-step guide that reads without clicking anything,
// next to the terminal demo of each step. `code` in backticks in the guide text is shown as code.
function withCode(text: string): ReactNode[] {
  return text.split(/`([^`]+)`/).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed sentence
    i % 2 === 1 ? <code key={i}>{part}</code> : part,
  );
}

export function UseGuide() {
  return (
    <div className="use-guide">
      <div className="guide-before">
        <h3 className="guide-h3">Before you start</h3>
        <ul>
          {BEFORE_YOU_START.map((b) => (
            <li key={b}>{withCode(b)}</li>
          ))}
        </ul>
      </div>
      <ol className="guide-steps">
        {STEPS.map((s, i) => (
          <li className="guide-step" key={s.id}>
            <h3 className="guide-h3">
              <span className="how-num" aria-hidden="true">
                {i + 1}
              </span>
              {s.title}
            </h3>
            <p className="guide-caption">{s.caption}</p>
            <ol className="guide-do">
              {s.does.map((d) => (
                <li key={d}>{withCode(d)}</li>
              ))}
            </ol>
            {s.tip ? <p className="guide-tip">{s.tip}</p> : null}
          </li>
        ))}
      </ol>
      <p className="guide-help">
        Stuck? The <a href="/docs/quickstart#troubleshooting">troubleshooting answers</a> quote the
        exact messages you may see.
      </p>
      <h3 className="guide-h3 guide-demo-title">See each step in the terminal</h3>
      <HowTerminal />
    </div>
  );
}
