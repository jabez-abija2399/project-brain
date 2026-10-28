// FEAT-009 security pass: attacker tests for the GitHub webhook, the install/link flow and the index-push job.
// Every fake secret or token is built at runtime (string joins), never written as a literal.
import { GET as callback } from "@/app/api/github/callback/route";
import { GET as install } from "@/app/api/github/install/route";
import { POST as linkRoute } from "@/app/api/github/link/route";
import { GET as repos } from "@/app/api/github/repos/route";
import { POST as webhook } from "@/app/api/github/webhook/route";
import { dbTablesRepo, filesRepo, githubRepo, projectsRepo, symbolsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import type { GithubConfig } from "./github";
import { completeInstall } from "./github-install";
import {
  type FakeRepo,
  type GithubMock,
  makeGithubConfig,
  mockGithub,
  restoreGithub,
  sign,
} from "./github-test-helpers";
import { MAX_WEBHOOK_BYTES } from "./github-webhook";
import { PUSH_EVENT, type PushEventData, setEventSenderForTests } from "./inngest";
import { installationClient } from "./inngest-functions";
import { MAX_PUSH_FILES, type StepRunner, runPushIndex } from "./push-index";
import { type TestWorld, createTestWorld } from "./test-helpers";

const BEFORE = "a".repeat(40);
const AFTER = "b".repeat(40);
const SENTINEL = ["SEC", "PASS", "BODY", "91c2"].join("_");

let world: TestWorld;
let config: GithubConfig;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;
let sent: { name: string; data: PushEventData }[];
let deliveryCounter = 0;
let stepNames: string[];
let stepOutputs: unknown[];

const step: StepRunner = {
  run: async (name, fn) => {
    stepNames.push(name);
    const result = await fn();
    stepOutputs.push(JSON.parse(JSON.stringify(result ?? null)));
    return result;
  },
};

beforeEach(async () => {
  world = await createTestWorld();
  config = makeGithubConfig();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  sent = [];
  stepNames = [];
  stepOutputs = [];
  setEventSenderForTests(async (events) => {
    sent.push(...events);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  setEventSenderForTests(undefined);
  restoreGithub();
  await world.teardown();
});

const fakeRepo = (over: Partial<FakeRepo> = {}): FakeRepo => ({
  installations: { 77: ["acme/app"] },
  userInstallations: [77],
  compare: {},
  files: {},
  ...over,
});

// ---------- webhook helpers ----------
const pushBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ref: "refs/heads/main",
    before: BEFORE,
    after: AFTER,
    repository: { full_name: "acme/app", default_branch: "main" },
    installation: { id: 77 },
    ...over,
  });

function deliver(
  body: BodyInit,
  opts: {
    event?: string;
    delivery?: string;
    signature?: string | null;
    signedOver?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": opts.event ?? "push",
    "x-github-delivery": opts.delivery ?? `sec-delivery-${++deliveryCounter}`,
    ...opts.headers,
  };
  const signature =
    opts.signature === undefined
      ? sign(opts.signedOver ?? String(body), config.webhookSecret)
      : opts.signature;
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return webhook(
    new Request("http://localhost/api/github/webhook", {
      method: "POST",
      headers,
      body,
      // biome-ignore lint/suspicious/noExplicitAny: a streamed body needs duplex in Node's fetch
      ...({ duplex: "half" } as any),
    }),
  );
}

const deliveries = async () =>
  Number(
    (await world.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM webhook_deliveries"))
      .rows[0]?.n,
  );

const link = (pid: string, ownerId: string, installationId = 77, repo = "acme/app") =>
  githubRepo.linkProject(world.db, pid, ownerId, installationId, repo);

// ---------- install helpers ----------
const oauthCode = () => ["code", "y".repeat(20)].join("");
async function stateFor(user: SessionUser, pid = projectId): Promise<string> {
  world.signInAs(user);
  const res = await install(new Request(`http://localhost/api/github/install?projectId=${pid}`));
  return new URL(res.headers.get("location") ?? "http://x/").searchParams.get("state") ?? "";
}
function callBack(state: string, installationId: number | string = 77, code = oauthCode()) {
  return callback(
    new Request(
      `http://localhost/api/github/callback?installation_id=${installationId}&setup_action=install&state=${encodeURIComponent(state)}&code=${code}`,
    ),
  );
}
function postLink(body: unknown) {
  return linkRoute(
    new Request("http://localhost/api/github/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
const projectRow = async (pid: string) =>
  (
    await world.pg.query<{ installationId: number | null }>(
      'SELECT installation_id::int AS "installationId" FROM projects WHERE id = $1',
      [pid],
    )
  ).rows[0];

// ---------- job helpers ----------
const event = (over: Partial<PushEventData> = {}): PushEventData => ({
  projectId,
  installationId: 77,
  repo: "acme/app",
  before: BEFORE,
  after: AFTER,
  deliveryId: "d-sec",
  ...over,
});
function jobRepo(changes: FakeRepo["compare"][string], files: FakeRepo["files"]): FakeRepo {
  return fakeRepo({ compare: { [`${BEFORE}...${AFTER}`]: changes }, files });
}
const runJob = (data = event(), installationId = 77) =>
  runPushIndex(world.db, data, step, () => installationClient(installationId));

// Wraps the mock: `override` answers some requests itself, everything else goes to mockGithub's stub.
function overrideFetch(override: (url: URL) => Response | null) {
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    return override(url) ?? base(input as never, init);
  });
}
const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function tableWithRlsOn() {
  const sqlFile = await filesRepo.insert(world.db, projectId, {
    path: "supabase/migrations/0001_init.sql",
    hash: "d".repeat(64),
  });
  await dbTablesRepo.insert(world.db, projectId, {
    fileId: sqlFile.id,
    schema: "public",
    name: "orders",
    rlsEnabled: true,
  });
}
const tsx = (name: string) =>
  `export function ${name}() {\n  const hidden = "${SENTINEL}";\n  return <div>{hidden}</div>;\n}\n`;

// =====================================================================================================
describe("FEAT-009 security: webhook signature (AC-009-03)", () => {
  beforeEach(async () => {
    await link(projectId, owner.id);
  });

  it("AC-009-03 attack: forged signature variants all get 401, nothing enqueued, no delivery id recorded", async () => {
    const body = pushBody();
    const good = sign(body, config.webhookSecret);
    const otherSecret = ["not", "the", "secret", String(Date.now())].join("-");
    const variants: (string | null)[] = [
      null,
      "",
      "sha256=",
      good.toUpperCase(),
      good.replace("sha256=", "SHA256="),
      good.replace("sha256=", "sha1="),
      // (Leading/trailing spaces are not variants: the Headers API strips them, so they equal the good value.)
      `${good},${good}`,
      good.slice(0, -1),
      `${good.slice(0, -1)}${good.endsWith("0") ? "1" : "0"}`,
      sign(body, otherSecret),
      sign(pushBody({ installation: { id: 88 } }), config.webhookSecret),
      sign("", config.webhookSecret),
      `sha256=${"0".repeat(64)}`,
    ];
    for (const signature of variants) {
      const res = await deliver(body, { signature });
      expect(res.status, String(signature)).toBe(401);
      expect(await res.json()).toEqual({ error: "bad_signature" });
    }
    // Only a sha1 header (GitHub's legacy X-Hub-Signature) is not accepted.
    const sha1Only = await deliver(body, {
      signature: null,
      headers: { "x-hub-signature": good.replace("sha256=", "sha1=") },
    });
    expect(sha1Only.status).toBe(401);
    expect(sent).toEqual([]);
    expect(await deliveries()).toBe(0);
  });

  it("AC-009-03 attack: a body altered after signing (whitespace, extra key, other repo) is rejected", async () => {
    const original = pushBody();
    const altered = [
      `${original} `,
      `${original}\n`,
      original.replace('"installation":{"id":77}', '"installation":{"id":77,"x":1}'),
      original.replace("acme/app", "acme/apq"),
      original.replace("refs/heads/main", "refs/heads/mai\u006e"), // identical text: must pass
    ];
    const results = [];
    for (const body of altered)
      results.push((await deliver(body, { signedOver: original })).status);
    expect(results).toEqual([401, 401, 401, 401, 202]);
    expect(sent).toHaveLength(1);
  });

  it("AC-009-03 attack: unsigned invalid JSON and unsigned uninstall events are refused before parsing or any write", async () => {
    const junk = await deliver("{not json", { signature: null });
    expect(junk.status).toBe(401);
    const uninstall = JSON.stringify({ action: "deleted", installation: { id: 77 } });
    const forged = await deliver(uninstall, {
      event: "installation",
      signature: sign(uninstall, ["guess", "ed"].join("")),
    });
    expect(forged.status).toBe(401);
    expect((await projectRow(projectId))?.installationId).toBe(77);
    expect(await deliveries()).toBe(0);
  });

  it("AC-009-03 attack: oversized bodies are refused unread, also when content-length lies", async () => {
    const big = "x".repeat(MAX_WEBHOOK_BYTES + 1);
    const declared = await deliver(big, { signature: sign(big, config.webhookSecret) });
    expect(declared.status).toBe(413);
    // A stream with no (or a small) declared length is cut at the cap while reading.
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let pushed = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pushed++ > 8) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const lying = await deliver(stream, {
      signature: `sha256=${"a".repeat(64)}`,
      headers: { "content-length": "10" },
    });
    expect([413, 401]).toContain(lying.status);
    expect(pushed).toBeLessThanOrEqual(8);
    expect(sent).toEqual([]);
    expect(await deliveries()).toBe(0);
  });

  it("AC-009-03 attack: unsigned requests never reach the GitHub API and an unconfigured app fails closed", async () => {
    const gh = mockGithub(fakeRepo());
    await deliver(pushBody(), { signature: null });
    expect(gh.requests).toEqual([]);
    const { setGithubConfigForTests } = await import("./github");
    setGithubConfigForTests(null);
    const res = await deliver(pushBody(), { signature: sign(pushBody(), config.webhookSecret) });
    expect(res.status).toBe(503);
    expect(sent).toEqual([]);
  });
});

// =====================================================================================================
describe("FEAT-009 security: replay (AC-009-04)", () => {
  beforeEach(async () => {
    await link(projectId, owner.id);
  });

  it("AC-009-04 attack: the same delivery id sent 6 times concurrently enqueues exactly once", async () => {
    const body = pushBody();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => deliver(body, { delivery: "replay-concurrent" })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 202]);
    expect(sent).toHaveLength(1);
  });

  it("AC-009-04 attack: an unsigned request cannot burn a delivery id that GitHub sends later", async () => {
    const forged = await deliver(pushBody(), { delivery: "future-id", signature: null });
    expect(forged.status).toBe(401);
    const real = await deliver(pushBody(), { delivery: "future-id" });
    expect(real.status).toBe(202);
    expect(sent).toHaveLength(1);
  });

  it("AC-009-04 attack: a captured signed push replayed under a fresh delivery id is not enqueued again", async () => {
    const body = pushBody();
    expect((await deliver(body, { delivery: "orig-1" })).status).toBe(202);
    // X-GitHub-Delivery is not covered by the HMAC: an attacker who captured one signed body can mint new ids.
    const replay = await deliver(body, { delivery: "attacker-minted-1" });
    expect(sent).toHaveLength(1);
    expect(replay.status).toBe(200);
  });

  it("AC-009-04 attack: delivery ids with odd characters or excessive length are refused, not stored", async () => {
    for (const delivery of ["../x", "a.b", "x".repeat(101), "id;drop", "id%00", "{{x}}"]) {
      const res = await deliver(pushBody(), { delivery });
      expect(res.status, delivery).toBe(400);
    }
    expect(sent).toEqual([]);
    expect(await deliveries()).toBe(0);
  });
});

