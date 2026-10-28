import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
    const code = await main(["login", "--api-url", "https://brain.test"], t.deps);
    expect(code).toBe(0);
    const path = join(t.home, ".config", "projectbrain", "config.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      apiUrl: "https://brain.test",
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
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(3);
    expect(() => statSync(join(t.home, ".config", "projectbrain", "config.json"))).toThrow();
    expect(t.err.join("\n")).not.toContain("pb_wrong");
  });

  it("index without login exits 3; unknown commands exit 2", async () => {
    const t = setup(whoami);
    expect(await main(["index"], t.deps)).toBe(3);
    expect(t.err).toEqual(["Not logged in: run `projectbrain login` first."]);
    expect(await main(["nope"], t.deps)).toBe(2);
  });
  it("KI-024 index of a folder with no indexable files exits 2 and sends nothing, so it cannot wipe the index", async () => {
    const calls: string[] = [];
    const t = setup(async (url, init) => {
      calls.push(String(url));
      return whoami(url, init);
    });
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
    calls.length = 0;
    expect(await main(["index"], t.deps)).toBe(2);
    expect(t.err.at(-1)).toMatch(/^No files to index in .+: run it in the repo root\.$/);
    expect(calls).toEqual([]);
  });
  it("AC-008-11 attack: login refuses to send the token over plain http to a non-local host", async () => {
    const calls: string[] = [];
    const t = setup(async (url, init) => {
      calls.push(String(url));
      return whoami(url, init);
    });
    for (const url of ["http://brain.example.com", "http://10.0.0.5:3000", "ftp://brain.test"]) {
      expect(await main(["login", "--api-url", url], t.deps)).toBe(2);
    }
    expect(calls).toEqual([]);
    expect(t.err.at(-1)).toBe(
      "--api-url must be https (plain http only for localhost, 127.0.0.1 or [::1]).",
    );
    for (const url of [
      "https://brain.example.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]) {
      expect(await main(["login", "--api-url", url], t.deps)).toBe(0);
    }
  });
  it("AC-008-11 attack: index refuses a config hand-edited to a plain-http non-local apiUrl, before sending the token", async () => {
    const calls: string[] = [];
    const t = setup(async (url, init) => {
      calls.push(String(url));
      return whoami(url, init);
    });
    writeFileSync(join(t.repo, "a.ts"), "export const a = 1;\n");
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
    const path = join(t.home, ".config", "projectbrain", "config.json");
    for (const url of [
      "http://brain.example.com",
      "http://10.0.0.5:3000",
      "ftp://brain.test",
      "nonsense",
    ]) {
      writeFileSync(path, JSON.stringify({ apiUrl: url, projectId: "proj-1", token: TOKEN }));
      calls.length = 0;
      expect(await main(["index"], t.deps)).toBe(2);
      expect(calls).toEqual([]);
      expect(t.err.at(-1)).toBe(
        "Saved server address must be https (plain http only for localhost, 127.0.0.1 or [::1]): run `projectbrain login` again.",
      );
      expect(t.err.join("\n")).not.toContain(TOKEN);
    }
  });
});
