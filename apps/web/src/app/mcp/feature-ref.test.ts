import { GET as lastReceiptRoute } from "@/app/api/hooks/[projectId]/last-receipt/route";
import { setLlmForTests } from "@/server/llm";
import { MCP_ERROR } from "@/server/mcp-tools";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import type { Llm } from "@brain/core";
import { featuresRepo, projectTokensRepo, projectsRepo, receiptsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Dogfooding (edutech): every MCP tool that takes a feature accepts the name, key or id that list_features and the
// start note show; a wrong one lists the valid names. Also: a receipt without a request, and the last receipt.
let nextId = 1;
async function tool(name: string, args: Record<string, unknown>, token: string) {
  const res = await POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  const result = JSON.parse(line ? line.slice(6) : body).result as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0]?.text ?? "", isError: result.isError === true };
}

let world: TestWorld;
let projectId: string;
let token: string;
let otherFeatureId: string;
let home: { id: string };
let reviews: { id: string };

const splitter: Llm = { complete: async () => "- Show a welcome banner" };

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).token;
  // What the index makes: the automatic "home" feature (key @home) and a folder feature.
  home = await featuresRepo.insert(world.db, projectId, { name: "home", key: "@home" });
  reviews = await featuresRepo.insert(world.db, projectId, { name: "Reviews", key: "reviews" });
  const other = await world.createUser({ name: "other" });
  const otherProject = (await projectsRepo.create(world.db, other.id, { name: "secret" })).id;
  otherFeatureId = (
    await featuresRepo.insert(world.db, otherProject, { name: "Payroll", key: "payroll" })
  ).id;
  setLlmForTests(splitter);
});
afterEach(async () => {
  setLlmForTests(undefined);
  vi.restoreAllMocks();
  await world.teardown();
});

describe("features by name, key or id", () => {
  it("list_features and the start note show each feature's id next to its name", async () => {
    const list = JSON.parse((await tool("list_features", {}, token)).text);
    expect(list.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: home.id, name: "home" }),
        expect.objectContaining({ id: reviews.id, name: "Reviews" }),
      ]),
    );
    const note = (await tool("where_did_we_stop", {}, token)).text;
    expect(note).toContain(`home (id ${home.id})`);
    expect(note).toContain(`Reviews (id ${reviews.id})`);
  });

  it("create_checklist accepts the name, the key or the id (and the old featureId argument)", async () => {
    for (const feature of ["home", "@home", home.id]) {
      const res = await tool(
        "create_checklist",
        { feature, request: "Add a welcome banner" },
        token,
      );
      expect([feature, res.isError]).toEqual([feature, false]);
      expect(JSON.parse(res.text).feature_id).toBe(home.id);
    }
    const legacy = await tool(
      "create_checklist",
      { featureId: "Reviews", request: "Add a welcome banner" },
      token,
    );
    expect(JSON.parse(legacy.text).feature_id).toBe(reviews.id);
  });

  it("get_context_pack accepts the name, the key or the id", async () => {
    for (const feature of ["Reviews", "reviews", reviews.id]) {
      const res = await tool("get_context_pack", { feature }, token);
      expect([feature, res.isError]).toEqual([feature, false]);
    }
  });

  it("a wrong feature is an error that lists the valid names", async () => {
    for (const [name, args] of [
      ["create_checklist", { feature: "dashboard", request: "x" }],
      ["get_context_pack", { feature: "dashboard" }],
    ] as const) {
      const res = await tool(name, args, token);
      expect(res.isError).toBe(true);
      const err = JSON.parse(res.text);
      expect(err.code).toBe(MCP_ERROR.notFound);
      expect(err.message).toBe("feature not found; use one of: home, Reviews");
      expect(err.data).toEqual({ valid_features: ["home", "Reviews"] });
    }
  });

  it("attack: another project's feature id is not found, and the error lists only this project's names", async () => {
    const res = await tool("create_checklist", { feature: otherFeatureId, request: "x" }, token);
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain("Payroll");
    expect(res.text).not.toContain(otherFeatureId);
    // Exactly the answer for a feature that exists nowhere: no existence oracle.
    const missing = await tool(
      "create_checklist",
      { feature: "no-such-feature", request: "x" },
      token,
    );
    expect(res.text).toBe(missing.text);
    expect(JSON.parse(res.text).data).toEqual({ valid_features: ["home", "Reviews"] });
  });
});

describe("receipts without a request, and the last receipt", () => {
  it("generate_receipt without a request records the changed files by feature with the no-request note, and no AI call", async () => {
    const calls: string[] = [];
    setLlmForTests({
      complete: async (r) => {
        calls.push(r.purpose ?? "");
        return "";
      },
    });
    const res = await tool("generate_receipt", { changedFiles: ["src/app/page.tsx"] }, token);
    expect(res.isError).toBe(false);
    const receipt = JSON.parse(res.text);
    expect(receipt.request_id).toBeNull();
    expect(receipt.items).toEqual([]);
    expect(receipt.no_request).toBe(true);
    expect(receipt.files_by_feature).toEqual([{ feature: "home", files: ["src/app/page.tsx"] }]);
    expect(calls).toEqual([]);
    const stored = (await receiptsRepo.list(world.db, projectId, 1))[0];
    expect(stored?.requestId).toBeNull();
  });

  it("GET /api/hooks/:projectId/last-receipt gives the newest receipt of the token's project only", async () => {
    await tool("generate_receipt", { changedFiles: ["src/app/page.tsx"] }, token);
    const ask = (id: string, bearer: string) =>
      lastReceiptRoute(
        new Request(`http://localhost/api/hooks/${id}/last-receipt`, {
          headers: { authorization: `Bearer ${bearer}` },
        }),
        { params: Promise.resolve({ projectId: id }) },
      );
    const res = await ask(projectId, token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.no_request).toBe(true);
    expect(typeof body.receipt_id).toBe("string");
    // Another project's token cannot read it.
    const other = await projectsRepo.create(world.db, (await world.createUser()).id, { name: "x" });
    const otherToken = (await projectTokensRepo.create(world.db, other.id)).token;
    expect((await ask(projectId, otherToken)).status).toBe(404);
    expect(await (await ask(other.id, otherToken)).json()).toEqual({ ok: true, receipt: null });
  });
});
