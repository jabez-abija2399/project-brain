import { describe, expect, it } from "vitest";
import { contradictions, subjectKey } from "./contradictions";
import { type Ears, parseEars } from "./ears";

const e = (text: string): Ears => {
  const parsed = parseEars(text);
  if (!parsed) throw new Error(`not EARS: ${text}`);
  return parsed;
};

describe("contradictions", () => {
  it("BP-3A-11 SHALL vs SHALL NOT on the same subject is flagged; other subjects are not", () => {
    expect(subjectKey(e("THE SYSTEM SHALL store the card numbers."))).toBe(
      subjectKey(e("THE SYSTEM SHALL NOT store card numbers")),
    );
    const found = contradictions([
      { id: "c1", ears: e("THE SYSTEM SHALL store the card numbers.") },
      { id: "c2", ears: e("THE SYSTEM SHALL NOT store card numbers") },
      { id: "c3", ears: e("THE SYSTEM SHALL NOT store passwords") },
      { id: "c4", ears: e("WHEN a refund is made, THE SYSTEM SHALL email the user") },
      { id: "c5", ears: e("WHEN an order ships, THE SYSTEM SHALL NOT email the user") },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ a: "c1", b: "c2", code: "shall_vs_shall_not" });
    expect(found[0]?.rewrite).toBeTruthy();
    expect(found[0]?.message).toMatch(/\.$/);

    const sameTrigger = contradictions([
      { id: "x", ears: e("WHEN an order ships, THE SYSTEM SHALL email the user") },
      { id: "y", ears: e("when an order ships the system shall not email the user") },
    ]);
    expect(sameTrigger).toHaveLength(1);
  });
});
