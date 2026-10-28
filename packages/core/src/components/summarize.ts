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

export type SummarizedComponent = ComponentIndex &
  SummaryState & {
    /** Hash of everything the summary is built from; a summary is regenerated only when it changes. */
    hash: string;
  };

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

function promptFor(c: ComponentIndex): string {
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

function isDue(s: SummaryState, now: Date): boolean {
  if (s.summary !== null || s.summaryStatus === "ok" || s.summaryStatus === "empty") return false;
  if (s.summaryStatus === null) return true;
  return (
    s.summaryAttempts < MAX_ATTEMPTS &&
    (s.summaryAttemptedAt === null ||
      now.getTime() - s.summaryAttemptedAt.getTime() >= RETRY_AFTER_MS)
  );
}

// Each hash is summarized once: a summary, an empty answer or an error is recorded with the attempt, and an
// unchanged component is not sent again. Only errors are retried, on the RETRY_AFTER_MS / MAX_ATTEMPTS schedule.
export async function summarizeComponents(
  components: ComponentIndex[],
  llm: Llm,
  previous: PreviousSummaries = new Map(),
  options: { now?: Date } = {},
): Promise<SummarizedComponent[]> {
  const now = options.now ?? new Date();
  const out: SummarizedComponent[] = components.map((c) => {
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
  const todo = out.filter((c) => isDue(c, now));
  let next = 0;
  let errorsInARow = 0;
  let inFlight = 0;
  const worker = async () => {
    // Counting calls in flight as possible errors keeps an outage at exactly MAX_ERRORS_IN_A_ROW calls.
    while (next < todo.length && errorsInARow + inFlight < MAX_ERRORS_IN_A_ROW) {
      const c = todo[next++] as SummarizedComponent;
      c.summaryAttempts++;
      c.summaryAttemptedAt = now;
      inFlight++;
      try {
        const text = await llm.complete({
          system: SYSTEM,
          prompt: promptFor(c),
          maxTokens: 100,
          purpose: "component-summary",
        });
        c.summary = cleanSummary(text);
        c.summaryStatus = c.summary === null ? "empty" : "ok";
        errorsInARow = 0;
      } catch {
        c.summary = null;
        c.summaryStatus = "error";
        errorsInARow++;
      } finally {
        inFlight--;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return out;
}
