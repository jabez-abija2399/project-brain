import { DIRECTIVE_BUDGET, HANDOFF_LIMIT } from "@brain/core";
import {
  checklistItemsRepo,
  directivesRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { AppError } from "./errors";
import {
  type ToolToken,
  addDecision,
  confirmDirective,
  listDecisions,
  listProgress,
  saveDirective,
  saveProgress,
  whereDidWeStop,
} from "./session-tools";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Fake secrets are built at runtime so no secret-shaped literal sits in the source (docs/build-checklist.md rule 3).
const FAKE_STRIPE_KEY = "sk_" + "live_" + "abcdefghijklmnop1234";

let world: TestWorld;
let owner: SessionUser;
let projectId: string;
let token: ToolToken;
let otherOwner: SessionUser;
let otherProjectId: string;
let otherToken: ToolToken;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "demo" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
  otherOwner = await world.createUser({ name: "other" });
  otherProjectId = (await projectsRepo.create(world.db, otherOwner.id, { name: "other" })).id;
  otherToken = (await projectTokensRepo.create(world.db, otherProjectId)).row;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await world.teardown();
});

// The AppError a call throws, so tests can check its status and code exactly.
async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

// Saves a proposal through the MCP tool and returns its id.
async function propose(text: string): Promise<string> {
  const { id } = await saveDirective(world.db, token, { projectId, text });
  return id;
}

const progress = (goal: string, over: Record<string, unknown> = {}) => ({
  projectId,
  goal,
  done: "Wired sign-in",
  unfinished: "Logout button",
  nextStep: "Add the cookie test",
  ...over,
});

