// FEAT-014 security pass: attacker tests for check_package and new dependencies on receipts (crafted names, hostile
// registry documents, cooldown gaming, receipt diff tricks, caps, rate limits, cross-project, secret leakage).
// The npm registry is always mocked; fake secrets are built at runtime from chunks under 10 characters.
import { POST as mcp } from "@/app/mcp/route";
import { type CompleteRequest, type Llm, isValidPackageName } from "@brain/core";
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
import { registryUrl, setRegistryFetchForTests } from "./npm-registry";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

const now = new Date("2026-10-29T12:00:30Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const REGISTRY = "https://registry.npmjs.org";

// Fake secrets: chunks under 10 characters joined at runtime.
const fakeGithub = () => ["gh", "p_", "aB1cD2eF3", "gH4iJ5kL6", "mN7oP8qR9", "sT0uV1wX2"].join("");
const fakeGitlab = () => ["glp", "at-", "xY3zW9", "vU7tS5", "rQ1pO2", "n8"].join("");

type DocOptions = {
  times?: Record<string, string>;
  versions?: Record<string, Record<string, unknown>>;
  repository?: unknown;
  latest?: string;
  created?: string;
};

function packument(name: string, o: DocOptions = {}) {
  const times = o.times ?? { "1.0.0": daysAgo(400), "1.1.0": daysAgo(90) };
  const keys = Object.keys(times);
  return {
    name,
    "dist-tags": { latest: o.latest ?? keys[keys.length - 1] },
    versions: o.versions ?? Object.fromEntries(keys.map((v) => [v, { name, version: v }])),
    time: { created: o.created ?? daysAgo(2000), modified: daysAgo(1), ...times },
    repository:
      "repository" in o ? o.repository : { type: "git", url: "git+https://github.com/acme/x.git" },
  };
}

let docs: Map<string, () => Response | Promise<Response>>;
let fetched: string[];
const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const raw = (text: string) => () => new Response(text, { status: 200 });

let world: TestWorld;
let projectId: string;
let token: { id: string; projectId: string };
let bearer: string;
let otherProjectId: string;
let calls: CompleteRequest[];

function scripted(answer: string) {
  calls = [];
  const llm: Llm = {
    async complete(req) {
      calls.push(req);
      return answer;
    },
  };
  setLlmForTests(llm);
}

beforeEach(async () => {
  docs = new Map([["zod", json(packument("zod"))]]);
  fetched = [];
  setRegistryFetchForTests(async (url) => {
    fetched.push(url);
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    const respond = docs.get(name);
    return respond ? respond() : new Response('{"error":"Not found"}', { status: 404 });
  });
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  const created = await projectTokensRepo.create(world.db, projectId);
  token = created.row;
  bearer = created.token;
  const stranger = await world.createUser({ name: "stranger" });
  otherProjectId = (await projectsRepo.create(world.db, stranger.id, { name: "other" })).id;
  scripted("");
});

afterEach(async () => {
  setRegistryFetchForTests(null);
  setLlmForTests(undefined);
  vi.restoreAllMocks();
  await world.teardown();
});

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

async function newRequest(pid = projectId) {
  const feature = await featuresRepo.insert(world.db, pid, { name: "Forms", key: "forms" });
  const created = await requestsRepo.createWithItems(
    world.db,
    pid,
    { featureId: feature.id, text: "Add forms" },
    [{ text: "Validate the signup form", needsClarification: false }],
  );
  return created.request.id;
}

const check = (name: string, version?: string) =>
  checkPackage(token, { projectId, name, ...(version ? { version } : {}) }, now);

let rpcId = 1;
async function tool(name: string, args: Record<string, unknown>) {
  const res = await mcp(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = await res.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  const result = JSON.parse(data ? data.slice(6) : body).result as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0]?.text ?? "", isError: result.isError === true };
}

