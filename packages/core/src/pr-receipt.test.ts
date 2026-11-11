import { describe, expect, it } from "vitest";
import { receiptView } from "./fix-prompt";
import {
  prCommentMarker,
  prReceiptCheckSummary,
  prReceiptClean,
  prReceiptComment,
  prReceiptCounts,
} from "./pr-receipt";

// Roadmap Phase 10b: the receipt as one pull-request comment.
const view = (items: { text: string; status: string }[], extra: Record<string, unknown> = {}) =>
  receiptView({ items: items.map((i, n) => ({ id: `i${n}`, ...i })), ...extra });
const PR_COMMENT_MARKER = prCommentMarker("p1");
const URL = "https://codeceipt.example/projects/p1/receipts";

describe("Phase 10b: PR receipt comment", () => {
  it("PH10B-04 a private repo's comment has the marker, the counts, the missed items and the link", () => {
    const views = [
      view([
        { text: "Add a pricing page", status: "done" },
        { text: "Show prices in euros", status: "missed" },
      ]),
    ];
    const body = prReceiptComment({ projectId: "p1", views, receiptsUrl: URL, publicRepo: false });
    expect(body.startsWith(`${PR_COMMENT_MARKER}\n### Codeceipt receipt`)).toBe(true);
    expect(body).toContain("| Done | 1 |");
    expect(body).toContain("| Missed | 1 |");
    expect(body).toContain("some things need a second look.");
    expect(body).toContain("- `Show prices in euros`");
    expect(body).toContain(`[Open the receipts](${URL})`);
  });

  it("PH10B-05 attack: a public repo's comment has counts only, never item text or file names", () => {
    const views = [
      view([{ text: "Secret roadmap item for client X", status: "missed" }], {
        findings: [{ type: "stripe_secret_key", file: "src/pay/keys.ts", line: 1, hint: "" }],
      }),
    ];
    const body = prReceiptComment({ projectId: "p1", views, receiptsUrl: URL, publicRepo: true });
    expect(body).toContain("| Missed | 1 |");
    expect(body).toContain("Security findings: 1.");
    expect(body).not.toContain("Secret roadmap");
    expect(body).not.toContain("keys.ts");
    expect(prReceiptCheckSummary(prReceiptCounts(views))).not.toContain("Secret roadmap");
  });

  it("PH10B-06 attack: item text cannot add Markdown structure, mentions that look like headings, or its own marker", () => {
    const views = [
      view([
        { text: `${PR_COMMENT_MARKER} # Approved by owner`, status: "missed" },
        { text: "[click](https://evil.example) <img src=x>", status: "missed" },
      ]),
    ];
    const body = prReceiptComment({ projectId: "p1", views, receiptsUrl: URL, publicRepo: false });
    // The only line that is the marker is the first one; the item's copy sits inside a code span.
    expect(body.split("\n").filter((l) => l === PR_COMMENT_MARKER)).toHaveLength(1);
    expect(body).not.toContain("<img");
    expect(body).toContain("- `[click](https://evil.example) &lt;img src=x&gt;`");
    // A link that is not a plain https URL is never written.
    const odd = prReceiptComment({
      projectId: "p1",
      views,
      receiptsUrl: "javascript:alert(1)",
      publicRepo: false,
    });
    expect(odd).not.toContain("javascript:");
    const broken = prReceiptComment({
      projectId: "p1",
      views,
      receiptsUrl: `${URL}) [x](https://evil.example`,
      publicRepo: false,
    });
    expect(broken).not.toContain("[Open the receipts]");
  });

  it("PH10B-07 no receipts says so; a clean set says nothing needs a second look; the body is capped", () => {
    expect(
      prReceiptComment({ projectId: "p1", views: [], receiptsUrl: URL, publicRepo: false }),
    ).toContain("No receipt was recorded");
    const clean = [view([{ text: "a", status: "done" }])];
    expect(prReceiptClean(prReceiptCounts(clean))).toBe(true);
    expect(
      prReceiptComment({ projectId: "p1", views: clean, receiptsUrl: URL, publicRepo: false }),
    ).toContain("nothing needs a second look.");
    const many = Array.from({ length: 50 }, () =>
      view(Array.from({ length: 50 }, () => ({ text: "x".repeat(300), status: "missed" }))),
    );
    expect(
      prReceiptComment({ projectId: "p1", views: many, receiptsUrl: URL, publicRepo: false })
        .length,
    ).toBeLessThanOrEqual(6000);
  });

  it("PH10B-17 attack (security review): mentions, issue numbers and links in item text stay plain; markers are per project", () => {
    const views = [
      view([
        {
          text: "Ping @acme/security about #123, see https://evil.example and `x`",
          status: "missed",
        },
      ]),
    ];
    const body = prReceiptComment({ projectId: "p1", views, receiptsUrl: URL, publicRepo: false });
    expect(body).toContain("- `Ping @acme/security about #123, see https://evil.example and 'x'`");
    expect(prCommentMarker("p1")).not.toBe(prCommentMarker("p2"));
    expect(prCommentMarker("--> <script>")).toBe("<!-- codeceipt:pr-receipt:unknown -->");
  });
});
