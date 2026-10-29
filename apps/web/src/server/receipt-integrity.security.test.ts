import { receiptView } from "@brain/core";
// FEAT-018 /security pass (server): forged or hostile testIntegrity input to generate_receipt. PGlite via test-helpers.
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

async function project(name: string) {
  const owner = await world.createUser();
  const pid = (await projectsRepo.create(world.db, owner.id, { name })).id;
  const tok = { id: (await projectTokensRepo.create(world.db, pid)).row.id, projectId: pid };
  const f = await featuresRepo.insert(world.db, pid, { name: "Cart", key: "cart" });
  const req = (
    await requestsRepo.createWithItems(world.db, pid, { featureId: f.id, text: "Fix the cart" }, [
      { text: "Totals are right", needsClarification: false },
    ])
  ).request.id;
  return { token: tok, requestId: req };
}

beforeEach(async () => {
  world = await createTestWorld();
  ({ token, requestId } = await project("shop"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await world.teardown();
});

const flag = (over: Record<string, unknown> = {}) => ({
  kind: "deleted_tests",
  file: "src/cart.test.ts",
  names: ["sums the total"],
  count: 1,
  ...over,
});

async function status(testIntegrity: unknown, tok = token, req = requestId) {
  const err = await generateReceipt(world.db, tok, {
    requestId: req,
    changedFiles: [],
    testIntegrity,
  }).then(
    () => null,
    (e) => e,
  );
  return err instanceof AppError ? err.status : err === null ? 200 : -1;
}

describe("FEAT-018 security: test integrity input to generate_receipt (server)", () => {
  it("AC-018-05 attack: counts out of range, floats, strings, NaN-like values and a forged passing_tests_dropped kind are refused", async () => {
    const bad: unknown[] = [
      { flags: [flag({ count: 1_000_001 })] },
      { flags: [flag({ count: 1.5 })] },
      { flags: [flag({ count: -1 })] },
      { flags: [flag({ count: "3" })] },
      { flags: [], passingBefore: 2.5 },
      { flags: [], passingAfter: 1_000_001 },
      { flags: [], passingAfter: "40" },
      { flags: [flag({ kind: "passing_tests_dropped", file: "src/a.test.ts" })] },
      { flags: [flag({ kind: "Deleted_Tests" })] },
      { flags: [flag({ names: Array.from({ length: 21 }, (_, i) => `t${i}`) })] },
      { flags: [flag({ names: ["x".repeat(501)] })] },
      { flags: [flag({ names: [42] })] },
      { flags: [flag({ file: "" })] },
      { flags: [flag({ file: "src/a\\b.test.ts" })] },
      { flags: [flag({ file: "/etc/passwd" })] },
      { flags: [flag()], extra: true },
      { flags: [flag()], passing_before: 1 },
    ];
    for (const ti of bad) expect(await status(ti), JSON.stringify(ti).slice(0, 120)).toBe(400);
    expect(await receiptsRepo.list(world.db, token.projectId)).toEqual([]);
  });

  it("AC-018-02 attack: file names with bidi, zero-width or control-like characters are cleaned in the returned and stored test_integrity", async () => {
    const rlo = "\u202e";
    const zw = "\u200b";
    const lri = "\u2066";
    const file = `src/${rlo}stt.tset${zw}${lri}.test.ts`;
    const receipt = await generateReceipt(world.db, token, {
      requestId,
      changedFiles: [],
      testIntegrity: { flags: [flag({ file, names: [`name${rlo}evil${zw}`] })] },
    });
    const unsafe = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/;
    expect(receipt.test_integrity?.flags[0]?.names[0]).not.toMatch(unsafe);
    expect(receipt.test_integrity?.flags[0]?.file).not.toMatch(unsafe);
    const [stored] = await receiptsRepo.list(world.db, token.projectId);
    expect(JSON.stringify(stored?.summaryJson)).not.toMatch(unsafe);
    // What the dashboard shows is cleaned either way.
    const view = receiptView(stored?.summaryJson);
    expect(JSON.stringify(view.testChecks)).not.toMatch(unsafe);
  });

  it("AC-018-02 attack: secrets in file names and test names are masked before they are returned or stored", async () => {
    const key = ["sk", "_live_", "aB3dE5gH7j", "kL9mN0pQ2r"].join("");
    const gh = ["ghp", "_", "Ab12Cd34Ef", "56Gh78Ij90", "Kl12"].join("");
    const receipt = await generateReceipt(world.db, token, {
      requestId,
      changedFiles: [],
      testIntegrity: {
        flags: [
          flag({ file: `src/${key}/cart.test.ts`, names: [`uses ${gh}`, `token=${key}`] }),
          flag({
            kind: "test_config_changed",
            file: "vitest.config.ts",
            names: ["exclude"],
            count: 1,
          }),
        ],
      },
    });
    const [stored] = await receiptsRepo.list(world.db, token.projectId);
    for (const text of [JSON.stringify(receipt), JSON.stringify(stored?.summaryJson)]) {
      expect(text).not.toContain(key);
      expect(text).not.toContain(gh);
    }
    expect(receipt.test_integrity?.flags[1]).toEqual({
      kind: "test_config_changed",
      file: "vitest.config.ts",
      names: ["exclude"],
      count: 1,
    });
  });

  it("AC-018-05 attack: 50 flags with 20 names of 500 characters each are accepted but stored capped (200 characters a name)", async () => {
    const flags = Array.from({ length: 50 }, (_, i) =>
      flag({
        file: `src/t${i}.test.ts`,
        names: Array.from({ length: 20 }, () => "n".repeat(500)),
        count: 1_000_000,
      }),
    );
    const receipt = await generateReceipt(world.db, token, {
      requestId,
      changedFiles: [],
      testIntegrity: { flags, passingBefore: 1_000_000, passingAfter: 0 },
    });
    expect(receipt.test_integrity?.flags).toHaveLength(51);
    for (const f of receipt.test_integrity?.flags ?? [])
      for (const n of f.names) expect(n.length).toBeLessThanOrEqual(200);
    expect(receipt.test_integrity?.flags[50]).toEqual({
      kind: "passing_tests_dropped",
      file: "",
      names: [],
      count: 1_000_000,
    });
  });

  it("AC-018-01 attack: project B's token cannot attach test-integrity flags to project A's request", async () => {
    const b = await project("other");
    expect(await status({ flags: [flag()] }, b.token, requestId)).toBe(404);
    const crossed = await generateReceipt(world.db, b.token, {
      projectId: token.projectId,
      requestId,
      changedFiles: [],
      testIntegrity: { flags: [flag()] },
    }).catch((e) => e);
    expect(crossed).toBeInstanceOf(AppError);
    expect(await receiptsRepo.list(world.db, token.projectId)).toEqual([]);
  });
});
