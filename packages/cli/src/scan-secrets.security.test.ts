// FEAT-015 security pass (independent review): attacker and realistic-input tests for `projectbrain scan-secrets` and
// the Supabase flags upload. Fake secrets are built at runtime from chunks under 10 characters.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SupabaseReadResult } from "@brain/core";
import * as esbuild from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { type CliDeps, main } from "./index";
import { uploadSupabaseFlags } from "./supabase-upload";

const reader = vi.hoisted(() => ({ result: null as SupabaseReadResult | null, calls: 0 }));
vi.mock("@brain/core", async (orig) => {
  const actual = await orig<typeof import("@brain/core")>();
  return {
    ...actual,
    readSupabaseMigrations: (
      dir: string,
      sandbox: Parameters<typeof actual.readSupabaseMigrations>[1],
    ) =>
      reader.result
        ? Promise.resolve(reader.result).finally(() => reader.calls++)
        : actual.readSupabaseMigrations(dir, sandbox),
  };
});

const chunk = "aB3dE5gH7j";
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const serviceRole = () =>
  [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ iss: "supabase", ref: "abcdefghij", role: "service_role" }),
    [chunk, chunk, chunk, chunk].join(""),
  ].join(".");
const openai = () => ["sk", "-proj-", chunk, chunk, chunk].join("");

function gitRepo() {
  const repo = mkdtempSync(join(tmpdir(), "pb-scan-sec-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/index.ts"), "export {};\n");
  return { repo, git };
}

async function scan(cwd: string, args: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    fetch: async () => {
      throw new Error("scan-secrets must not use the network");
    },
    env: {},
    cwd,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
  };
  const code = await main(["scan-secrets", ...args], deps);
  return { code, out, err, report: JSON.parse(out[0] ?? "{}") };
}

describe("FEAT-015 scan-secrets security pass", () => {
  it("AC-015-01 attack: changed files whose names git prints quoted (unicode, a double quote) are still scanned", async () => {
    const { repo, git } = gitRepo();
    writeFileSync(join(repo, "src/café.tsx"), "export {};\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    // A tracked file with a non-ASCII name changes, and a new untracked one appears.
    writeFileSync(join(repo, "src/café.tsx"), `"use client";\nconst k = "${openai()}";\n`);
    writeFileSync(join(repo, "src/zürich client.ts"), `const k = "${openai()}";\n`);
    writeFileSync(join(repo, 'src/say"hi".ts'), `const k = "${openai()}";\n`);
    const { code, report } = await scan(repo);
    expect(code).toBe(0);
    expect(
      report.findings.map((f: { file: string; line: number }) => [f.file, f.line]).sort(),
    ).toEqual([
      ["src/café.tsx", 2],
      ['src/say"hi".ts', 1],
      ["src/zürich client.ts", 1],
    ]);
  });

  it("AC-015-01 attack: a committed .env that gains a service-role key (NEXT_PUBLIC_, shipped to the browser) is flagged", async () => {
    const { repo, git } = gitRepo();
    writeFileSync(join(repo, ".env"), "NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    writeFileSync(
      join(repo, ".env"),
      `NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nNEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=${serviceRole()}\n`,
    );
    const { report } = await scan(repo);
    expect(report.findings).toEqual([
      { file: ".env", line: 2, type: "supabase_service_role_key", masked_value: "eyJh***" },
    ]);
  });

  it("AC-015-03 attack: a named file reached through a symlinked folder that points outside the repo is not read", async () => {
    const { repo } = gitRepo();
    const outside = mkdtempSync(join(tmpdir(), "pb-outside-dir-"));
    writeFileSync(join(outside, "keys.ts"), `const k = "${openai()}";\n`);
    symlinkSync(outside, join(repo, "src/vendor"), "dir");
    const { report } = await scan(repo, ["src/vendor/keys.ts"]);
    expect(report.findings).toEqual([]);
    expect(report.scanned).toBe(0);
  });

  it("AC-015-01 attack: a 1 MB line crafted against the JWT pattern cannot stall the scan (ReDoS)", async () => {
    // The detector runs in a child node process so a stalled regex can be stopped; 60 s is ~100x a linear scan.
    const dir = mkdtempSync(join(tmpdir(), "pb-redos-"));
    const outfile = join(dir, "secrets.mjs");
    await esbuild.build({
      entryPoints: [fileURLToPath(new URL("../../core/src/secrets.ts", import.meta.url))],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    const script = [
      `const { scanSecrets } = await import(${JSON.stringify(pathToFileURL(outfile).href)});`,
      `scanSecrets("dist/bundle.js", "eyJ-".repeat(250000));`,
      `process.stdout.write("done");`,
    ].join("\n");
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 60_000,
      encoding: "utf8",
    });
    expect(run.signal).toBeNull();
    expect(run.stdout).toBe("done");
  }, 90_000);
});

describe("FEAT-015 Supabase flags upload security pass", () => {
  const config = { apiUrl: "https://brain.test", projectId: "proj-1", token: "pb_test-token" };
  const retry = { sleep: async () => {}, print: () => {} };

  async function uploadWith(result: SupabaseReadResult) {
    const root = mkdtempSync(join(tmpdir(), "pb-supa-sec-"));
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    reader.result = result;
    reader.calls = 0;
    const bodies: { tables: { name: string; rlsEnabled: boolean; rlsUnknown: boolean }[] }[] = [];
    try {
      await uploadSupabaseFlags(
        async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true, tables: 0, policies: 0 });
        },
        config,
        root,
        undefined,
        () => {},
        retry,
        // The reader is mocked, so the sandbox is never started.
        async () =>
          ({}) as Awaited<ReturnType<NonNullable<Parameters<typeof uploadSupabaseFlags>[6]>>>,
      ).catch(() => {});
    } finally {
      reader.result = null;
    }
    expect(reader.calls).toBe(1);
    return bodies;
  }

  it("AC-015-06 attack: when the migrations folder cannot be read, the CLI does not upload an empty, all-clear table list", async () => {
    const bodies = await uploadWith({
      root: "/x",
      tables: [],
      policies: [],
      errors: [{ file: ".", message: "cannot read migrations dir: EIO" }],
    });
    // Either nothing is uploaded (the last known flags stay) or the upload cannot read as "no tables, all safe".
    for (const body of bodies) expect(body.tables.length).toBeGreaterThan(0);
  });

  it("AC-015-06 attack: when one migration file cannot be read, no uploaded table is reported as RLS enabled", async () => {
    // The tables created in 0002 are missing from the result and 0002 may disable RLS on todos: nothing is confirmed.
    const bodies = await uploadWith({
      root: "/x",
      tables: [
        {
          schema: "public",
          name: "todos",
          file: "0001_init.sql",
          columns: [],
          rlsEnabled: true,
          rlsUnknown: false,
        },
      ],
      policies: [],
      errors: [{ file: "0002_more.sql", message: "read failed: EIO" }],
    });
    for (const body of bodies) {
      for (const t of body.tables) expect([t.name, t.rlsEnabled]).toEqual([t.name, false]);
    }
  });
});
