// FEAT-040 (design v3): the clearance seal, the one bold mark next to a page's verdict. Its state is said in words
// (the accessible name), and the shape inside differs per state, so it never depends on colour alone.
export type SealState = "clear" | "needs" | "unsafe" | "start";

const NAME: Record<SealState, string> = {
  clear: "All clear",
  needs: "Needs you",
  unsafe: "Unsafe",
  start: "Not started",
};

export function Seal({ state, count }: { state: SealState; count?: number }) {
  return (
    <span className={`seal seal-${state}`} role="img" aria-label={NAME[state]} data-seal={state}>
      {state === "clear" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : state === "unsafe" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 4 2.8 19.5h18.4z M12 10v4 M12 17h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : state === "needs" ? (
        <b>{count !== undefined && count > 99 ? "99+" : (count ?? "!")}</b>
      ) : (
        <b>·</b>
      )}
    </span>
  );
}
