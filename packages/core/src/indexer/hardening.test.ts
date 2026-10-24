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
});
