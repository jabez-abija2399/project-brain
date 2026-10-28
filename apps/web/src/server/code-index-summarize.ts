import {
  type Llm,
  MAX_ATTEMPTS,
  type PreviousSummaries,
  componentKey,
  isSummaryDue,
  summarizeComponents,
  withPreviousSummaries,
} from "@brain/core";
import { type BrainDb, type ComponentRow, codeIndexRepo, symbolsRepo } from "@brain/db";
import { SUMMARIZE_MAX_CALLS, SUMMARIZE_PAGE, dailyAiBudget } from "./code-index-limits";
import { nextUtcDay, releaseDaily, reserveDaily } from "./rate-limit";

export function asPrevious(rows: ComponentRow[]): PreviousSummaries {
  return new Map(rows.map((r) => [componentKey(r.path, r.name), r]));
}

export type SummarizeResult = {
  attempted: number;
  remaining: number;
  enabled: boolean;
  // KI-023: the project's daily AI budget is used up; the rest waits until resumesAt (next UTC midnight).
  budgetExhausted: boolean;
  resumesAt: string | null;
};

const asInput = (r: ComponentRow) => ({
  id: r.id,
  path: r.path,
  name: r.name,
  signature: r.signature ?? "",
});

// Summarizes the project's due components, at most SUMMARIZE_MAX_CALLS per request and within the project's daily AI
// budget (KI-023). The previous summaries and attempt state come from the database (KI-022) and every attempt is
// stamped with the server's clock. M2: components are read in pages; only the due ones this request can send (and as
// many that used up their attempts, for the final attempt after a success) are kept, the rest are only counted.
export async function summarizeDue(
  db: BrainDb,
  projectId: string,
  llm: Llm | null,
  pageSize = SUMMARIZE_PAGE,
): Promise<SummarizeResult> {
  const now = new Date();
  const picked: ComponentRow[] = [];
  let dueTotal = 0;
  let pickedDue = 0;
  let pickedExhausted = 0;
  for (let afterId: string | undefined; ; ) {
    const page = await symbolsRepo.listComponents(db, projectId, { afterId, limit: pageSize });
    for (const row of page) {
      const [c] = withPreviousSummaries([asInput(row)], asPrevious([row]));
      if (!c) continue;
      if (isSummaryDue(c, now)) {
        dueTotal++;
        if (pickedDue < SUMMARIZE_MAX_CALLS) {
          picked.push(row);
          pickedDue++;
        }
      } else if (
        c.summaryStatus === "error" &&
        c.summaryAttempts === MAX_ATTEMPTS &&
        pickedExhausted < SUMMARIZE_MAX_CALLS
      ) {
        picked.push(row);
        pickedExhausted++;
      }
    }
    if (page.length < pageSize) break;
    afterId = page.at(-1)?.id;
  }
  const result = (attempted: number, remaining: number, exhausted: boolean) => ({
    attempted,
    remaining,
    enabled: llm !== null,
    budgetExhausted: exhausted,
    resumesAt: exhausted ? nextUtcDay(now).toISOString() : null,
  });
  if (!llm || dueTotal === 0) return result(0, dueTotal, false);

  // Reserve calls before making them; whatever is not used goes back to the budget.
  const key = `ai:${projectId}`;
  const want = Math.min(SUMMARIZE_MAX_CALLS, dueTotal);
  const granted = await reserveDaily(db, key, dailyAiBudget(), want, now);
  let used = 0;
  try {
    if (granted === 0) return result(0, dueTotal, true);
    const out = await summarizeComponents(picked.map(asInput), llm, asPrevious(picked), {
      now,
      maxCalls: granted,
    });
    const attempted = out.filter((c) => c.summaryAttemptedAt === now);
    used = attempted.length;
    await codeIndexRepo.saveSummaries(db, projectId, attempted);
    const remaining = dueTotal - pickedDue + out.filter((c) => isSummaryDue(c, now)).length;
    return result(used, remaining, remaining > 0 && granted < want && used === granted);
  } finally {
    await releaseDaily(db, key, want - used, now);
  }
}
