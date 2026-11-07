import { describe, expect, it } from "vitest";
import { checkBlueprint, mustNeverCoverage } from "./coverage";

describe("coverage", () => {
  it("BP-3A-12 features without an active must-never or security criterion get a warning", () => {
    const warnings = mustNeverCoverage([
      { id: "F1", criteria: [{ kind: "behaviour", status: "active" }] },
      { id: "F2", criteria: [{ kind: "must_never", status: "active" }] },
      { id: "F3", criteria: [{ kind: "security", status: "removed" }] },
      { id: "F4", criteria: [{ kind: "security", status: "open" }] },
    ]);
    expect(warnings.map((w) => w.featureId)).toEqual(["F1", "F3"]);
    expect(warnings[0]?.message).toMatch(/\.$/);

    const result = checkBlueprint({
      features: [
        {
          id: "F1",
          criteria: [
            {
              id: "a",
              text: "THE SYSTEM SHALL store card numbers",
              kind: "behaviour",
              status: "active",
            },
            {
              id: "b",
              text: "THE SYSTEM SHALL NOT store card numbers",
              kind: "must_never",
              status: "active",
            },
            { id: "c", text: "The app should be fast", kind: "behaviour", status: "active" },
          ],
        },
        {
          id: "F2",
          criteria: [
            { id: "d", text: "THE SYSTEM SHALL log in users", kind: "behaviour", status: "active" },
          ],
        },
      ],
    });
    const f1 = result.find((r) => r.featureId === "F1");
    expect(f1?.contradictions).toHaveLength(1);
    expect(f1?.coverage).toBeNull();
    expect(f1?.criteria.find((c) => c.id === "c")?.flags.length).toBeGreaterThan(0);
    expect(f1?.criteria.find((c) => c.id === "a")?.flags).toEqual([]);
    expect(result.find((r) => r.featureId === "F2")?.coverage?.message).toBeTruthy();
  });
});
