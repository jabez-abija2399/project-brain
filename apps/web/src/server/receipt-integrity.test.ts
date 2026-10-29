import {
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let token: { id: string; projectId: string };
let requestId: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser();
  const pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  token = { id: (await projectTokensRepo.create(world.db, pid)).row.id, projectId: pid };
  const f = await featuresRepo.insert(world.db, pid, { name: "Cart", key: "cart" });
  requestId = (
    await requestsRepo.createWithItems(world.db, pid, { featureId: f.id, text: "Fix the cart" }, [
      { text: "Totals are right", needsClarification: false },
    ])
  ).request.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await world.teardown();
});

describe("FEAT-018 test integrity in receipts", () => {
  it("AC-018-05 a receipt reports the passing-test count before and after and flags a drop", async () => {
    const receipt = await generateReceipt(world.db, token, {
      requestId,
      changedFiles: [],
      testIntegrity: {
        flags: [
          { kind: "deleted_tests", file: "src/cart.test.ts", names: ["sums the total"], count: 1 },
        ],
        passingBefore: 42,
        passingAfter: 40,
      },
    });
    expect(receipt.test_integrity).toEqual({
      flags: [
        { kind: "deleted_tests", file: "src/cart.test.ts", names: ["sums the total"], count: 1 },
        { kind: "passing_tests_dropped", file: "", names: [], count: 2 },
      ],
      passing_before: 42,
      passing_after: 40,
    });
    const [stored] = await receiptsRepo.list(world.db, token.projectId);
    expect((stored?.summaryJson as { test_integrity: unknown }).test_integrity).toEqual(
      receipt.test_integrity,
    );
    const same = await generateReceipt(world.db, token, {
      requestId,
      changedFiles: [],
      testIntegrity: { flags: [], passingBefore: 40, passingAfter: 41 },
    });
    expect(same.test_integrity?.flags).toEqual([]);
  });

  it("AC-018-02 attack: only names and counts are accepted; unknown kinds, oversized lists and source-like extras are refused, names are masked", async () => {
    const bad = [
      { flags: [{ kind: "all_good", file: "a.test.ts", names: [], count: 0 }] },
      {
        flags: [
          { kind: "deleted_tests", file: "a.test.ts", names: [], count: 1, source: "expect(x)" },
        ],
      },
      {
        flags: Array.from({ length: 51 }, () => ({
          kind: "deleted_tests",
          file: "a.test.ts",
          names: [],
          count: 1,
        })),
      },
      { flags: [{ kind: "deleted_tests", file: "../../etc/passwd", names: [], count: 1 }] },
      { flags: [], passingBefore: -1 },
    ];
    for (const testIntegrity of bad) {
      const err = await generateReceipt(world.db, token, {
        requestId,
        changedFiles: [],
        testIntegrity,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(400);
    }
    const key = ["sk", "_live_", "aB3dE5gH7j", "aB3dE5gH7j"].join("");
    const receipt = await generateReceipt(world.db, token, {
      requestId,
      changedFiles: [],
      testIntegrity: {
        flags: [
          {
            kind: "skipped_tests",
            file: "a.test.ts",
            names: [`skip: uses ${key}\n‮forged`],
            count: 1,
          },
        ],
      },
    });
    expect(JSON.stringify(receipt.test_integrity)).not.toContain(key);
    expect(receipt.test_integrity?.flags[0]?.names[0]).not.toMatch(/[\n‮]/);
  });
});
