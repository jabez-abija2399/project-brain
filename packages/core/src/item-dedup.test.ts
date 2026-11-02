import { describe, expect, it } from "vitest";
import {
  DUPLICATE_SIMILARITY,
  isNearDuplicate,
  itemKey,
  itemSimilarity,
  planOpenItemCleanup,
} from "./item-dedup";

// H1 (2026-11-02): the start note listed "Add a short comment at the top of the main page" about eight times in
// different wording. These are the same open item.
describe("H1 near-duplicate checklist items", () => {
  it("the exact example: every wording of the comment item is one key and a duplicate", () => {
    const wordings = [
      "Add a short comment at the top of the main page",
      "Add a comment at the top of the main page",
      "add a comment to the main page",
      "Please add a short comment at the top of the main page.",
    ];
    for (const w of wordings) expect(itemKey(w)).toBe("add comment main page");
    for (const w of wordings) expect(isNearDuplicate(wordings[0] as string, w)).toBe(true);
  });

  it("strips punctuation and the filler words a, the, short, please, to, at, top, of", () => {
    expect(itemKey("Please ADD the short, to-the top OF page!")).toBe("add page");
  });

  it("the threshold is a word-set similarity of at least 0.8", () => {
    expect(DUPLICATE_SIMILARITY).toBe(0.8);
    // 4 shared of 5 distinct words: 0.8, a duplicate.
    expect(
      itemSimilarity("Add a comment to the main page", "Add a comment to the main page footer"),
    ).toBe(0.8);
    // 3 shared of 5 distinct words: 0.6, not a duplicate (conservative).
    expect(isNearDuplicate("Add stars to the review page", "Add stars to the reviews page")).toBe(
      false,
    );
  });

  it("different things are not duplicates", () => {
    expect(
      isNearDuplicate("Add a pricing page", "Add a short comment at the top of the main page"),
    ).toBe(false);
    expect(isNearDuplicate("Add a login button", "Add a logout button")).toBe(false);
  });

  it("attacker: text with only filler words never matches anything", () => {
    expect(itemKey("the a of")).toBe("");
    expect(isNearDuplicate("the a of", "a the to")).toBe(false);
    expect(isNearDuplicate("", "")).toBe(false);
  });

  it("cleanup plan: an open item that a LATER done receipt shows done is closed as done", () => {
    const t0 = new Date("2026-10-01T10:00:00Z");
    const t1 = new Date("2026-10-02T10:00:00Z");
    const plan = planOpenItemCleanup([
      {
        id: "open-old",
        text: "Add a short comment at the top of the main page",
        status: "open",
        requestCreatedAt: t0,
      },
      {
        id: "done-later",
        text: "Add a comment to the main page",
        status: "done",
        requestCreatedAt: t1,
      },
    ]);
    expect(plan).toEqual([{ id: "open-old", status: "done" }]);
  });

  it("cleanup plan: a done receipt from an EARLIER request does not close a newer open item", () => {
    const plan = planOpenItemCleanup([
      {
        id: "open-new",
        text: "Add a pricing page",
        status: "open",
        requestCreatedAt: new Date("2026-10-02"),
      },
      {
        id: "done-old",
        text: "Add a pricing page",
        status: "done",
        requestCreatedAt: new Date("2026-10-01"),
      },
    ]);
    expect(plan).toEqual([]);
  });

  it("cleanup plan: a done-without-test receipt closes as done_untested, never as done", () => {
    const plan = planOpenItemCleanup([
      {
        id: "open",
        text: "Add a pricing page",
        status: "partial",
        requestCreatedAt: new Date("2026-10-01"),
      },
      {
        id: "untested",
        text: "Add a pricing page",
        status: "done_untested",
        requestCreatedAt: new Date("2026-10-02"),
      },
    ]);
    expect(plan).toEqual([{ id: "open", status: "done_untested" }]);
  });

  it("cleanup plan: of several near-duplicate open items the newest stays open, the older are dismissed", () => {
    const plan = planOpenItemCleanup([
      {
        id: "c",
        text: "Add a comment to the main page",
        status: "open",
        requestCreatedAt: new Date("2026-10-03"),
      },
      {
        id: "b",
        text: "Add a short comment at the top of the main page",
        status: "open",
        requestCreatedAt: new Date("2026-10-02"),
      },
      {
        id: "a",
        text: "Please add a comment at the top of the main page",
        status: "postponed",
        requestCreatedAt: new Date("2026-10-01"),
      },
      {
        id: "x",
        text: "Add a pricing page",
        status: "open",
        requestCreatedAt: new Date("2026-10-01"),
      },
    ]);
    expect(plan).toEqual([
      { id: "b", status: "dismissed" },
      { id: "a", status: "dismissed" },
    ]);
  });

  it("cleanup plan is idempotent: applying it leaves nothing to change", () => {
    const rows = [
      {
        id: "c",
        text: "Add a comment to the main page",
        status: "open",
        requestCreatedAt: new Date("2026-10-03"),
      },
      {
        id: "b",
        text: "Add a short comment at the top of the main page",
        status: "open",
        requestCreatedAt: new Date("2026-10-02"),
      },
      {
        id: "d",
        text: "Add a pricing page",
        status: "done",
        requestCreatedAt: new Date("2026-10-04"),
      },
    ];
    const first = planOpenItemCleanup(rows);
    const applied = rows.map((r) => {
      const change = first.find((p) => p.id === r.id);
      return change ? { ...r, status: change.status } : r;
    });
    expect(planOpenItemCleanup(applied)).toEqual([]);
  });
});
