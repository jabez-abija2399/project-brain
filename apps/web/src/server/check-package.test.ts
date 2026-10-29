import {
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  rateCountersRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPackage } from "./check-package";
import { AppError } from "./errors";
import { setLlmForTests } from "./llm";
import { setRegistryFetchForTests } from "./npm-registry";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

const now = new Date("2026-10-29T12:00:30Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

function packument(
  name: string,
  times: Record<string, string> = { "3.22.0": daysAgo(400), "3.23.8": daysAgo(90) },
) {
  const versions = Object.keys(times);
  return {
    name,
    versions: Object.fromEntries(versions.map((v) => [v, { name, version: v }])),
    "dist-tags": { latest: versions[versions.length - 1] },
    time: { created: daysAgo(2000), modified: daysAgo(1), ...times },
    repository: { type: "git", url: "git+https://github.com/colinhacks/zod.git" },
  };
}

// The mocked registry: name -> response; anything else is a 404.
let docs: Map<string, () => Response | Promise<Response>>;
let fetched: { url: string; init: RequestInit }[];
const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

let world: TestWorld;
let projectId: string;
let token: { id: string; projectId: string };

beforeEach(async () => {
  docs = new Map([["zod", json(packument("zod"))]]);
  fetched = [];
  setRegistryFetchForTests(async (url, init) => {
    fetched.push({ url, init });
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    const respond = docs.get(name);
    return respond ? respond() : new Response('{"error":"Not found"}', { status: 404 });
  });
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
});

afterEach(async () => {
  setRegistryFetchForTests(null);
  setLlmForTests(undefined);
  vi.restoreAllMocks();
  await world.teardown();
});

describe("check_package (FEAT-014)", () => {
  it("AC-014-01 check_package('zod') reports exists, age, last release and repository link from the npm registry over https", async () => {
    const result = await checkPackage(token, { projectId, name: "zod" }, now);
    expect(result).toMatchObject({
      name: "zod",
      status: "EXISTS",
      recommendation: "ok_to_install",
      latest: "3.23.8",
      created: daysAgo(2000),
      last_release: daysAgo(90),
      repository: "git+https://github.com/colinhacks/zod.git",
    });
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.url).toBe("https://registry.npmjs.org/zod");
    expect(fetched[0]?.init.redirect).toBe("error");
    expect(fetched[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("AC-014-01 results are cached per package for a short time, then read again", async () => {
    await checkPackage(token, { projectId, name: "zod" }, now);
    await checkPackage(
      token,
      { projectId, name: "zod", version: "3.22.0" },
      new Date(now.getTime() + 60_000),
    );
    expect(fetched).toHaveLength(1);
    await checkPackage(token, { projectId, name: "zod" }, new Date(now.getTime() + 11 * 60_000));
    expect(fetched).toHaveLength(2);
  });

  it("AC-014-02 a name that does not exist is NOT_FOUND with a do-not-install recommendation", async () => {
    const result = await checkPackage(token, { projectId, name: "react-dom-utilz-pro" }, now);
    expect(result).toMatchObject({ status: "NOT_FOUND", recommendation: "do_not_install" });
    docs.set(
      "gone",
      json({ name: "gone", time: { created: daysAgo(9), unpublished: { time: daysAgo(1) } } }),
    );
    expect((await checkPackage(token, { projectId, name: "gone" }, now)).status).toBe("NOT_FOUND");
  });

  it("AC-014-06 a scoped package's latest version from 4 days ago is flagged with an older version suggested", async () => {
    docs.set(
      "@acme/ui",
      json(packument("@acme/ui", { "1.0.0": daysAgo(300), "1.1.0": daysAgo(4) })),
    );
    const result = await checkPackage(token, { projectId, name: "@acme/ui" }, now);
    expect(fetched[0]?.url).toBe("https://registry.npmjs.org/@acme%2Fui");
    expect(result).toMatchObject({ status: "RISKY", version: "1.1.0", suggested_version: "1.0.0" });
  });

  it("AC-014-07 attack: malformed, oversized, failing and slow registry answers are UNREACHABLE and never throw", async () => {
    const answers: [string, () => Response | Promise<Response>][] = [
      ["bad-json", () => new Response("{not json", { status: 200 })],
      ["bad-shape", json(["zod"])],
      ["bad-name", json(packument("someone-else"))],
      ["server-error", () => new Response("oops", { status: 503 })],
      ["redirected", () => Promise.reject(new TypeError("fetch failed: redirect mode is error"))],
      [
        "declared-huge",
        () => new Response("{}", { status: 200, headers: { "content-length": String(10 ** 12) } }),
      ],
      [
        "streamed-huge",
        () =>
          new Response(`{"name":"streamed-huge","pad":"${"x".repeat(5_000)}"}`, { status: 200 }),
      ],
    ];
    for (const [name, respond] of answers) docs.set(name, respond);
    setRegistryFetchForTests(
      async (url, init) => {
        fetched.push({ url, init });
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        if (name === "slow") {
          return new Promise((_, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("timeout", "TimeoutError")),
            ),
          );
        }
        return (docs.get(name) as () => Response)();
      },
      { timeoutMs: 20, maxBytes: 4_096 },
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const name of [...answers.map(([n]) => n), "slow"]) {
      const result = await checkPackage(token, { projectId, name }, now);
      expect(result.status, name).toBe("UNREACHABLE");
      expect(result.recommendation, name).toBe("verify_manually");
    }
    // A failed read is cached for a minute only: then the registry is asked again.
    await checkPackage(token, { projectId, name: "bad-json" }, now);
    expect(fetched.filter((f) => f.url.endsWith("/bad-json"))).toHaveLength(1);
    await checkPackage(token, { projectId, name: "bad-json" }, new Date(now.getTime() + 61_000));
    expect(fetched.filter((f) => f.url.endsWith("/bad-json"))).toHaveLength(2);
  });

  it("AC-014-07 attack: crafted names are rejected before any request, and another project's id is not found", async () => {
    for (const name of [
      "../-/whoami",
      "zod?write=true",
      "zod#",
      "@a/b/c",
      "%2e%2e",
      "zod\n",
      "a".repeat(215),
    ]) {
      const err = await checkPackage(token, { projectId, name }, now).catch((e) => e);
      expect(err, name).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(400);
      expect(Object.keys((err as AppError).fieldErrors ?? {})).toEqual(["name"]);
    }
    const badVersion = await checkPackage(
      token,
      { projectId, name: "zod", version: "../1" },
      now,
    ).catch((e) => e);
    expect((badVersion as AppError).fieldErrors).toHaveProperty("version");
    const other = await checkPackage(
      token,
      { projectId: "someone-elses-project", name: "zod" },
      now,
    ).catch((e) => e);
    expect((other as AppError).status).toBe(404);
    expect(fetched).toHaveLength(0);
  });
});

describe("new dependencies on receipts (FEAT-014)", () => {
  async function newRequest() {
    const feature = await featuresRepo.insert(world.db, projectId, { name: "Forms", key: "forms" });
    const created = await requestsRepo.createWithItems(
      world.db,
      projectId,
      { featureId: feature.id, text: "Add forms" },
      [{ text: "Validate the signup form", needsClarification: false }],
    );
    return created.request.id;
  }
  const marker = ["build", "secret", "script"].join("-");
  const before = JSON.stringify({ dependencies: { react: "^18.3.0" } });
  const after = JSON.stringify({
    scripts: { build: marker },
    dependencies: { react: "^18.3.0", zod: "3.23.8", "reactt-formz": "^1.0.0", local: "file:../x" },
  });

  it("AC-014-05 a receipt lists every newly added dependency from the package.json change with its check_package result", async () => {
    const requestId = await newRequest();
    const receipt = await generateReceipt(
      world.db,
      token,
      {
        projectId,
        requestId,
        changedFiles: [],
        packageJson: [{ path: "package.json", before, after }],
      },
      now,
    );
    expect(receipt.llm_calls).toBe(0);
    expect(receipt.new_dependencies.map((d) => [d.name, d.check?.status ?? d.note])).toEqual([
      ["zod", "EXISTS"],
      ["reactt-formz", "NOT_FOUND"],
      ["local", "not from the npm registry (git, file, link or workspace)"],
    ]);
    expect(receipt.new_dependencies[0]).toMatchObject({ range: "3.23.8", path: "package.json" });
    const [stored] = await receiptsRepo.list(world.db, projectId);
    expect(stored?.id).toBe(receipt.receipt_id);
    expect(JSON.stringify(stored?.summaryJson)).toContain("reactt-formz");
    // Only names, ranges and results are kept: nothing else from the package.json text.
    expect(JSON.stringify(stored?.summaryJson)).not.toContain(marker);
  });

  it("AC-014-05 each registry check counts against the existing per-minute limits", async () => {
    const requestId = await newRequest();
    const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    await rateCountersRepo.add(world.db, `mcp-project:${projectId}`, window, 299);
    const err = await generateReceipt(
      world.db,
      token,
      {
        projectId,
        requestId,
        changedFiles: [],
        packageJson: [{ path: "package.json", before, after }],
      },
      now,
    ).catch((e) => e);
    expect((err as AppError).status).toBe(429);
    expect(fetched).toHaveLength(0);
  });

  it("AC-014-05 attack: package.json text that is not a JSON object is rejected as invalid input", async () => {
    const requestId = await newRequest();
    const err = await generateReceipt(
      world.db,
      token,
      {
        projectId,
        requestId,
        changedFiles: [],
        packageJson: [{ path: "package.json", after: "[1,2]" }],
      },
      now,
    ).catch((e) => e);
    expect((err as AppError).status).toBe(400);
    expect((err as AppError).fieldErrors).toHaveProperty("packageJson.0");
  });
});
