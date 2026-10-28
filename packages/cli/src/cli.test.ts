import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { configPath } from "./config";
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

type Sent = { url: string; body: { files: { path: string }[]; folder?: string } | null };

// A fake index API: records every request after login and answers like the real routes.
function indexApi(sent: Sent[]): CliDeps["fetch"] {
  return async (url, init) => {
    const u = String(url);
    if (u.endsWith("/api/token/whoami")) return whoami(url, init);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url: u.replace("https://brain.test", ""), body });
    if (u.endsWith("/diff"))
      return Response.json({
        ok: true,
        changed: (body as { files: { path: string }[] }).files.map((f) => f.path),
        deleted: [],
      });
    if (u.endsWith("/summarize"))
      return Response.json({ ok: true, attempted: 0, remaining: 0, enabled: true });
    return Response.json({ ok: true });
  };
}

const uploaded = (sent: Sent[]) =>
  sent.filter((r) => r.url === "/api/index/proj-1").flatMap((r) => r.body?.files ?? []);

// M1 needs a folder the OS refuses to read. chmod 000 does not work when the tests run as root (root reads anything),
// so readdirSync fails with EACCES for that one folder instead. Everything else passes through to the real fs.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readdirSync: ((path: Parameters<typeof actual.readdirSync>[0], options?: unknown) => {
      if (String(path).endsWith("/src/locked")) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return actual.readdirSync(path, options as Parameters<typeof actual.readdirSync>[1]);
    }) as typeof actual.readdirSync,
  };
});

describe("FEAT-008 projectbrain index review fixes", () => {
  it("M1 an unreadable folder stops the index with an error naming it, before anything is sent or deleted", async () => {
    const sent: Sent[] = [];
    const t = setup(indexApi(sent));
    writeFileSync(join(t.repo, "a.ts"), "export const a = 1;\n");
    mkdirSync(join(t.repo, "src", "locked"), { recursive: true });
    writeFileSync(join(t.repo, "src", "locked", "b.ts"), "export const b = 1;\n");
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
    expect(await main(["index"], t.deps)).toBe(1);
    expect(sent).toEqual([]);
    expect(t.err.at(-1)).toBe(
      "Cannot read folder src/locked: fix its permissions and run index again. Nothing was uploaded or deleted.",
    );
  });

  it("L2 a relative XDG_CONFIG_HOME is ignored, so the token is never written into the repo", async () => {
    expect(configPath({ XDG_CONFIG_HOME: "rel/cfg" }, "linux", "/home/u")).toBe(
      "/home/u/.config/projectbrain/config.json",
    );
    expect(configPath({ XDG_CONFIG_HOME: "" }, "linux", "/home/u")).toBe(
      "/home/u/.config/projectbrain/config.json",
    );
    expect(configPath({ XDG_CONFIG_HOME: "/x/cfg" }, "linux", "/home/u")).toBe(
      "/x/cfg/projectbrain/config.json",
    );
    const t = setup(whoami);
    t.deps.env.XDG_CONFIG_HOME = "rel/cfg";
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
    expect(readdirSync(t.repo)).toEqual([]);
    expect(statSync(join(t.home, ".config", "projectbrain", "config.json")).isFile()).toBe(true);
  });

  it("L3 a file whose name the server cannot store is skipped and reported by name; the rest is indexed", async () => {
    const sent: Sent[] = [];
    const t = setup(indexApi(sent));
    writeFileSync(join(t.repo, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(t.repo, "we\\ird.ts"), "export const w = 1;\n");
    writeFileSync(join(t.repo, "new\nline.ts"), "export const n = 1;\n");
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
    expect(await main(["index"], t.deps)).toBe(0);
    expect(uploaded(sent).map((f) => f.path)).toEqual(["a.ts"]);
    expect(t.out).toContain(
      'Skipped 2 files whose names the server cannot store (backslash, control character, drive letter or too long): "new\\nline.ts", "we\\\\ird.ts"',
    );
  });

  it("L4 a .git in the home folder or above is not the app's repo: the folder itself is the root, and the CLI says so", async () => {
    for (const gitAt of ["home", "above"] as const) {
      const sent: Sent[] = [];
      const t = setup(indexApi(sent));
      const base = mkdtempSync(join(tmpdir(), "pb-base-"));
      const home = join(base, "home");
      const repo = join(home, "work", "app");
      mkdirSync(repo, { recursive: true });
      mkdirSync(join(gitAt === "home" ? home : base, ".git"));
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      t.deps.homedir = home;
      t.deps.env.XDG_CONFIG_HOME = join(home, ".config");
      t.deps.cwd = repo;
      expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
      expect(await main(["index"], t.deps)).toBe(0);
      expect(uploaded(sent).map((f) => f.path)).toEqual(["a.ts"]);
      for (const r of sent) expect(r.body?.folder).toBeUndefined();
      expect(t.out).toContain(
        `Ignoring the .git in ${gitAt === "home" ? home : base}: it is your home folder or above it, so ${repo} is indexed as the project root.`,
      );
    }
  });

  it("KI-025 a .git below the home folder still makes a subfolder index use repo-root paths", async () => {
    const sent: Sent[] = [];
    const t = setup(indexApi(sent));
    const home = mkdtempSync(join(tmpdir(), "pb-home2-"));
    const repo = join(home, "app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "web"));
    writeFileSync(join(repo, "web", "a.ts"), "export const a = 1;\n");
    t.deps.homedir = home;
    t.deps.env.XDG_CONFIG_HOME = join(home, ".config");
    t.deps.cwd = join(repo, "web");
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
    expect(await main(["index"], t.deps)).toBe(0);
    expect(uploaded(sent).map((f) => f.path)).toEqual(["web/a.ts"]);
  });

  it("M2 a project over its storage cap gets a clear message, not 'too large'", async () => {
    const sent: Sent[] = [];
    const api = indexApi(sent);
    const t = setup(async (url, init) =>
      String(url).endsWith("/api/index/proj-1")
        ? Response.json({ ok: false, code: "project_storage_full" }, { status: 413 })
        : api(url, init),
    );
    writeFileSync(join(t.repo, "a.ts"), "export const a = 1;\n");
    expect(await main(["login", "--api-url", "https://brain.test"], t.deps)).toBe(0);
    expect(await main(["index"], t.deps)).toBe(4);
    expect(t.err.at(-1)).toBe(
      "This project is at its storage limit on the server (files or symbols per project), so the upload was not stored.",
    );
  });
});
