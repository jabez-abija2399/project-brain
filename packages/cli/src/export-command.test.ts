import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECTION_END, SECTION_START } from "@brain/core";
import { describe, expect, it } from "vitest";
import { configPath } from "./config";
import { main } from "./index";
import { linkRepo } from "./test-support";

// Roadmap Phase 8: `codeceipt export` on a real git repo, with a fake server.
const PROJECT = "11111111-2222-3333-4444-555555555555";
const BLUEPRINT = {
  ok: true,
  ready: true,
  version: 3,
  features: [
    {
      name: "Photo albums",
      purpose: null,
      dependsOn: [],
      criteria: [{ text: "The system shall never show another user's albums", kind: "must_never" }],
    },
  ],
  boundaries: [],
};

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "cc-export-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return dir;
}

async function run(dir: string, argv: string[], answer: unknown = BLUEPRINT) {
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  linkRepo(dir, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
    apiUrl: "https://codeceipt.example",
    projectId: PROJECT,
    token: ["pb", "_", "testtoken123"].join(""),
  });
  const urls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    cwd: dir,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
  });
  return { code, text: out.join("\n"), err: err.join("\n"), urls };
}

describe("codeceipt export (roadmap Phase 8)", () => {
  it("PH8-28 agents: shows the change, --write adds the section and keeps the owner's text, --check then passes", async () => {
    const dir = repo();
    writeFileSync(join(dir, "AGENTS.md"), "# AGENTS.md\nMy rules.\n");
    const dry = await run(dir, ["export", "--to", "agents"]);
    expect(dry.code).toBe(0);
    expect(dry.urls).toEqual([`https://codeceipt.example/api/hooks/${PROJECT}/blueprint`]);
    expect(dry.text).toContain("update AGENTS.md");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("# AGENTS.md\nMy rules.\n");
    expect((await run(dir, ["export", "--to", "agents", "--check"])).code).toBe(1);
    const wrote = await run(dir, ["export", "--to", "agents", "--write"]);
    expect(wrote.text).toContain("wrote 1 file");
    const text = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(text.startsWith("# AGENTS.md\nMy rules.\n")).toBe(true);
    expect(text).toContain(SECTION_START);
    expect(text).toContain("- Must never: The system shall never show another user's albums");
    const check = await run(dir, ["export", "--to", "agents", "--check"]);
    expect(check.code).toBe(0);
    expect(check.text).toContain("up to date with Blueprint version 3");
  });

  it("PH8-29 speckit: creates the spec, rewrites only files it wrote, and never a hand-written one", async () => {
    const dir = repo();
    await run(dir, ["export", "--to", "speckit", "--write"]);
    const spec = join(dir, "specs/001-photo-albums/spec.md");
    expect(readFileSync(spec, "utf8")).toContain("# Feature Specification: Photo albums");
    const changed = {
      ...BLUEPRINT,
      version: 4,
      features: [
        {
          ...BLUEPRINT.features[0],
          criteria: [{ text: "Users can rename an album", kind: "behaviour" }],
        },
      ],
    };
    expect((await run(dir, ["export", "--to", "speckit", "--write"], changed)).text).toContain(
      "wrote 1 file",
    );
    writeFileSync(spec, "# My own spec\n");
    const kept = await run(dir, ["export", "--to", "speckit", "--write"], changed);
    expect(kept.text).toContain(
      "keep   specs/001-photo-albums/spec.md (written by hand; left as it is)",
    );
    expect(readFileSync(spec, "utf8")).toBe("# My own spec\n");
  });

  it("PH8-30 attack: a symlinked AGENTS.md or spec folder is never written through", async () => {
    const dir = repo();
    const outside = mkdtempSync(join(tmpdir(), "cc-outside-"));
    writeFileSync(join(outside, "target.md"), "outside\n");
    symlinkSync(join(outside, "target.md"), join(dir, "AGENTS.md"));
    const a = await run(dir, ["export", "--to", "agents", "--write"]);
    expect(a.text).toContain("keep   AGENTS.md (a link or not a plain file)");
    expect(readFileSync(join(outside, "target.md"), "utf8")).toBe("outside\n");
    symlinkSync(outside, join(dir, "openspec"));
    await run(dir, ["export", "--to", "openspec", "--write"]);
    expect(existsSync(join(outside, "specs"))).toBe(false);
  });

  it("PH8-31 broken markers leave AGENTS.md alone; a server without the Blueprint exports nothing; bad flags are usage errors", async () => {
    const dir = repo();
    writeFileSync(join(dir, "AGENTS.md"), `# AGENTS.md\n${SECTION_START}\nhalf a section\n`);
    const r = await run(dir, ["export", "--to", "agents", "--write"]);
    expect(r.text).toContain("markers are broken");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).not.toContain(SECTION_END);
    const notReady = await run(dir, ["export", "--to", "openspec", "--write"], {
      ok: true,
      ready: false,
      version: 0,
      features: [],
      boundaries: [],
    });
    expect(notReady.text).toContain("not set up");
    mkdirSync(join(dir, "x"));
    expect((await run(dir, ["export", "--to", "evil"])).code).toBe(2);
    expect((await run(dir, ["export", "--to", "agents", "--write", "--check"])).code).toBe(2);
  });
});
