import { createHash, generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LATEST_MANIFEST_URL, releaseBase, signManifest } from "./release";
import { DAY_MS, runUpdate, shouldCheck } from "./self-update";

// D-027: the self-updater. A real temporary "installed binary" (a script printing its version) is replaced, so the
// atomic swap, the new file's version probe and the cleanup run for real; the network is a fake.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const PRIV = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const script = (version: string) => `#!/bin/sh\necho "codeceipt ${version}"\n`;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

function release(
  version: string,
  body = script(version),
  opts: { sha?: string; key?: string } = {},
) {
  const text = JSON.stringify({
    name: "codeceipt",
    version,
    files: {
      "linux-x64": {
        file: "codeceipt-linux-x64",
        sha256: opts.sha ?? sha(body),
        size: Buffer.byteLength(body),
      },
    },
  });
  return { text, sig: signManifest(text, opts.key ?? PRIV), body };
}

function world(rel: ReturnType<typeof release>, over: { binaryUrl?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cc-upd-"));
  const execPath = join(dir, "codeceipt");
  writeFileSync(execPath, script("0.1.2"), { mode: 0o755 });
  const fetched: string[] = [];
  const fetch = async (url: string) => {
    fetched.push(url);
    const respond = (body: string, finalUrl = url) => {
      const r = new Response(body);
      Object.defineProperty(r, "url", { value: finalUrl });
      return r;
    };
    if (url === LATEST_MANIFEST_URL) return respond(rel.text);
    if (url === `${LATEST_MANIFEST_URL}.sig`) return respond(rel.sig);
    if (url.startsWith(releaseBase(JSON.parse(rel.text).version)))
      return respond(rel.body, over.binaryUrl ?? url);
    return new Response("not found", { status: 404 });
  };
  const run = () =>
    runUpdate({
      fetch,
      execPath,
      target: "linux-x64",
      version: "0.1.2",
      publicKey: PUB,
      platform: "linux",
    });
  return { dir, execPath, fetched, run };
}

describe("codeceipt update", () => {
  it("a newer signed release replaces the installed binary in place, still executable, nothing left behind", async () => {
    const w = world(release("0.2.0"));
    const result = await w.run();
    expect(result).toMatchObject({ status: "updated", version: "0.2.0" });
    expect(readFileSync(w.execPath, "utf8")).toBe(script("0.2.0"));
    expect(statSync(w.execPath).mode & 0o111).not.toBe(0);
    expect(readdirSync(w.dir)).toEqual(["codeceipt"]);
    expect(w.fetched.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("the same or an older signed version changes nothing (no downgrade)", async () => {
    for (const v of ["0.1.2", "0.1.1"]) {
      const w = world(release(v));
      expect((await w.run()).status).toBe("up-to-date");
      expect(readFileSync(w.execPath, "utf8")).toBe(script("0.1.2"));
    }
  });

  it("attack: a manifest signed with another key is refused before anything is downloaded", async () => {
    const other = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    const w = world(release("0.2.0", undefined, { key: other }));
    expect((await w.run()).status).toBe("failed");
    expect(w.fetched).toEqual([LATEST_MANIFEST_URL, `${LATEST_MANIFEST_URL}.sig`]);
    expect(readFileSync(w.execPath, "utf8")).toBe(script("0.1.2"));
  });

  it("attack: a download whose SHA-256 differs from the signed manifest is thrown away", async () => {
    const w = world(release("0.2.0", script("0.2.0"), { sha: "b".repeat(64) }));
    expect((await w.run()).status).toBe("failed");
    expect(readFileSync(w.execPath, "utf8")).toBe(script("0.1.2"));
    expect(readdirSync(w.dir)).toEqual(["codeceipt"]);
  });

  it("attack: a download that ends up on plain http (a redirect) is refused", async () => {
    const w = world(release("0.2.0"), { binaryUrl: "http://objects.example/codeceipt" });
    expect((await w.run()).status).toBe("failed");
    expect(readFileSync(w.execPath, "utf8")).toBe(script("0.1.2"));
  });

  it("attack: a verified file that does not run as the promised version is not installed", async () => {
    const body = script("6.6.6");
    const w = world(release("0.2.0", body));
    expect((await w.run()).status).toBe("failed");
    expect(readFileSync(w.execPath, "utf8")).toBe(script("0.1.2"));
    expect(readdirSync(w.dir)).toEqual(["codeceipt"]);
  });

  it("a build without the release key never updates", async () => {
    const w = world(release("0.2.0"));
    const result = await runUpdate({
      fetch: async () => new Response(""),
      execPath: w.execPath,
      target: "linux-x64",
      version: "0.1.2",
      publicKey: "",
      platform: "linux",
    });
    expect(result.status).toBe("disabled");
    expect(existsSync(w.execPath)).toBe(true);
  });
});

describe("background check", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("at most once a day, and never when auto-update is off", () => {
    expect(shouldCheck({}, {}, now)).toBe(true);
    expect(
      shouldCheck({ lastCheck: new Date(now.getTime() - DAY_MS + 60_000).toISOString() }, {}, now),
    ).toBe(false);
    expect(
      shouldCheck({ lastCheck: new Date(now.getTime() - DAY_MS).toISOString() }, {}, now),
    ).toBe(true);
    expect(shouldCheck({}, { autoUpdate: false }, now)).toBe(false);
    // A clock set back (lastCheck in the future) does not stop checks forever.
    expect(shouldCheck({ lastCheck: "2030-01-01T00:00:00Z" }, {}, now)).toBe(true);
  });
});
