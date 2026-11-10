import { POST as askRoute, GET as statusRoute } from "@/app/api/hooks/[projectId]/approvals/route";
import { POST as decideRoute } from "@/app/api/projects/[id]/approvals/decide/route";
import { GET as overviewRoute, PUT as policyRoute } from "@/app/api/projects/[id]/approvals/route";
import { approvalAuditRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentAsk,
  approvalsOverview,
  decideRequest,
  pauseApprovals,
  setPolicy,
  undoAutomatic,
} from "./approvals";
import type { SessionUser } from "./auth";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 6a: approval policies on the server. Agents only ask; only the owner decides or changes the policy.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let pid: string;
let token: string;
let otherToken: string;

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  const other = (await projectsRepo.create(world.db, stranger.id, { name: "vault" })).id;
  token = (await projectTokensRepo.create(world.db, pid)).token;
  otherToken = (await projectTokensRepo.create(world.db, other)).token;
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const ask = (body: object, t = token, projectId = pid) =>
  askRoute(
    new Request(`http://localhost/api/hooks/${projectId}/approvals`, {
      method: "POST",
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) },
  );
const ownerCall = (
  route: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  method: string,
  body?: object,
  headers: Record<string, string> = {},
) =>
  route(
    new Request(`http://localhost/api/projects/${pid}/approvals`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: pid }) },
  );

