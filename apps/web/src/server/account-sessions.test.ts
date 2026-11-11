import AccountPage from "@/app/account/page";
import { DELETE as endOneRoute } from "@/app/api/account/sessions/[sid]/route";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserLabel, sessionsView } from "./account";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Backlog wave D: per-browser sessions on /account.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const APP = "https://codeceipts.test";
let world: TestWorld;
let owner: SessionUser;
let other: SessionUser;

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function addSession(id: string, userId: string, ua: string | null, expires = "1 day") {
  await world.db.execute(
    `insert into "session" (id, "userId", token, "expiresAt", "userAgent") values ('${id}', '${userId}', 'tok-${id}', now() + interval '${expires}', ${ua === null ? "null" : `'${ua}'`})` as never,
  );
}
const ids = async () =>
  (
    (await world.db.execute(`select id from "session" order by id` as never)) as unknown as {
      rows: { id: string }[];
    }
  ).rows.map((r) => r.id);
const del = (sid: string, origin: string | null = APP) =>
  endOneRoute(
    new Request(`${APP}/api/account/sessions/${sid}`, {
      method: "DELETE",
      headers: origin ? { origin } : {},
    }),
    { params: Promise.resolve({ sid }) },
  );

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  world = await createTestWorld();
  owner = await world.createUser({ name: "Ada" });
  other = await world.createUser({ name: "eve" });
  world.signInAs(owner);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await world.teardown();
});

describe("per-browser sessions", () => {
  it("BL-40a lists only the user's live sessions, with a short browser name and no token or address", async () => {
    await addSession("s1", owner.id, CHROME_MAC);
    await addSession("s2", owner.id, null);
    await addSession("s3", owner.id, CHROME_MAC, "-1 day");
    await addSession("s4", other.id, CHROME_MAC);
    const list = await sessionsView(world.db, owner);
    expect(list.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(list.find((s) => s.id === "s1")?.label).toBe("Chrome on Mac");
    expect(list.find((s) => s.id === "s2")?.label).toBe("Unknown browser");
    expect(JSON.stringify(list)).not.toContain("tok-");
    const html = renderToStaticMarkup((await AccountPage()) as ReactElement);
    expect(html).toContain("Chrome on Mac");
    expect(html).toContain("Sign out of all sessions");
    expect(html).not.toContain("tok-s1");
  });

  it("BL-40b the owner signs one browser out; the others stay", async () => {
    await addSession("s1", owner.id, CHROME_MAC);
    await addSession("s2", owner.id, CHROME_MAC);
    const res = await del("s1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ended: 1 });
    expect(await ids()).toEqual(["s2"]);
  });

  it("BL-40c attack: another user's session is 404 and stays; a cross-origin or signed-out call is refused", async () => {
    await addSession("theirs", other.id, CHROME_MAC);
    await addSession("mine", owner.id, CHROME_MAC);
    expect((await del("theirs")).status).toBe(404);
    expect((await del("theirs' or '1'='1")).status).toBe(404);
    expect((await del("mine", "https://evil.example")).status).toBe(403);
    world.signInAs(null);
    expect((await del("mine")).status).toBe(401);
    expect(await ids()).toEqual(["mine", "theirs"]);
  });

  it("BL-40d browser names are a few plain words, never the raw user agent", () => {
    expect(
      browserLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1"),
    ).toBe("Safari on iPhone or iPad");
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0) Firefox/131.0")).toBe("Firefox on Windows");
    expect(browserLabel("<script>alert(1)</script>")).toBe("Unknown browser");
    expect(browserLabel("curl/8.0")).toBe("Unknown browser");
  });
});
