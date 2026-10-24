import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepo } from "./index";

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "brain-indexer-hardening-"));
  temps.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("indexRepo stays inside the repo root", () => {
  it("never follows symlinked folders or files and lists them as skipped", async () => {
    const outside = tempDir();
    writeTree(outside, {
      "ServerOnly.tsx": "export function ServerOnly() { return <div/>; }\n",
    });
    const repo = tempDir();
    writeTree(repo, { "src/Ok.tsx": "export function Ok() { return <div/>; }\n" });
    symlinkSync(outside, join(repo, "src", "link"));
    symlinkSync(join(outside, "ServerOnly.tsx"), join(repo, "src", "File.tsx"));
    symlinkSync(repo, join(repo, "src", "loop"));

    const result = await indexRepo(repo);

    expect(result.files.map((f) => f.path)).toEqual(["src/Ok.tsx"]);
    expect(result.components.map((c) => c.name)).toEqual(["Ok"]);
    expect(JSON.stringify(result)).not.toContain("ServerOnly");
    const skipped = new Map(result.skipped.map((s) => [s.path, s.reason]));
    expect(skipped.get("src/link")).toBe("symlink");
    expect(skipped.get("src/File.tsx")).toBe("symlink");
    expect(skipped.get("src/loop")).toBe("symlink");
  });

  it("records imports that resolve outside the repo root as outside, with no path", async () => {
    const outside = tempDir();
    writeTree(outside, { "probe.ts": "export const x = 1;\n", "lib/shared.ts": "export {};\n" });
    const repo = tempDir();
    const up = "../".repeat(12);
    const outsideRel = `${up}${outside.replace(/^\//, "")}`;
    writeTree(repo, {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@ext/*": [`${outsideRel}/lib/*`] } },
      }),
      "src/a.ts": [
        `import x from "${outsideRel}/probe";`,
        'import y from "@ext/shared";',
        'import z from "./link/probe";',
        'import w from "./b";',
        "",
      ].join("\n"),
      "src/b.ts": "export default 1;\n",
    });
    symlinkSync(outside, join(repo, "src", "link"));

    const result = await indexRepo(repo);
    const imports = result.files.find((f) => f.path === "src/a.ts")?.imports ?? [];
    const byTo = new Map(imports.map((i) => [i.to, i]));

    const rel = byTo.get(`${outsideRel}/probe`);
    expect(rel?.resolved).toBeNull();
    expect(rel?.outside).toBe(true);
    const alias = byTo.get("@ext/shared");
    expect(alias?.resolved).toBeNull();
    expect(alias?.outside).toBe(true);
    expect(byTo.get("./link/probe")?.resolved).toBeNull();
    expect(byTo.get("./b")?.resolved).toBe("src/b.ts");
    expect(byTo.get("./b")?.outside).toBe(false);
    const serialized = JSON.stringify(
      result.files.flatMap((f) => f.imports.map((i) => i.resolved)),
    );
    expect(serialized).not.toContain("..");
    expect(serialized).not.toContain(outside);
  });
});
