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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { FeatureNotFoundError, resolveFeature } from "./feature-ref";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { whereDidWeStop } from "./session-tools";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Independent security review of D-023 (dogfooding fixes): receipts without a request, the tests group in receipts,
// features by name/key/id. Secrets are built at runtime from short chunks.
let world: TestWorld;
let projectId: string;
let token: { id: string; projectId: string };
let reviewsId: string;
let billingId: string;
let requestId: string;
let itemIds: string[];
let otherProjectId: string;
let otherRequestId: string;
let otherFeatureId: string;
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

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
  reviewsId = (await featuresRepo.insert(world.db, projectId, { name: "Reviews", key: "reviews" }))
    .id;
  billingId = (await featuresRepo.insert(world.db, projectId, { name: "Billing", key: "billing" }))
    .id;
  await addFile(projectId, reviewsId, "src/reviews/List.tsx");
  await addFile(projectId, billingId, "src/billing/Invoice.tsx");
  const created = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: reviewsId, text: "Add reviews with a list" },
    [{ text: "Show the reviews list", needsClarification: false }],
  );
  requestId = created.request.id;
  itemIds = created.items.map((i) => i.id);

  const other = await world.createUser({ name: "other" });
  otherProjectId = (await projectsRepo.create(world.db, other.id, { name: "secret" })).id;
  otherFeatureId = (
    await featuresRepo.insert(world.db, otherProjectId, { name: "Payroll", key: "payroll" })
  ).id;
  otherRequestId = (
    await requestsRepo.createWithItems(
      world.db,
      otherProjectId,
      { featureId: otherFeatureId, text: "Pay everyone twice" },
      [{ text: "Double payroll", needsClarification: false }],
    )
  ).request.id;
  scripted("");
});

afterEach(async () => {
  setLlmForTests(undefined);
  await world.teardown();
});

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected an error");
}

