import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepo } from "./indexer";
import { toUpload } from "./upload";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "brain-upload-"));
  temps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const hashOf = async (root: string, path: string) =>
  toUpload(await indexRepo(root)).find((f) => f.path === path)?.hash;

describe("KI-036 the diff hash follows what a file's imports resolve to", () => {
  const page = 'import { x } from "@/server/x";\nexport const p = x;\n';

  it("an unchanged file whose alias starts resolving (a new tsconfig.json) gets a new hash, so it is re-uploaded", async () => {
    const files = {
      "apps/web/src/page.ts": page,
      "apps/web/src/server/x.ts": "export const x = 1;\n",
    };
    const before = await hashOf(repo(files), "apps/web/src/page.ts");
    const after = await hashOf(
      repo({
        ...files,
        "apps/web/tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "@/*": ["./src/*"] } },
        }),
      }),
      "apps/web/src/page.ts",
    );
    expect(before).toBeDefined();
    expect(after).not.toBe(before);
  });

  it("a folder moved with the files it imports keeps its hashes (a rename keeps the user's placement, KI-027)", async () => {
    const files = (dir: string) => ({
      [`${dir}/Button.tsx`]: 'import { cn } from "./cn";\nexport const Button = cn;\n',
      [`${dir}/cn.ts`]: "export const cn = 1;\n",
    });
    expect(await hashOf(repo(files("src/a")), "src/a/Button.tsx")).toBe(
      await hashOf(repo(files("src/b/c")), "src/b/c/Button.tsx"),
    );
  });
});
