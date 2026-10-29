import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";

// Fake secrets are built at runtime from chunks under 10 characters.
const chunk = "aB3dE5gH7j";
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) =>
  [
    b64url({ alg: "HS256" }),
    b64url({ iss: "supabase", role, ref: "abcdefghij" }),
    chunk.repeat(4),
  ].join(".");
const serviceRole = jwt("service_role");
const openai = ["sk", "-proj-", chunk, chunk, chunk].join("");

function gitRepo() {
  const repo = mkdtempSync(join(tmpdir(), "pb-scan-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  mkdirSync(join(repo, "src/app"), { recursive: true });
  writeFileSync(
    join(repo, "src/app/page.tsx"),
    "export default function Page() { return null; }\n",
  );
  writeFileSync(join(repo, "src/old.ts"), `const key = "${openai}";\n`);
  git("add", ".");
  git("commit", "-q", "-m", "base");
  return repo;
}

function run(cwd: string, args: string[] = []) {
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
  return main(["scan-secrets", ...args], deps).then((code) => ({ code, out, err }));
}

describe("FEAT-015 projectbrain scan-secrets", () => {
  it("AC-015-01 scans only the changed files and prints masked findings with file and line", async () => {
    const repo = gitRepo();
    const line = `const admin = createClient(url, "${serviceRole}"); // ADMIN_CLIENT_MARKER`;
    writeFileSync(join(repo, "src/app/page.tsx"), `"use client";\n${line}\n`);
    writeFileSync(join(repo, "src/app/new.ts"), `export const anon = "${jwt("anon")}";\n`);
    mkdirSync(join(repo, "sub"));
    const { code, out } = await run(join(repo, "sub"));
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const report = JSON.parse(out[0] ?? "{}");
    expect(report.findings).toEqual([
      {
        file: "src/app/page.tsx",
        line: 2,
        type: "supabase_service_role_key",
        masked_value: "eyJh***",
      },
    ]);
    // src/old.ts did not change, so its key is not reported in this change's scan.
    expect(report.scanned).toBe(2);
  });

  it("AC-015-03 attack: the output never holds a secret or a source line; .env, symlinks and named files outside the repo are not read", async () => {
    const repo = gitRepo();
    writeFileSync(join(repo, ".env"), `OPENAI_API_KEY=${openai}\n`);
    const outside = mkdtempSync(join(tmpdir(), "pb-outside-"));
    writeFileSync(join(outside, "keys.ts"), `const k = "${openai}";\n`);
    symlinkSync(join(outside, "keys.ts"), join(repo, "src/link.ts"));
    writeFileSync(join(repo, "src/pay.ts"), `const PAY_CONFIG_MARKER = { key: "${openai}" };\n`);
    const changed = await run(repo);
    const named = await run(repo, ["src/pay.ts", join(outside, "keys.ts")]);
    for (const { out } of [changed, named]) {
      const text = out.join("\n");
      expect(text).not.toContain(openai.slice(0, 8));
      expect(text).not.toContain("PAY_CONFIG_MARKER");
    }
    expect(JSON.parse(changed.out[0] ?? "{}").findings).toEqual([
      { file: "src/pay.ts", line: 1, type: "openai_api_key", masked_value: "sk-p***" },
    ]);
    expect(JSON.parse(named.out[0] ?? "{}").skipped).toEqual([
      { file: expect.stringMatching(/^\.\.\//), reason: "outside this folder" },
    ]);
  });
});
