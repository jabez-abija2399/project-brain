import { Fragment } from "react";

/** Plain text with `backticked` commands shown as code (landing copy only; no HTML is ever parsed). */
export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string never move
          <code key={i}>{part}</code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string never move
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
