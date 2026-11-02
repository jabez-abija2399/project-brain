import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

// D-027: native releases. A release is a manifest (version and, per target, the file name, SHA-256 and size), signed
// with the Codeceipt release key (Ed25519). The installers pin a version and its checksums; the self-updater accepts
// only a manifest this build's public key verifies, and only a newer version.

export const RELEASE_REPO = "jabez-abija2399/project-brain";
// Release assets live on GitHub Releases under the tag cli-v<version>; only https URLs built from these constants are
// ever fetched.
export const releaseBase = (version: string) =>
  `https://github.com/${RELEASE_REPO}/releases/download/cli-v${version}/`;
export const LATEST_MANIFEST_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/manifest.json`;

export const TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
  "windows-x64",
] as const;
export type Target = (typeof TARGETS)[number];

export type ReleaseFile = { file: string; sha256: string; size: number };
export type ReleaseManifest = {
  name: "codeceipt";
  version: string;
  files: Partial<Record<Target, ReleaseFile>>;
};

/** The release target for this machine, or null when there is no native build for it. */
export function targetFor(
  platform: string,
  arch: string,
  libc: "glibc" | "musl" = "glibc",
): Target | null {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `darwin-${arch}`;
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) {
    return libc === "musl" ? `linux-${arch}-musl` : `linux-${arch}`;
  }
  if (platform === "win32" && arch === "x64") return "windows-x64";
  return null;
}

export const fileNameFor = (target: Target) =>
  `codeceipt-${target}${target.startsWith("windows") ? ".exe" : ""}`;

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_SIZE = 512 * 1024 * 1024;

/** Strictly newer plain x.y.z versions only; anything else (pre-releases, a "v" prefix) is never newer. */
export function isNewer(candidate: string, current: string): boolean {
  const a = VERSION.exec(candidate);
  const b = VERSION.exec(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(a[i]) - Number(b[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** The manifest, if every field has the expected shape: known targets, safe file names, real checksums. */
export function parseManifest(text: string): ReleaseManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.name !== "codeceipt" || typeof m.version !== "string" || !VERSION.test(m.version))
    return null;
  if (typeof m.files !== "object" || m.files === null || Array.isArray(m.files)) return null;
  const files: ReleaseManifest["files"] = {};
  for (const [target, value] of Object.entries(m.files as Record<string, unknown>)) {
    if (!(TARGETS as readonly string[]).includes(target)) return null;
    const f = value as Partial<ReleaseFile> | null;
    if (
      !f ||
      f.file !== fileNameFor(target as Target) ||
      typeof f.sha256 !== "string" ||
      !SHA256.test(f.sha256) ||
      typeof f.size !== "number" ||
      !Number.isInteger(f.size) ||
      f.size <= 0 ||
      f.size > MAX_SIZE
    ) {
      return null;
    }
    files[target as Target] = { file: f.file, sha256: f.sha256, size: f.size };
  }
  return { name: "codeceipt", version: m.version, files };
}

/** The manifest if `signatureB64` is the release key's Ed25519 signature of exactly `text`; otherwise null. */
export function verifyManifest(
  text: string,
  signatureB64: string,
  publicKeyB64: string,
): ReleaseManifest | null {
  if (!publicKeyB64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureB64.trim())) return null;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ed25519") return null;
    const ok = verify(
      null,
      Buffer.from(text, "utf8"),
      key,
      Buffer.from(signatureB64.trim(), "base64"),
    );
    return ok ? parseManifest(text) : null;
  } catch {
    return null;
  }
}

/** Signs a manifest (release workflow only; the private key never leaves the CI secret). */
export function signManifest(text: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, Buffer.from(text, "utf8"), key).toString("base64");
}
