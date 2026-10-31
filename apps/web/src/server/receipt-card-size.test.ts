import { ReceiptCard } from "@/components/receipt-card";
import { fixPrompt, receiptView } from "@brain/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Edutech: a click on the receipts page blocked the UI for 416 ms (INP). Measured in Chromium (4x CPU slowdown): 50
// receipts put 54,000 nodes on the page, because every closed card carried its whole body, and a click on a summary
// took 192 ms of style and layout. A closed card renders only its summary line; its body is rendered when opened.
const files = Array.from({ length: 200 }, (_, i) => `src/features/f${i % 10}/Widget${i}.tsx`);
const summary = {
  items: Array.from({ length: 10 }, (_, i) => ({
    id: `i${i}`,
    text: `Item ${i}`,
    status: "missed",
    evidence: files.slice(0, 5),
  })),
  files_by_feature: [{ feature: "widgets", files }],
  outside_scope: files.slice(0, 100),
  findings: [],
};
const card = (expanded: boolean) => {
  const view = receiptView(summary);
  return renderToStaticMarkup(
    createElement(ReceiptCard, {
      receipt: {
        id: "r1",
        createdAt: "2026-10-31T12:00:00.000Z",
        asked: "Add widgets",
        commitSha: null,
        view,
        fixPrompt: fixPrompt("Add widgets", view),
      },
      expanded,
    }),
  );
};

describe("receipt card size (INP)", () => {
  it("a closed card renders its summary line only, not its files, items or fix prompt", () => {
    const closed = card(false);
    expect(closed).toContain("10 missed");
    expect(closed).not.toContain("Widget199.tsx");
    expect(closed).not.toContain("Send fix to agent");
    expect(closed.length).toBeLessThan(3_000);
  });

  it("an open card renders its body", () => {
    const open = card(true);
    expect(open).toContain("Widget199.tsx");
    expect(open).toContain("Send fix to agent");
  });
});
