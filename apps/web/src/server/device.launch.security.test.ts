import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { POST as approveRoute } from "@/app/api/device/approve/route";
import { POST as startRoute } from "@/app/api/device/start/route";
import { POST as tokenRoute } from "@/app/api/device/token/route";
import { projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import type { SessionUser } from "./auth";
import { approveDevice, deviceView, pollDevice, startDevice } from "./device";
import { AppError } from "./errors";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Launch security pass (independent review): attacks on device approval and the Origin check.
const APP = "https://codeceipts.test";
const appDir = fileURLToPath(new URL("../app", import.meta.url));
const T0 = new Date("2026-10-30T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const req = (ip = "203.0.113.7", url = `${APP}/api/device/x`) =>
  new Request(url, { method: "POST", headers: { "x-forwarded-for": ip } });

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  world.signInAs(owner);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await world.teardown();
});

const approveReq = (headers: Record<string, string>, body: string) =>
  new Request(`${APP}/api/device/approve`, { method: "POST", headers, body });

async function pending(userCode: string) {
  // A pending code is still visible on the approval page.
  return (await deviceView(world.db, owner, userCode)).code === userCode;
}

describe("launch: device approval attacks", () => {
  it("attack: Origin variants (null, case, port, trailing dot, http, trailing slash, foreign Referer) never approve", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    const body = JSON.stringify({ user_code: s.user_code, project_id: projectId });
    const variants: Record<string, string>[] = [
      { origin: "null" },
      { origin: "https://CODECEIPTS.TEST" },
      { origin: "https://codeceipts.test:443" },
      { origin: "https://codeceipts.test." },
      { origin: "http://codeceipts.test" },
      { origin: `${APP}/` },
      { origin: "https://codeceipts.test.evil.test" },
      { origin: "" },
      { referer: "https://evil.test/device" },
      { referer: "https://codeceipts.test@evil.test/device" },
      { referer: "null" },
      { referer: "not a url" },
      { origin: "https://evil.test", referer: `${APP}/device` },
    ];
    for (const headers of variants) {
      const res = await approveRoute(
        approveReq({ "content-type": "application/json", ...headers }, body),
      );
      expect([JSON.stringify(headers), res.status]).toEqual([JSON.stringify(headers), 403]);
    }
    expect(await pending(s.user_code)).toBe(true);
  });

  it("attack: a form-encodable text/plain body (CSRF without Origin) does not approve a code", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    // <form enctype="text/plain"> with name `{"user_code":"...","new_project_name":"x` and value `y"}` sends this body.
    const body = `{"user_code":"${s.user_code}","new_project_name":"x=y"}`;
    const res = await approveRoute(approveReq({ "content-type": "text/plain" }, body));
    expect(res.status).not.toBe(200);
    expect(await pending(s.user_code)).toBe(true);
  });

  it("attack: a large body sent without Content-Length is refused with 413 like one that declares it", async () => {
    const big = JSON.stringify({ name: "x".repeat(200_000) });
    const res = await startRoute(
      new Request(`${APP}/api/device/start`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
        body: big,
      }),
    );
    expect(res.status).toBe(413);
  });

  it("attack: the approval page cannot be used to guess codes without a limit", async () => {
    let refused: unknown = null;
    for (let i = 0; i < 40 && !refused; i++) {
      refused = await deviceView(world.db, stranger, "BCDF-GHJK", T0).then(
        () => null,
        (e: unknown) => e,
      );
    }
    expect(refused instanceof AppError && refused.status === 429).toBe(true);
  });

  it("attack: a suggested project name with bidi or control characters is not shown as sent", async () => {
    const name = "shop\u202Etxt.exe\u0007";
    const s = await startDevice(world.db, req(), { name }, T0);
    const view = await deviceView(world.db, owner, s.user_code, at(1));
    expect(view.code).toBe(s.user_code);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
    expect(view.suggestedName ?? "").not.toMatch(/[\u0000-\u001f\u007f\u202A-\u202E\u2066-\u2069]/);
  });

  it("attack: the device approval page cannot be framed by another site (clickjacking a one-click approve)", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const framingDenied = rules.some(
      (r) =>
        (r.source === "/device" || r.source === "/:path*" || r.source === "/(.*)") &&
        r.headers.some(
          (h) =>
            (h.key.toLowerCase() === "x-frame-options" && /deny|sameorigin/i.test(h.value)) ||
            (h.key.toLowerCase() === "content-security-policy" &&
              /frame-ancestors\s+('none'|'self')/.test(h.value)),
        ),
    );
    expect(framingDenied).toBe(true);
  });

  it("attack: a spoofed Host (request URL) never changes the verification address or the api_url handed to the CLI", async () => {
    const evil = "https://evil.test/api/device/start";
    const s = await startDevice(world.db, req("203.0.113.8", evil), {}, T0);
    expect(s.verification_uri).toBe(`${APP}/device`);
    expect(s.verification_uri_complete.startsWith(`${APP}/device?code=`)).toBe(true);
    await approveDevice(world.db, owner, { user_code: s.user_code, project_id: projectId }, at(1));
    const got = await pollDevice(
      world.db,
      req("203.0.113.8", evil),
      { device_code: s.device_code },
      at(6),
    );
    expect((got.body as { api_url: string }).api_url).toBe(APP);
  });

  it("attack: the minted token and the device code never reach the logs", async () => {
    const lines: string[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        lines.push(a.map(String).join(" "));
      });
    }
    const s = await startDevice(world.db, req(), { name: "app" }, T0);
    await approveDevice(world.db, owner, { user_code: s.user_code, project_id: projectId }, at(1));
    const got = await pollDevice(world.db, req(), { device_code: s.device_code }, at(6));
    const token = (got.body as { access_token: string }).access_token;
    expect(token).toMatch(/^pb_/);
    const all = lines.join("\n");
    expect(all).not.toContain(token);
    expect(all).not.toContain(s.device_code);
  });

  it("attack: replaying a used, denied or expired device code through the token route never yields a token", async () => {
    const poll = async (deviceCode: string, ip: string) => {
      const res = await tokenRoute(
        new Request(`${APP}/api/device/token`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ device_code: deviceCode }),
        }),
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const used = await startDevice(world.db, req(), {}, T0);
    await approveDevice(
      world.db,
      owner,
      { user_code: used.user_code, project_id: projectId },
      at(1),
    );
    expect(
      (await pollDevice(world.db, req(), { device_code: used.device_code }, at(6))).status,
    ).toBe(200);
    const replay = await poll(used.device_code, "198.51.100.1");
    expect(replay).toEqual({ status: 400, body: { error: "invalid_grant" } });

    const denied = await startDevice(world.db, req(), {}, T0);
    await approveDevice(world.db, owner, { user_code: denied.user_code, deny: true }, at(1));
    // Approving after a deny is not possible either.
    const again = await approveDevice(
      world.db,
      owner,
      { user_code: denied.user_code, project_id: projectId },
      at(2),
    ).then(
      () => null,
      (e: AppError) => e.status,
    );
    expect(again).toBe(404);
    expect((await poll(denied.device_code, "198.51.100.2")).body).toEqual({
      error: "access_denied",
    });
  });

  it("attack: malformed poll and approve bodies are 400s, never 500s or a token", async () => {
    const bodies = [
      "[]",
      "42",
      '"x"',
      "{",
      JSON.stringify({ device_code: "x".repeat(201) }),
      JSON.stringify({ device_code: { $ne: null } }),
      JSON.stringify({ device_code: "a", extra: 1 }),
    ];
    for (const [i, body] of bodies.entries()) {
      const res = await tokenRoute(
        new Request(`${APP}/api/device/token`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `198.51.100.${50 + i}`,
          },
          body,
        }),
      );
      expect([body, res.status]).toEqual([body, 400]);
      expect(JSON.stringify(await res.json())).not.toContain("access_token");
    }
    const s = await startDevice(world.db, req(), {}, T0);
    const approveBodies = [
      { user_code: s.user_code, project_id: projectId, deny: true },
      { user_code: s.user_code, project_id: projectId, new_project_name: "x" },
      { user_code: "\u0392CDF-GHJK", project_id: projectId },
      { user_code: `${s.user_code}\u0000`, project_id: projectId },
      { user_code: s.user_code, project_id: projectId, user_id: stranger.id },
    ];
    for (const body of approveBodies) {
      const res = await approveRoute(
        approveReq({ "content-type": "application/json", origin: APP }, JSON.stringify(body)),
      );
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(await pending(s.user_code)).toBe(true);
  });

  it("attack: every route that reads the session to change state goes through requireUser (and so the Origin check)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? files(p) : n === "route.ts" ? [p] : [];
      });
    const offenders = files(join(appDir, "api")).filter((f) => {
      const src = readFileSync(f, "utf8");
      const mutates = /export (?:async function |const )(?:POST|PUT|PATCH|DELETE)\b/.test(src);
      const readsSession = /getSessionUser\(|getAuth\(\)\.api\.getSession|cookies\(\)/.test(src);
      return mutates && readsSession && !src.includes("requireUser(");
    });
    expect(offenders.map((f) => relative(appDir, f))).toEqual([]);
  });
});
