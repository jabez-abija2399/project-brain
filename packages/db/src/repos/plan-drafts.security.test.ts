// FEAT-019 security pass (independent review): repository-level attacks on plan drafts and approval.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import { featuresRepo, planDraftsRepo, projectsRepo, usersRepo } from "./index";

const items = [
  { text: "A member books a class", kind: "happy" },
  { text: "Booking a full class is refused", kind: "negative" },
  { text: "A stranger cannot cancel a booking", kind: "permission" },
];
const HASH = "b".repeat(64);

describe("FEAT-019 plan drafts repository security", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  let a: string;
  let b: string;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    await usersRepo.upsertById(db, { id: "u2", name: "u2", email: "u2@example.com" });
    a = (await projectsRepo.create(db, "u1", { name: "A" })).id;
    b = (await projectsRepo.create(db, "u2", { name: "B" })).id;
  });
  afterEach(async () => {
    await pg.close();
  });

  async function draftIn(projectId: string, names: string[]) {
    const q = await planDraftsRepo.saveQuestions(db, projectId, {
      ideaText: "idea",
      questions: { restated: ["r"], questions: [] },
      createdBy: "tok",
    });
    const d = await planDraftsRepo.saveDraft(db, projectId, q.id, {
      answers: {},
      hash: HASH,
      draft: {
        restated: ["r"],
        features: names.map((name) => ({ name, existing: false, depends_on: [], items })),
      },
    });
    if (!d) throw new Error("draft not saved");
    return d;
  }

  it("AC-019-04 permission: another project's question set or draft cannot be drafted or approved through project A", async () => {
    const qB = await planDraftsRepo.saveQuestions(db, b, {
      ideaText: "B idea",
      questions: { restated: ["r"], questions: [] },
      createdBy: "tokB",
    });
    expect(await planDraftsRepo.byId(db, a, qB.id)).toBeNull();
    const stolen = await planDraftsRepo.saveDraft(db, a, qB.id, {
      answers: {},
      hash: HASH,
      draft: { restated: ["r"], features: [{ name: "X", existing: false, depends_on: [], items }] },
    });
    expect(stolen).toBeNull();
    expect((await planDraftsRepo.byId(db, b, qB.id))?.status).toBe("questions");

    const dB = await draftIn(b, ["Payments"]);
    expect(await planDraftsRepo.approve(db, a, dB.id, HASH, "u1", new Date(0))).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect((await featuresRepo.listSummaries(db, a, 10)).total).toBe(0);
    expect((await featuresRepo.listSummaries(db, b, 10)).total).toBe(0);
    expect((await planDraftsRepo.byId(db, b, dB.id))?.status).toBe("draft");
  });

  it("AC-019-04 attack: a replayed approval or a wrong hash creates no feature twice", async () => {
    const d = await draftIn(a, ["Accounts", "Bookings"]);
    expect((await planDraftsRepo.approve(db, a, d.id, "c".repeat(64), "u1", new Date(0))).ok).toBe(
      false,
    );
    expect((await planDraftsRepo.approve(db, a, d.id, HASH, "u1", new Date(0))).ok).toBe(true);
    expect(await planDraftsRepo.approve(db, a, d.id, HASH, "u1", new Date(0))).toEqual({
      ok: false,
      reason: "changed",
    });
    expect((await featuresRepo.listSummaries(db, a, 10)).total).toBe(2);
  });

  it("AC-019-06 attack: a feature indexed between drafting and approval under another letter case is not created a second time", async () => {
    const d = await draftIn(a, ["Accounts", "Bookings"]);
    // The re-index (attacker-influenced code) adds "accounts" before the owner approves.
    await featuresRepo.insert(db, a, { name: "accounts", key: "accounts" });
    const result = await planDraftsRepo.approve(db, a, d.id, HASH, "u1", new Date(0));
    expect(result.ok).toBe(true);
    const names = (await featuresRepo.list(db, a)).map((f) => f.name.toLowerCase());
    // The planner treats names case-insensitively as the same feature; approval must too.
    expect(names.filter((n) => n === "accounts")).toHaveLength(1);
  });
});
