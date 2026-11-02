import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type ReleaseManifest,
  fileNameFor,
  isNewer,
  parseManifest,
  signManifest,
  targetFor,
  verifyManifest,
} from "./release";

// D-027: what the installers and the self-updater trust. A release is a manifest (version, per-target file name,
// SHA-256 and size) signed with the Codeceipt release key (Ed25519); nothing else is believed.
const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    priv: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
};
const SHA = "a".repeat(64);
// Bad manifests on purpose in the attack test: any fields are allowed here, the parser decides.
const manifest = (over: Record<string, unknown> = {}): ReleaseManifest =>
  ({
    name: "codeceipt",
    version: "0.2.0",
    files: {
      "linux-x64": { file: "codeceipt-linux-x64", sha256: SHA, size: 1000 },
      "windows-x64": { file: "codeceipt-windows-x64.exe", sha256: SHA, size: 1000 },
    },
    ...over,
  }) as ReleaseManifest;

describe("release targets", () => {
  it("names the 7 supported targets and nothing else", () => {
    expect(targetFor("darwin", "arm64")).toBe("darwin-arm64");
    expect(targetFor("darwin", "x64")).toBe("darwin-x64");
    expect(targetFor("linux", "x64", "glibc")).toBe("linux-x64");
    expect(targetFor("linux", "arm64", "glibc")).toBe("linux-arm64");
    expect(targetFor("linux", "x64", "musl")).toBe("linux-x64-musl");
    expect(targetFor("linux", "arm64", "musl")).toBe("linux-arm64-musl");
    expect(targetFor("win32", "x64")).toBe("windows-x64");
    expect(targetFor("win32", "arm64")).toBeNull();
    expect(targetFor("freebsd", "x64")).toBeNull();
    expect(fileNameFor("windows-x64")).toBe("codeceipt-windows-x64.exe");
    expect(fileNameFor("linux-arm64-musl")).toBe("codeceipt-linux-arm64-musl");
  });

  it("only a strictly newer x.y.z counts as newer", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.1.2", "0.1.2")).toBe(false);
    expect(isNewer("0.1.1", "0.1.2")).toBe(false);
    expect(isNewer("0.2.0-beta", "0.1.0")).toBe(false);
    expect(isNewer("v0.2.0", "0.1.0")).toBe(false);
  });
});

describe("signed manifest", () => {
  it("a manifest signed with the release key is accepted, exactly as signed", () => {
    const k = keys();
    const text = JSON.stringify(manifest());
    expect(verifyManifest(text, signManifest(text, k.priv), k.pub)).toEqual(manifest());
  });

  it("attack: one changed byte, another key's signature, or no release key in this build: refused", () => {
    const k = keys();
    const other = keys();
    const text = JSON.stringify(manifest());
    const sig = signManifest(text, k.priv);
    expect(verifyManifest(text.replace("0.2.0", "0.2.1"), sig, k.pub)).toBeNull();
    expect(verifyManifest(text, signManifest(text, other.priv), k.pub)).toBeNull();
    expect(verifyManifest(text, sig, "")).toBeNull();
    expect(verifyManifest(text, "not base64 !!", k.pub)).toBeNull();
  });

  it("attack: a signed manifest with an unsafe file name, a bad checksum or a bad version is still refused", () => {
    for (const bad of [
      manifest({ version: "0.2" }),
      manifest({ name: "evil" }),
      manifest({ files: { "linux-x64": { file: "../../bin/sh", sha256: SHA, size: 1 } } }),
      manifest({ files: { "linux-x64": { file: "https://evil.test/x", sha256: SHA, size: 1 } } }),
      manifest({ files: { "linux-x64": { file: "codeceipt-linux-x64", sha256: "abc", size: 1 } } }),
      manifest({ files: { "linux-x64": { file: "codeceipt-linux-x64", sha256: SHA, size: 0 } } }),
      manifest({ files: { "plan9-x64": { file: "codeceipt-plan9-x64", sha256: SHA, size: 1 } } }),
    ]) {
      expect(parseManifest(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(parseManifest("not json")).toBeNull();
  });
});
