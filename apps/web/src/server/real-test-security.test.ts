import type { CompleteRequest, Llm } from "@brain/core";
import { projectTokensRepo, projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import { featuresRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChecklist } from "./checklist";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Security review of the real-test fixes (2026-11-01): the agent being audited holds the project token, so a receipt
// that found something can never be replaced away, and the splitter's retry costs its own unit of AI budget.
let world: TestWorld;
let projectId: string;
let token: { id: string; projectId: string };
let requestId: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
  requestId = (
    await requestsRepo.createWithItems(world.db, projectId, { featureId: null, text: "x" }, [
      { text: "Add a page", needsClarification: false },
    ])
  ).request.id;
  setLlmForTests({
    async complete() {
      return "1 | done | a.ts";
    },
  });
});
afterEach(async () => {
  setLlmForTests(undefined);
  vi.unstubAllEnvs();
  await world.teardown();
});

const flagged = {
  flags: [{ kind: "skipped_tests" as const, file: "a.test.ts", names: ["t"], count: 1 }],
};

describe("receipt replacement (Stop hook)", () => {
  it("a clean earlier receipt of the same request is replaced: one receipt per session", async () => {
    const first = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["a.ts"],
    });
    await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["a.ts"],
      replacesReceiptId: first.receipt_id,
    });
    const ids = (await receiptsRepo.list(world.db, projectId)).map((r) => r.id);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(first.receipt_id);
  });

  it("attack: a receipt that flagged skipped tests or a secret cannot be replaced away by the agent", async () => {
    const bad = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["a.ts", "a.test.ts"],
      testIntegrity: flagged,
    });
    const secret = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["a.ts"],
      secretFindings: [
        { type: "stripe_secret_key", file: "a.ts", line: 1, masked_value: "sk_l***" },
      ],
    });
    for (const old of [bad.receipt_id, secret.receipt_id]) {
      await generateReceipt(world.db, token, {
        projectId,
        requestId,
        changedFiles: ["a.ts"],
        replacesReceiptId: old,
      });
    }
    const ids = (await receiptsRepo.list(world.db, projectId)).map((r) => r.id);
    expect(ids).toContain(bad.receipt_id);
    expect(ids).toContain(secret.receipt_id);
  });

  it("attack: another project's receipt, or another request's, is never deleted", async () => {
    const owner2 = await world.createUser({ name: "eve" });
    const other = (await projectsRepo.create(world.db, owner2.id, { name: "other" })).id;
    const otherToken = (await projectTokensRepo.create(world.db, other)).row;
    const theirs = await generateReceipt(world.db, otherToken, {
      projectId: other,
      changedFiles: ["b.ts"],
    });
    const mineNoRequest = await generateReceipt(world.db, token, {
      projectId,
      changedFiles: ["a.ts"],
    });
    await generateReceipt(world.db, token, {
      projectId,
      changedFiles: ["a.ts"],
      replacesReceiptId: theirs.receipt_id,
    });
    await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["a.ts"],
      replacesReceiptId: mineNoRequest.receipt_id,
    });
    expect((await receiptsRepo.list(world.db, other)).map((r) => r.id)).toEqual([
      theirs.receipt_id,
    ]);
    expect((await receiptsRepo.list(world.db, projectId)).map((r) => r.id)).toContain(
      mineNoRequest.receipt_id,
    );
  });
});

describe("the splitter's retry and the AI budget", () => {
  it("attack: with one unit of budget left, an unreadable answer is not retried (no second AI call)", async () => {
    const calls: CompleteRequest[] = [];
    const llm: Llm = {
      async complete(req) {
        calls.push(req);
        return "Sure.";
      },
    };
    setLlmForTests(llm);
    await featuresRepo.insert(world.db, projectId, { name: "Home", key: "home" });
    vi.stubEnv("AI_CALLS_PER_PROJECT_PER_DAY", "1");
    {
      const made = await createChecklist(world.db, token, {
        projectId,
        feature: "Home",
        request: "reply with one word only",
      });
      expect(calls).toHaveLength(1);
      expect(made.items).toEqual([
        expect.objectContaining({ text: "reply with one word only", needs_clarification: false }),
      ]);
    }
  });
});
