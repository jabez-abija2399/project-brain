import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import {
  accountRepo,
  adminAuditRepo,
  adminRepo,
  aiUsageRepo,
  decisionsRepo,
  deviceCodesRepo,
  featuresRepo,
  githubRepo,
  lastDays,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
  usersRepo,
  waitlistRepo,
} from "./index";

// Account and admin (2026-11-01): connected computers, signing out everywhere, the data export, deleting an account,
// suspension, AI usage and the append-only audit log. Every read is scoped by the owner.
describe("account and admin repos", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
  });
  afterEach(async () => {
    await pg.close();
  });

  async function user(name: string) {
    return usersRepo.upsertById(db, { id: `u-${name}`, name, email: `${name}@example.com` });
  }
  const count = async (table: string, where = "true") =>
    Number(
      (await pg.query<{ n: number }>(`select count(*)::int as n from "${table}" where ${where}`))
        .rows[0]?.n,
    );

  it("connected computers: every token on the user's own projects with its label, never the hash", async () => {
    const ada = await user("ada");
    const eve = await user("eve");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    const theirs = await projectsRepo.create(db, eve.id, { name: "theirs" });
    await projectTokensRepo.create(db, p.id, "salon-booking");
    await projectTokensRepo.create(db, theirs.id, "eve-laptop");
    const list = await accountRepo.connectedComputers(db, ada.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      projectId: p.id,
      projectName: "salon",
      label: "salon-booking",
    });
    expect(JSON.stringify(list)).not.toMatch(/hash|pb_/);
  });

  it("a device approval labels the token with the repo folder it came from", async () => {
    const ada = await user("ada");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    const now = new Date();
    const started = await deviceCodesRepo.create(
      db,
      {
        deviceCodeHash: "h".repeat(64),
        userCode: "BCDF-GHJK",
        suggestedName: "salon-booking",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );
    expect(started).toBeTruthy();
    expect(
      await deviceCodesRepo.decide(db, "BCDF-GHJK", { userId: ada.id, projectId: p.id }, now),
    ).toBe(true);
    const polled = await deviceCodesRepo.poll(db, "h".repeat(64), now, 0);
    expect(polled.status).toBe("approved");
    expect((await accountRepo.connectedComputers(db, ada.id))[0]?.label).toBe("salon-booking");
  });

  it("signing out everywhere ends every session of that user only", async () => {
    const ada = await user("ada");
    const eve = await user("eve");
    for (const [id, u] of [
      ["s1", ada.id],
      ["s2", ada.id],
      ["s3", eve.id],
    ]) {
      await pg.query(
        `insert into "session" (id, "userId", token, "expiresAt") values ($1, $2, $1, now() + interval '1 day')`,
        [id, u],
      );
    }
    expect(await accountRepo.endAllSessions(db, ada.id)).toBe(2);
    expect(await count("session")).toBe(1);
  });

  it("the export holds projects, features, requests, receipts and decisions, and never tokens or hashes", async () => {
    const ada = await user("ada");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    const f = await featuresRepo.insert(db, p.id, { name: "Reviews", key: "reviews" });
    const { request } = await requestsRepo.createWithItems(
      db,
      p.id,
      { featureId: f.id, text: "Add reviews" },
      [{ text: "List", needsClarification: false }],
    );
    await receiptsRepo.insert(db, p.id, { requestId: request.id, summaryJson: { items: [] } });
    await decisionsRepo.insert(db, p.id, { title: "Use Supabase", reason: "speed" });
    const { token } = await projectTokensRepo.create(db, p.id, "laptop");
    const other = await user("eve");
    await projectsRepo.create(db, other.id, { name: "not-mine" });

    const data = await accountRepo.exportData(db, ada.id);
    expect(data.user?.email).toBe("ada@example.com");
    expect(data.projects.map((x) => x.name)).toEqual(["salon"]);
    const [proj] = data.projects;
    expect(proj?.features.map((x) => x.name)).toEqual(["Reviews"]);
    expect(proj?.requests.map((x) => x.text)).toEqual(["Add reviews"]);
    expect(proj?.checklistItems.map((x) => x.text)).toEqual(["List"]);
    expect(proj?.receipts).toHaveLength(1);
    expect(proj?.decisions.map((x) => x.title)).toEqual(["Use Supabase"]);
    const json = JSON.stringify(data);
    expect(json).not.toContain(token);
    expect(json).not.toMatch(/"hash"|tokens|"label"|not-mine/);
  });

  it("deleting an account removes the user, their projects and every row under them, and their waitlist entry", async () => {
    const ada = await user("ada");
    const eve = await user("eve");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    const keep = await projectsRepo.create(db, eve.id, { name: "keep" });
    await featuresRepo.insert(db, p.id, { name: "Reviews", key: "reviews" });
    await receiptsRepo.insert(db, p.id, { requestId: null, summaryJson: {} });
    await receiptsRepo.insert(db, keep.id, { requestId: null, summaryJson: {} });
    await projectTokensRepo.create(db, p.id, null);
    await aiUsageRepo.add(db, p.id, new Date(), 3);
    await waitlistRepo.add(db, "ADA@example.com".toLowerCase());
    await waitlistRepo.add(db, "other@example.com");
    await pg.query(
      `insert into "session" (id, "userId", token, "expiresAt") values ('s1', $1, 's1', now() + interval '1 day')`,
      [ada.id],
    );
    await pg.query(
      `insert into "account" (id, "userId", "accountId", "providerId") values ('a1', $1, '1', 'github')`,
      [ada.id],
    );

    expect(await accountRepo.deleteAccount(db, ada.id)).toEqual({ deleted: true });
    expect(await count("user", `id = '${ada.id}'`)).toBe(0);
    for (const t of ["projects", "features", "project_tokens", "ai_usage_daily"]) {
      expect([t, await count(t, `${t === "projects" ? "id" : "project_id"} = '${p.id}'`)]).toEqual([
        t,
        0,
      ]);
    }
    expect(await count("session", `"userId" = '${ada.id}'`)).toBe(0);
    expect(await count("account", `"userId" = '${ada.id}'`)).toBe(0);
    expect(await count("waitlist")).toBe(1);
    // Another user's data is untouched.
    expect(await count("receipts", `project_id = '${keep.id}'`)).toBe(1);
    expect(await accountRepo.deleteAccount(db, ada.id)).toEqual({ deleted: false });
  });

  it("suspension: users and projects can be suspended and unsuspended; the owner check scopes projects", async () => {
    const ada = await user("ada");
    const eve = await user("eve");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    const theirs = await projectsRepo.create(db, eve.id, { name: "theirs" });
    expect(await adminRepo.setProjectSuspended(db, p.id, true)).toBe(true);
    expect(await adminRepo.setProjectSuspended(db, theirs.id, true)).toBe(true);
    expect(await accountRepo.suspension(db, ada.id, [p.id, theirs.id])).toEqual({
      user: false,
      projects: [p.id],
    });
    await adminRepo.setUserSuspended(db, ada.id, true);
    expect((await accountRepo.suspension(db, ada.id)).user).toBe(true);
    await adminRepo.setUserSuspended(db, ada.id, false);
    await adminRepo.setProjectSuspended(db, p.id, false);
    expect(await accountRepo.suspension(db, ada.id, [p.id])).toEqual({ user: false, projects: [] });
    expect(await adminRepo.setUserSuspended(db, "missing", true)).toBe(false);
  });

  it("admin overview counts users, projects, waitlist, receipts per day for 30 days and active projects", async () => {
    const ada = await user("ada");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    const q = await projectsRepo.create(db, ada.id, { name: "quiet" });
    await receiptsRepo.insert(db, p.id, { requestId: null, summaryJson: {} });
    const old = await receiptsRepo.insert(db, q.id, { requestId: null, summaryJson: {} });
    await pg.query(`update receipts set created_at = now() - interval '10 days' where id = $1`, [
      old.id,
    ]);
    await waitlistRepo.add(db, "w@example.com");
    const now = new Date();
    const o = await adminRepo.overview(db, now);
    expect(o).toMatchObject({ users: 1, projects: 2, waitlist: 1, activeProjects7d: 1 });
    expect(o.receiptsPerDay).toHaveLength(30);
    expect(o.receiptsPerDay.at(-1)).toEqual({ day: now.toISOString().slice(0, 10), receipts: 1 });
    expect(o.receiptsPerDay.reduce((n, d) => n + d.receipts, 0)).toBe(2);
    expect(lastDays(new Date("2026-11-01T12:00:00Z"), 3)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("admin users list: counts, last activity, and a search that treats % and _ as plain text", async () => {
    const ada = await user("ada");
    await user("bob_smith");
    await user("bobXsmith");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    await receiptsRepo.insert(db, p.id, { requestId: null, summaryJson: {} });
    const all = await adminRepo.listUsers(db);
    expect(all.total).toBe(3);
    const a = all.rows.find((r) => r.id === ada.id);
    expect(a).toMatchObject({ projects: 1, receipts: 1 });
    expect(a?.lastActivity).toBeInstanceOf(Date);
    const found = await adminRepo.listUsers(db, { search: "bob_" });
    expect(found.rows.map((r) => r.name)).toEqual(["bob_smith"]);
    expect((await adminRepo.listUsers(db, { search: "%" })).total).toBe(0);
    const detail = await adminRepo.userDetail(db, ada.id);
    expect(detail?.projects).toMatchObject([{ name: "salon", receipts: 1 }]);
    expect(JSON.stringify(detail)).not.toContain("summary");
  });

  it("AI usage is kept per project per day (beyond the two-day counters), never below zero", async () => {
    const ada = await user("ada");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    const now = new Date();
    await aiUsageRepo.add(db, p.id, now, 5);
    await aiUsageRepo.add(db, p.id, now, 2);
    await aiUsageRepo.add(db, p.id, now, -1);
    const usage = await adminRepo.aiUsage(db, now);
    expect(usage.range).toHaveLength(30);
    expect(usage.rows).toEqual([
      { projectId: p.id, projectName: "salon", day: now.toISOString().slice(0, 10), calls: 6 },
    ]);
    await aiUsageRepo.add(db, p.id, now, -50);
    expect((await adminRepo.aiUsage(db, now)).rows[0]?.calls).toBe(0);
  });

  it("attack: the audit log is append-only; the database refuses UPDATE and DELETE", async () => {
    await adminAuditRepo.record(db, {
      adminUserId: "u-ada",
      adminLogin: "ada",
      action: "suspend_user",
      targetType: "user",
      targetId: "u-eve",
    });
    const [entry] = await adminAuditRepo.list(db);
    expect(entry).toMatchObject({ adminLogin: "ada", action: "suspend_user", targetId: "u-eve" });
    await expect(pg.query(`update admin_audit set action = 'nothing'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(pg.query("delete from admin_audit")).rejects.toThrow(/append-only/);
    expect(await count("admin_audit")).toBe(1);
  });

  it("attack: a push webhook skips a suspended project and every project of a suspended user", async () => {
    const ada = await user("ada");
    const p = await projectsRepo.create(db, ada.id, { name: "salon" });
    await githubRepo.linkProject(db, p.id, ada.id, 42, "acme/app");
    expect(await githubRepo.linkedProjects(db, 42, "acme/app")).toEqual([{ id: p.id }]);
    await adminRepo.setProjectSuspended(db, p.id, true);
    expect(await githubRepo.linkedProjects(db, 42, "acme/app")).toEqual([]);
    await adminRepo.setProjectSuspended(db, p.id, false);
    await adminRepo.setUserSuspended(db, ada.id, true);
    expect(await githubRepo.linkedProjects(db, 42, "acme/app")).toEqual([]);
  });

  it("suspending writes its audit row in the same transaction; an unknown target writes nothing", async () => {
    const ada = await user("ada");
    const audit = {
      adminUserId: "u-x",
      adminLogin: "x",
      action: "suspend_user",
      targetType: "user",
      targetId: ada.id,
    };
    expect(
      await adminRepo.setSuspendedAudited(db, {
        targetType: "user",
        targetId: ada.id,
        suspended: true,
        audit,
      }),
    ).toBe(true);
    expect(
      await adminRepo.setSuspendedAudited(db, {
        targetType: "user",
        targetId: "missing",
        suspended: true,
        audit: { ...audit, targetId: "missing" },
      }),
    ).toBe(false);
    expect((await adminAuditRepo.list(db)).map((r) => r.targetId)).toEqual([ada.id]);
  });
});
