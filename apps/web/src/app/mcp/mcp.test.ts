import { setLlmForTests } from "@/server/llm";
import { MCP_CALLS_PER_MINUTE, MCP_ERROR } from "@/server/mcp-tools";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import type { Llm } from "@brain/core";
import {
  decisionsRepo,
  featureFilesRepo,
  featuresRepo,
  filesRepo,
  projectTokensRepo,
  projectsRepo,
  symbolsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

type ToolResult = { content?: { type: string; text: string }[]; isError?: boolean };
type RpcResponse = { status: number; body: string; result?: Record<string, unknown> };

let nextId = 1;

// One JSON-RPC call to /mcp as an HTTP MCP client sends it. The answer is a one-event SSE stream (or plain JSON).
async function rpc(method: string, params: Record<string, unknown>, token: string | null) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const res = await POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  const body = await res.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  let result: Record<string, unknown> | undefined;
  try {
    result = JSON.parse(data ? data.slice(6) : body).result;
  } catch {
    result = undefined;
  }
  return { status: res.status, body, result } satisfies RpcResponse;
}

async function callTool(name: string, args: Record<string, unknown>, token: string) {
  const res = await rpc("tools/call", { name, arguments: args }, token);
  const result = res.result as ToolResult | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { ...res, text, isError: result?.isError === true };
}

// The JSON error body a tool returns ({ code, message, data }).
function errorBody(text: string): { code: number; message: string; data?: { field?: string } } {
  return JSON.parse(text);
}

let world: TestWorld;
let projectId: string;
let token: string;
let otherProjectId: string;
let otherToken: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).token;
  const other = await world.createUser({ name: "other" });
  otherProjectId = (await projectsRepo.create(world.db, other.id, { name: "secret-shop" })).id;
  otherToken = (await projectTokensRepo.create(world.db, otherProjectId)).token;
});

afterEach(async () => {
  setLlmForTests(undefined);
  vi.restoreAllMocks();
  await world.teardown();
});

// Project B's data, so a leak would show up in the response body.
async function seedOtherProject() {
  const feature = await featuresRepo.insert(world.db, otherProjectId, { name: "Vault" });
  const file = await filesRepo.insert(world.db, otherProjectId, {
    path: "src/vault/Vault.tsx",
    hash: "h",
  });
  await featureFilesRepo.link(world.db, otherProjectId, { featureId: feature.id, fileId: file.id });
  await symbolsRepo.insert(world.db, otherProjectId, {
    fileId: file.id,
    kind: "component",
    name: "VaultPanel",
    summary: "OTHER-PROJECT-SECRET summary",
  });
  await decisionsRepo.insert(world.db, otherProjectId, { title: "OTHER-PROJECT-SECRET decision" });
  await callTool(
    "save_progress",
    { projectId: otherProjectId, goal: "OTHER-PROJECT-SECRET goal", nextStep: "x" },
    otherToken,
  );
}

const READ_AND_WRITE_CALLS = (pid: string) =>
  [
    ["where_did_we_stop", { projectId: pid }],
    ["get_context_pack", { projectId: pid, feature: "Vault" }],
    ["find_similar_component", { projectId: pid, query: "VaultPanel" }],
    ["save_progress", { projectId: pid, goal: "planted", nextStep: "planted" }],
    ["add_decision", { projectId: pid, title: "planted" }],
  ] as const;