describe("FEAT-014 check_package security pass", () => {
  // ---- names and URLs ----------------------------------------------------------------------------------------
  it("AC-014-07 attack: no name that passes validation can leave the registry origin or add a path segment", () => {
    const tricky = [
      "-",
      "~",
      "@-/-",
      "@~/~",
      "a..b",
      "zod~",
      "zod.",
      "zod-",
      "@a/b.",
      "JSONStream",
    ];
    // Deterministic fuzz over the allowed alphabet plus the characters that matter for URLs.
    const alphabet = "aZ09._~-@/%?#:\\ ";
    let seed = 7;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const fuzz: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      let s = "";
      const len = 1 + Math.floor(rand() * 8);
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      fuzz.push(s);
    }
    let accepted = 0;
    for (const name of [...tricky, ...fuzz]) {
      if (!isValidPackageName(name)) {
        expect(() => registryUrl(name), name).toThrow();
        continue;
      }
      accepted++;
      const url = new URL(registryUrl(name));
      expect(url.origin, name).toBe(REGISTRY);
      expect(url.search + url.hash, name).toBe("");
      expect(url.pathname.slice(1).includes("/"), name).toBe(false);
      expect(decodeURIComponent(url.pathname.slice(1)), name).toBe(name);
    }
    expect(accepted).toBeGreaterThan(100);
  });

  it("AC-014-07 attack: unicode look-alikes, full-width and invisible characters in names are rejected before any request", async () => {
    for (const name of [
      "z\u043Ed", // Cyrillic o
      "\uFF5A\uFF4F\uFF44",
      `zod${String.fromCharCode(0x200b)}`,
      `zod${String.fromCharCode(0x202e)}`,
      `@acme${String.fromCharCode(0x2215)}ui`,
      "zod ",
      " zod",
      "zod%2F..",
      "@acme/",
      "@/x",
    ]) {
      const err = await errorOf(check(name));
      expect(err.status, name).toBe(400);
    }
    expect(fetched).toHaveLength(0);
  });

  it("AC-014-07 attack: a document served for a case variant is never accepted or reused for another name", async () => {
    // A registry (or proxy) that answers "Zod" with zod's document: the name does not match, so UNREACHABLE.
    docs.set("Zod", json(packument("zod")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await check("Zod")).status).toBe("UNREACHABLE");
    expect((await check("zod")).status).toBe("EXISTS");
    // A hostile document for "zod-evil" claiming no risk cannot poison zod's cached answer either.
    docs.set("zod-evil", json(packument("zod", { created: daysAgo(1) })));
    expect((await check("zod-evil")).status).toBe("UNREACHABLE");
    expect((await check("zod")).status).toBe("EXISTS");
    expect(fetched.filter((u) => u.endsWith("/zod"))).toHaveLength(1);
  });

  // ---- hostile registry documents ----------------------------------------------------------------------------
  it("AC-014-07 attack: __proto__ keys in dist-tags, time or repository never produce a verdict from inherited values", async () => {
    const base = (name: string, distTags: string, time: string, repo: string) =>
      `{"name":"${name}","dist-tags":${distTags},"time":${time},"versions":{"1.0.0":{}},"repository":${repo}}`;
    const okTime = `{"created":"${daysAgo(2000)}","1.0.0":"${daysAgo(400)}"}`;
    docs.set(
      "proto-tags",
      raw(base("proto-tags", '{"__proto__":{"latest":"1.0.0"}}', okTime, '"acme/x"')),
    );
    docs.set(
      "proto-time",
      raw(
        base(
          "proto-time",
          '{"latest":"1.0.0"}',
          `{"__proto__":{"created":"${daysAgo(2000)}","1.0.0":"${daysAgo(400)}"}}`,
          '"acme/x"',
        ),
      ),
    );
    docs.set(
      "proto-repo",
      raw(
        base(
          "proto-repo",
          '{"latest":"1.0.0"}',
          okTime,
          '{"__proto__":{"url":"https://github.com/acme/x"}}',
        ),
      ),
    );
    docs.set(
      "proto-doc",
      raw(`{"__proto__":{"name":"proto-doc","dist-tags":{"latest":"1.0.0"},"time":${okTime}}}`),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await check("proto-tags")).status).toBe("UNREACHABLE");
    expect((await check("proto-time")).status).toBe("UNREACHABLE");
    expect((await check("proto-doc")).status).toBe("UNREACHABLE");
    const repo = await check("proto-repo");
    expect(repo.status).toBe("RISKY");
    expect(repo.repository).toBeNull();
    expect(repo.warnings).toContain("no repository link");
    expect(({} as Record<string, unknown>).latest).toBeUndefined();
  });

  it("AC-014-07 attack: weird JSON values (null, arrays, numbers, deep nesting) are UNREACHABLE and never throw", async () => {
    const deep = `${"[".repeat(100_000)}${"]".repeat(100_000)}`;
    const bodies: Record<string, string> = {
      "w-null": "null",
      "w-num": "42",
      "w-str": '"zod"',
      "w-deep": `{"name":"w-deep","time":${deep}}`,
      "w-tags-arr": `{"name":"w-tags-arr","dist-tags":["1.0.0"],"time":{"created":"${daysAgo(9)}"}}`,
      "w-latest-num": `{"name":"w-latest-num","dist-tags":{"latest":1},"time":{"created":"${daysAgo(9)}","1":"${daysAgo(9)}"}}`,
      "w-date-num": `{"name":"w-date-num","dist-tags":{"latest":"1.0.0"},"time":{"created":1,"1.0.0":"${daysAgo(9)}"}}`,
      "w-latest-missing": `{"name":"w-latest-missing","dist-tags":{"latest":"9.9.9"},"time":{"created":"${daysAgo(900)}","1.0.0":"${daysAgo(900)}"}}`,
      "w-bom": `﻿{"name":"w-bom"}`,
    };
    for (const [name, body] of Object.entries(bodies)) docs.set(name, raw(body));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const name of Object.keys(bodies)) {
      const result = await check(name);
      expect(result.status, name).toBe("UNREACHABLE");
      expect(result.recommendation, name).toBe("verify_manually");
    }
  });

  it("AC-014-07 attack: a huge version map under the size cap is handled without crashing", async () => {
    const times: Record<string, string> = {};
    for (let i = 0; i < 50_000; i++) times[`1.${i}.0`] = daysAgo(400 + (i % 50));
    times["2.0.0"] = daysAgo(1);
    docs.set("many-versions", json(packument("many-versions", { times })));
    const result = await check("many-versions");
    expect(result.status).toBe("RISKY");
    expect(result.version).toBe("2.0.0");
    expect(result.suggested_version).toBe("1.49999.0");
  });

  it("AC-014-03 attack: created and release dates in the future are RISKY, never EXISTS", async () => {
    docs.set(
      "future-created",
      json(packument("future-created", { created: "9999-01-01T00:00:00.000Z" })),
    );
    docs.set(
      "future-version",
      json(
        packument("future-version", {
          times: { "1.0.0": daysAgo(400), "1.1.0": "+275760-09-13T00:00:00.000Z" },
        }),
      ),
    );
    const created = await check("future-created");
    expect(created.status).toBe("RISKY");
    expect(created.recommendation).not.toBe("ok_to_install");
    const version = await check("future-version");
    expect(version.status).toBe("RISKY");
    expect(version.suggested_version).toBe("1.0.0");
  });

  it("AC-014-03 attack: a meaningless repository value ('../..', './.') counts as no repository link", async () => {
    for (const [i, repository] of ["../..", "./.", "-/-", ".../..."].entries()) {
      const name = `odd-repo-${i}`;
      docs.set(name, json(packument(name, { repository })));
      const result = await check(name);
      expect(result.repository, repository).toBeNull();
      expect(result.status, repository).toBe("RISKY");
      expect(result.warnings, repository).toContain("no repository link");
    }
  });

  it("AC-014-03 attack: control, bidi-override and line-separator characters in the repository never reach the output", async () => {
    const chars = [0x1b, 0x0a, 0x85, 0x2028, 0x202e, 0x2067].map((c) => String.fromCharCode(c));
    for (const [i, c] of chars.entries()) {
      const name = `ctl-repo-${i}`;
      docs.set(name, json(packument(name, { repository: `https://github.com/acme/x${c}y` })));
      const result = await check(name);
      expect(JSON.stringify(result).includes(c), `U+${c.charCodeAt(0).toString(16)}`).toBe(false);
    }
  });

  it("AC-014-03 attack: invisible direction marks (LRM, RLM, ALM) in the repository link never reach the output", async () => {
    const marks = [0x200e, 0x200f, 0x061c].map((c) => String.fromCharCode(c));
    for (const [i, c] of marks.entries()) {
      const name = `mark-repo-${i}`;
      docs.set(
        name,
        json(packument(name, { repository: `https://github.com/acme/evil${c}/x.git` })),
      );
      const result = await check(name);
      expect(JSON.stringify(result).includes(c), `U+${c.charCodeAt(0).toString(16)}`).toBe(false);
    }
  });

  it("AC-014-01 attack: user:password credentials in a repository URL are masked in the output", async () => {
    const secret = fakeGitlab();
    docs.set(
      "creds-pass",
      json(
        packument("creds-pass", { repository: `https://oauth2:${secret}@gitlab.com/acme/x.git` }),
      ),
    );
    const result = await check("creds-pass");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.repository).toContain(secret.slice(0, 4));
  });

  it("AC-014-01 attack: a token used as the URL user name (https://TOKEN@host) is masked in the output", async () => {
    const secret = fakeGitlab();
    docs.set(
      "creds-user",
      json(packument("creds-user", { repository: `https://${secret}@gitlab.com/acme/x.git` })),
    );
    const result = await check("creds-user");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("AC-014-01 attack: a secret-shaped package name is masked in check_package's answer", async () => {
    const secret = fakeGithub();
    expect(isValidPackageName(secret)).toBe(true);
    const result = await check(secret);
    expect(result.status).toBe("NOT_FOUND");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  // ---- cooldown and suggestions ------------------------------------------------------------------------------
  it("AC-014-06 attack: a version that was unpublished (still in time, gone from versions) is never suggested or called ok", async () => {
    // Real npm documents keep unpublished versions in `time` but drop them from `versions`.
    docs.set(
      "pulled",
      json(
        packument("pulled", {
          times: { "1.0.0": daysAgo(400), "1.0.5": daysAgo(100), "1.1.0": daysAgo(2) },
          versions: { "1.0.0": {}, "1.1.0": {} },
        }),
      ),
    );
    const latest = await check("pulled");
    expect(latest.status).toBe("RISKY");
    expect(latest.suggested_version).toBe("1.0.0");
    const pulled = await check("pulled", "1.0.5");
    expect(pulled.status).not.toBe("EXISTS");
    expect(pulled.recommendation).not.toBe("ok_to_install");
  });

  it("AC-014-06 attack: a deprecated version (e.g. pulled for malware) is never the suggested older version", async () => {
    docs.set(
      "deprecated-pick",
      json(
        packument("deprecated-pick", {
          times: { "1.0.0": daysAgo(400), "1.0.5": daysAgo(100), "1.1.0": daysAgo(2) },
          versions: {
            "1.0.0": {},
            "1.0.5": { deprecated: "compromised release, do not use" },
            "1.1.0": {},
          },
        }),
      ),
    );
    const result = await check("deprecated-pick");
    expect(result.status).toBe("RISKY");
    expect(result.suggested_version).toBe("1.0.0");
  });

  it("AC-014-06 attack: prerelease versions are never suggested and the 7-day boundary is not off by one", async () => {
    docs.set(
      "edge",
      json(
        packument("edge", {
          times: {
            "1.0.0": daysAgo(30),
            "2.0.0-rc.1": daysAgo(20),
            "1.0.1": new Date(now.getTime() - 7 * 86_400_000 + 1000).toISOString(),
            "1.0.2": daysAgo(1),
          },
        }),
      ),
    );
    const result = await check("edge");
    expect(result.status).toBe("RISKY");
    expect(result.suggested_version).toBe("1.0.0");
    const almost = await check("edge", "1.0.1");
    expect(almost.status).toBe("RISKY");
  });

  // ---- route, rate limits, cross-project ---------------------------------------------------------------------
  it("AC-014-01 attack: through the real /mcp route, check_package counts against the per-minute limits and another project's id is not found", async () => {
    const asB = await tool("check_package", { projectId: otherProjectId, name: "zod" });
    expect(asB.isError).toBe(true);
    expect(JSON.parse(asB.text).message).toBe("not_found");
    const crafted = await tool("check_package", { projectId, name: "../-/whoami" });
    expect(crafted.isError).toBe(true);
    expect(fetched).toHaveLength(0);
    // Fill the project's counter for this minute and the next, so the test cannot straddle a window.
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    for (const w of [minute, minute + 60_000]) {
      await rateCountersRepo.add(world.db, `mcp-project:${projectId}`, new Date(w), 300);
    }
    const limited = await tool("check_package", { projectId, name: "zod" });
    expect(limited.isError).toBe(true);
    expect(JSON.parse(limited.text).message).toBe("rate_limited");
    expect(fetched).toHaveLength(0);
  });

  it("AC-014-05 attack: project A's token cannot receipt project B, and A's registry checks never use B's limits", async () => {
    const otherRequest = await newRequest(otherProjectId);
    const after = JSON.stringify({ dependencies: { zod: "3.23.8" } });
    const err = await errorOf(
      generateReceipt(
        world.db,
        token,
        {
          projectId: otherProjectId,
          requestId: otherRequest,
          changedFiles: [],
          packageJson: [{ path: "package.json", after }],
        },
        now,
      ),
    );
    expect(err.status).toBe(404);
    expect(fetched).toHaveLength(0);
    const requestId = await newRequest();
    await generateReceipt(
      world.db,
      token,
      { projectId, requestId, changedFiles: [], packageJson: [{ path: "package.json", after }] },
      now,
    );
    const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    expect(await rateCountersRepo.add(world.db, `mcp-project:${otherProjectId}`, window, 0)).toBe(
      0,
    );
    expect(await rateCountersRepo.add(world.db, `mcp-project:${projectId}`, window, 0)).toBe(1);
  });

  // ---- receipts: diff tricks, caps, leakage ------------------------------------------------------------------
  it("AC-014-05 attack: re-pointing an existing dependency to an npm: alias or a git URL is reported as a new dependency", async () => {
    const requestId = await newRequest();
    const before = JSON.stringify({ dependencies: { lodash: "^4.17.21", ui: "^1.0.0" } });
    const after = JSON.stringify({
      dependencies: { lodash: "npm:lodash-evil@1.0.0", ui: "github:evil/ui" },
    });
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
    const names = receipt.new_dependencies.map((d) => d.name);
    expect(names).toContain("lodash");
    expect(names).toContain("ui");
    const lodash = receipt.new_dependencies.find((d) => d.name === "lodash");
    expect(lodash?.check?.status).toBe("NOT_FOUND");
  });

  it("AC-014-04 attack: a known-hallucinated name hidden behind an npm: alias or a case change is still flagged on a receipt", async () => {
    docs.set("huggingface-cli", json(packument("huggingface-cli")));
    docs.set("Unused-Imports", json(packument("Unused-Imports")));
    const requestId = await newRequest();
    const after = JSON.stringify({
      dependencies: { "my-cli": "npm:huggingface-cli@1.1.0", "Unused-Imports": "1.1.0" },
    });
    const receipt = await generateReceipt(
      world.db,
      token,
      { projectId, requestId, changedFiles: [], packageJson: [{ path: "package.json", after }] },
      now,
    );
    for (const dep of receipt.new_dependencies) {
      expect(dep.check?.recommendation, dep.name).toBe("do_not_install");
    }
  });

  it("AC-014-05 attack: secret-shaped dependency names and alias targets are masked in the stored and returned receipt", async () => {
    const secret = fakeGithub();
    const requestId = await newRequest();
    const after = JSON.stringify({
      dependencies: { [secret]: "1.0.0", "innocent-alias": `npm:${secret}@1.0.0` },
    });
    const receipt = await generateReceipt(
      world.db,
      token,
      { projectId, requestId, changedFiles: [], packageJson: [{ path: "package.json", after }] },
      now,
    );
    expect(JSON.stringify(receipt)).not.toContain(secret);
    const [stored] = await receiptsRepo.list(world.db, projectId);
    expect(JSON.stringify(stored?.summaryJson)).not.toContain(secret);
  });

  it("AC-014-05 attack: a package.json with tens of thousands of new dependency keys cannot bloat the stored receipt", async () => {
    const requestId = await newRequest();
    const deps: Record<string, string> = {};
    let text = "";
    for (let i = 0; ; i++) {
      deps[`d${i}`] = "1";
      if (i % 1000 === 0) {
        text = JSON.stringify({ dependencies: deps });
        if (text.length > 240_000) break;
      }
    }
    const receipt = await generateReceipt(
      world.db,
      token,
      {
        projectId,
        requestId,
        changedFiles: [],
        packageJson: [{ path: "package.json", after: text }],
      },
      now,
    );
    expect(fetched.length).toBeLessThanOrEqual(20);
    const [stored] = await receiptsRepo.list(world.db, projectId);
    expect(stored?.id).toBe(receipt.receipt_id);
    // The stored receipt stays small: a capped list plus a count/marker, not one row per key.
    expect(JSON.stringify(stored?.summaryJson).length).toBeLessThan(200_000);
  });

  it("AC-014-05 attack: package.json text that is not JSON is rejected before the AI judging call spends budget", async () => {
    scripted("1 | done | src/forms/Form.tsx");
    const requestId = await newRequest();
    const err = await errorOf(
      generateReceipt(
        world.db,
        token,
        {
          projectId,
          requestId,
          changedFiles: ["src/forms/Form.tsx"],
          packageJson: [{ path: "package.json", after: "{not json" }],
        },
        now,
      ),
    );
    expect(err.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("AC-014-05 attack: when the registry checks are over the per-minute limit, no AI judging call is spent", async () => {
    scripted("1 | done | src/forms/Form.tsx");
    const requestId = await newRequest();
    const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    await rateCountersRepo.add(world.db, `mcp-project:${projectId}`, window, 299);
    const after = JSON.stringify({ dependencies: { zod: "3.23.8", "left-pad": "1.3.0" } });
    const err = await errorOf(
      generateReceipt(
        world.db,
        token,
        {
          projectId,
          requestId,
          changedFiles: ["src/forms/Form.tsx"],
          packageJson: [{ path: "package.json", after }],
        },
        now,
      ),
    );
    expect(err.status).toBe(429);
    expect(fetched).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("AC-014-05 attack: nothing from package.json beyond names, ranges and results is stored or logged", async () => {
    const marker = ["post", "install", "-", "curl", "-evil"].join("");
    const secret = fakeGithub();
    const logs: string[] = [];
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    const requestId = await newRequest();
    const after = JSON.stringify({
      scripts: { postinstall: marker },
      config: { token: secret },
      dependencies: { zod: "3.23.8", "git-dep": `git+https://user:${secret}@github.com/a/b.git` },
    });
    const receipt = await generateReceipt(
      world.db,
      token,
      { projectId, requestId, changedFiles: [], packageJson: [{ path: "package.json", after }] },
      now,
    );
    const [stored] = await receiptsRepo.list(world.db, projectId);
    for (const text of [JSON.stringify(receipt), JSON.stringify(stored?.summaryJson), ...logs]) {
      expect(text).not.toContain(marker);
      expect(text).not.toContain(secret);
    }
  });
});
