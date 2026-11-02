import { createHash } from "node:crypto";
// The consent step of MCP OAuth: GET /oauth/authorize (the view) and POST /oauth/consent (Allow or Deny).
import { POST as consentRoute } from "@/app/oauth/consent/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { oauthCodes, oauthGrants, projectsRepo, users } from "@brain/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import {
  type ConsentFields,
  authorizePathFor,
  authorizeView,
  consentCsrf,
  decideConsent,
  registerClient,
} from "./mcp-oauth";
import {
  ORIGIN,
  REDIRECT,
  RESOURCE,
  formRequest,
  jsonRequest,
  pkce,
  useLocalOrigin,
} from "./mcp-oauth-test-helpers";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let shopId: string;
let strangersId: string;
let clientId: string;
const NOW = new Date("2026-11-02T10:00:00Z");

useLocalOrigin();

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "Owner" });
  stranger = await world.createUser({ name: "Stranger" });
  shopId = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
  strangersId = (await projectsRepo.create(world.db, stranger.id, { name: "Their vault" })).id;
  const reg = await registerClient(
    world.db,
    jsonRequest(`${ORIGIN}/oauth/register`, { client_name: "VS Code", redirect_uris: [REDIRECT] }),
    NOW,
  );
  clientId = (reg.body as { client_id: string }).client_id;
});
afterEach(async () => {
  await world.teardown();
});

function query(over: Record<string, string | undefined> = {}) {
  const { challenge } = pkce();
  const base: Record<string, string | undefined> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: "state-abc",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    project_id: shopId,
  };
  return { ...base, ...over };
}

describe("GET /oauth/authorize: the consent view", () => {
  it("names the project and the client, says what it can read and do, and carries a CSRF value", async () => {
    const view = await authorizeView(world.db, owner, ORIGIN, query());
    expect(view.kind).toBe("consent");
    if (view.kind !== "consent") return;
    expect(view.project).toEqual({ id: shopId, name: "Shop" });
    expect(view.client).toMatchObject({ name: "VS Code", host: "localhost:33418" });
    expect(view.csrf.length).toBeGreaterThan(20);
  });

  it("without a project, offers only the signed-in user's own projects to pick from", async () => {
    const view = await authorizeView(world.db, owner, ORIGIN, query({ project_id: undefined }));
    expect(view.kind).toBe("pick");
    if (view.kind !== "pick") return;
    expect(view.projects.map((p) => p.name)).toEqual(["Shop"]);
  });

  it("attack: a project of another user is reported exactly like a project that does not exist", async () => {
    const theirs = await authorizeView(world.db, owner, ORIGIN, query({ project_id: strangersId }));
    const missing = await authorizeView(
      world.db,
      owner,
      ORIGIN,
      query({ project_id: "no-such-id" }),
    );
    expect(theirs.kind).toBe("error");
    expect(missing.kind).toBe("error");
    if (theirs.kind === "error" && missing.kind === "error") {
      expect(theirs.message).toBe(missing.message);
    }
  });

  it("attack: a redirect URI that was not registered gets an error page, never a redirect", async () => {
    const view = await authorizeView(
      world.db,
      owner,
      ORIGIN,
      query({ redirect_uri: "https://attacker.example/steal" }),
    );
    expect(view.kind).toBe("error");
  });

  it("attack: a plain (non-S256) PKCE method, a missing challenge or a missing state is refused", async () => {
    for (const over of [
      { code_challenge_method: "plain" },
      { code_challenge: undefined },
      { code_challenge: "short" },
      { state: undefined },
      { response_type: "token" },
    ]) {
      const view = await authorizeView(world.db, owner, ORIGIN, query(over));
      expect(view.kind, JSON.stringify(over)).toBe("error");
    }
  });

  it("attack: a token asked for another resource (not this server's /mcp) is refused", async () => {
    const view = await authorizeView(
      world.db,
      owner,
      ORIGIN,
      query({ resource: "https://other.example/mcp" }),
    );
    expect(view.kind).toBe("error");
  });

  it("an unknown client id is refused", async () => {
    expect((await authorizeView(world.db, owner, ORIGIN, query({ client_id: "nope" }))).kind).toBe(
      "error",
    );
  });

  it("a suspended owner gets no consent view and cannot allow one", async () => {
    await world.db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, owner.id));
    const view = await authorizeView(world.db, owner, ORIGIN, query());
    expect(view.kind).toBe("error");
    world.signInAs(owner);
    const fields: ConsentFields = {
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: "s",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
      resource: RESOURCE,
      project_id: shopId,
    };
    const req = jsonRequest(
      `${ORIGIN}/oauth/consent`,
      { decision: "allow", ...fields, csrf: consentCsrf(owner.id, fields) },
      { origin: ORIGIN },
    );
    await expect(decideConsent(world.db, req, NOW)).rejects.toMatchObject({ status: 403 });
    expect(await world.db.select().from(oauthGrants)).toHaveLength(0);
  });

  it("the return path for the sign-in page carries only the authorization parameters", () => {
    const path = authorizePathFor({ ...query(), junk: "x" });
    expect(path.startsWith("/oauth/authorize?")).toBe(true);
    expect(path).not.toContain("junk");
    expect(new URLSearchParams(path.split("?")[1]).get("client_id")).toBe(clientId);
  });
});

