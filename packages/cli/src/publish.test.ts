import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build.mjs";
import { type CliDeps, DEFAULT_API_URL, VERSION, main } from "./index";
import { onPath } from "./setup-command";

// Launch part 7: the CLI is ready to publish as the npm package "codeceipt" (not published here).
const pkgDir = fileURLToPath(new URL("..", import.meta.url));
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(pkgDir, ".publish-build-"));
  await build({ outDir });
}, 60_000);
afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("publish-ready CLI", () => {
  it("the package is codeceipt 0.1.1 with one command, codeceipt, and no workspace dependencies", () => {
    const manifest = json(join(outDir, "package.json"));
    expect(manifest.name).toBe("codeceipt");
    expect(manifest.version).toBe("0.1.1");
    expect(VERSION).toBe("0.1.1");
    expect(json(join(pkgDir, "package.json")).version).toBe("0.1.1");
    expect(manifest.bin).toEqual({ codeceipt: "./codeceipt.mjs" });
    expect(manifest.files).toEqual(["codeceipt.mjs", "child.mjs", "README.md"]);
    expect(Object.keys(manifest.dependencies).filter((d) => d.startsWith("@brain/"))).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(manifest.private).toBeUndefined();
  });

  it("the bundle has the workspace packages built in: no @brain/* import is left", () => {
    const bundle = readFileSync(join(outDir, "codeceipt.mjs"), "utf8");
    expect(bundle.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(bundle).not.toMatch(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']@brain\//);
  });

  it("npm pack publishes only the built files and the README", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: outDir,
      encoding: "utf8",
      env: { ...process.env, npm_config_loglevel: "silent" },
    });
    const [pack] = JSON.parse(raw) as {
      name: string;
      version: string;
      files: { path: string }[];
    }[];
    expect([pack?.name, pack?.version]).toEqual(["codeceipt", "0.1.1"]);
    expect(pack?.files.map((f) => f.path).sort()).toEqual(
      ["README.md", "child.mjs", "codeceipt.mjs", "package.json"].sort(),
    );
    const readme = readFileSync(join(outDir, "README.md"), "utf8");
    expect(readme).toContain("npx codeceipt");
    expect(readme).not.toContain("CODECEIPT_TOKEN=");
  });

  it("with no --api-url or CODECEIPT_API_URL, `npx codeceipt` talks to https://codeceipts.vercel.app", async () => {
    expect(DEFAULT_API_URL).toBe("https://codeceipts.vercel.app");
    const repo = mkdtempSync(join(tmpdir(), "cc-pub-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const home = mkdtempSync(join(tmpdir(), "cc-pub-home-"));
    const urls: string[] = [];
    const deps: CliDeps = {
      fetch: async (url) => {
        urls.push(String(url));
        return new Response("{}", { status: 503 });
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: () => {},
      stderr: () => {},
      readStdin: async () => "",
    };
    expect(await main([], deps)).not.toBe(0);
    expect(urls).toEqual(["https://codeceipts.vercel.app/api/device/start"]);
  });

  it("finds whether the codeceipt command is installed (on PATH) so the summary can say how to install it", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-path-"));
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "codeceipt"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir, "bin", "codeceipt.cmd"), "@echo off\r\n");
    expect(
      onPath("codeceipt", { PATH: ["/nowhere", join(dir, "bin")].join(delimiter) }, "linux"),
    ).toBe(true);
    expect(onPath("codeceipt", { PATH: "/nowhere" }, "linux")).toBe(false);
    expect(onPath("codeceipt", {}, "linux")).toBe(false);
    // Windows looks for the extensions in PATHEXT, and the variable may be spelled Path.
    expect(onPath("codeceipt", { Path: join(dir, "bin"), PATHEXT: ".COM;.CMD" }, "win32")).toBe(
      true,
    );
    expect(existsSync(join(dir, "bin", "codeceipt"))).toBe(true);
  });
});