describe("generate_receipt without a request", () => {
  it("attack: another project's requestId is not found, exactly like an id that exists nowhere", async () => {
    const cross = await errorOf(
      generateReceipt(world.db, token, { requestId: otherRequestId, changedFiles: ["a.ts"] }),
    );
    const none = await errorOf(
      generateReceipt(world.db, token, { requestId: "no-such-request", changedFiles: ["a.ts"] }),
    );
    expect(cross).toBeInstanceOf(AppError);
    expect([(cross as AppError).status, (cross as AppError).code]).toEqual([
      (none as AppError).status,
      (none as AppError).code,
    ]);
    expect((cross as AppError).message).toBe((none as AppError).message);
    // Nothing stored for either project, and the other project's item keeps its status.
    expect(await receiptsRepo.list(world.db, projectId, 5)).toEqual([]);
    expect(await receiptsRepo.list(world.db, otherProjectId, 5)).toEqual([]);
  });

  it("attack: a null, empty or prototype-key requestId is refused, never read as 'no request'", async () => {
    for (const requestId of [null, "", "__proto__", "constructor"]) {
      const err = await errorOf(
        generateReceipt(world.db, token, { requestId, changedFiles: ["a.ts"] }),
      );
      expect([requestId, (err as AppError).status]).toEqual([
        requestId,
        requestId === null || requestId === "" ? 400 : 404,
      ]);
    }
    expect(await receiptsRepo.list(world.db, projectId, 5)).toEqual([]);
  });

  it("attack: a receipt without a request makes no AI call and changes no open item, even with open items in the project", async () => {
    scripted(
      JSON.stringify([{ id: itemIds[0], status: "done", evidence: ["src/reviews/List.tsx"] }]),
    );
    const r = await generateReceipt(world.db, token, {
      changedFiles: ["src/reviews/List.tsx", "src/reviews/List.test.tsx"],
    });
    expect(r.no_request).toBe(true);
    expect(r.items).toEqual([]);
    expect(calls).toEqual([]);
    expect((await checklistItemsRepo.byId(world.db, projectId, itemIds[0] as string))?.status).toBe(
      "open",
    );
  });

  it("attack: a projectId of another project in the arguments is refused (the token decides)", async () => {
    const err = await errorOf(
      generateReceipt(world.db, token, { projectId: otherProjectId, changedFiles: ["a.ts"] }),
    );
    expect(err).toBeInstanceOf(AppError);
    expect(await receiptsRepo.list(world.db, otherProjectId, 5)).toEqual([]);
  });

  it("attack: prototype-key paths group normally and never crash the receipt", async () => {
    const r = await generateReceipt(world.db, token, {
      changedFiles: ["__proto__/x.ts", "constructor", "src/components/__proto__/a.tsx"],
    });
    expect(r.files_by_feature.flatMap((g) => g.files).sort()).toEqual(
      ["__proto__/x.ts", "constructor", "src/components/__proto__/a.tsx"].sort(),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("attack: path tricks (backslash, '..', NUL) are refused before anything is stored", async () => {
    for (const p of [
      "src\\tests\\..\\app\\page.tsx",
      "tests/../src/app/page.tsx",
      "tests/a\u0000.ts",
    ]) {
      const err = await errorOf(generateReceipt(world.db, token, { changedFiles: [p] }));
      expect([p, (err as AppError).status]).toEqual([p, 400]);
    }
    expect(await receiptsRepo.list(world.db, projectId, 5)).toEqual([]);
  });

  it("attack: secrets in a test folder are still reported on a receipt without a request", async () => {
    const masked = ["sk_l", "***"].join("");
    const r = await generateReceipt(world.db, token, {
      changedFiles: ["tests/setup.ts"],
      secretFindings: [
        { file: "tests/setup.ts", line: 3, type: "stripe_secret_key", masked_value: masked },
      ],
    });
    expect(r.findings.some((f) => JSON.stringify(f).includes("tests/setup.ts"))).toBe(true);
  });

  it("attack: an unmasked secret in the findings is refused, not stored for last-receipt to return", async () => {
    const raw = ["sk_", "live_", "4eC39Hq", "LyjWDarj"].join("");
    const err = await errorOf(
      generateReceipt(world.db, token, {
        changedFiles: ["tests/setup.ts"],
        secretFindings: [
          { file: "tests/setup.ts", line: 3, type: "stripe_secret_key", masked_value: raw },
        ],
      }),
    );
    expect((err as AppError).status).toBe(400);
    expect(JSON.stringify(err)).not.toContain(raw);
    expect(await receiptsRepo.list(world.db, projectId, 5)).toEqual([]);
  });
});

describe("tests group in a receipt's outside-scope check", () => {
  it("attack: real test files under tests/ for the request stay in scope (guard)", async () => {
    const r = await generateReceipt(world.db, token, {
      requestId,
      changedFiles: ["src/reviews/__tests__/List.test.tsx"],
    });
    expect(r.outside_scope).toEqual([]);
  });

  it("attack: app code linked to another feature but sitting in a folder named fixtures/test/e2e is still outside the request", async () => {
    // Billing code a user (or a malicious repo) keeps under a test-named folder: real server code, linked to Billing.
    const hidden = [
      "src/billing/fixtures/charge.ts",
      "src/app/api/test/route.ts",
      "src/app/e2e/page.tsx",
      "src/lib/test/admin-auth.ts",
    ];
    for (const p of hidden) await addFile(projectId, billingId, p);
    const r = await generateReceipt(world.db, token, { requestId, changedFiles: hidden });
    expect(r.outside_scope.sort()).toEqual([...hidden].sort());
  });

  it("attack: lookalike or differently cased test folders do not get the tests-group pass", async () => {
    const paths = [
      "src/t\u0435sts/charge.ts", // Cyrillic e
      "src/\uff54\uff45\uff53\uff54\uff53/charge.ts", // fullwidth tests
      "src/Tests/charge.ts",
      "src/tests\u200b/charge.ts", // zero-width space
    ];
    for (const p of paths) await addFile(projectId, billingId, p);
    const r = await generateReceipt(world.db, token, { requestId, changedFiles: paths });
    expect(r.outside_scope.length).toBe(paths.length);
  });
});

describe("features by name, key or id", () => {
  it("attack: another project's feature id, name or key is not found, with the same answer as a made-up one", async () => {
    const answers: string[] = [];
    for (const ref of [otherFeatureId, "Payroll", "payroll", "nothing-here"]) {
      const err = await errorOf(resolveFeature(world.db, projectId, ref));
      expect(err).toBeInstanceOf(FeatureNotFoundError);
      answers.push(JSON.stringify((err as FeatureNotFoundError).valid));
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).not.toContain("Payroll");
  });

  it("attack: prototype keys as a feature ref are a plain not-found", async () => {
    for (const ref of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const err = await errorOf(resolveFeature(world.db, projectId, ref));
      expect([ref, err instanceof FeatureNotFoundError]).toEqual([ref, true]);
    }
  });

  it("attack: a lookalike name (Cyrillic e) does not resolve to the real feature", async () => {
    const err = await errorOf(resolveFeature(world.db, projectId, "R\u0435views"));
    expect(err).toBeInstanceOf(FeatureNotFoundError);
  });

  it("attack: a feature name cannot forge another feature's id in the start note", async () => {
    // Names allow ", " and parentheses (80 chars, no control characters): one name can carry a fake "(id ...)".
    await featuresRepo.insert(world.db, projectId, {
      name: `Admin (id ${billingId}), Login`,
      key: "admin",
    });
    const note = await whereDidWeStop(world.db, token, {});
    const line = note.split("\n").find((l) => l.startsWith("ALL FEATURES:")) ?? "";
    // One "(id " per feature: three features in this project.
    expect(line.split("(id ").length - 1).toBe(3);
  });

  it("attack: secrets in a feature name are masked in the not-found list and the start note", async () => {
    const secret = ["sk_", "live_", "4eC39Hq", "LyjWDarj"].join("");
    await featuresRepo.insert(world.db, projectId, { name: `leak ${secret}`, key: "leak" });
    const err = (await errorOf(
      resolveFeature(world.db, projectId, "nope"),
    )) as FeatureNotFoundError;
    expect(JSON.stringify(err.valid)).not.toContain(secret);
    expect(await whereDidWeStop(world.db, token, {})).not.toContain(secret);
  });
});
