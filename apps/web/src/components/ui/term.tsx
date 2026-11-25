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
  // Pieces of the text in order; a piece with a term key becomes a Term. Keys are the piece's start offset.
  let pieces: { at: number; text: string; term?: string }[] = [{ at: 0, text }];
  for (const term of terms) {
    let done = false;
    pieces = pieces.flatMap((piece) => {
      if (done || piece.term) return [piece];
      const m = term.match.exec(piece.text);
      if (!m) return [piece];
      done = true;
      const start = piece.at + m.index;
      return [
        { at: piece.at, text: piece.text.slice(0, m.index) },
        { at: start, text: m[0], term: term.key },
        { at: start + m[0].length, text: piece.text.slice(m.index + m[0].length) },
      ];
    });
  }
  return pieces.map((p) =>
    p.term ? (
      <Term key={`term-${p.at}`} name={p.term}>
        {p.text}
      </Term>
    ) : (
      <Fragment key={`text-${p.at}`}>{p.text}</Fragment>
    ),
  );
}