describe("Phase 6a: approvals on the server", () => {
  it("PH6-11 an agent's request gets the policy's answer: auto, auto and tell, ask, or never", async () => {
    const r = async (action: string) =>
      (await (await ask({ action, summary: "why", agent: "claude" })).json()) as {
        status: string;
        choice: string;
      };
    expect(await r("link_test")).toMatchObject({ status: "auto", choice: "auto" });
    expect(await r("add_dependency")).toMatchObject({ status: "auto", choice: "auto_tell" });
    expect(await r("delete_feature")).toMatchObject({ status: "pending", choice: "ask" });
    await setPolicy(world.db, owner, pid, {
      policy: { preset: "balanced", rules: [{ action: "add_decision", choice: "never" }] },
    });
    expect(await r("add_decision")).toMatchObject({ status: "never", choice: "never" });
  });

  it("PH6-12 attack: an agent's token cannot read, change or decide anything on the owner's routes", async () => {
    const auth = { authorization: `Bearer ${token}` };
    expect((await ownerCall(overviewRoute, "GET", undefined, auth)).status).toBe(401);
    expect(
      (
        await ownerCall(
          policyRoute,
          "PUT",
          { policy: { preset: "fast", rules: [] }, confirm: true },
          auth,
        )
      ).status,
    ).toBe(401);
    const asked = (await (await ask({ action: "delete_feature", summary: "x" })).json()) as {
      id: string;
    };
    expect(
      (await ownerCall(decideRoute, "POST", { requestId: asked.id, decision: "approve" }, auth))
        .status,
    ).toBe(401);
    // Another project's token cannot ask for this project, nor read its requests.
    expect((await ask({ action: "link_test", summary: "x" }, otherToken)).status).toBe(404);
    const status = await statusRoute(
      new Request(`http://localhost/api/hooks/${pid}/approvals?id=${asked.id}`, {
        headers: { authorization: `Bearer ${otherToken}` },
      }),
      { params: Promise.resolve({ projectId: pid }) },
    );
    expect(status.status).toBe(404);
  });

  it("PH6-13 attack: another signed-in user gets 404; the owner decides once, and 'remember' becomes a rule", async () => {
    const asked = (await (
      await ask({ action: "delete_feature", summary: "drop old", agent: "codex" })
    ).json()) as {
      id: string;
    };
    await expect(
      decideRequest(world.db, stranger, pid, { requestId: asked.id, decision: "approve" }),
    ).rejects.toMatchObject({ status: 404 });
    world.signInAs(stranger);
    expect((await ownerCall(overviewRoute, "GET")).status).toBe(404);
    const done = await decideRequest(world.db, owner, pid, {
      requestId: asked.id,
      decision: "approve",
      remember: true,
    });
    expect(done.request.status).toBe("approved");
    await expect(
      decideRequest(world.db, owner, pid, { requestId: asked.id, decision: "reject" }),
    ).rejects.toMatchObject({ status: 409, code: "not_pending" });
    const again = (await (
      await ask({ action: "delete_feature", summary: "drop more", agent: "codex" })
    ).json()) as {
      status: string;
    };
    expect(again.status).toBe("auto");
  });

  it("PH6-14 attack: a remembered or written rule can never make a locked action automatic", async () => {
    await setPolicy(world.db, owner, pid, {
      policy: { preset: "fast", rules: [{ action: "*", choice: "auto" }] },
      confirm: true,
    });
    const asked = (await (await ask({ action: "turn_off_guard", summary: "x" })).json()) as {
      status: string;
      id: string;
    };
    expect(asked.status).toBe("pending");
    await decideRequest(world.db, owner, pid, {
      requestId: asked.id,
      decision: "approve",
      remember: true,
    });
    const next = (await (await ask({ action: "turn_off_guard", summary: "y" })).json()) as {
      status: string;
    };
    expect(next.status).toBe("pending");
  });

  it("PH6-15 loosening needs the owner's confirmation; tightening is instant; both are in the audit log", async () => {
    await expect(
      setPolicy(world.db, owner, pid, { policy: { preset: "fast", rules: [] } }),
    ).rejects.toMatchObject({ status: 409, code: "confirm_loosening" });
    await setPolicy(world.db, owner, pid, { policy: { preset: "careful", rules: [] } });
    await setPolicy(world.db, owner, pid, { policy: { preset: "fast", rules: [] }, confirm: true });
    await expect(
      setPolicy(world.db, owner, pid, { policy: { preset: "yolo" } }),
    ).rejects.toMatchObject({
      status: 400,
    });
    const audit = await approvalAuditRepo.list(world.db, pid);
    expect(audit.map((a) => [a.event, a.detail.loosened])).toEqual([
      ["policy_changed", true],
      ["policy_changed", false],
    ]);
  });

  it("PH6-16 pause asks for everything; undo works once on an automatic approval only", async () => {
    await pauseApprovals(world.db, owner, pid, { hours: 1 });
    const paused = await agentAsk(world.db, pid, { action: "link_test", summary: "x" });
    expect(paused).toMatchObject({ status: "pending" });
    await pauseApprovals(world.db, owner, pid, { hours: null });
    const auto = (await agentAsk(world.db, pid, { action: "link_test", summary: "y" })) as {
      id: string;
    };
    expect((await undoAutomatic(world.db, owner, pid, { requestId: auto.id })).request.undone).toBe(
      true,
    );
    await expect(undoAutomatic(world.db, owner, pid, { requestId: auto.id })).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    const overview = await approvalsOverview(world.db, owner, pid);
    expect(overview).toMatchObject({ ready: true });
  });

  it("PH6-17 attack: summaries are masked and one line; unknown actions are refused; before 0055 nothing is set up", async () => {
    const secret = ["sk", "_live_", "Q7xT2mK9vR4wZp8aB3dE5gH7"].join("");
    await agentAsk(world.db, pid, { action: "delete_feature", summary: `remove\nit ${secret}` });
    const overview = (await approvalsOverview(world.db, owner, pid)) as {
      pending: { summary: string }[];
    };
    expect(overview.pending[0]?.summary).not.toContain(secret);
    expect(overview.pending[0]?.summary).not.toContain("\n");
    expect((await ask({ action: "rm_rf", summary: "x" })).status).toBe(400);
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0055_approvals'`);
    resetMigrationCheckForTests();
    expect(await agentAsk(world.db, pid, { action: "link_test", summary: "x" })).toEqual({
      ready: false,
    });
    expect(await approvalsOverview(world.db, owner, pid)).toEqual({ ready: false });
  });
});
