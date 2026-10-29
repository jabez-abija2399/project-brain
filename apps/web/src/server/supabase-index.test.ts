import { POST as supabaseRoute } from "@/app/api/index/[projectId]/supabase/route";
import { scanSecrets } from "@brain/core";
import {
  dbSchemaRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const call = (handler: Handler, projectId: string, token: string, body: unknown) =>
  handler(
    new Request(`http://x/api/index/${projectId}/supabase`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) },
  );

const path = "supabase/migrations/0001_init.sql";
const table = (name: string, rlsEnabled: boolean, rlsUnknown = false) => ({
  schema: "public",
  name,
  path,
  rlsEnabled,
  rlsUnknown,
});
const policy = (t: string, command: string, allowsAll: boolean, permissive = true) => ({
  schema: "public",
  table: t,
  command,
  permissive,
  allowsAll,
  checksOwnership: !allowsAll,
});
const flags = {
  tables: [
    table("profiles", false),
    table("posts", true),
    table("orders", false, true),
    table("documents", true),
    table("comments", true),
  ],
  policies: [
    policy("posts", "UPDATE", true),
    policy("documents", "UPDATE", false, false),
    policy("comments", "SELECT", true),
    policy("comments", "INSERT", false),
  ],
};
// Fake secrets are built at runtime from chunks under 10 characters.
const chunk = "aB3dE5gH7j";
const stripeLive = ["sk", "_live_", chunk, chunk, chunk].join("");

let world: TestWorld;
let a: { id: string; token: string; tokenId: string };
let b: { id: string; token: string };
let logs: string[];

async function newRequest() {
  const feature =
    (await featuresRepo.byKeys(world.db, a.id, ["pay"]))[0] ??
    (await featuresRepo.insert(world.db, a.id, { name: "Pay", key: "pay" }));
  const created = await requestsRepo.createWithItems(
    world.db,
    a.id,
    { featureId: feature.id, text: "Add payments" },
    [{ text: "Charge the card", needsClarification: false }],
  );
  return created.request.id;
}

beforeEach(async () => {
  world = await createTestWorld();
  const pa = await projectsRepo.create(world.db, (await world.createUser()).id, { name: "a" });
  const pb = await projectsRepo.create(world.db, (await world.createUser()).id, { name: "b" });
  const ta = await projectTokensRepo.create(world.db, pa.id);
  a = { id: pa.id, token: ta.token, tokenId: ta.row.id };
  b = { id: pb.id, token: (await projectTokensRepo.create(world.db, pb.id)).token };
  logs = [];
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    });
  }
});

afterEach(async () => {
  setLlmForTests(undefined);
  vi.restoreAllMocks();
  await world.teardown();
});