// =====================================================================================================
describe("FEAT-009 security: event spoofing (AC-009-02)", () => {
  it("AC-009-02 attack: a signed push for another installation never reaches a project linked under a different installation", async () => {
    const victimOwner = await world.createUser({ name: "victim" });
    const victim = (await projectsRepo.create(world.db, victimOwner.id, { name: "v" })).id;
    await link(victim, victimOwner.id, 88, "victim/secret");
    await link(projectId, owner.id, 77, "acme/app");
    // Attacker's own installation 77 pushes a repo whose name matches the victim's.
    const res = await deliver(
      pushBody({
        repository: { full_name: "victim/secret", default_branch: "main" },
        installation: { id: 77 },
      }),
    );
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
  });

  it("AC-009-02 attack: tag pushes, non-default branches, look-alike refs and branch deletes enqueue nothing", async () => {
    await link(projectId, owner.id);
    const bodies = [
      pushBody({ ref: "refs/tags/main" }),
      pushBody({ ref: "refs/heads/feature" }),
      pushBody({ ref: "refs/heads/main/x" }),
      pushBody({ ref: "refs/heads/Main" }),
      pushBody({ ref: "main" }),
      pushBody({ ref: "refs/heads/main", deleted: true }),
      pushBody({
        ref: "refs/heads/main",
        repository: { full_name: "acme/app", default_branch: "dev" },
      }),
    ];
    for (const b of bodies) {
      const res = await deliver(b);
      expect(res.status).toBe(200);
    }
    expect(sent).toEqual([]);
  });

  it("AC-009-02 attack: payload shape tricks (string ids, bad shas, path-like repo names) are rejected", async () => {
    await link(projectId, owner.id);
    const bodies = [
      pushBody({ installation: { id: "77" } }),
      pushBody({ installation: { id: -77 } }),
      pushBody({ after: "../../etc/passwd".padEnd(40, "a") }),
      pushBody({ before: "A".repeat(40) }),
      pushBody({ repository: { full_name: "acme/app/../other", default_branch: "main" } }),
      pushBody({ repository: { full_name: "acme/app?x=1", default_branch: "main" } }),
    ];
    for (const b of bodies) expect((await deliver(b)).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it("AC-009-02 attack: a forged Inngest event for someone else's project is skipped before any GitHub call", async () => {
    const victimOwner = await world.createUser({ name: "victim" });
    const victim = (await projectsRepo.create(world.db, victimOwner.id, { name: "v" })).id;
    await link(victim, victimOwner.id, 88, "victim/secret");
    await link(projectId, owner.id, 77, "acme/app");
    const gh = mockGithub(
      jobRepo([{ filename: "src/A.tsx", status: "added" }], { "src/A.tsx": tsx("A") }),
    );
    // Victim project with the attacker's installation/repo, and attacker project with the victim's.
    expect(await runJob(event({ projectId: victim }))).toEqual({ skipped: "not_linked" });
    expect(await runJob(event({ installationId: 88, repo: "victim/secret" }), 88)).toEqual({
      skipped: "not_linked",
    });
    expect(gh.requests).toEqual([]);
    expect(await filesRepo.list(world.db, victim)).toEqual([]);
  });

  it("AC-009-02 attack: a push for a repo linked by more than 10 projects enqueues at most 10 jobs", async () => {
    for (let i = 0; i < 12; i++) {
      const u = await world.createUser({ name: `u${i}` });
      const p = (await projectsRepo.create(world.db, u.id, { name: `p${i}` })).id;
      await link(p, u.id);
    }
    const res = await deliver(pushBody());
    expect(res.status).toBe(202);
    expect(sent.length).toBeLessThanOrEqual(10);
    expect(sent.every((e) => e.name === PUSH_EVENT)).toBe(true);
  });
});

// =====================================================================================================
describe("FEAT-009 security: linking (AC-009-01)", () => {
  it("AC-009-01 attack: a stranger cannot start an install for, or redeem the state of, someone else's project", async () => {
    mockGithub(fakeRepo());
    world.signInAs(stranger);
    const start = await install(
      new Request(`http://localhost/api/github/install?projectId=${projectId}`),
    );
    expect(start.status).toBe(404);

    const ownerState = await stateFor(owner);
    world.signInAs(stranger);
    expect((await callBack(ownerState)).status).toBe(400);
    world.signInAs(null);
    expect((await callBack(ownerState)).status).toBe(401);
    expect((await projectRow(projectId))?.installationId ?? null).toBeNull();
  });

  it("AC-009-01 attack: a typed-in installation id the GitHub user cannot access is refused", async () => {
    mockGithub(
      fakeRepo({
        installations: { 77: ["acme/app"], 88: ["victim/secret"] },
        userInstallations: [77],
      }),
    );
    const state = await stateFor(owner);
    const res = await callBack(state, 88);
    expect(res.status).toBe(404);
    expect((await projectRow(projectId))?.installationId ?? null).toBeNull();
    for (const bad of ["0", "-1", "1.5", "9007199254740993", "77abc", ""]) {
      expect((await callBack(state, bad)).status, bad).toBe(400);
    }
  });

  it("AC-009-01 attack: missing or malformed OAuth code, forged/expired/reused state are all refused", async () => {
    mockGithub(fakeRepo());
    const state = await stateFor(owner);
    world.signInAs(owner);
    expect((await callBack(state, 77, "")).status).toBe(400);
    expect((await callBack(state, 77, "a%20b")).status).toBe(400);
    expect((await callBack("x".repeat(43))).status).toBe(400);
    expect((await callBack(`${state}x`)).status).toBe(400);
    // Expired: 11 minutes later.
    await expect(
      completeInstall(
        world.db,
        owner,
        { state, code: oauthCode(), installationId: 77 },
        new Date(Date.now() + 11 * 60 * 1000),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect((await callBack(state)).status).toBe(303);
    // Reused after a successful link.
    expect((await callBack(state)).status).toBe(400);
  });

  it("AC-009-01 attack: an OAuth exchange failure does not link and the error does not echo the code or secrets", async () => {
    mockGithub(fakeRepo());
    overrideFetch((url) =>
      url.pathname === "/login/oauth/access_token"
        ? jsonRes({ error: "bad_verification_code", error_description: "bad" })
        : null,
    );
    const state = await stateFor(owner);
    const res = await callBack(state);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain(oauthCode());
    expect(text).not.toContain(config.clientSecret);
    expect((await projectRow(projectId))?.installationId ?? null).toBeNull();
  });

  it("AC-009-01 attack: the selection screen cannot link a repo outside the installation, another user's state, or a chosen project", async () => {
    mockGithub(fakeRepo({ installations: { 77: ["acme/app", "acme/web"] } }));
    const state = await stateFor(owner);
    expect((await callBack(state)).status).toBe(303);

    world.signInAs(stranger);
    expect(
      (await repos(new Request(`http://localhost/api/github/repos?state=${state}`))).status,
    ).toBe(400);
    expect((await postLink({ state, repo: "acme/app" })).status).toBe(400);

    world.signInAs(owner);
    expect((await postLink({ state, repo: "victim/secret" })).status).toBe(404);
    expect((await postLink({ state, repo: "acme/../victim" })).status).toBe(400);
    const strangerProject = (await projectsRepo.create(world.db, stranger.id, { name: "s" })).id;
    expect((await postLink({ state, repo: "acme/app", projectId: strangerProject })).status).toBe(
      400,
    );
    expect((await projectRow(strangerProject))?.installationId ?? null).toBeNull();
    expect((await projectRow(projectId))?.installationId ?? null).toBeNull();
  });

  it("AC-009-01 attack: two parallel link requests with one state link only once", async () => {
    mockGithub(fakeRepo({ installations: { 77: ["acme/app", "acme/web"] } }));
    const state = await stateFor(owner);
    expect((await callBack(state)).status).toBe(303);
    world.signInAs(owner);
    const [a, b] = await Promise.all([
      postLink({ state, repo: "acme/app" }),
      postLink({ state, repo: "acme/web" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it("AC-009-01 attack: a state cannot be redeemed after the owner lost the project", async () => {
    mockGithub(fakeRepo());
    const state = await stateFor(owner);
    await world.pg.query("UPDATE projects SET owner_id = $1 WHERE id = $2", [
      stranger.id,
      projectId,
    ]);
    world.signInAs(owner);
    expect([400, 404]).toContain((await callBack(state)).status);
    expect((await projectRow(projectId))?.installationId ?? null).toBeNull();
  });
});

// =====================================================================================================
describe("FEAT-009 security: the index-push job (AC-009-05)", () => {
  beforeEach(async () => {
    await link(projectId, owner.id);
  });

  it("AC-009-05 attack: odd paths from compare (traversal, absolute, control chars) are never stored nor escape the repo's contents API", async () => {
    const odd = [
      "../escape.tsx",
      "src/../../escape2.tsx",
      "/abs.tsx",
      "C:/win.tsx",
      "src/a\nb.tsx",
      "src/\u001b[31mred.tsx",
      "src//double.tsx",
      "./src/dot.tsx",
      "src\\back.tsx",
    ];
    const gh = mockGithub(
      jobRepo(
        odd.map((filename) => ({ filename, status: "added" })),
        Object.fromEntries(odd.map((p, i) => [p, tsx(`Odd${i}`)])),
      ),
    );
    await runJob();
    expect(await filesRepo.list(world.db, projectId)).toEqual([]);
    for (const r of gh.requests) {
      if (r.startsWith("POST ")) continue;
      expect(r, r).toMatch(/^GET \/repos\/acme\/app\/(compare|contents)\//);
    }
  });

  it("AC-009-05 attack: symlinks, submodules, directories, oversized and binary files are not indexed", async () => {
    const paths = ["src/Link.tsx", "src/Sub.tsx", "src/Dir.tsx", "src/Huge.tsx", "src/Bin.tsx"];
    mockGithub(
      jobRepo(
        paths.map((filename) => ({ filename, status: "added" })),
        { "src/Bin.tsx": Buffer.concat([Buffer.from(tsx("Bin")), Buffer.from([0, 1, 2])]) },
      ),
    );
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    overrideFetch((url) => {
      const p = decodeURIComponent(url.pathname);
      if (p.endsWith("/contents/src/Link.tsx"))
        return jsonRes({
          type: "symlink",
          target: "/etc/passwd",
          size: 11,
          encoding: "base64",
          content: b64(tsx("Link")),
        });
      if (p.endsWith("/contents/src/Sub.tsx"))
        return jsonRes({
          type: "submodule",
          size: 0,
          encoding: "base64",
          content: b64(tsx("Sub")),
        });
      if (p.endsWith("/contents/src/Dir.tsx")) return jsonRes([{ type: "file", name: "x" }]);
      if (p.endsWith("/contents/src/Huge.tsx"))
        return jsonRes({ type: "file", size: 5 * 1024 * 1024, encoding: "none", content: "" });
      return null;
    });
    await runJob();
    expect(await filesRepo.list(world.db, projectId)).toEqual([]);
  });

  it("AC-009-05 attack: a file whose fetch fails makes the step throw without leaking the installation token or source", async () => {
    const errLog = vi.spyOn(console, "error");
    mockGithub(jobRepo([{ filename: "src/A.tsx", status: "added" }], { "src/A.tsx": tsx("A") }));
    overrideFetch((url) =>
      decodeURIComponent(url.pathname).endsWith("/contents/src/A.tsx")
        ? jsonRes({ message: "boom" }, 500)
        : null,
    );
    let thrown: unknown;
    try {
      await runJob();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const token = ["ghs", "_", "x".repeat(36)].join("");
    const serialized = `${String(thrown)} ${(thrown as Error).stack ?? ""} ${JSON.stringify(thrown)}`;
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(SENTINEL);
    expect(errLog.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).not.toContain(token);
    expect(await filesRepo.list(world.db, projectId)).toEqual([]);
  });

  it("AC-009-05 attack: secrets in component signatures are masked and source text never reaches the DB, steps or logs", async () => {
    const info = vi.spyOn(console, "info");
    const secret = ["sk", "live", "Q".repeat(10) + "9".repeat(14)].join("_");
    const ghToken = ["ghp", "_", "Z".repeat(36)].join("");
    const src = `export function Pay({ apiKey = "${secret}", gh = "${ghToken}" }) {\n  const body = "${SENTINEL}";\n  return <div>{body}</div>;\n}\n`;
    mockGithub(jobRepo([{ filename: "src/Pay.tsx", status: "added" }], { "src/Pay.tsx": src }));
    await runJob();
    const tables = await world.pg.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    for (const { table_name } of tables.rows) {
      const rows = await world.pg.query<{ row: string }>(
        `SELECT row_to_json(t)::text AS row FROM "${table_name}" t`,
      );
      for (const r of rows.rows) {
        expect(r.row, table_name).not.toContain(SENTINEL);
        expect(r.row, table_name).not.toContain(secret);
        expect(r.row, table_name).not.toContain(ghToken);
      }
    }
    const outside =
      JSON.stringify(stepOutputs) + info.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    for (const s of [SENTINEL, secret, ghToken]) expect(outside).not.toContain(s);
    expect((await symbolsRepo.listComponents(world.db, projectId)).map((c) => c.name)).toEqual([
      "Pay",
    ]);
  });

  it("AC-009-05 attack: a removed path only deletes this project's file, never the same path in another project", async () => {
    const otherOwner = await world.createUser({ name: "other" });
    const other = (await projectsRepo.create(world.db, otherOwner.id, { name: "o" })).id;
    await filesRepo.insert(world.db, other, { path: "src/shared.ts", hash: "e".repeat(64) });
    await filesRepo.insert(world.db, projectId, { path: "src/shared.ts", hash: "e".repeat(64) });
    mockGithub(jobRepo([{ filename: "src/shared.ts", status: "removed" }], {}));
    await runJob();
    expect((await filesRepo.list(world.db, projectId)).map((f) => f.path)).toEqual([]);
    expect((await filesRepo.list(world.db, other)).map((f) => f.path)).toEqual(["src/shared.ts"]);
  });

  it("AC-009-05 attack: a migration changed with an upper-case .SQL extension still marks RLS unknown (fail closed)", async () => {
    await tableWithRlsOn();
    mockGithub(
      jobRepo([{ filename: "supabase/migrations/0002_off.SQL", status: "added" }], {
        "supabase/migrations/0002_off.SQL": "alter table orders disable row level security;",
      }),
    );
    await runJob();
    const [table] = await dbTablesRepo.list(world.db, projectId);
    expect(table).toMatchObject({ rlsEnabled: false, rlsUnknown: true });
  });

  it("AC-009-05 attack: a push too large to index that touches a migration still leaves RLS unknown, never enabled", async () => {
    await tableWithRlsOn();
    const changes = Array.from({ length: MAX_PUSH_FILES + 1 }, (_, i) => ({
      filename: `src/f${i}.ts`,
      status: "added",
    }));
    changes.push({ filename: "supabase/migrations/0002_off.sql", status: "added" });
    mockGithub(jobRepo(changes, {}));
    const result = await runJob();
    expect(result).toMatchObject({ skipped: "too_many_files" });
    const [table] = await dbTablesRepo.list(world.db, projectId);
    expect(table?.rlsEnabled).toBe(false);
  });

  it("AC-009-05 attack: a compare whose file list GitHub truncated (300 files, first page only) is not treated as complete", async () => {
    await tableWithRlsOn();
    // Real GitHub: files appear only on page 1 and stop at 300 for the whole comparison; later pages carry none.
    const first300 = Array.from({ length: 300 }, (_, i) => ({
      filename: `src/t${i}.ts`,
      status: "added",
    }));
    mockGithub(jobRepo([], {}));
    overrideFetch((url) => {
      if (!/\/compare\//.test(url.pathname)) return null;
      const page = Number(url.searchParams.get("page") ?? "1");
      return jsonRes({ files: page === 1 ? first300 : [] });
    });
    const result = await runJob();
    const [table] = await dbTablesRepo.list(world.db, projectId);
    // Safe: either the job refuses the truncated list or it fails closed on RLS (a migration may be in the unseen rest).
    const safe = "skipped" in result || table?.rlsUnknown === true;
    expect(safe).toBe(true);
  });
});

// =====================================================================================================
describe("FEAT-009 security: caps and unbounded work (AC-009-06)", () => {
  beforeEach(async () => {
    await link(projectId, owner.id);
  });

  it("AC-009-06 attack: a push with more than the cap of files fetches no contents and makes a bounded number of compare calls", async () => {
    const changes = Array.from({ length: MAX_PUSH_FILES * 2 }, (_, i) => ({
      filename: `src/c${i}.tsx`,
      status: "modified",
    }));
    const gh = mockGithub(jobRepo(changes, {}));
    const result = await runJob();
    expect(result).toMatchObject({ skipped: "too_many_files" });
    expect(gh.fetchedPaths).toEqual([]);
    expect(gh.requests.filter((r) => r.includes("/compare/")).length).toBeLessThanOrEqual(
      MAX_PUSH_FILES / 100 + 1,
    );
  });

  it("AC-009-06 attack: a 250-file push is split into steps of at most 100 files that return counts only", async () => {
    const changes = Array.from({ length: 250 }, (_, i) => ({
      filename: `src/b${i}.tsx`,
      status: "added",
    }));
    const files = Object.fromEntries(changes.map((c, i) => [c.filename, tsx(`B${i}`)]));
    mockGithub(jobRepo(changes, files));
    const result = await runJob();
    expect(result).toMatchObject({ indexed: 250 });
    const batches = stepNames.filter((n) => n.startsWith("index-batch-"));
    expect(batches).toHaveLength(3);
    expect(JSON.stringify(stepOutputs)).not.toContain(SENTINEL);
  });

  it("AC-009-06 attack: the webhook does no GitHub API call and stays cheap even for a push of thousands of files", async () => {
    const gh: GithubMock = mockGithub(fakeRepo());
    const commits = Array.from({ length: 2000 }, (_, i) => ({
      id: String(i),
      added: [`f${i}.ts`],
    }));
    // No timing assertion (checklist rule 8): the 2 s budget holds because the handler makes no network call.
    const res = await deliver(pushBody({ commits }));
    expect(res.status).toBe(202);
    expect(gh.requests).toEqual([]);
  });
});
