// Real-test replay, judge side (K and L). K: the session's own findings (test checks, secrets, new dependencies) go to
// the judge as masked facts, so a request fulfilled by exactly that change is judged done. L: a file the request
// names is in scope, by its full path or by its basename when only one changed file has that name.
// Fake secrets are built at runtime from short chunks.
import type { CompleteRequest, Llm } from "@brain/core";
import {
  checklistItemsRepo,
  featureFilesRepo,
  featuresRepo,
  filesRepo,
  projectTokensRepo,
  projectsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

const PERMISSIONS = "src/lib/permissions.test.ts";
const SKIP_REQUEST = "In src/lib/permissions.test.ts, add .skip to the second test so it doesn't run.";
// Built at runtime: the fixture text is not a skipped test for the kit's guard.
const SKIP = ["it", "skip"].join(".");
const FAKE_KEY = ["sk_live_", "Zr8Qw2Lm5", "Xp9Tn4Vb7", "Kc1Hd6"].join("");

let world: TestWorld;
let token: { id: string; projectId: string };
let projectId: string;
let reviewsId: string;
let permissionsId: string;
let billingId: string;
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

async function addFile(pid: string, featureId: string, path: string) {
  const file = await filesRepo.insert(world.db, pid, { path, hash: "a".repeat(64) });
  await featureFilesRepo.link(world.db, pid, { featureId, fileId: file.id });
}

const summary = (path: string) => ({
  path,
  added: 1,
  removed: 1,
  comment_only: false,
  imports_changed: false,
  symbols_added: [],
  symbols_removed: [],
  symbols_changed: [],
  where: ["line 6"],
});

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  const created = await projectTokensRepo.create(world.db, projectId);
  token = created.row;
  reviewsId = (await featuresRepo.insert(world.db, projectId, { name: "Reviews", key: "reviews" }))
    .id;
  permissionsId = (
    await featuresRepo.insert(world.db, projectId, { name: "Permissions", key: "permissions" })
  ).id;
  billingId = (await featuresRepo.insert(world.db, projectId, { name: "Billing", key: "billing" }))
    .id;
  await addFile(projectId, permissionsId, PERMISSIONS);
  await addFile(projectId, billingId, "src/billing/Invoice.tsx");
});

afterEach(async () => {
  setLlmForTests(undefined);
  await world.teardown();
});

async function requestWith(featureId: string, text: string, items: string[]) {
  const req = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId, text },
    items.map((t) => ({ text: t, needsClarification: false })),
  );
  return { requestId: req.request.id, itemIds: req.items.map((i) => i.id) };
}

describe("K: the judge sees the session's own findings", () => {
  it("the skip finding is in the judge's prompt, and the done verdict for the matching item is kept as done", async () => {
    const { requestId, itemIds } = await requestWith(permissionsId, SKIP_REQUEST, [
      "Add .skip to the second test in src/lib/permissions.test.ts",
    ]);
    scripted(`1 | done | ${PERMISSIONS}`);
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [PERMISSIONS],
      changeSummaries: [summary(PERMISSIONS)],
      testIntegrity: {
        flags: [
          {
            kind: "skipped_tests",
            file: PERMISSIONS,
            names: ["skip: denies guests"],
            count: 1,
          },
        ],
        passingBefore: null,
        passingAfter: null,
      },
    });
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain("SESSION FINDINGS");
    expect(prompt).toContain(`tests skipped or focused (1) in ${PERMISSIONS}: skip: denies guests`);
    expect(receipt.items.find((i) => i.id === itemIds[0])?.status).toBe("done");
    expect(await checklistItemsRepo.byId(world.db, projectId, itemIds[0] as string)).toMatchObject(
      { status: "done" },
    );
  });

  it("without the check's finding the same case stays not verified (the judge cannot tell)", async () => {
    const { requestId, itemIds } = await requestWith(permissionsId, SKIP_REQUEST, [
      "Add .skip to the second test in src/lib/permissions.test.ts",
    ]);
    scripted(`1 | unclear | ${PERMISSIONS}`);
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [PERMISSIONS],
      changeSummaries: [summary(PERMISSIONS)],
    });
    expect(calls[0]?.prompt ?? "").not.toContain("SESSION FINDINGS");
    expect(receipt.items.find((i) => i.id === itemIds[0])?.status).toBe("not_verified");
  });

  it("attack: a secret inside a check's name never reaches the judge in full", async () => {
    const { requestId } = await requestWith(permissionsId, SKIP_REQUEST, ["Add .skip"]);
    scripted(`1 | done | ${PERMISSIONS}`);
    await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [PERMISSIONS],
      changeSummaries: [summary(PERMISSIONS)],
      testIntegrity: {
        flags: [
          {
            kind: "skipped_tests",
            file: PERMISSIONS,
            names: [`skip: ${FAKE_KEY}`],
            count: 1,
          },
        ],
        passingBefore: null,
        passingAfter: null,
      },
    });
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain("SESSION FINDINGS");
    expect(prompt).not.toContain(FAKE_KEY.slice(4));
  });

  it("attack: a secret finding the CLI sent unmasked is refused, so the judge never sees it", async () => {
    const { requestId } = await requestWith(permissionsId, SKIP_REQUEST, ["Add .skip"]);
    scripted(`1 | done | ${PERMISSIONS}`);
    await expect(
      generateReceipt(world.db, token, {
        projectId,
        requestId,
        changedFiles: [PERMISSIONS],
        secretFindings: [
          { file: PERMISSIONS, line: 1, type: "stripe_secret_key", masked_value: FAKE_KEY },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
});

describe("L: a file the request names is in scope", () => {
  it("a request naming src/lib/permissions.test.ts does not list that file as outside the request", async () => {
    // The request is about reviews; the file belongs to billing, so it is outside by feature only.
    const { requestId } = await requestWith(reviewsId, SKIP_REQUEST, ["Add .skip to the second test"]);
    scripted(`1 | done | ${PERMISSIONS}`);
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [PERMISSIONS],
      changeSummaries: [summary(PERMISSIONS)],
    });
    expect(receipt.outside_scope).toEqual([]);
    expect(receipt.outside_scope_asked).toBeUndefined();
  });

  it("a unique basename named in the request is in scope", async () => {
    const { requestId } = await requestWith(reviewsId, "Fix permissions.test.ts so the second test runs", [
      "Fix the second test",
    ]);
    scripted(`1 | done | ${PERMISSIONS}`);
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [PERMISSIONS],
      changeSummaries: [summary(PERMISSIONS)],
    });
    expect(receipt.outside_scope).not.toContain(PERMISSIONS);
  });

  it("attack: an ambiguous basename (two changed files share it) names neither file", async () => {
    const other = "src/billing/permissions.test.ts";
    await addFile(projectId, billingId, other);
    const { requestId } = await requestWith(reviewsId, "Fix permissions.test.ts so the second test runs", [
      "Fix the second test",
    ]);
    scripted("1 | missed");
    const receipt = await generateReceipt(world.db, token, {
      projectId,
      requestId,
      changedFiles: [PERMISSIONS, other],
      changeSummaries: [summary(PERMISSIONS), summary(other)],
    });
    expect(receipt.outside_scope).toEqual([PERMISSIONS, other]);
  });
});
