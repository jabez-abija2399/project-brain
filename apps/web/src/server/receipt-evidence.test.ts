import type { CompleteRequest, Llm } from "@brain/core";
import {
  checklistItemsRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiptsFeed } from "./dashboard";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

// D-025 on the server: change summaries reach the judge, "missed" needs evidence, files already modified before the
// session are marked, a missing start snapshot is noted, and clarifying questions are never tasks.
let world: TestWorld;
let projectId: string;
let owner: Awaited<ReturnType<TestWorld["createUser"]>>;
let token: { id: string; projectId: string };
let calls: CompleteRequest[];
let answer: string;

const comment = {
  path: "src/app/page.tsx",
  added: 1,
  removed: 0,
  comment_only: true,
  imports_changed: false,
  symbols_added: [],
  symbols_removed: [],
  symbols_changed: [],
  where: ["top of file"],
};

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
  calls = [];
  answer = "1 | missed |";
  const llm: Llm = {
    async complete(req) {
      calls.push(req);
      return answer;
    },
  };
  setLlmForTests(llm);
});
afterEach(async () => {
  setLlmForTests(undefined);
  await world.teardown();
});

async function edutechRequest(question = false) {
  const home = await featuresRepo.insert(world.db, projectId, { name: "home", key: "@home" });
  return requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: home.id, text: "Add a comment at the top of the main page" },
    [
      { text: "Add a comment at the top of src/app/page.tsx", needsClarification: false },
      ...(question ? [{ text: "What should the comment say?", needsClarification: true }] : []),
    ],
  );
}

describe("D-025 receipts on the server", () => {
  it("the edutech case: the judge sees the change summary, and a missed verdict on paths alone is not verified", async () => {
    const { request, items } = await edutechRequest();
    // An older CLI sends paths only: the judge cannot tell, so the item is never missed.
    const oldCli = await generateReceipt(world.db, token, {
      requestId: request.id,
      changedFiles: ["src/app/page.tsx"],
    });
    expect(oldCli.items[0]?.status).toBe("not_verified");
    expect((await checklistItemsRepo.byId(world.db, projectId, items[0]?.id ?? ""))?.status).toBe(
      "open",
    );
    answer = "1 | done | src/app/page.tsx";
    const now = await generateReceipt(world.db, token, {
      requestId: request.id,
      changedFiles: ["src/app/page.tsx"],
      changeSummaries: [comment],
    });
    expect(calls[1]?.prompt).toContain(
      "src/app/page.tsx (in the request's feature): +1 -0, comment only, top of file",
    );
    expect(now.items[0]?.status).toBe("done_untested");
  });

  it("files already modified before the session are marked, and a missing snapshot is noted, in the receipt and the dashboard", async () => {
    await generateReceipt(world.db, token, {
      changedFiles: ["src/app/page.tsx", "src/lib/offline/sync.ts"],
      preExistingFiles: ["src/lib/offline/sync.ts"],
      snapshot: "missing",
    });
    const [stored] = await receiptsRepo.list(world.db, projectId, 5);
    expect(stored?.summaryJson).toMatchObject({
      files_already_modified: ["src/lib/offline/sync.ts"],
      no_snapshot: true,
    });
    const [card] = (await receiptsFeed(world.db, owner, projectId, 1)).rows;
    expect(card?.view.alreadyModified).toEqual(["src/lib/offline/sync.ts"]);
    expect(card?.view.noSnapshot).toBe(true);
  });

  it("a clarifying question is shown as a question: never judged, never missed, never in Send fix to agent", async () => {
    const { request, items } = await edutechRequest(true);
    answer = "1 | missed |\n2 | missed |";
    const receipt = await generateReceipt(world.db, token, {
      requestId: request.id,
      changedFiles: ["src/app/page.tsx"],
      changeSummaries: [comment],
    });
    expect(calls[0]?.prompt).not.toContain("What should the comment say?");
    expect(receipt.items.map((i) => i.status)).toEqual(["missed", "question"]);
    expect((await checklistItemsRepo.byId(world.db, projectId, items[1]?.id ?? ""))?.status).toBe(
      "open",
    );
    const [card] = (await receiptsFeed(world.db, owner, projectId, 1)).rows;
    expect(card?.view.items.map((i) => i.status)).toEqual(["missed", "question"]);
    expect(card?.fixPrompt).toContain("Add a comment at the top of src/app/page.tsx");
    expect(card?.fixPrompt).not.toContain("What should the comment say?");
  });

  it("attack: summaries that carry text, unknown places, odd names or files not in the change are refused", async () => {
    const bad = [
      { ...comment, symbols_added: ["return <main>secret</main>;"] },
      { ...comment, where: ["export default function Home() {"] },
      { ...comment, added: -1 },
      { ...comment, source: "const x = 1;" },
      { ...comment, symbols_changed: Array.from({ length: 21 }, (_, i) => `s${i}`) },
    ];
    for (const s of bad) {
      await expect(
        generateReceipt(world.db, token, {
          changedFiles: ["src/app/page.tsx"],
          changeSummaries: [s],
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      generateReceipt(world.db, token, {
        changedFiles: ["src/app/page.tsx"],
        changeSummaries: [{ ...comment, path: "src/other.ts" }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      generateReceipt(world.db, token, {
        changedFiles: ["src/app/page.tsx"],
        preExistingFiles: ["src/other.ts"],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      generateReceipt(world.db, token, { changedFiles: ["src/app/page.tsx"], snapshot: "used" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("security pass: a binary or large file's kind-only summary is accepted, and pre-existing files are labelled for the judge", async () => {
    const { request } = await edutechRequest();
    answer = "1 | missed |";
    const receipt = await generateReceipt(world.db, token, {
      requestId: request.id,
      changedFiles: ["src/app/page.tsx", "public/logo.png"],
      changeSummaries: [
        comment,
        {
          ...comment,
          path: "public/logo.png",
          added: 0,
          comment_only: false,
          where: ["binary file"],
        },
      ],
      preExistingFiles: ["src/app/page.tsx"],
    });
    expect(calls[0]?.prompt).toContain(
      "src/app/page.tsx (in the request's feature, already modified before the session",
    );
    // Every file had a summary, so the judge's missed stands.
    expect(receipt.items[0]?.status).toBe("missed");
    await expect(
      generateReceipt(world.db, token, {
        changedFiles: ["a.bin"],
        changeSummaries: [{ ...comment, path: "a.bin", where: ["huge file"] }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
