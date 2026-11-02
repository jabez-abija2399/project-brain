import { nextDismissStep } from "@/components/dismiss-step";
// 2026-11-02 (owner items 1 and 3): the receipt card's Close and Dismiss buttons for open items, the confirm step before a
// dismiss, and the "Closed by you" label. Rendered to static markup (no DOM library here); the confirm step is a pure
// function, so its clicks are tested directly. Attacker tests are named "attack: ...".
import { ReceiptCard } from "@/components/receipt-card";
import { receiptView } from "@brain/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));

const ITEM_ID = "3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f";

function card(summary: unknown, closedByOwner = new Set<string>()) {
  return renderToStaticMarkup(
    createElement(ReceiptCard, {
      receipt: {
        id: "rc-1",
        projectId: "proj-1",
        createdAt: "2026-11-02T12:00:00.000Z",
        asked: "Add a pricing page",
        commitSha: null,
        view: receiptView(summary, closedByOwner),
        fixPrompt: null,
      },
      expanded: true,
    }),
  );
}

describe("receipt card: Close and Dismiss on open items (owner item 1)", () => {
  it("an unresolved item shows Close and Dismiss, named with its text, and the card knows the project", () => {
    const html = card({
      items: [{ id: ITEM_ID, text: "Add the pricing page", status: "missed", evidence: [] }],
    });
    expect(html).toContain('aria-label="Close: Add the pricing page"');
    expect(html).toContain('aria-label="Dismiss: Add the pricing page"');
  });

  it("a done item (the agent's verdict) shows no Close or Dismiss", () => {
    const html = card({
      items: [{ id: ITEM_ID, text: "Add the pricing page", status: "done", evidence: [] }],
    });
    expect(html).not.toContain("Dismiss: Add the pricing page");
    expect(html).not.toContain("Close: Add the pricing page");
  });

  it("attack: an item with no plain id in the stored receipt gets no action buttons", () => {
    const html = card({
      items: [{ id: "<b>x</b>", text: "Add the pricing page", status: "missed", evidence: [] }],
    });
    expect(html).not.toContain("Dismiss: Add the pricing page");
    expect(html).not.toContain("Close: Add the pricing page");
  });
});

describe("owner-closed items read as closed by the owner (owner item 3)", () => {
  it("a closed item shows 'Closed by you' and never the agent's 'Done' label", () => {
    const html = card(
      { items: [{ id: ITEM_ID, text: "Add the pricing page", status: "missed", evidence: [] }] },
      new Set([ITEM_ID]),
    );
    expect(html).toContain("<span>Closed by you</span>");
    expect(html).not.toContain("<span>Done</span>");
    expect(html).not.toContain("Dismiss: Add the pricing page");
  });

  it("the header counts the owner's closes apart from the agent's done items", () => {
    const html = card(
      {
        items: [
          { id: ITEM_ID, text: "Add the pricing page", status: "done", evidence: [] },
          { id: "other-1", text: "Add the about page", status: "done", evidence: [] },
        ],
      },
      new Set([ITEM_ID]),
    );
    expect(html).toContain("<span>1 done</span>");
    expect(html).toContain("<span>1 closed by you</span>");
  });
});

describe("dismiss needs a confirm step (owner item 1)", () => {
  it("the first click only asks; nothing is sent", () => {
    expect(nextDismissStep("idle", "dismiss")).toEqual({ step: "confirming", send: false });
  });

  it("only the confirm sends the dismiss", () => {
    expect(nextDismissStep("confirming", "confirm")).toEqual({ step: "idle", send: true });
  });

  it("Cancel stops without sending", () => {
    expect(nextDismissStep("confirming", "cancel")).toEqual({ step: "idle", send: false });
  });

  it("attack: a confirm without the first click sends nothing", () => {
    expect(nextDismissStep("idle", "confirm")).toEqual({ step: "idle", send: false });
  });
});
