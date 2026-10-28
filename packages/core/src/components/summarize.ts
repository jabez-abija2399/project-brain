import { createHash } from "node:crypto";
import type { ComponentIndex } from "../indexer";
import type { Llm } from "../llm";
import { maskSecretsIn } from "../mask";

export const MAX_SUMMARY = 200;
const CONCURRENCY = 4;
// A failed summary is retried on later indexes at most once per RETRY_AFTER_MS and MAX_ATTEMPTS times per hash.
export const RETRY_AFTER_MS = 24 * 3600_000;
export const MAX_ATTEMPTS = 3;
// This many failed calls in a row (an outage, a bad key) stop the batch; the rest wait for the next index.
export const MAX_ERRORS_IN_A_ROW = 5;

/** Outcome of the last summary attempt for the current hash; null = not attempted yet. */
export type SummaryStatus = "ok" | "empty" | "error";

export type SummaryState = {
  summary: string | null;
  summaryStatus: SummaryStatus | null;
  /** Attempts for the current hash. */
  summaryAttempts: number;
  summaryAttemptedAt: Date | null;
};

/** What a summary is built from (metadata only); the CLI upload has no line or props. */
export type SummaryInput = Pick<ComponentIndex, "path" | "name" | "signature">;

export type Summarized<T extends SummaryInput> = T &
  SummaryState & {
    /** Hash of everything the summary is built from; a summary is regenerated only when it changes. */
    hash: string;
  };
export type SummarizedComponent = Summarized<ComponentIndex>;

/** What the previous index stored, keyed by componentKey(path, name). Rows from before 0008 have no status. */
export type PreviousSummaries = Map<
  string,
  { hash: string | null; summary: string | null } & Partial<SummaryState>
>;

export function componentKey(path: string, name: string): string {
  return `${path}#${name}`;
}

// The summary sees metadata only (name, path, signature from the AST): the server never has the source.
export function componentHash(c: Pick<ComponentIndex, "path" | "name" | "signature">): string {
  return createHash("sha256").update(`${c.path}\n${c.name}\n${c.signature}`).digest("hex");
}

const SYSTEM =
  "You describe React components for a project map. Answer with one plain sentence under 200 characters: " +
  "what the component is for. No markdown, no code.";

function promptFor(c: SummaryInput): string {
  return maskSecretsIn(`Component: ${c.name}\nFile: ${c.path}\nSignature: ${c.signature}`);
}

export function cleanSummary(text: string): string | null {
  const flat = maskSecretsIn(text.replace(/\s+/g, " ").trim());
  if (!flat) return null;
  return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY - 3)}...` : flat;
}

const NOT_ATTEMPTED: SummaryState = {
  summary: null,
  summaryStatus: null,
  summaryAttempts: 0,
  summaryAttemptedAt: null,
};

/** Not attempted yet for this hash, or a failed attempt whose retry is due. */
export function isSummaryDue(s: SummaryState, now: Date): boolean {
  if (s.summary !== null || s.summaryStatus === "ok" || s.summaryStatus === "empty") return false;
  if (s.summaryStatus === null) return true;
  return (
    s.summaryAttempts < MAX_ATTEMPTS &&
    (s.summaryAttemptedAt === null ||
      now.getTime() - s.summaryAttemptedAt.getTime() >= RETRY_AFTER_MS)
  );
}

function isExhausted(s: SummaryState): boolean {
  return s.summaryStatus === "error" && s.summaryAttempts === MAX_ATTEMPTS;
}

// Each hash is summarized once: a summary, an empty answer or an error is recorded with the attempt, and an
// unchanged component is not sent again. Only errors are retried, on the RETRY_AFTER_MS / MAX_ATTEMPTS schedule;
// once a call in this run succeeds (the API works again), components that used up their attempts get one final
// attempt. maxCalls bounds one run (a request); the rest stay due for the next run.
// Carries the previous summary and attempt state over to components whose hash did not change (no LLM call).
export function withPreviousSummaries<T extends SummaryInput>(
  components: T[],
  previous: PreviousSummaries,
): Summarized<T>[] {
  return components.map((c) => {
    const hash = componentHash(c);
    const prev = previous.get(componentKey(c.path, c.name));
    if (!prev || prev.hash !== hash) return { ...c, hash, ...NOT_ATTEMPTED };
    return {
      ...c,
      hash,
      summary: prev.summary,
      summaryStatus: prev.summaryStatus ?? (prev.summary !== null ? "ok" : null),
      summaryAttempts: prev.summaryAttempts ?? 0,
      summaryAttemptedAt: prev.summaryAttemptedAt ?? null,
    };
  });
}

export async function summarizeComponents<T extends SummaryInput>(
  components: T[],
  llm: Llm,
  previous: PreviousSummaries = new Map(),
  options: { now?: Date; maxCalls?: number } = {},
): Promise<Summarized<T>[]> {
  const now = options.now ?? new Date();
  const out = withPreviousSummaries(components, previous);
  const queue = out.filter((c) => isSummaryDue(c, now));
  const exhausted = out.filter(isExhausted);
  let next = 0;
  let budget = options.maxCalls ?? Number.POSITIVE_INFINITY;
  let errorsInARow = 0;
  let inFlight = 0;
  let succeeded = false;

  const attempt = async (c: Summarized<T>): Promise<boolean> => {
    c.summaryAttempts++;
    c.summaryAttemptedAt = now;
    try {
      const text = await llm.complete({
        system: SYSTEM,
        prompt: promptFor(c),
        maxTokens: 100,
        purpose: "component-summary",
      });
      c.summary = cleanSummary(text);
      c.summaryStatus = c.summary === null ? "empty" : "ok";
      return true;
    } catch {
      c.summary = null;
      c.summaryStatus = "error";
      return false;
    }
  };

  // A pool of up to CONCURRENCY calls, refilled after every answer, so a success lets it grow back to full size.
  await new Promise<void>((done) => {
    const pump = () => {
      // Counting calls in flight as possible errors keeps an outage at exactly MAX_ERRORS_IN_A_ROW calls.
      while (
        inFlight < CONCURRENCY &&
        next < queue.length &&
        budget > 0 &&
        errorsInARow + inFlight < MAX_ERRORS_IN_A_ROW
      ) {
        const c = queue[next++] as Summarized<T>;
        budget--;
        inFlight++;
        void attempt(c).then((ok) => {
          inFlight--;
          if (ok) {
            errorsInARow = 0;
            if (!succeeded) queue.push(...exhausted);
            succeeded = true;
          } else {
            errorsInARow++;
          }
          pump();
        });
      }
      if (inFlight === 0) done();
    };
    pump();
  });
  return out;
}
