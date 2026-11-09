// Roadmap Phase 4b: "Review here first". Every receipt ranks at most three places a person should look at first,
// each with a plain reason, from the receipt's own evidence only (no AI, nothing new from the server): security
// findings, weakened tests, a failed check, work marked missed or partly done, work done without a test, and changes
// outside the request's feature. Paths and texts are already masked and one line in the ReceiptView.
import type { ReceiptView } from "./fix-prompt";
import { maskPath, maskSecretsIn } from "./mask";
import { plainText } from "./text";

export const MAX_REVIEW_PLACES = 3;
const MAX_TEXT = 80;

export type ReviewPlace = { where: string; why: string };

const short = (text: string) => {
  const t = maskSecretsIn(plainText(text));
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
};

/** At most MAX_REVIEW_PLACES places, most serious first, one per place (the first reason found for it wins). */
export function reviewFirst(view: ReceiptView): ReviewPlace[] {
  const out: ReviewPlace[] = [];
  // Paths are masked per segment, like every stored path; a long path keeps its end (the file name), so two
  // different long paths never merge into one entry.
  const place = (where: string) => {
    const w = maskPath(plainText(where));
    return w.length > 120 ? `…${w.slice(-119)}` : w;
  };
  const add = (where: string, why: string) => {
    const w = place(where);
    if (w && !out.some((p) => p.where === w)) out.push({ where: w, why });
  };
  for (const f of view.findings) {
    if (f.asked) continue;
    if (f.type.startsWith("rls") || f.type === "policy_allows_everyone_to_write") {
      add(f.file, "a database table's protection is off or open to anyone");
    } else add(f.file, "a secret key was found in this file");
  }
  const boundaryWhy = {
    protected_path: "changed a path the owner protected",
    disallowed_dependency: "added a package the owner disallowed",
    not_allowed_dependency: "added a package that is not on the owner's allowed list",
  } as const;
  for (const h of view.boundaryHits ?? []) add(h.subject, boundaryWhy[h.kind]);
  for (const c of view.testChecks) {
    if (!c.asked) add(c.file, `tests changed here: ${short(c.label).toLowerCase()} (${c.count})`);
  }
  if (view.checkRun.status === "failed" || view.checkRun.status === "timed_out") {
    add(
      "the project's check command",
      view.checkRun.status === "failed"
        ? "it failed after this session"
        : "it did not finish in time",
    );
  }
  const labels: Partial<Record<string, string>> = {
    missed: "is marked missed",
    not_done: "is not done",
    partial: "is only partly done",
    done_untested: "is done, but no test proves it",
  };
  for (const status of ["missed", "not_done", "partial", "done_untested"]) {
    for (const item of view.items) {
      if (item.status !== status || item.closedByOwner) continue;
      const place = item.evidence[0];
      if (place) add(place, `"${short(item.text)}" ${labels[status]}`);
    }
  }
  for (const path of view.outsideScope) {
    if (!view.outsideScopeAsked.includes(path)) add(path, "changed outside the request's feature");
  }
  return out.slice(0, MAX_REVIEW_PLACES);
}
