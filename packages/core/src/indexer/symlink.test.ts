import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexRepo } from "./index";

// Every path the indexer hands to the filesystem, so a test can prove an outside path is never looked up.
const touched: string[] = [];
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const spy =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      if (typeof args[0] === "string") touched.push(args[0]);
      return fn(...args);
    };
  return {
    ...real,
    existsSync: spy(real.existsSync),
    lstatSync: spy(real.lstatSync),
    openSync: spy(real.openSync),
    readFileSync: spy(real.readFileSync),
    readdirSync: spy(real.readdirSync),
    realpathSync: spy(real.realpathSync),
    statSync: spy(real.statSync),
  };
});

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), "brain-indexer-symlink-"));
  temps.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(dirname(join(root, rel)), { recursive: true });
    fs.writeFileSync(join(root, rel), content);
  }
}

afterEach(() => {
  touched.length = 0;
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("indexer symlink and outside-root hardening", () => {
  it("AC-004-08 never follows or reads a symlinked file or folder and lists it as skipped symlink", async () => {
    const parent = tempDir();
    const outside = join(parent, "outside");
    const repo = join(parent, "repo");
    writeTree(outside, {
      "Secret.tsx": "export function Secret() { return <div/>; }\n",
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@x/*": ["./src/*"] } } }),
    });
    writeTree(repo, {
      "src/Ok.tsx": 'import "@x/Ok";\nexport function Ok() { return <div/>; }\n',
    });
    fs.symlinkSync(outside, join(repo, "src", "outdir"));
    fs.symlinkSync(join(outside, "Secret.tsx"), join(repo, "src", "Secret.tsx"));
    fs.symlinkSync(parent, join(repo, "src", "ancestor"));
    fs.symlinkSync(repo, join(repo, "src", "self"));
    fs.symlinkSync(join(outside, "tsconfig.json"), join(repo, "tsconfig.json"));

    const result = await indexRepo(repo);

    expect(result.files.map((f) => f.path)).toEqual(["src/Ok.tsx"]);
    expect(result.components.map((c) => c.name)).toEqual(["Ok"]);
    expect(result.skipped).toEqual([
      { path: "src/ancestor", reason: "symlink" },
      { path: "src/outdir", reason: "symlink" },
      { path: "src/Secret.tsx", reason: "symlink" },
      { path: "src/self", reason: "symlink" },
      { path: "tsconfig.json", reason: "symlink" },
    ]);
    expect(JSON.stringify(result)).not.toContain("Secret()");
    // The symlinked tsconfig was not read: its @x/* alias is unknown, so the import stays external.
    expect(result.files[0]?.imports).toMatchObject([
      { to: "@x/Ok", resolved: null, external: true },
    ]);
    // Nothing under the outside folder or reached through a link is ever touched.
    expect(touched.filter((p) => p.startsWith(outside))).toEqual([]);
    const throughLink = ["outdir/", "ancestor/", "self/"].map((l) => join(repo, "src", l));
    expect(touched.filter((p) => throughLink.some((l) => p.startsWith(l)))).toEqual([]);
  });

  it("AC-004-09 gives outside imports resolved null, the same output whether the target exists, and never looks them up", async () => {
    const parent = tempDir();
    const outside = join(parent, "outside");
    const repo = join(parent, "repo");
    writeTree(outside, { "probe.ts": "export const x = 1;\n", "lib/shared.ts": "export {};\n" });
    writeTree(repo, {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@ext/*": ["../outside/lib/*"] } },
      }),
      "src/a.ts": [
        'import x from "../../outside/probe";',
        'import y from "@ext/shared";',
        'import z from "./link/probe";',
        'export { w } from "./sub/../../../outside/probe";',
        'import v from "./b";',
        "",
      ].join("\n"),
      "src/b.ts": "export default 1;\n",
    });
    fs.symlinkSync(outside, join(repo, "src", "link"));

    const withTarget = await indexRepo(repo);
    const lookedUp = [...touched];
    fs.rmSync(join(outside, "probe.ts"));
    fs.rmSync(join(outside, "lib"), { recursive: true });
    const withoutTarget = await indexRepo(repo);

    const imports = withTarget.files.find((f) => f.path === "src/a.ts")?.imports ?? [];
    expect(
      imports.map(({ to, resolved, outside: out }) => ({ to, resolved, outside: out })),
    ).toEqual([
      { to: "../../outside/probe", resolved: null, outside: true },
      { to: "@ext/shared", resolved: null, outside: true },
      { to: "./link/probe", resolved: null, outside: false },
      { to: "./sub/../../../outside/probe", resolved: null, outside: true },
      { to: "./b", resolved: "src/b.ts", outside: false },
    ]);
    expect(withoutTarget).toEqual(withTarget);
    // Relative and tsconfig-path cases are rejected before any filesystem call.
    expect(lookedUp.filter((p) => p.startsWith(outside))).toEqual([]);
  });
});
