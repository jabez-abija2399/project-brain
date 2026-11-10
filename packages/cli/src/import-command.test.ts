import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath } from "./config";
import { main } from "./index";
import { linkRepo } from "./test-support";

// Roadmap Phase 8: `codeceipt import` on a real git repo, with a fake server.
const PROJECT = "11111111-2222-3333-4444-555555555555";
const SPEC = [
  "# Feature Specification: Photo albums",
  "- **FR-001**: System MUST let users create albums",
  "- **FR-002**: System MUST NOT show another user's albums",
].join("\n");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "cc-import-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  mkdirSync(join(dir, "specs/001-albums"), { recursive: true });
  writeFileSync(join(dir, "specs/001-albums/spec.md"), SPEC);
  return dir;
}

async function run(dir: string, argv: string[], linked = true) {
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  if (linked) {
    linkRepo(dir, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
      apiUrl: "https://codeceipt.example",
      projectId: PROJECT,
      token: ["pb", "_", "testtoken123"].join(""),
    });
  }
  const sent: { url: string; body: unknown }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    fetch: async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(
        JSON.stringify({
          ok: true,
          draft_id: "d1",
          features: 1,
          criteria: 2,
          skipped: [],
          more: 0,
          cut_items: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    cwd: dir,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
  });
  return { code, text: out.join("\n"), err: err.join("\n"), sent };
}

describe("codeceipt import (roadmap Phase 8)", () => {
  it("PH8-14 finds the Spec Kit spec, sends only names, criteria and lines, and points to the Plan tab", async () => {
    const dir = repo();
    const r = await run(dir, ["import"]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("Codeceipt import (speckit): 1 feature, 2 criteria from 1 file.");
    expect(r.text).toContain("Photo albums (2) specs/001-albums/spec.md:1");
    expect(r.sent.map((s) => s.url)).toEqual([
      `https://codeceipt.example/api/hooks/${PROJECT}/import`,
    ]);
    expect(r.sent[0]?.body).toEqual({
      source: "speckit",
      features: [
        {
          name: "Photo albums",
          path: "specs/001-albums/spec.md",
          line: 1,
          dependsOn: [],
          items: [
            { text: "System MUST let users create albums", kind: "happy", line: 2 },
            { text: "System MUST NOT show another user's albums", kind: "negative", line: 3 },
          ],
        },
      ],
    });
    expect(r.text).toContain(`https://codeceipt.example/projects/${PROJECT}/plan`);
    expect(r.text).toContain("Nothing is active yet.");
  });

  it("PH8-15 --dry-run sends nothing; two kinds of spec need --from; unknown kinds are a usage error", async () => {
    const dir = repo();
    const dry = await run(dir, ["import", "--dry-run"]);
    expect(dry.sent).toEqual([]);
    expect(dry.text).toContain("Dry run: nothing was sent.");
    writeFileSync(
      join(dir, "AGENTS.md"),
      "# Rules\n- Never store user source code in the database\n",
    );
    const both = await run(dir, ["import"]);
    expect(both.code).toBe(2);
    expect(both.text).toContain("speckit, agents");
    const agents = await run(dir, ["import", "--from", "agents", "--dry-run"]);
    expect(agents.text).toContain("Project rules (1) AGENTS.md:1");
    expect((await run(dir, ["import", "--from", "evil"])).code).toBe(2);
  });

  it("PH8-16 attack: a symlinked spec pointing outside the repo is never read; an unlinked repo sends nothing", async () => {
    const dir = repo();
    const outside = mkdtempSync(join(tmpdir(), "cc-outside-"));
    writeFileSync(join(outside, "spec.md"), "- **FR-001**: secret plan from outside\n");
    mkdirSync(join(dir, "specs/002-link"), { recursive: true });
    symlinkSync(join(outside, "spec.md"), join(dir, "specs/002-link/spec.md"));
    const r = await run(dir, ["import", "--dry-run"]);
    expect(r.text).not.toContain("secret plan");
    expect(r.text).toContain("from 1 file");
    const unlinked = await run(dir, ["import"], false);
    expect(unlinked.sent).toEqual([]);
    expect(unlinked.code).not.toBe(0);
  });
});