describe("/mcp remote MCP server (FEAT-011)", () => {
  it("AC-011-01 a client connects to /mcp and lists the five tools", async () => {
    const init = await rpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "claude-code", version: "1" },
      },
      token,
    );
    expect(init.status).toBe(200);
    expect((init.result?.serverInfo as { name: string }).name).toBe("project-brain");
    const list = await rpc("tools/list", {}, token);
    const names = (list.result?.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_decision",
        "find_similar_component",
        "get_context_pack",
        "save_progress",
        "where_did_we_stop",
      ].sort(),
    );
  });

  it("AC-011-02 no credentials, an unknown token or a revoked token get 401 and no tool runs", async () => {
    const info = vi.spyOn(console, "info");
    expect((await rpc("tools/list", {}, null)).status).toBe(401);
    expect(
      (
        await rpc(
          "tools/call",
          { name: "where_did_we_stop", arguments: { projectId } },
          "pb_not-a-real-token",
        )
      ).status,
    ).toBe(401);
    const created = await projectTokensRepo.create(world.db, projectId);
    await projectTokensRepo.revoke(world.db, projectId, created.row.id);
    const revoked = await rpc(
      "tools/call",
      { name: "where_did_we_stop", arguments: { projectId } },
      created.token,
    );
    expect(revoked.status).toBe(401);
    expect(revoked.body).not.toContain("PROJECT HANDOFF");
    expect(info.mock.calls.some((c) => String(c[0]).startsWith("[mcp]"))).toBe(false);
  });

  it("AC-011-03 a token for project A gets not_found and no data for every tool called with project B's id", async () => {
    await seedOtherProject();
    for (const [name, args] of READ_AND_WRITE_CALLS(otherProjectId)) {
      const res = await callTool(name, args, token);
      expect(res.isError, name).toBe(true);
      expect(errorBody(res.text), name).toEqual({ code: MCP_ERROR.notFound, message: "not_found" });
      expect(res.body, name).not.toContain("OTHER-PROJECT-SECRET");
    }
    // Nothing was written into project B: its decisions are still only its own.
    const decisions = await decisionsRepo.listNewest(world.db, otherProjectId, 50);
    expect(decisions.map((d) => d.title)).toEqual(["OTHER-PROJECT-SECRET decision"]);
  });

  it("AC-011-03 with its own project id, project A still cannot reach B's feature or components", async () => {
    await seedOtherProject();
    const pack = await callTool("get_context_pack", { projectId, feature: "Vault" }, token);
    expect(errorBody(pack.text).code).toBe(MCP_ERROR.notFound);
    const similar = await callTool(
      "find_similar_component",
      { projectId, query: "VaultPanel" },
      token,
    );
    expect(similar.isError).toBe(false);
    expect(JSON.parse(similar.text)).toEqual({ matches: [] });
  });

  it("AC-011-05 the three read tools answer under 500 ms p95 with 0 LLM calls", async () => {
    let llmCalls = 0;
    const llm: Llm = {
      async complete() {
        llmCalls++;
        return "never";
      },
    };
    setLlmForTests(llm);
    const feature = await featuresRepo.insert(world.db, projectId, { name: "Checkout" });
    for (let i = 0; i < 20; i++) {
      const file = await filesRepo.insert(world.db, projectId, {
        path: `src/checkout/Part${i}.tsx`,
        hash: `h${i}`,
      });
      await featureFilesRepo.link(world.db, projectId, { featureId: feature.id, fileId: file.id });
      await symbolsRepo.insert(world.db, projectId, {
        fileId: file.id,
        kind: "component",
        name: `CheckoutPart${i}`,
        summary: "Part of the checkout.",
      });
    }
    const p95 = (ms: number[]) =>
      [...ms].sort((a, b) => a - b)[Math.ceil(ms.length * 0.95) - 1] ?? 0;
    const calls: [string, Record<string, unknown>][] = [
      ["where_did_we_stop", { projectId }],
      ["get_context_pack", { projectId, feature: "Checkout" }],
      ["find_similar_component", { projectId, query: "CheckoutPart" }],
    ];
    for (const [name, args] of calls) {
      const ms: number[] = [];
      for (let i = 0; i < 40; i++) {
        const started = performance.now();
        const res = await callTool(name, args, token);
        ms.push(performance.now() - started);
        expect(res.isError, name).toBe(false);
      }
      console.log(`[perf] ${name} p95=${p95(ms).toFixed(1)}ms`);
      expect(p95(ms), name).toBeLessThan(500);
    }
    expect(llmCalls).toBe(0);
  }, 120_000);

  it("AC-011-05 a token past the per-minute call limit gets rate_limited (-32005) and the write does not happen", async () => {
    for (let i = 0; i < MCP_CALLS_PER_MINUTE; i++) {
      const ok = await callTool("where_did_we_stop", { projectId }, token);
      expect(ok.isError).toBe(false);
    }
    const limited = await callTool("add_decision", { projectId, title: "over the limit" }, token);
    expect(errorBody(limited.text)).toEqual({
      code: MCP_ERROR.rateLimited,
      message: "rate_limited",
      data: { retry_after_s: 60 },
    });
    expect(await decisionsRepo.listNewest(world.db, projectId, 5)).toEqual([]);
  }, 120_000);

  it("AC-011-06 invalid arguments return a validation error naming the field", async () => {
    const emptyGoal = await callTool(
      "save_progress",
      { projectId, goal: "  ", nextStep: "x" },
      token,
    );
    expect(emptyGoal.isError).toBe(true);
    expect(errorBody(emptyGoal.text)).toMatchObject({
      code: MCP_ERROR.invalidParams,
      data: { field: "goal" },
    });
    const emptyFeature = await callTool("get_context_pack", { projectId, feature: "" }, token);
    expect(errorBody(emptyFeature.text)).toMatchObject({
      code: MCP_ERROR.invalidParams,
      data: { field: "feature" },
    });
    // A missing or wrongly typed field is rejected by the tool's schema before the tool runs; the message names it.
    const missing = await callTool("save_progress", { projectId, goal: "g" }, token);
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("nextStep");
    const wrongType = await callTool("where_did_we_stop", { projectId: 42 }, token);
    expect(wrongType.isError).toBe(true);
    expect(wrongType.text).toContain("projectId");
  });
});
