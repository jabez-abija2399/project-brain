// FEAT-015 security pass (independent review): attacker tests for the RLS flags upload and the receipt findings,
// through the real /api/index/:projectId/supabase and /mcp routes. Fake secrets are built at runtime from chunks under
// 10 characters (never secret-shaped literals).
import { POST as supabaseRoute } from "@/app/api/index/[projectId]/supabase/route";
import { POST as mcp } from "@/app/mcp/route";
import {
  dbSchemaRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLlmForTests } from "./llm";
import { type TestWorld, createTestWorld } from "./test-helpers";

const chunk = "aB3dE5gH7j";
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const serviceRole = () =>
  [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ iss: "supabase", ref: "abcdefghij", role: "service_role" }),
    [chunk, chunk, chunk, chunk].join(""),
  ].join(".");
const stripeLive = () => ["sk", "_live_", chunk, chunk, chunk].join("");
const openai = () => ["sk", "-proj-", chunk, chunk, chunk].join("");
// What must never show up anywhere: a long enough piece of each secret to identify it.
const secretPieces = () => [
  serviceRole().slice(-24),
  stripeLive().slice(0, 12),
  openai().slice(0, 12),
];

const migration = "supabase/migrations/0001_init.sql";
const table = (name: string, rlsEnabled: boolean, rlsUnknown = false) => ({
  schema: "public",
  name,
  path: migration,
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

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const upload = (
  projectId: string,
  token: string,
  body: unknown,
  handler: Handler = supabaseRoute,
) =>
  handler(
    new Request(`http://x/api/index/${projectId}/supabase`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) },
  );

let rpcId = 1;
async function tool(bearer: string, name: string, args: Record<string, unknown>) {
  const res = await mcp(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = await res.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  const parsed = JSON.parse(data ? data.slice(6) : body) as {
    result?: { content: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };
  return {
    raw: body,
    text: parsed.result?.content[0]?.text ?? parsed.error?.message ?? "",
    isError: parsed.result?.isError === true || parsed.error !== undefined,
  };
}

let world: TestWorld;
let a: { id: string; token: string; tokenId: string };
let b: { id: string; token: string; tokenId: string };
let logs: string[];

async function newRequest(projectId: string) {
  const feature =
    (await featuresRepo.byKeys(world.db, projectId, ["pay"]))[0] ??
    (await featuresRepo.insert(world.db, projectId, { name: "Pay", key: "pay" }));
  const created = await requestsRepo.createWithItems(
    world.db,
    projectId,
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
  const tb = await projectTokensRepo.create(world.db, pb.id);
  a = { id: pa.id, token: ta.token, tokenId: ta.row.id };
  b = { id: pb.id, token: tb.token, tokenId: tb.row.id };
  logs = [];
  for (const level of ["info", "warn", "error", "log", "debug"] as const) {
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

describe("FEAT-015 findings security pass", () => {
  it("AC-015-03 attack: raw secrets sent in masked_value or type through the real /mcp route are refused without being echoed, stored or logged", async () => {
    const requestId = await newRequest(a.id);
    const attempts = [
      { file: "src/a.ts", line: 1, type: "stripe_secret_key", masked_value: stripeLive() },
      { file: "src/a.ts", line: 1, type: "stripe_secret_key", masked_value: `${stripeLive()}***` },
      { file: "src/a.ts", line: 1, type: stripeLive(), masked_value: "sk_l***" },
      { file: "src/a.ts", line: 1, type: "supabase_service_role_key", masked_value: serviceRole() },
    ];
    for (const finding of attempts) {
      const res = await tool(a.token, "generate_receipt", {
        requestId,
        changedFiles: [],
        secretFindings: [finding],
      });
      expect(res.isError).toBe(true);
      for (const piece of secretPieces()) expect(res.raw).not.toContain(piece);
    }
    expect(await receiptsRepo.list(world.db, a.id)).toHaveLength(0);
    for (const piece of secretPieces()) expect(logs.join("\n")).not.toContain(piece);
  });

  it("AC-015-03 attack: a raw secret placed in a finding's file path is masked in the /mcp response, the stored receipt and the logs", async () => {
    const requestId = await newRequest(a.id);
    const res = await tool(a.token, "generate_receipt", {
      requestId,
      changedFiles: [],
      secretFindings: [
        {
          file: `src/${stripeLive()}.ts`,
          line: 3,
          type: "stripe_secret_key",
          masked_value: "sk_l***",
        },
        {
          file: `config/${serviceRole()}`,
          line: 1,
          type: "supabase_service_role_key",
          masked_value: "eyJh***",
        },
        { file: `keys/${openai()}/x.ts`, line: 2, type: "openai_api_key", masked_value: "sk-p***" },
      ],
    });
    expect(res.isError).toBe(false);
    const receipt = JSON.parse(res.text) as { findings: { file: string; masked_value: string }[] };
    expect(receipt.findings).toHaveLength(3);
    const [stored] = await receiptsRepo.list(world.db, a.id);
    for (const place of [res.raw, JSON.stringify(stored), logs.join("\n")]) {
      for (const piece of secretPieces()) expect(place).not.toContain(piece);
    }
  });

  it("AC-015-03 attack: an upload with an unknown field or a bad value named after a secret gets a 400 that does not echo it", async () => {
    const extraKey = await upload(a.id, a.token, {
      tables: [{ ...table("posts", true), [stripeLive()]: true }],
      policies: [],
    });
    expect(extraKey.status).toBe(400);
    const badCommand = await upload(a.id, a.token, {
      tables: [table("posts", true)],
      policies: [{ ...policy("posts", "UPDATE", false), command: openai() }],
    });
    expect(badCommand.status).toBe(400);
    const bodies = `${await extraKey.text()}\n${await badCommand.text()}`;
    for (const piece of secretPieces()) expect(bodies).not.toContain(piece);
    for (const piece of secretPieces()) expect(logs.join("\n")).not.toContain(piece);
  });

  it("AC-015-04 attack: project B's token can neither upload A's flags, nor read A's findings through generate_receipt", async () => {
    expect(
      (await upload(a.id, b.token, { tables: [table("posts", false)], policies: [] })).status,
    ).toBe(404);
    expect(
      (
        await upload(a.id, a.token, {
          tables: [table("profiles", false)],
          policies: [],
        })
      ).status,
    ).toBe(200);
    const aRequest = await newRequest(a.id);
    // B names A's project and A's request: refused, and nothing of A's comes back.
    const crossed = await tool(b.token, "generate_receipt", {
      projectId: a.id,
      requestId: aRequest,
      changedFiles: [],
    });
    expect(crossed.isError).toBe(true);
    expect(crossed.raw).not.toContain("profiles");
    const sneaky = await tool(b.token, "generate_receipt", {
      requestId: aRequest,
      changedFiles: [],
    });
    expect(sneaky.isError).toBe(true);
    expect(sneaky.raw).not.toContain("profiles");
    // B's own receipt sees none of A's tables.
    const own = await tool(b.token, "generate_receipt", {
      requestId: await newRequest(b.id),
      changedFiles: [],
    });
    expect(own.isError).toBe(false);
    const parsed = JSON.parse(own.text) as { findings: unknown[]; rls_tables_checked: number };
    expect(parsed.findings).toEqual([]);
    expect(parsed.rls_tables_checked).toBe(0);
    expect(await receiptsRepo.list(world.db, a.id)).toHaveLength(0);
  });

  it("AC-015-06 attack: an unknown table is reported even when its uploaded policies look restrictive or open, and never as safe", async () => {
    const res = await upload(a.id, a.token, {
      tables: [table("orders", false, true), table("items", false, true)],
      policies: [policy("orders", "UPDATE", true), policy("items", "ALL", false, false)],
    });
    expect(res.status).toBe(200);
    const out = await tool(a.token, "generate_receipt", {
      requestId: await newRequest(a.id),
      changedFiles: [],
    });
    const receipt = JSON.parse(out.text) as { findings: { type: string; table: string }[] };
    expect(receipt.findings.map((f) => [f.type, f.table])).toEqual([
      ["rls_cannot_be_confirmed", "public.items"],
      ["rls_cannot_be_confirmed", "public.orders"],
    ]);
  });

  it("AC-015-06 attack: 5,000 unknown tables are capped in the receipt but every one is counted, none is dropped as safe", async () => {
    const tables = Array.from({ length: 5_000 }, (_, i) =>
      table(`t${String(i).padStart(4, "0")}`, false, true),
    );
    expect((await upload(a.id, a.token, { tables, policies: [] })).status).toBe(200);
    const out = await tool(a.token, "generate_receipt", {
      requestId: await newRequest(a.id),
      changedFiles: [],
    });
    const receipt = JSON.parse(out.text) as {
      findings: { type: string }[];
      findings_omitted: number;
      rls_tables_checked: number;
    };
    expect(receipt.findings).toHaveLength(200);
    expect(receipt.findings.every((f) => f.type === "rls_cannot_be_confirmed")).toBe(true);
    expect(receipt.findings_omitted).toBe(4_800);
    expect(receipt.rls_tables_checked).toBe(5_000);
  }, 60_000);

  it("AC-015-07 attack: mixed-case or quoted command values and restrictive allow-all claims are refused, not stored", async () => {
    for (const command of ["update", '"UPDATE"', "Update ", "INSERT;"]) {
      const res = await upload(a.id, a.token, {
        tables: [table("posts", true)],
        policies: [{ ...policy("posts", "UPDATE", false), command }],
      });
      expect(res.status).toBe(400);
    }
    const restrictive = await upload(a.id, a.token, {
      tables: [table("posts", true)],
      policies: [policy("posts", "INSERT", true, false)],
    });
    expect(restrictive.status).toBe(400);
    expect(await dbSchemaRepo.listWithPolicies(world.db, a.id)).toEqual([]);
  });

  it("AC-015-04 attack: two uploads at once leave exactly one of them stored, never a mix or duplicates", async () => {
    const first = {
      tables: [table("posts", true), table("profiles", false)],
      policies: [policy("posts", "UPDATE", true)],
    };
    const second = {
      tables: [table("posts", true), table("orders", false, true)],
      policies: [policy("posts", "SELECT", false)],
    };
    const [r1, r2] = await Promise.all([
      upload(a.id, a.token, first),
      upload(a.id, a.token, second),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const stored = await dbSchemaRepo.listWithPolicies(world.db, a.id);
    const shape = stored
      .map((t) => [t.name, t.policies.map((p) => [p.command, p.allowsAll])])
      .sort();
    const expected = (u: typeof first) =>
      u.tables
        .map((t) => [
          t.name,
          u.policies.filter((p) => p.table === t.name).map((p) => [p.command, p.allowsAll]),
        ])
        .sort();
    expect([JSON.stringify(expected(first)), JSON.stringify(expected(second))]).toContain(
      JSON.stringify(shape),
    );
  });
});
