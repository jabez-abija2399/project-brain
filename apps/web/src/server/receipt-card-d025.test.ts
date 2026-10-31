import { ReceiptCard } from "@/components/receipt-card";
import { NO_SNAPSHOT_NOTE, receiptView } from "@brain/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// D-025 on the receipt card: questions are their own state, files already modified before the session are marked,
// and a missing start snapshot is said.
const card = (summary: unknown) =>
  renderToStaticMarkup(
    createElement(ReceiptCard, {
      receipt: {
        id: "rc-1",
        createdAt: "2026-10-31T12:00:00.000Z",
        asked: "Add a comment at the top of the main page",
        commitSha: null,
        view: receiptView(summary),
        fixPrompt: null,
      },
      expanded: true,
    }),
  );

describe("receipt card (D-025)", () => {
  it("a clarifying question shows as Question, counted apart and never as missed", () => {
    const html = card({
      items: [
        {
          id: "a",
          text: "Add the comment",
          status: "done_untested",
          evidence: ["src/app/page.tsx"],
        },
        { id: "q", text: "What should the comment say?", status: "question", evidence: [] },
      ],
    });
    expect(html).toContain(
      'data-status="question"><span aria-hidden="true">?</span><span>Question</span>',
    );
    expect(html).toContain("<span>1 question</span>");
    expect(html).toContain("<span>0 missed</span>");
  });

  it("marks files already modified before the session and shows the no-snapshot notice", () => {
    const html = card({
      items: [],
      files_by_feature: [
        { feature: "home", files: ["src/app/page.tsx", "src/lib/offline/sync.ts"] },
      ],
      files_already_modified: ["src/lib/offline/sync.ts"],
      no_snapshot: true,
    });
    expect(html).toContain(
      '<code class="wrap">src/lib/offline/sync.ts</code> <span class="muted">(already modified before the session)</span>',
    );
    expect(html).not.toContain('page.tsx</code> <span class="muted">(already modified');
    expect(html).toContain(NO_SNAPSHOT_NOTE.replace(/'/g, "&#x27;"));
  });

  it("owner decision 2026-10-31: secrets already in the working tree get their own section, outside the findings count", () => {
    const html = card({
      items: [],
      findings: [],
      findings_before_session: [
        {
          type: "stripe_secret_key",
          file: "db_dump.json",
          line: 1,
          hint: "Move it to an env var",
          masked_value: "sk_l***",
        },
      ],
    });
    expect(html).toContain(">Already in your working tree before this session</h3>");
    const section = html.slice(
      html.indexOf(">Already in your working tree before this session</h3>"),
    );
    expect(section).toContain("db_dump.json");
    expect(html).not.toContain("findings</span>");
  });
});
