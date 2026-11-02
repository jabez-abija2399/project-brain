import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, VERSION, main } from "../index";
import { setNativeBuild } from "./install-info";

// D-027: `codeceipt --version`, `codeceipt update` and `codeceipt config auto-update on|off`.
function cli() {
  const home = mkdtempSync(join(tmpdir(), "cc-native-home-"));
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[]) => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: async () => new Response("", { status: 404 }),
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: home,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => "",
    } satisfies CliDeps);
  };
  return { home, out, err, run };
}

describe("codeceipt --version", () => {
  it("prints exactly `codeceipt <version>` (the self-updater checks a new file with it)", async () => {
    const c = cli();
    for (const flag of ["--version", "-v", "version"]) {
      expect(await c.run([flag])).toBe(0);
      expect(c.out).toEqual([`codeceipt ${VERSION}`]);
    }
  });
});

describe("codeceipt config auto-update", () => {
  it("off is saved in the user config and on turns it back on; no argument prints the setting", async () => {
    const c = cli();
    expect(await c.run(["config", "auto-update", "off"])).toBe(0);
    expect(c.out.join("\n")).toContain("Automatic updates are off");
    const file = join(c.home, ".config", "codeceipt", "config.json");
    expect(JSON.parse(readFileSync(file, "utf8")).autoUpdate).toBe(false);
    expect(await c.run(["config", "auto-update"])).toBe(0);
    expect(c.out.join("\n")).toContain("off");
    expect(await c.run(["config", "auto-update", "on"])).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).autoUpdate).toBe(true);
  });

  it("anything else is a usage error", async () => {
    const c = cli();
    expect(await c.run(["config", "auto-update", "maybe"])).not.toBe(0);
    expect(await c.run(["config", "colour", "on"])).not.toBe(0);
  });
});

describe("codeceipt update", () => {
  it("an npm or npx copy does not replace itself: it points to the native installer", async () => {
    setNativeBuild(null);
    const c = cli();
    expect(await c.run(["update"])).toBe(0);
    const text = c.out.join("\n");
    expect(text).toContain("curl -fsSL https://codeceipts.vercel.app/install.sh | sh");
    expect(text).toContain("irm https://codeceipts.vercel.app/install.ps1 | iex");
  });
});
