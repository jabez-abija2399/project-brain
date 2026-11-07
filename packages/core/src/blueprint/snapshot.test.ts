import { describe, expect, it } from "vitest";
import { parseEars } from "./ears";
import {
  BLUEPRINT_SNAPSHOT_VERSION,
  type BlueprintSnapshot,
  buildSnapshot,
  diffSnapshots,
  parseSnapshot,
  snapshotHash,
} from "./snapshot";

type Input = Parameters<typeof buildSnapshot>[0];

const crit = (id: string, text: string) => ({
  id,
  text,
  ears: parseEars(text),
  kind: "behaviour" as const,
  tests: [
    { fileId: "f2", testName: "b" },
    { fileId: "f1", testName: null },
  ],
});

const input = (): Input => ({
  features: [
    {
      id: "F2",
      name: "Payments",
      purpose: "Take money",
      buildOrder: 2,
      dependsOn: ["F1", "F0"],
      areas: ["src/pay", "src/api"],
      criteria: [
        crit("c2", "THE SYSTEM SHALL send a receipt"),
        crit("c1", "THE SYSTEM SHALL charge"),
      ],
    },
    {
      id: "F1",
      name: "Login",
      purpose: null,
      buildOrder: 1,
      dependsOn: [],
      areas: [],
      criteria: [],
    },
    {
      id: "F3",
      name: "Admin",
      purpose: null,
      buildOrder: null,
      dependsOn: [],
      areas: [],
      criteria: [],
    },
  ],
  boundaries: [
    { id: "b2", kind: "protected_path", pattern: "supabase/**", note: null },
    { id: "b1", kind: "disallowed_dependency", pattern: "left-pad", note: "no" },
  ],
  directives: [
    { id: "d2", text: "Use pnpm" },
    { id: "d1", text: "Plain English" },
  ],
  decisions: ["D-002", "D-001"],
});

describe("blueprint snapshots", () => {
  it("BP-3A-14 deterministic order, stable hash, strict parse with caps", () => {
    const a = buildSnapshot(input());
    expect(a.schema).toBe(BLUEPRINT_SNAPSHOT_VERSION);
    expect(a.features.map((f) => f.id)).toEqual(["F1", "F2", "F3"]);
    const pay = a.features[1];
    expect(pay?.criteria.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(pay?.dependsOn).toEqual(["F0", "F1"]);
    expect(pay?.areas).toEqual(["src/api", "src/pay"]);
    expect(pay?.criteria[0]?.tests.map((t) => t.fileId)).toEqual(["f1", "f2"]);
    expect(a.boundaries.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(a.directives.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(a.decisions).toEqual(["D-001", "D-002"]);

    // Same content in another order -> the same snapshot and hash.
    const shuffled = input();
    shuffled.features.reverse();
    shuffled.boundaries.reverse();
    shuffled.decisions.reverse();
    const b = buildSnapshot(shuffled);
    expect(b).toEqual(a);
    expect(snapshotHash(b)).toBe(snapshotHash(a));
    expect(snapshotHash(a)).toMatch(/^[0-9a-f]{64}$/);

    // Round-trips through JSON.
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(a)));
    expect(snapshotHash(parsed)).toBe(snapshotHash(a));

    // Unknown keys are rejected at every level.
    expect(() => parseSnapshot({ ...a, extra: 1 })).toThrow();
    const withExtraFeatureKey = JSON.parse(JSON.stringify(a));
    withExtraFeatureKey.features[0].admin = true;
    expect(() => parseSnapshot(withExtraFeatureKey)).toThrow();
    expect(() => parseSnapshot({ ...a, schema: 2 })).toThrow();

    // Caps.
    const tooMany = { ...a, features: Array.from({ length: 501 }, () => a.features[0]) };
    expect(() => parseSnapshot(tooMany)).toThrow();
    const longText = JSON.parse(JSON.stringify(a)) as BlueprintSnapshot;
    const first = longText.features[1]?.criteria[0];
    if (first) first.text = "x".repeat(301);
    expect(() => parseSnapshot(longText)).toThrow();
    const longPattern = JSON.parse(JSON.stringify(a)) as BlueprintSnapshot;
    const boundary = longPattern.boundaries[0];
    if (boundary) boundary.pattern = "p".repeat(201);
    expect(() => parseSnapshot(longPattern)).toThrow();
  });

  it("BP-3A-14 diffSnapshots lists added, removed and changed features and criteria", () => {
    const a = buildSnapshot(input());
    const next = input();
    next.features = next.features.filter((f) => f.id !== "F3");
    next.features.push({
      id: "F4",
      name: "Search",
      purpose: null,
      buildOrder: 4,
      dependsOn: [],
      areas: [],
      criteria: [],
    });
    const pay = next.features.find((f) => f.id === "F2");
    if (pay) {
      pay.criteria = [
        crit("c1", "THE SYSTEM SHALL charge the card"),
        crit("c3", "THE SYSTEM SHALL NOT store card numbers"),
      ];
    }
    const d = diffSnapshots(a, buildSnapshot(next));
    expect(d.addedFeatures).toEqual(["Search"]);
    expect(d.removedFeatures).toEqual(["Admin"]);
    expect(d.changedFeatures).toEqual(["Payments"]);
    expect(d.addedCriteria).toEqual(["c3"]);
    expect(d.removedCriteria).toEqual(["c2"]);
    expect(d.changedCriteria).toEqual(["c1"]);
    expect(diffSnapshots(a, a)).toEqual({
      addedFeatures: [],
      removedFeatures: [],
      changedFeatures: [],
      addedCriteria: [],
      removedCriteria: [],
      changedCriteria: [],
    });
  });
});
