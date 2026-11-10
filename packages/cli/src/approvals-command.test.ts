import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath } from "./config";
import { main } from "./index";
import { linkRepo } from "./test-support";

// Roadmap Phase 6b: `codeceipt approvals` points the owner to the web page; the CLI never decides (it has no owner
// session, only a project token).
describe("codeceipt approvals (roadmap Phase 6b)", () => {
  it("PH6B-05 prints the project's Approvals page and makes no request", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cc-appr-"));
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const git = (...a: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...a], {
        cwd: repo,
      });
    git("init", "-q");
    writeFileSync(join(repo, "a.ts"), "export {};\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    linkRepo(repo, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
      apiUrl: "https://codeceipt.example/",
      projectId: "11111111-2222-3333-4444-555555555555",
      token: ["pb", "_", "testtoken123"].join(""),
    });
    const out: string[] = [];
    const code = await main(["approvals"], {
      fetch: async () => {
        throw new Error("no network");
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: () => {},
      readStdin: async () => "",
    });
    expect(code).toBe(0);
    expect(out[0]).toContain(
      "https://codeceipt.example/projects/11111111-2222-3333-4444-555555555555/approvals",
    );
    expect(out[1]).toContain("Agents can only ask");
  });
});
