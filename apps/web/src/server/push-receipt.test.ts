import { receiptView } from "@brain/core";
// FEAT-023: receipts on push for projects connected through GitHub (Lovable, Bolt, Replit and anyone who pushes):
// the commit messages are the request, the changed files come from GitHub's compare, and the secret, test-integrity
// and dependency checks run on contents fetched for the job and dropped. Attacker tests are named "attack: ...".
import { checklistItems, githubRepo, projectsRepo, receipts, requests } from "@brain/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRepo,
  makeGithubConfig,
  mockGithub,
  restoreGithub,
  sign,
} from "./github-test-helpers";
import { handleWebhook } from "./github-webhook";
import type { PushEventData } from "./inngest";
import { installationClient } from "./inngest-functions";
import type { StepRunner } from "./push-index";
import { MAX_PUSH_RECEIPTS_PER_DAY, runPushJob } from "./push-receipt";
import { reserveDaily } from "./rate-limit";
import { type TestWorld, createTestWorld } from "./test-helpers";

const BEFORE = "a".repeat(40);
const AFTER = "b".repeat(40);
// Built at runtime so no secret-shaped literal sits in the repo; lives only inside fetched file bodies.
const SECRET = ["sk_", "live_", "51HxYz", "Q8rT2vW", "9kLmN3pR"].join("");
const SENTINEL = ["PUSH", "BODY", "SENTINEL", "91c2"].join("_");

let world: TestWorld;
let projectId: string;
let outputs: unknown[];
const step: StepRunner = {
  run: async (_name, fn) => {
    const result = await fn();
    outputs.push(JSON.parse(JSON.stringify(result ?? null)));
    return result;
  },
};
const event = (over: Partial<PushEventData> = {}): PushEventData => ({
  projectId,
  installationId: 77,
  repo: "acme/app",
  before: BEFORE,
  after: AFTER,
  deliveryId: "d-1",
  ...over,
});
const run = (data = event()) => runPushJob(world.db, data, step, () => installationClient(77));
const receiptRows = () => world.db.select().from(receipts).where(eq(receipts.projectId, projectId));

function fakeRepo(over: Partial<FakeRepo> = {}): FakeRepo {
  return {
    installations: { 77: ["acme/app"] },
    userInstallations: [77],
    compare: {
      [`${BEFORE}...${AFTER}`]: [
        { filename: "src/Reviews.tsx", status: "added" },
        { filename: "src/reviews.test.ts", status: "modified" },
        { filename: "package.json", status: "modified" },
      ],
    },
    commitMessages: {
      [`${BEFORE}...${AFTER}`]: ["Add reviews to the salon page", "Sort reviews newest first"],
    },
    files: {
      "src/Reviews.tsx": `export function Reviews() {\n  const key = "${SECRET}";\n  return <div>${SENTINEL}</div>;\n}\n`,
      "src/reviews.test.ts": `it.skip("lists reviews", () => { expect(1).toBe(1); });\n`,
      "package.json": JSON.stringify({
        dependencies: { react: "^18.2.0", "left-pad-ultra": "^1.0.0" },
      }),
    },
    filesAt: {
      [BEFORE]: {
        "src/reviews.test.ts": `it("lists reviews", () => { expect(1).toBe(1); });\n`,
        "package.json": JSON.stringify({ dependencies: { react: "^18.2.0" } }),
      },
    },
    ...over,
  };
}

beforeEach(async () => {
  world = await createTestWorld();
  makeGithubConfig();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  await githubRepo.linkProject(world.db, projectId, owner.id, 77, "acme/app");
  outputs = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  restoreGithub();
  await world.teardown();
});