describe("POST /oauth/consent: Allow and Deny", () => {
  async function decision(
    over: Record<string, unknown> = {},
    opts: { csrf?: string; origin?: string } = {},
  ) {
    const view = await authorizeView(world.db, owner, ORIGIN, query());
    if (view.kind !== "consent") throw new Error("no consent view");
    const headers: Record<string, string> = {};
    if (opts.origin !== undefined) headers.origin = opts.origin;
    return jsonRequest(
      `${ORIGIN}/oauth/consent`,
      { decision: "allow", ...view.params, csrf: opts.csrf ?? view.csrf, ...over },
      headers,
    );
  }

  it("Allow creates a grant for this user and ONE project, and returns a code to the registered redirect", async () => {
    world.signInAs(owner);
    const result = await decideConsent(world.db, await decision({}, { origin: ORIGIN }), NOW);
    expect("redirect" in result).toBe(true);
    if (!("redirect" in result)) return;
    const url = new URL(result.redirect);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("code")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe("state-abc");
    const grants = await world.db.select().from(oauthGrants);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ projectId: shopId, userId: owner.id, resource: RESOURCE });
  });

  it("stores only the hash of the code, expiring 60 seconds after it was issued", async () => {
    world.signInAs(owner);
    const result = await decideConsent(world.db, await decision({}, { origin: ORIGIN }), NOW);
    if (!("redirect" in result)) throw new Error("not allowed");
    const code = new URL(result.redirect).searchParams.get("code") ?? "";
    const rows = await world.db.select().from(oauthCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.expiresAt.getTime()).toBe(NOW.getTime() + 60_000);
  });

  it("Deny returns access_denied to the redirect, keeps the state, and creates no grant", async () => {
    world.signInAs(owner);
    const result = await decideConsent(
      world.db,
      await decision({ decision: "deny" }, { origin: ORIGIN }),
      NOW,
    );
    if (!("redirect" in result)) throw new Error("no redirect");
    const url = new URL(result.redirect);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("code")).toBeNull();
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(await world.db.select().from(oauthGrants)).toHaveLength(0);
  });

  it("attack: a forged or missing CSRF value is refused with 403 and nothing is granted", async () => {
    world.signInAs(owner);
    for (const csrf of ["forged", ""]) {
      await expect(
        decideConsent(world.db, await decision({}, { csrf, origin: ORIGIN }), NOW),
      ).rejects.toMatchObject({
        status: 403,
      });
    }
    expect(await world.db.select().from(oauthGrants)).toHaveLength(0);
  });

  it("attack: a CSRF value made for another user does not work for this user", async () => {
    const mine = await authorizeView(world.db, owner, ORIGIN, query());
    if (mine.kind !== "consent") throw new Error("no consent");
    expect(mine.csrf).not.toBe(consentCsrf(stranger.id, mine.params));
    world.signInAs(owner);
    await expect(
      decideConsent(
        world.db,
        await decision({ csrf: consentCsrf(stranger.id, mine.params) }, { origin: ORIGIN }),
        NOW,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("attack: changing the project after the view invalidates the CSRF value", async () => {
    world.signInAs(owner);
    const view = await authorizeView(world.db, owner, ORIGIN, query());
    if (view.kind !== "consent") throw new Error("no consent");
    await expect(
      decideConsent(
        world.db,
        jsonRequest(
          `${ORIGIN}/oauth/consent`,
          { decision: "allow", ...view.params, project_id: strangersId, csrf: view.csrf },
          { origin: ORIGIN },
        ),
        NOW,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await world.db.select().from(oauthGrants)).toHaveLength(0);
  });

  it("attack: even with a valid CSRF value, a project the user does not own is 404 and grants nothing", async () => {
    world.signInAs(owner);
    const fields: ConsentFields = {
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: "s",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
      resource: RESOURCE,
      project_id: strangersId,
    };
    const req = jsonRequest(
      `${ORIGIN}/oauth/consent`,
      { decision: "allow", ...fields, csrf: consentCsrf(owner.id, fields) },
      { origin: ORIGIN },
    );
    await expect(decideConsent(world.db, req, NOW)).rejects.toMatchObject({ status: 404 });
    expect(await world.db.select().from(oauthGrants)).toHaveLength(0);
  });

  it("attack: a signed-out decision is 401", async () => {
    world.signInAs(null);
    await expect(
      decideConsent(world.db, await decision({}, { origin: ORIGIN }), NOW),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("attack: a decision posted from another site (foreign Origin) is 403", async () => {
    world.signInAs(owner);
    await expect(
      decideConsent(world.db, await decision({}, { origin: "https://evil.example" }), NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("attack: an HTML form post (cross-site form body) is refused with 415", async () => {
    world.signInAs(owner);
    const res = await consentRoute(
      formRequest(
        `${ORIGIN}/oauth/consent`,
        { decision: "allow" },
        { origin: "https://evil.example" },
      ),
    );
    expect(res.status).toBe(415);
  });

  it("the consent route answers Allow with the redirect as JSON for the page to follow", async () => {
    world.signInAs(owner);
    const res = await consentRoute(await decision({}, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect: string };
    expect(body.redirect.startsWith(REDIRECT)).toBe(true);
  });
});
