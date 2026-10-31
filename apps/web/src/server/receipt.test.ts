import type { CompleteRequest, Llm } from "@brain/core";
import {
  checklistItemsRepo,
  featureFilesRepo,
  featuresRepo,
  filesRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { whereDidWeStop } from "./session-tools";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let projectId: string;
let token: { id: string; projectId: string };
let reviewsId: string;
let requestId: string;
let itemIds: string[];
let calls: CompleteRequest[];

function scripted(answer: string) {
  calls = [];
  const llm: Llm = {
    async complete(req) {
      calls.push(req);
      return answer;
    },
  };
  setLlmForTests(llm);
}

async function addFile(featureId: string, path: string) {
  const file = await filesRepo.insert(world.db, projectId, { path, hash: "a".repeat(64) });
  await featureFilesRepo.link(world.db, projectId, { featureId, fileId: file.id });
}

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
  reviewsId = (await featuresRepo.insert(world.db, projectId, { name: "Reviews", key: "reviews" }))
    .id;
  const billingId = (
    await featuresRepo.insert(world.db, projectId, { name: "Billing", key: "billing" })
  ).id;
  await addFile(reviewsId, "src/reviews/List.tsx");
  await addFile(reviewsId, "src/reviews/List.test.tsx");
  await addFile(billingId, "src/billing/Invoice.tsx");
  const created = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: reviewsId, text: "Add reviews with a list and stars" },
    [
      { text: "Show the reviews list", needsClarification: false },
      { text: "Add a star rating", needsClarification: false },
    ],
  );
  requestId = created.request.id;
  itemIds = created.items.map((i) => i.id);
  scripted("");
});

afterEach(async () => {
  setLlmForTests(undefined);
  vi.unstubAllEnvs();
  await world.teardown();
});

const status = async (id: string) =>
  (await checklistItemsRepo.byId(world.db, projectId, id))?.status;

// D-025: what the CLI sends with each changed file; with a summary for every file, "missed" is evidence.
const summaries = (paths: string[]) =>
  paths.map((path) => ({
    path,
    added: 2,
    removed: 0,
    comment_only: false,
    imports_changed: false,
    symbols_added: [],
    symbols_removed: [],
    symbols_changed: [],
    where: ["new file"],
  }));