describe("RLS flags upload and receipt findings (FEAT-015)", () => {
  it("AC-015-04 RLS off and a policy that lets everyone UPDATE are flagged in the receipt from the uploaded flags", async () => {
    const res = await call(supabaseRoute, a.id, a.token, flags);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tables: 5, policies: 4 });
    const receipt = await generateReceipt(
      world.db,
      { id: a.tokenId, projectId: a.id },
      { requestId: await newRequest(), changedFiles: [] },
    );
    expect(receipt.rls_tables_checked).toBe(5);
    expect(receipt.findings.map((f) => [f.type, f.table, f.file])).toEqual([
      ["rls_cannot_be_confirmed", "public.orders", path],
      ["policy_allows_everyone_to_write", "public.posts", path],
      ["rls_disabled", "public.profiles", path],
    ]);
    const [stored] = await receiptsRepo.list(world.db, a.id);
    expect((stored?.summaryJson as { findings: unknown[] }).findings).toHaveLength(3);
  });

  it("AC-015-06 a table whose RLS state is unknown is 'RLS cannot be confirmed', never safe and never skipped", async () => {
    await call(supabaseRoute, a.id, a.token, {
      tables: [table("orders", false, true)],
      policies: [],
    });
    const receipt = await generateReceipt(
      world.db,
      { id: a.tokenId, projectId: a.id },
      { requestId: await newRequest(), changedFiles: [] },
    );
    expect(receipt.findings).toHaveLength(1);
    expect(receipt.findings[0]).toMatchObject({
      type: "rls_cannot_be_confirmed",
      table: "public.orders",
    });
    expect(receipt.findings[0]?.hint).toMatch(/^RLS cannot be confirmed/);
    const both = await call(supabaseRoute, a.id, a.token, {
      tables: [table("orders", true, true)],
      policies: [],
    });
    expect(both.status).toBe(400);
  });

  it("AC-015-07 attack: an upload claiming a restrictive policy allows everyone is refused, and restrictive policies never produce a finding", async () => {
    const bad = await call(supabaseRoute, a.id, a.token, {
      tables: [table("documents", true)],
      policies: [policy("documents", "UPDATE", true, false)],
    });
    expect(bad.status).toBe(400);
    await call(supabaseRoute, a.id, a.token, {
      tables: [table("documents", true)],
      policies: [
        policy("documents", "UPDATE", false, false),
        policy("documents", "ALL", false, false),
      ],
    });
    const receipt = await generateReceipt(
      world.db,
      { id: a.tokenId, projectId: a.id },
      { requestId: await newRequest(), changedFiles: [] },
    );
    expect(receipt.findings).toEqual([]);
  });

  it("AC-015-04 attack: another project's token, SQL text fields and oversized uploads are refused and store nothing", async () => {
    expect((await call(supabaseRoute, a.id, b.token, flags)).status).toBe(404);
    const withSql = await call(supabaseRoute, a.id, a.token, {
      tables: [table("posts", true)],
      policies: [{ ...policy("posts", "UPDATE", true), using: "true" }],
    });
    expect(withSql.status).toBe(400);
    const many = Array.from({ length: 5_001 }, (_, i) => table(`t${i}`, true));
    expect((await call(supabaseRoute, a.id, a.token, { tables: many, policies: [] })).status).toBe(
      400,
    );
    expect(await dbSchemaRepo.listWithPolicies(world.db, a.id)).toEqual([]);
  });

  it("AC-015-03 attack: secrets are masked in the receipt response, the database and the logs, and an unmasked value is refused without being echoed", async () => {
    const source = `const stripe = new Stripe("${stripeLive}");`;
    const secretFindings = scanSecrets("src/app/checkout/page.tsx", `"use client";\n${source}`);
    expect(secretFindings).toHaveLength(1);
    const token = { id: a.tokenId, projectId: a.id };
    const receipt = await generateReceipt(world.db, token, {
      requestId: await newRequest(),
      changedFiles: [],
      secretFindings,
    });
    expect(receipt.findings[0]).toMatchObject({
      type: "stripe_secret_key",
      file: "src/app/checkout/page.tsx",
      line: 2,
      masked_value: "sk_l***",
    });
    const response = JSON.stringify(receipt);
    const [stored] = await receiptsRepo.list(world.db, a.id);
    const row = JSON.stringify(stored);
    for (const place of [response, row, logs.join("\n")]) {
      expect(place).not.toContain(stripeLive.slice(0, 8));
      expect(place).not.toContain("new Stripe");
    }
    expect(row).toContain("sk_l***");

    const raw = [
      { file: "src/a.ts", line: 1, type: "stripe_secret_key", masked_value: stripeLive },
    ];
    const err = await generateReceipt(world.db, token, {
      requestId: await newRequest(),
      changedFiles: [],
      secretFindings: raw,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
    expect(
      JSON.stringify({ message: (err as AppError).message, fields: (err as AppError).fieldErrors }),
    ).not.toContain(stripeLive.slice(0, 8));
    expect(await receiptsRepo.list(world.db, a.id)).toHaveLength(1);
    expect(logs.join("\n")).not.toContain(stripeLive.slice(0, 8));
  });
});
