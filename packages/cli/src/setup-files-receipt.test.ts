import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { AGENTS_SECTION } from "./templates";
import { linkRepo } from "./test-support";

// First-receipt fix 1: what `codeceipt init` adds or changes is never a changed file in a receipt. The token is built
// at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

function setup() {
  const home = mkdtempSync(join(tmpdir(), "cc-setupf-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-setupf-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(join(repo, "AGENTS.md"), "# Rules\nWrite tests.\n");
  writeFileSync(join(repo, "app.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const sent: string[][] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    if (new URL(String(url)).pathname.endsWith("/open-items")) {
      return Response.json({
        ok: true,
        requests: [{ id: "req-1", text: "Add x", items: [{ text: "x", status: "open" }] }],
      });
    }
    const body = JSON.parse(String(init?.body));
    if (body.params.name === "generate_receipt") sent.push(body.params.arguments.changedFiles);
    const text =
      body.params.name === "generate_receipt"
        ? JSON.stringify({ receipt_id: "rc-1", items: [] })
        : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  const hook = (event: string) =>
    main(["hook", event, "--agent", "claude"], {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: () => {},
      stderr: () => {},
      readStdin: async () => JSON.stringify({ session_id: "s1", cwd: repo }),
    });
  const write = (rel: string, text: string) => {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  return { repo, sent, hook, write };
}

describe("setup files never count in a receipt", () => {
  it("files init writes, and an AGENTS.md change that is only the Codeceipt section, are left out of changedFiles", async () => {
    const t = setup();
    await t.hook("session-start");
    for (const rel of [
      ".mcp.json",
      ".claude/settings.json",
      ".claude/skills/codeceipt/SKILL.md",
      ".cursor/mcp.json",
      ".cursor/hooks.json",
      ".cursor/rules/codeceipt.mdc",
      ".codex/config.toml",
      ".codex/hooks.json",
      "opencode.json",
      ".opencode/plugins/codeceipt.js",
      ".agents/mcp_config.json",
      ".agents/hooks.json",
      ".agents/rules/codeceipt.md",
      ".agents/skills/codeceipt/SKILL.md",
    ]) {
      t.write(rel, "{}\n");
    }
    const agents = readFileSync(join(t.repo, "AGENTS.md"), "utf8");
    writeFileSync(join(t.repo, "AGENTS.md"), `${agents}\n${AGENTS_SECTION}\n`);
    t.write("app.ts", "export const a = 2;\n");
    t.write(".cursor/rules/style.mdc", "my own rule\n");
    await t.hook("session-end");
    expect(t.sent.map((files) => [...files].sort())).toEqual([
      [".cursor/rules/style.mdc", "app.ts"],
    ]);
  });

  it("an AGENTS.md edit outside the Codeceipt section is the user's change and counts", async () => {
    const t = setup();
    await t.hook("session-start");
    writeFileSync(
      join(t.repo, "AGENTS.md"),
      `# Rules\nWrite tests.\nUse tabs.\n\n${AGENTS_SECTION}\n`,
    );
    await t.hook("session-end");
    expect(t.sent).toEqual([["AGENTS.md"]]);
  });

  it("a session that only ran init sends no receipt request at all", async () => {
    const t = setup();
    await t.hook("session-start");
    t.write(".mcp.json", "{}\n");
    t.write(".claude/settings.json", "{}\n");
    await t.hook("session-end");
    expect(t.sent).toEqual([]);
  });
});