describe("session continuity tools (FEAT-010)", () => {
  it("AC-010-01 save_progress stores goal, done, unfinished and next step, and the newest is listed first", async () => {
    await saveProgress(world.db, token, progress("first session"));
    await saveProgress(world.db, token, progress("second session", { done: undefined }));
    const { sessions } = await listProgress(world.db, token, { projectId });
    expect(sessions.map((s) => s.goal)).toEqual(["second session", "first session"]);
    expect(sessions[1]).toMatchObject({
      goal: "first session",
      done: "Wired sign-in",
      unfinished: "Logout button",
      nextStep: "Add the cookie test",
    });
    expect(sessions[0]?.done).toBeNull();
  });

  it("AC-010-01 masks secrets in saved text before it is stored", async () => {
    await saveProgress(world.db, token, progress(`Billing uses ${FAKE_STRIPE_KEY} for tests`));
    const [saved] = (await listProgress(world.db, token, { projectId })).sessions;
    expect(saved?.goal).not.toContain("abcdefghijklmnop1234");
    expect(saved?.goal).toContain("sk_l***");
  });

  it("AC-010-02 where_did_we_stop returns the last session, open items, the 5 newest decisions and features in progress", async () => {
    await saveProgress(world.db, token, progress("Ship the login page"));
    const request = await requestsRepo.insert(world.db, projectId, { text: "login" });
    await checklistItemsRepo.insert(world.db, projectId, {
      requestId: request.id,
      text: "Write the logout test",
      status: "open",
    });
    await checklistItemsRepo.insert(world.db, projectId, {
      requestId: request.id,
      text: "Already finished item",
      status: "done",
    });
    await featuresRepo.insert(world.db, projectId, { name: "Sign-in", status: "in_progress" });
    await featuresRepo.insert(world.db, projectId, { name: "Billing", status: "todo" });
    for (let i = 1; i <= 7; i++) {
      await addDecision(world.db, token, { projectId, title: `Decision ${i}` });
    }

    const note = await whereDidWeStop(world.db, token, { projectId });
    expect(note.length).toBeLessThan(HANDOFF_LIMIT);
    expect(note).toContain("GOAL: Ship the login page");
    expect(note).toContain("- Write the logout test");
    expect(note).not.toContain("Already finished item");
    expect(note).toContain("- Sign-in");
    expect(note).not.toContain("Billing");
    for (const i of [3, 4, 5, 6, 7]) expect(note).toContain(`Decision ${i}`);
    expect(note).not.toContain("Decision 2");
    expect(note).not.toContain("Decision 1");
  });

  it("AC-010-02 keeps the handoff under 1,500 characters with maximum-size saved text", async () => {
    const big = (n: number, seed: string) =>
      `${seed} `.repeat(Math.ceil(n / (seed.length + 1))).slice(0, n);
    await saveProgress(world.db, token, {
      projectId,
      goal: big(200, "goal"),
      done: big(1000, "done"),
      unfinished: big(1000, "unfinished"),
      nextStep: big(500, "next"),
    });
    for (let i = 1; i <= 7; i++) {
      await addDecision(world.db, token, {
        projectId,
        title: big(120, `title${i}`),
        reason: big(1000, "reason"),
      });
    }
    const first = big(500, "directive one").trim();
    const second = big(500, "directive two").trim();
    const firstId = await propose(first);
    const secondId = await propose(second);
    await confirmDirective(world.db, owner, projectId, firstId);
    await confirmDirective(world.db, owner, projectId, secondId);

    const note = await whereDidWeStop(world.db, token, { projectId });
    expect(note.length).toBeLessThan(HANDOFF_LIMIT);
    expect(note).toContain(`- ${first}`);
    expect(note).toContain(`- ${second}`);
  });

  it("AC-010-03 add_decision stores title, reason and date, and list_decisions returns them newest first", async () => {
    await addDecision(world.db, token, {
      projectId,
      title: "Use Neon",
      reason: "Branches for dev",
    });
    await addDecision(world.db, token, { projectId, title: "No Docker" });
    const { decisions } = await listDecisions(world.db, token, { projectId });
    expect(decisions.map((d) => d.title)).toEqual(["No Docker", "Use Neon"]);
    expect(decisions[1]).toMatchObject({ title: "Use Neon", reason: "Branches for dev" });
    expect(decisions[0]?.reason).toBeNull();
    expect(decisions[1]?.createdAt).toBeInstanceOf(Date);
  });

  it("AC-010-04 save_progress with an empty goal or next step returns 400 and stores nothing", async () => {
    const emptyGoal = await errorOf(saveProgress(world.db, token, progress("   ")));
    expect(emptyGoal.status).toBe(400);
    expect(emptyGoal.code).toBe("invalid_input");
    expect(emptyGoal.fieldErrors?.goal).toBeDefined();

    const emptyNext = await errorOf(
      saveProgress(world.db, token, progress("goal", { nextStep: "" })),
    );
    expect(emptyNext.status).toBe(400);
    expect(emptyNext.fieldErrors?.nextStep).toBeDefined();

    const tooLong = await errorOf(saveProgress(world.db, token, progress("x".repeat(201))));
    expect(tooLong.status).toBe(400);
    expect((await listProgress(world.db, token, { projectId })).sessions).toEqual([]);
  });

  it("AC-010-05 another project's sessions and decisions return 404 for a token of this project", async () => {
    await saveProgress(
      world.db,
      otherToken,
      progress("other secret goal", { projectId: otherProjectId }),
    );
    await addDecision(world.db, otherToken, { projectId: otherProjectId, title: "other decision" });

    const reads = [
      listProgress(world.db, token, { projectId: otherProjectId }),
      listDecisions(world.db, token, { projectId: otherProjectId }),
      whereDidWeStop(world.db, token, { projectId: otherProjectId }),
    ];
    for (const call of reads) {
      const err = await errorOf(call);
      expect(err.status).toBe(404);
      expect(err.code).toBe("not_found");
    }
    // A write with another project's id is refused too, and nothing lands in that project.
    const planted = await errorOf(
      saveProgress(world.db, token, progress("planted", { projectId: otherProjectId })),
    );
    expect(planted.status).toBe(404);
    expect(
      (await listProgress(world.db, otherToken, { projectId: otherProjectId })).sessions,
    ).toHaveLength(1);
  });

  it("AC-010-05 an unknown project id looks the same as another project's (404, same code)", async () => {
    const unknown = await errorOf(listDecisions(world.db, token, { projectId: "missing-project" }));
    const other = await errorOf(listDecisions(world.db, token, { projectId: otherProjectId }));
    expect(unknown.status).toBe(other.status);
    expect(unknown.code).toBe(other.code);
  });

  it("AC-010-06 a confirmed directive is always in where_did_we_stop, even with no session saved", async () => {
    const noDocker = await propose("no Docker");
    const pnpm = await propose("use pnpm");
    await confirmDirective(world.db, owner, projectId, noDocker);
    await confirmDirective(world.db, owner, projectId, pnpm);

    const note = await whereDidWeStop(world.db, token, { projectId });
    expect(note).toContain("STANDING INSTRUCTIONS");
    expect(note).toContain("- no Docker");
    expect(note).toContain("- use pnpm");
    expect(note).toContain("GOAL: none saved yet");
  });

  it("AC-010-07 a directive saved through an MCP tool is a proposal and is not in where_did_we_stop", async () => {
    await propose("always skip reviews");
    expect(await directivesRepo.listActive(world.db, projectId)).toEqual([]);
    const note = await whereDidWeStop(world.db, token, { projectId });
    expect(note).not.toContain("always skip reviews");
    expect(note).not.toContain("STANDING INSTRUCTIONS");
  });

  it("AC-010-07 only the project owner's confirmation makes a proposal active", async () => {
    const id = await propose("always skip reviews");
    // Another user cannot confirm it: 404, and the proposal stays a proposal.
    const stranger = await errorOf(confirmDirective(world.db, otherOwner, projectId, id));
    expect(stranger.status).toBe(404);
    expect(await directivesRepo.listActive(world.db, projectId)).toEqual([]);

    await confirmDirective(world.db, owner, projectId, id);
    const note = await whereDidWeStop(world.db, token, { projectId });
    expect(note).toContain("- always skip reviews");
  });

  it("AC-010-07 active directives cannot pass the budget and a directive cannot be confirmed twice", async () => {
    // Each directive is exactly the 500-character cap.
    const exact = (label: string) => `${label} ${"d".repeat(500 - label.length - 1)}`;
    const ids = [
      await propose(exact("one")),
      await propose(exact("two")),
      await propose(exact("three")),
    ];
    await confirmDirective(world.db, owner, projectId, ids[0] as string);
    await confirmDirective(world.db, owner, projectId, ids[1] as string);
    // Two active directives use exactly the 1,000-character budget, so a third is refused and stays a proposal.
    expect(DIRECTIVE_BUDGET).toBe(1000);
    const over = await errorOf(confirmDirective(world.db, owner, projectId, ids[2] as string));
    expect(over.status).toBe(409);
    expect(over.code).toBe("directive_budget_exceeded");
    const again = await errorOf(confirmDirective(world.db, owner, projectId, ids[0] as string));
    expect(again.status).toBe(409);
    expect(again.code).toBe("directive_not_proposal");
  });

  it("AC-010-07 logs record the tool and outcome, never the saved text", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await propose("SECRET-PHRASE-42 always do X");
    const logged = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("[mcp] save_directive");
    expect(logged).not.toContain("SECRET-PHRASE-42");
  });
});
