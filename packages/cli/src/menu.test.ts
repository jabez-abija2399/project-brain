import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath } from "./config";
import { type CliDeps, main } from "./index";
import { MENU, menuChoice } from "./menu";
import { linkRepo } from "./test-support";

// Roadmap Phase 9: `codeceipt` with no arguments in a connected repo, in a terminal: a numbered menu.
const PROJECT = "11111111-2222-3333-4444-555555555555";

function setup(linked: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "cc-menu-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  if (linked) {
    linkRepo(dir, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
      apiUrl: "https://codeceipt.example",
      projectId: PROJECT,
      token: ["pb", "_", "testtoken123"].join(""),
    });
  }
  return { dir, home };
}

async function run(linked: boolean, choose: CliDeps["choose"] | undefined, urls: string[] = []) {
  const { dir, home } = setup(linked);
  const out: string[] = [];
  const asked: string[][] = [];
  const code = await main([], {
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          ok: true,
          state: {
            pendingApprovals: 0,
            planDraft: false,
            receipts: 0,
            openMissed: 0,
            features: 0,
            criteria: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    cwd: dir,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: () => {},
    readStdin: async () => "",
    sleep: async () => {},
    openUrl: async () => false,
    ...(choose
      ? {
          choose: async (q: string, options: string[]) => {
            asked.push([q, ...options]);
            return choose(q, options);
          },
        }
      : {}),
  });
  return { code, text: out.join("\n"), asked, urls };
}

describe("codeceipt menu (roadmap Phase 9)", () => {
  it("PH9-17 a connected repo in a terminal gets the menu; picking an entry runs that command", async () => {
    const urls: string[] = [];
    const r = await run(true, async () => 0, urls);
    expect(r.code).toBe(0);
    expect(r.asked[0]?.[0]).toBe("This repo is connected to Codeceipt. What do you want to do?");
    expect(r.asked[0]?.slice(1)).toEqual(MENU.map((m) => m.label));
    expect(urls).toEqual([`https://codeceipt.example/api/hooks/${PROJECT}/next-step`]);
    expect(r.text).toContain("Next step: Connect a repository and finish one agent session");
  });

  it("PH9-18 quitting does nothing; a repo that is not connected, or no terminal, never sees the menu", async () => {
    const quit = await run(true, async () => null);
    expect(quit.code).toBe(0);
    expect(quit.urls).toEqual([]);
    const unlinked = await run(false, async () => 0);
    expect(unlinked.asked).toEqual([]);
    const noTerminal = await run(true, undefined);
    expect(noTerminal.asked).toEqual([]);
  });

  it("PH9-19 only a number on the menu counts as a choice", () => {
    expect(menuChoice("1")).toBe(0);
    expect(menuChoice(` ${MENU.length}\n`)).toBe(MENU.length - 1);
    for (const bad of ["", "q", "0", String(MENU.length + 1), "1; rm -rf /", "-1", "1e1", "999"]) {
      expect(menuChoice(bad), bad).toBeNull();
    }
  });
});
