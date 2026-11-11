import type { ReceiptView } from "./fix-prompt";
import { plainText } from "./text";

// Roadmap Phase 10b: the receipt as one comment on a pull request. Deterministic Markdown from stored receipts: the
// counts, what was missed, and a link to the full receipt. On a public repository only counts are shown (no item
// text, no file names): a public comment must not carry what the owner asked their agent for. The first line is a
// hidden marker, so the same comment is updated in place on every push instead of a new one being added.

// Security review: the marker names the project, so two projects linked to one repository each keep their own
// comment and never overwrite the other's.
export const prCommentMarker = (projectId: string) =>
  `<!-- codeceipt:pr-receipt:${/^[\w-]{1,64}$/.test(projectId) ? projectId : "unknown"} -->`;
const MAX_MISSED = 5;
const MAX_BODY = 6_000;

export type PrReceiptInput = {
  projectId: string;
  views: ReceiptView[];
  /** The receipts page of the project (the owner signs in to open it). */
  receiptsUrl: string;
  publicRepo: boolean;
};

export type PrReceiptCounts = {
  receipts: number;
  done: number;
  partial: number;
  missed: number;
  notVerified: number;
  findings: number;
  testChecks: number;
  contradicted: number;
};

export function prReceiptCounts(views: ReceiptView[]): PrReceiptCounts {
  const items = views.flatMap((v) => v.items);
  const count = (status: string) => items.filter((i) => i.status === status).length;
  return {
    receipts: views.length,
    done: count("done") + count("done_untested") + count("already_present"),
    partial: count("partial"),
    missed: count("missed"),
    notVerified: views.reduce((n, v) => n + v.notVerified.length, 0),
    findings: views.reduce((n, v) => n + v.findings.length, 0),
    testChecks: views.reduce((n, v) => n + v.testChecks.filter((c) => !c.asked).length, 0),
    contradicted: views.reduce(
      (n, v) => n + v.claims.filter((c) => c.verdict === "contradicted").length,
      0,
    ),
  };
}

/** True when nothing in these receipts needs a second look. */
export const prReceiptClean = (c: PrReceiptCounts) =>
  c.missed + c.partial + c.findings + c.testChecks + c.contradicted === 0;

const codeSpan = (text: string) =>
  `\`${plainText(text).slice(0, 200).replace(/`/g, "'").replace(/</g, "&lt;").replace(/>/g, "&gt;")}\``;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The comment's Markdown (marker first). Only https links to the project's own receipts page are written. */
export function prReceiptComment(input: PrReceiptInput): string {
  const c = prReceiptCounts(input.views);
  const lines = [prCommentMarker(input.projectId), "### Codeceipt receipt"];
  lines.push(
    c.receipts === 0
      ? "No receipt was recorded for the commits of this pull request."
      : `${plural(c.receipts, "receipt", "receipts")} for the commits of this pull request: ${
          prReceiptClean(c) ? "nothing needs a second look." : "some things need a second look."
        }`,
  );
  if (c.receipts > 0) {
    lines.push(
      "",
      "| Checklist | Count |",
      "|---|---|",
      `| Done | ${c.done} |`,
      `| Partly done | ${c.partial} |`,
      `| Missed | ${c.missed} |`,
      `| Not verified | ${c.notVerified} |`,
      "",
      `Security findings: ${c.findings}. Test checks (deleted, skipped or weakened tests): ${c.testChecks}. Claims contradicted: ${c.contradicted}.`,
    );
    if (!input.publicRepo) {
      const missed = input.views
        .flatMap((v) => v.items)
        .filter((i) => i.status === "missed")
        .slice(0, MAX_MISSED);
      if (missed.length > 0) {
        lines.push("", "Missed:");
        // Security review: item text goes in a code span, so "@name", "#123" and bare links stay plain text (no
        // notification, no link) whatever a prompt or commit message said.
        for (const m of missed) lines.push(`- ${codeSpan(m.text)}`);
        if (c.missed > missed.length) lines.push(`- and ${c.missed - missed.length} more`);
      }
    }
  }
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9/_-]*$/.test(input.receiptsUrl)) {
    lines.push(
      "",
      `[Open the receipts](${input.receiptsUrl}) (the project owner signs in to see them).`,
    );
  }
  return lines.join("\n").slice(0, MAX_BODY);
}

/** The check run's one-line summary (counts only: check runs are visible to everyone who can see the repo). */
export function prReceiptCheckSummary(c: PrReceiptCounts): string {
  return c.receipts === 0
    ? "No receipt was recorded for these commits."
    : `${plural(c.receipts, "receipt", "receipts")}: ${c.done} done, ${c.partial} partly done, ${c.missed} missed; ${plural(c.findings, "security finding", "security findings")}; ${plural(c.testChecks, "test check", "test checks")}.`;
}
