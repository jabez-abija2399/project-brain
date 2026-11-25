import { GLOSSARY, type GlossaryTerm, glossaryTerm } from "@/lib/glossary";
import { Fragment, type ReactNode } from "react";

// FEAT-028: a word with a dotted underline whose one-sentence meaning shows on hover and on keyboard focus.
export function Term({ name, children }: { name: string; children?: ReactNode }) {
  const term = glossaryTerm(name);
  if (!term) return <>{children}</>;
  const id = `term-${term.key.replaceAll(" ", "-")}`;
  return (
    <span className="term-wrap">
      <button type="button" className="term" aria-describedby={id}>
        {children ?? term.label}
      </button>
      <span role="tooltip" id={id} className="term-tip">
        {term.text}
      </span>
    </span>
  );
}

/** Running text with the first mention of each glossary word made a Term (at most one of each). */
export function withTerms(text: string, keys: string[] = GLOSSARY.map((t) => t.key)): ReactNode {
  const terms = keys.map(glossaryTerm).filter((t): t is GlossaryTerm => t !== null);
  let parts: ReactNode[] = [text];
  for (const term of terms) {
    let done = false;
    parts = parts.flatMap((part) => {
      if (done || typeof part !== "string") return [part];
      const m = term.match.exec(part);
      if (!m) return [part];
      done = true;
      return [
        part.slice(0, m.index),
        <Term key={term.key} name={term.key}>
          {m[0]}
        </Term>,
        part.slice(m.index + m[0].length),
      ];
    });
  }
  return parts.map((p, i) => (typeof p === "string" ? <Fragment key={`t${i}`}>{p}</Fragment> : p));
}
