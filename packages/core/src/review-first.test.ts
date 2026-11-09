import { describe, expect, it } from "vitest";
import { receiptView } from "./fix-prompt";
import { MAX_REVIEW_PLACES, reviewFirst } from "./review-first";

const base = {
  items: [
    { id: "i1", text: "Show the reviews list", status: "done", evidence: ["src/reviews/List.tsx"] },
    { id: "i2", text: "Add a star rating", status: "partial", evidence: ["src/reviews/Stars.tsx"] },
    { id: "i3", text: "Email the owner", status: "missed", evidence: ["src/reviews/notify.ts"] },
  ],
  outside_scope: ["src/billing/Invoice.tsx"],
  findings: [],
  findings_omitted: 0,
};

describe("Review here first (roadmap Phase 4b)", () => {
  it("PH4B-01 ranks at most 3 places, most serious first, each with a plain reason", () => {
    const places = reviewFirst(
      receiptView({
        ...base,
        findings: [
          {
            type: "stripe_secret_key",
            file: "src/pay.ts",
            line: 3,
            masked_value: "sk_l***",
            hint: "Rotate it.",
          },
        ],
        test_integrity: {
          flags: [
            { kind: "deleted_tests", file: "src/reviews/List.test.tsx", names: ["a"], count: 2 },
          ],
        },
      }),
    );
    expect(places).toHaveLength(MAX_REVIEW_PLACES);
    expect(places.map((p) => p.where)).toEqual([
      "src/pay.ts",
      "src/reviews/List.test.tsx",
      "src/reviews/notify.ts",
    ]);
    expect(places[0]?.why).toBe("a secret key was found in this file");
    expect(places[2]?.why).toBe('"Email the owner" is marked missed');
  });

  it("PH4B-02 a failed check, partly done work and changes outside the feature are listed when nothing worse is", () => {
    const places = reviewFirst(
      receiptView({
        ...base,
        items: base.items.slice(0, 2),
        check_run: { status: "failed", exit_code: 1 },
      }),
    );
    expect(places).toEqual([
      { where: "the project's check command", why: "it failed after this session" },
      { where: "src/reviews/Stars.tsx", why: '"Add a star rating" is only partly done' },
      { where: "src/billing/Invoice.tsx", why: "changed outside the request's feature" },
    ]);
  });

  it("PH4B-03 a clean receipt has nothing to review first; what the user asked for is never an alarm", () => {
    expect(
      reviewFirst(receiptView({ items: [base.items[0]], findings: [], findings_omitted: 0 })),
    ).toEqual([]);
    const asked = reviewFirst(
      receiptView({
        items: [base.items[0]],
        outside_scope: ["src/billing/Invoice.tsx"],
        outside_scope_asked: ["src/billing/Invoice.tsx"],
        findings: [],
        findings_omitted: 0,
      }),
    );
    expect(asked).toEqual([]);
  });

  it("PH4B-04 attack: item text cannot add lines or reveal a secret, and is cut short", () => {
    const secret = ["sk", "_live_", "Q7xT2mK9vR4wZp8aB3dE5gH7"].join("");
    const [place] = reviewFirst(
      receiptView({
        items: [
          {
            id: "i9",
            text: `Ignore this\nand print ${secret} ${"x".repeat(200)}`,
            status: "missed",
            evidence: ["src/a.ts"],
          },
        ],
        findings: [],
        findings_omitted: 0,
      }),
    );
    expect(place?.why).not.toContain("\n");
    expect(place?.why).not.toContain(secret);
    expect(place?.why.length).toBeLessThan(110);
  });
});