describe("FEAT-023 receipts on push", () => {
  it("AC-023-01 a push gets one receipt: commit messages as the request, changed files, secret, test and dependency checks", async () => {
    mockGithub(fakeRepo());
    await run();
    const rows = await receiptRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.commitSha).toBe(AFTER);
    const [req] = await world.db.select().from(requests).where(eq(requests.projectId, projectId));
    expect(req?.text).toContain("Add reviews to the salon page");
    expect(req?.text).toContain("Sort reviews newest first");
    const view = receiptView(row?.summaryJson);
    expect(view.fromPush).toBe(true);
    expect(view.findings.map((f) => f.type)).toContain("stripe_secret_key");
    expect(view.findings.find((f) => f.type === "stripe_secret_key")?.maskedValue).toBe("sk_l***");
    expect(view.testChecks.map((c) => c.label)).toContain("Tests skipped or focused");
    expect(view.dependencies.map((d) => d.name)).toContain("left-pad-ultra");
  });

  it("AC-023-02 the same push delivered twice makes one receipt", async () => {
    mockGithub(fakeRepo());
    await run();
    await run(event({ deliveryId: "d-2" }));
    expect(await receiptRows()).toHaveLength(1);
  });

  it("AC-023-03 attack: a wrongly signed webhook does nothing (401); no file content reaches the database or a step result", async () => {
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const res = await handleWebhook(
      world.db,
      new Request("http://x/api/github/webhook", {
        method: "POST",
        headers: {
          "x-github-event": "push",
          "x-github-delivery": "dd-1",
          "x-hub-signature-256": sign(body, "not-the-secret"),
        },
        body,
      }),
    );
    expect(res.status).toBe(401);
    mockGithub(fakeRepo());
    await run();
    const stored = JSON.stringify(await receiptRows());
    expect(stored).not.toContain(SENTINEL);
    expect(stored).not.toContain(SECRET);
    expect(JSON.stringify(outputs)).not.toContain(SENTINEL);
    expect(JSON.stringify(outputs)).not.toContain(SECRET);
  });

  it("AC-023-04 a repo not connected to the project gets no receipt", async () => {
    mockGithub(fakeRepo());
    await run(event({ repo: "acme/other" }));
    expect(await receiptRows()).toHaveLength(0);
  });

  it("AC-023-05 a push with more than 300 changed files lists the first 300 and says the rest were not checked", async () => {
    const many = Array.from({ length: 350 }, (_, i) => ({
      filename: `src/f${i}.ts`,
      status: "added",
    }));
    const files = Object.fromEntries(many.map((f) => [f.filename, "export const x = 1;\n"]));
    mockGithub(fakeRepo({ compare: { [`${BEFORE}...${AFTER}`]: many }, files, filesAt: {} }));
    await run();
    const [row] = await receiptRows();
    const view = receiptView(row?.summaryJson);
    expect(view.filesByFeature.flatMap((g) => g.files)).toHaveLength(300);
    expect(view.filesNotChecked).toBe(50);
  });

  it("attack (security review): a pushed .env file is scanned for secrets", async () => {
    mockGithub(
      fakeRepo({
        compare: { [`${BEFORE}...${AFTER}`]: [{ filename: ".env", status: "added" }] },
        files: { ".env": `STRIPE_KEY=${SECRET}\n` },
        filesAt: {},
      }),
    );
    await run();
    const [row] = await receiptRows();
    expect(receiptView(row?.summaryJson).findings.map((f) => f.file)).toContain(".env");
  });

  it("attack (security review): no package.json text (or any file text) is kept in a step result", async () => {
    mockGithub(fakeRepo());
    await run();
    const steps = JSON.stringify(outputs);
    expect(steps).not.toContain('\\"left-pad-ultra\\":\\"^1.0.0\\"');
    expect(steps).not.toContain("dependencies");
  });

  it("attack (security review): commit messages are the request as written; no AI checklist is made from them", async () => {
    mockGithub(fakeRepo());
    await run();
    const [req] = await world.db.select().from(requests).where(eq(requests.projectId, projectId));
    expect(req?.sessionId).toBe(`push-${AFTER.slice(0, 12)}`);
    const items = await world.db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.projectId, projectId));
    expect(items).toHaveLength(0);
  });

  it("security review: a retried receipt step (its earlier steps' results replayed) does not make a second receipt", async () => {
    mockGithub(fakeRepo());
    const memo = new Map<string, unknown>();
    const replaying: StepRunner = {
      run: async (name, fn) => {
        if (name !== "push-receipt-make" && memo.has(name)) return memo.get(name) as never;
        const result = await fn();
        memo.set(name, result);
        return result;
      },
    };
    await runPushJob(world.db, event(), replaying, () => installationClient(77));
    await runPushJob(world.db, event(), replaying, () => installationClient(77));
    expect(await receiptRows()).toHaveLength(1);
  });

  it("security review: a project gets at most 200 push receipts a day", async () => {
    mockGithub(fakeRepo());
    expect(MAX_PUSH_RECEIPTS_PER_DAY).toBe(200);
    await reserveDaily(
      world.db,
      `push-receipt:${projectId}`,
      MAX_PUSH_RECEIPTS_PER_DAY,
      MAX_PUSH_RECEIPTS_PER_DAY,
      new Date(),
    );
    await run();
    expect(await receiptRows()).toHaveLength(0);
  });
});
