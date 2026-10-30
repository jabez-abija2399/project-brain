import { ReceiptCard } from "@/components/receipt-card";
import { receiptView } from "@brain/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// First-receipt fix 2: "Done", "Done, no test proves it" and "Not verified" are three states, each with an icon
// and a label.
const card = (summary: unknown) =>
  renderToStaticMarkup(
    createElement(ReceiptCard, {
      receipt: {
        id: "rc-1",
        createdAt: "2026-10-30T12:00:00.000Z",
        asked: "Add reviews",
        commitSha: null,
        view: receiptView(summary),
        fixPrompt: null,
      },
      expanded: true,
    }),
  );
const badges = (html: string) =>
  [
    ...html.matchAll(
      /data-status="(\w+)"><span aria-hidden="true">([^<]+)<\/span><span>([^<]+)<\/span>/g,
    ),
  ].map((m) => `${m[1]}|${m[2]}|${m[3]}`);

describe("receipt states", () => {
  it("each item shows its own icon and label, and the summary counts done, done without a test and not verified apart", () => {
    const html = card({
      items: [
        { id: "a", text: "List", status: "done", evidence: ["src/List.tsx"] },
        { id: "b", text: "Stars", status: "done_untested", evidence: ["src/Stars.tsx"] },
        { id: "c", text: "Email", status: "not_verified", evidence: [] },
      ],
      not_verified: [
        { id: "b", text: "Stars", reason: "no test changed" },
        { id: "c", text: "Email", reason: "no file evidence" },
      ],
    });
    const all = badges(html);
    expect(all).toEqual(
      expect.arrayContaining([
        "done|✓|1 done",
        "done_untested|✓?|1 done, no test proves it",
        "not_verified|?|1 not verified",
        "done|✓|Done",
        "done_untested|✓?|Done, no test proves it",
        "not_verified|?|Not verified",
      ]),
    );
    // The Not verified section lists only what Codeceipt could not check.
    const section = html.slice(html.indexOf(">Not verified</h3>"));
    expect(section).toContain("Email");
    expect(section).not.toContain("Stars");
  });
});
