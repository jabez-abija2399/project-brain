import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";

const TOKEN = "pb_secret-token-value";

function setup(fetchImpl: CliDeps["fetch"], stdin = `${TOKEN}\n`) {
  const home = mkdtempSync(join(tmpdir(), "pb-home-"));
  const repo = mkdtempSync(join(tmpdir(), "pb-repo-"));
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    fetch: fetchImpl,
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), NO_COLOR: "1" },
    cwd: repo,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => stdin,
  };
  return { deps, home, repo, out, err };
}

const whoami: CliDeps["fetch"] = async (url, init) => {
  const auth = new Headers(init?.headers).get("authorization");
  if (String(url).endsWith("/api/token/whoami") && auth === `Bearer ${TOKEN}`) {
    return Response.json({ ok: true, project_id: "proj-1" });
  }
  return Response.json({ ok: false, code: "unauthenticated" }, { status: 401 });
};

describe("FEAT-008 projectbrain login", () => {
  it("AC-008-01 login stores the project token in the user's config dir with mode 0600, never in the repo", async () => {
    const t = setup(whoami);
    const code = await main(["login", "--api-url", "http://brain.test"], t.deps);
    expect(code).toBe(0);
    const path = join(t.home, ".config", "projectbrain", "config.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      apiUrl: "http://brain.test",
      projectId: "proj-1",
      token: TOKEN,
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(t.repo)).toEqual([]);
    expect(t.out).toEqual(["Logged in as project proj-1"]);
    expect([...t.out, ...t.err].join("\n")).not.toContain(TOKEN);
  });

  it("AC-008-01 a rejected token is not stored and exits 3", async () => {
    const t = setup(whoami, "pb_wrong\n");
    expect(await main(["login", "--api-url", "http://brain.test"], t.deps)).toBe(3);
    expect(() => statSync(join(t.home, ".config", "projectbrain", "config.json"))).toThrow();
    expect(t.err.join("\n")).not.toContain("pb_wrong");
  });

  it("index without login exits 3; unknown commands exit 2", async () => {
    const t = setup(whoami);
    expect(await main(["index"], t.deps)).toBe(3);
    expect(t.err).toEqual(["Not logged in: run `projectbrain login` first."]);
    expect(await main(["nope"], t.deps)).toBe(2);
  });
});
