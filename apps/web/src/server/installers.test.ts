import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as installPs1Route } from "@/app/install.ps1/route";
import { GET as installShRoute } from "@/app/install.sh/route";
import { describe, expect, it } from "vitest";
import { type CliRelease, installPs1, installSh } from "./installers";

// D-027: the one-line installers served from the site. They pin a version and the SHA-256 of every file (from
// apps/web/src/lib/cli-release.json), download only over https from that release, check the checksum before
// installing, install into a user folder without sudo, add it to PATH and print the next step.
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const binary = (v: string) => `#!/bin/sh\necho "codeceipt ${v}"\n`;
const RELEASE_URL =
  "https://github.com/jabez-abija2399/project-brain/releases/download/cli-v0.2.0/";

const release = (linuxSha: string): CliRelease => ({
  version: "0.2.0",
  sha256: {
    "darwin-arm64": "1".repeat(64),
    "darwin-x64": "2".repeat(64),
    "linux-x64": linuxSha,
    "linux-arm64": "4".repeat(64),
    "linux-x64-musl": "5".repeat(64),
    "linux-arm64-musl": "6".repeat(64),
    "windows-x64": "7".repeat(64),
  },
});

// Runs the real install.sh under sh with stub curl and npm on PATH (no network); returns what happened.
function runInstallSh(script: string, served: string, opts: { npmGlobal?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-inst-home-"));
  const stubs = join(home, "stubs");
  mkdirSync(stubs);
  const log = join(home, "calls.log");
  // curl: records its arguments and writes the served file to -o.
  writeFileSync(
    join(stubs, "curl"),
    `#!/bin/sh\necho "curl $*" >> "${log}"\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; shift; fi; shift; done\nprintf '%s' '${served.replace(/'/g, "'\\''")}' > "$out"\n`,
  );
  writeFileSync(
    join(stubs, "npm"),
    `#!/bin/sh\necho "npm $*" >> "${log}"\nif [ "$1" = "ls" ]; then ${opts.npmGlobal ? "echo 'codeceipt@0.1.2'; exit 0" : "exit 1"}; fi\nexit 0\n`,
  );
  chmodSync(join(stubs, "curl"), 0o755);
  chmodSync(join(stubs, "npm"), 0o755);
  writeFileSync(join(home, "install.sh"), script);
  const r = spawnSync("/bin/sh", [join(home, "install.sh")], {
    // Only what the script needs (the web app's types require NODE_ENV in a ProcessEnv; a cast, as in the sandbox).
    env: {
      HOME: home,
      PATH: `${stubs}:/usr/bin:/bin`,
      SHELL: "/bin/bash",
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { home, r, calls, bin: join(home, ".local", "bin", "codeceipt") };
}

describe("install.sh", () => {
  it("installs the pinned version into ~/.local/bin without sudo, adds it to PATH and prints the next step", () => {
    const body = binary("0.2.0");
    const t = runInstallSh(installSh(release(sha(body))), body);
    expect(t.r.status, t.r.stderr).toBe(0);
    expect(readFileSync(t.bin, "utf8")).toBe(body);
    expect(execFileSync(t.bin, ["--version"], { encoding: "utf8" }).trim()).toBe("codeceipt 0.2.0");
    expect(t.calls).toContain(`${RELEASE_URL}codeceipt-linux-x64`);
    expect(t.calls).toMatch(/--proto =https/);
    expect(t.calls).not.toContain("sudo");
    // Not on PATH yet: the shell profile gets one PATH line, once.
    expect(readFileSync(join(t.home, ".bashrc"), "utf8")).toContain(
      'export PATH="$HOME/.local/bin:$PATH"',
    );
    expect(t.r.stdout).toContain("Codeceipt 0.2.0 is installed");
    expect(t.r.stdout).toMatch(/cd into your app's folder and run:\s+codeceipt/);
  });

  it("attack: a download whose SHA-256 differs from the pinned one is not installed", () => {
    const t = runInstallSh(installSh(release("f".repeat(64))), binary("0.2.0"));
    expect(t.r.status).not.toBe(0);
    expect(t.r.stderr).toMatch(/checksum/i);
    expect(existsSync(t.bin)).toBe(false);
  });

  it("migrates from npm: a global npm copy is uninstalled so it cannot shadow the native one", () => {
    const body = binary("0.2.0");
    const t = runInstallSh(installSh(release(sha(body))), body, { npmGlobal: true });
    expect(t.r.status, t.r.stderr).toBe(0);
    expect(t.calls).toContain("npm uninstall -g codeceipt");
    expect(t.r.stdout).toMatch(/removed the npm copy/i);
  });

  it("before the first native release it says so and points to npx, installing nothing", () => {
    const t = runInstallSh(installSh({ version: null, sha256: {} }), "");
    expect(t.r.status).not.toBe(0);
    expect(t.r.stderr).toContain("npx codeceipt");
    expect(t.calls).toBe("");
  });

  it("attack: only https URLs of the pinned release appear in the script; values are checked before they are embedded", () => {
    const s = installSh(release("3".repeat(64)));
    expect(s).not.toMatch(/http:\/\//);
    for (const url of s.match(/https:\/\/[^\s"']+/g) ?? []) {
      expect(
        url.startsWith(RELEASE_URL.replace(/\/$/, "")) ||
          url.startsWith("https://codeceipts.vercel.app"),
        url,
      ).toBe(true);
    }
    expect(() => installSh({ version: '0.2.0"; rm -rf ~; "', sha256: {} })).toThrow();
    expect(() => installSh({ version: "0.2.0", sha256: { "linux-x64": "$(id)" } })).toThrow();
  });
});

describe("install.ps1", () => {
  it("pins the Windows file and its SHA-256, checks it with Get-FileHash, installs per user and adds the user PATH", () => {
    const s = installPs1(release("3".repeat(64)));
    expect(s).toContain(`${RELEASE_URL}codeceipt-windows-x64.exe`);
    expect(s).toContain("7".repeat(64));
    expect(s).toContain("Get-FileHash");
    expect(s).toContain('[Environment]::SetEnvironmentVariable("Path"');
    expect(s).toContain('"User"');
    expect(s).toContain(".local\\bin");
    expect(s).not.toMatch(/http:\/\//);
    expect(s).toContain("npm uninstall -g codeceipt");
  });
});

describe("routes", () => {
  it("serve the scripts as plain text from the site", async () => {
    for (const route of [installShRoute, installPs1Route]) {
      const res = await route();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await res.text()).length).toBeGreaterThan(200);
    }
  });
});