describe("generate_receipt (FEAT-013)", () => {
  it("AC-013-01 returns done/partial/missed per item with file evidence, from one LLM call, and stores the receipt", async () => {
    scripted("1 | done | src/reviews/List.tsx, src/reviews/List.test.tsx\n2 | missed |");
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["src/reviews/List.tsx", "src/reviews/List.test.tsx"],
      changeSummaries: summaries(["src/reviews/List.tsx", "src/reviews/List.test.tsx"]),
    });
    expect(calls).toHaveLength(1);
    expect(receipt.items).toEqual([
      {
        id: itemIds[0],
        text: "Show the reviews list",
        status: "done",
        evidence: ["src/reviews/List.tsx", "src/reviews/List.test.tsx"],
      },
      { id: itemIds[1], text: "Add a star rating", status: "missed", evidence: [] },
    ]);
    expect(await status(itemIds[0] as string)).toBe("done");
    expect(await status(itemIds[1] as string)).toBe("missed");
    const [stored] = await receiptsRepo.list(world.db, projectId);
    expect(stored).toMatchObject({ id: receipt.receipt_id, requestId });
  });

  it("AC-013-02 groups changed files by feature and lists files outside the request's feature under outside_scope", async () => {
    scripted("1 | partial | src/reviews/List.tsx");
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [
        "src/reviews/List.tsx",
        "src/features/reviews/Stars.tsx",
        "src/billing/Invoice.tsx",
        "README.md",
      ],
    });
    expect(receipt.files_by_feature).toEqual([
      { feature: "Reviews", files: ["src/reviews/List.tsx", "src/features/reviews/Stars.tsx"] },
      { feature: "Billing", files: ["src/billing/Invoice.tsx"] },
      { feature: "(no feature)", files: ["README.md"] },
    ]);
    // Stars.tsx is not indexed yet: the FEAT-006 path rule (src/features/<name>/) places it in Reviews, so it is in
    // scope; README.md has no feature and is listed outside.
    expect(receipt.outside_scope).toEqual(["src/billing/Invoice.tsx", "README.md"]);
  });

  it("AC-013-03 a reviews request whose change touches the billing feature lists the billing file under outside_scope", async () => {
    scripted("1 | done | src/reviews/List.tsx");
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["src/reviews/List.tsx", "src/billing/Invoice.tsx"],
    });
    expect(receipt.outside_scope).toEqual(["src/billing/Invoice.tsx"]);
  });

  it("AC-013-04 missed items stay open on the feature until done or dismissed; a later receipt closes them", async () => {
    scripted("1 | missed |\n2 | missed |");
    await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["src/reviews/List.tsx"],
      changeSummaries: summaries(["src/reviews/List.tsx"]),
    });
    expect(await status(itemIds[0] as string)).toBe("missed");
    // Still listed as unfinished work in the handoff note.
    const note = await whereDidWeStop(world.db, token, { projectId });
    expect(note).toContain("- Show the reviews list");

    scripted("1 | done | src/reviews/List.tsx, src/reviews/List.test.tsx\n2 | missed |");
    await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["src/reviews/List.tsx", "src/reviews/List.test.tsx"],
      changeSummaries: summaries(["src/reviews/List.tsx", "src/reviews/List.test.tsx"]),
    });
    expect(await status(itemIds[0] as string)).toBe("done");
    // A done item is not judged again: the third receipt only asks about item 2.
    scripted("1 | missed |");
    await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["src/reviews/List.tsx"],
      changeSummaries: summaries(["src/reviews/List.tsx"]),
    });
    expect(calls[0]?.prompt).not.toContain("Show the reviews list");
    expect(await status(itemIds[0] as string)).toBe("done");
  });

  it("AC-013-05 a receipt with 0 changed files reports every item missed and makes no LLM call", async () => {
    vi.stubEnv("AI_CALLS_PER_PROJECT_PER_DAY", "0");
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [],
    });
    expect(calls).toHaveLength(0);
    expect(receipt.llm_calls).toBe(0);
    expect(receipt.items.map((i) => i.status)).toEqual(["missed", "missed"]);
  });

  it("AC-013-06 20 changed files and 10 items give a receipt in under 15 s with at most 1 LLM call", async () => {
    const big = await requestsRepo.createWithItems(
      world.db,
      projectId,
      { featureId: reviewsId, text: "big change" },
      Array.from({ length: 10 }, (_, i) => ({ text: `Item ${i}`, needsClarification: false })),
    );
    const changed = Array.from({ length: 20 }, (_, i) => `src/reviews/Part${i}.tsx`);
    scripted(
      Array.from({ length: 10 }, (_, i) => `${i + 1} | partial | src/reviews/Part${i}.tsx`).join(
        "\n",
      ),
    );
    const started = performance.now();
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId: big.request.id,
      changedFiles: changed,
    });
    const ms = performance.now() - started;
    console.log("[perf]", "receipt 20 files 10 items", `${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(15_000);
    expect(calls.length).toBeLessThanOrEqual(1);
    expect(receipt.items).toHaveLength(10);
  });

  it("AC-013-07 every receipt has a not_verified section; items without a test or evidence are listed there, not done", async () => {
    scripted("1 | done | src/reviews/List.tsx\n2 | done |");
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["src/reviews/List.tsx"],
    });
    expect(receipt.not_verified).toEqual([
      { id: itemIds[0], text: "Show the reviews list", reason: "no test changed" },
      { id: itemIds[1], text: "Add a star rating", reason: "no file evidence" },
    ]);
    // Owner, 2026-10-30: done without a changed test is its own state ("Done, no test proves it"); still listed in
    // not_verified with its reason and never called plain done.
    expect(receipt.items.map((i) => i.status)).toEqual(["done_untested", "not_verified"]);
    // Not called done: both items keep their open status.
    expect(await status(itemIds[0] as string)).toBe("open");
    expect(await status(itemIds[1] as string)).toBe("open");
    const empty = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [],
    });
    expect(empty.not_verified).toEqual([]);
  });

  it("AC-013-01 attack: a request of another project or a path outside the repo is refused", async () => {
    const other = await world.createUser({ name: "other" });
    const otherProject = (await projectsRepo.create(world.db, other.id, { name: "other" })).id;
    const otherReq = await requestsRepo.createWithItems(
      world.db,
      otherProject,
      { featureId: null as unknown as string, text: "x" },
      [{ text: "secret item", needsClarification: false }],
    );
    const err = await generateReceipt(world.db, token, {
      projectId,
      requestId: otherReq.request.id,
      changedFiles: [],
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(404);
    const traversal = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: ["../etc/passwd"],
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((traversal as AppError).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("Codeceipt's own setup files sent by a client never count as changed files or outside scope", async () => {
    scripted("1 | done | src/reviews/List.tsx, src/reviews/List.test.tsx\n2 | missed |");
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [
        "src/reviews/List.tsx",
        "src/reviews/List.test.tsx",
        ".mcp.json",
        ".claude/settings.json",
        ".claude/skills/codeceipt/SKILL.md",
        ".agents/hooks.json",
      ],
    });
    expect(receipt.files_by_feature.flatMap((g) => g.files).sort()).toEqual([
      "src/reviews/List.test.tsx",
      "src/reviews/List.tsx",
    ]);
    expect(receipt.outside_scope).toEqual([]);
    expect(calls[0]?.prompt).not.toContain(".mcp.json");
  });
});
