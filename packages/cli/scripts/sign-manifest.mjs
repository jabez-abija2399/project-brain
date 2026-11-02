// D-027 (release workflow only): signs dist-native/manifest.json with the release private key (Ed25519, PEM) from the
// environment variable CODECEIPT_RELEASE_SIGNING_KEY, writes manifest.json.sig (base64), and checks the signature
// against the public key built into the CLI (src/native/release-key.ts), so a release can never ship with a key the
// binaries do not trust. The key is never printed or written to disk.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const pem = process.env.CODECEIPT_RELEASE_SIGNING_KEY;
if (!pem) throw new Error("CODECEIPT_RELEASE_SIGNING_KEY is not set");
const manifestPath = join(pkgDir, "dist-native", "manifest.json");
const text = readFileSync(manifestPath, "utf8");
const signature = sign(null, Buffer.from(text, "utf8"), createPrivateKey(pem));
const keyFile = readFileSync(join(pkgDir, "src", "native", "release-key.ts"), "utf8");
const pub = /RELEASE_PUBLIC_KEY = "([A-Za-z0-9+/=]*)"/.exec(keyFile)?.[1] ?? "";
if (!pub)
  throw new Error(
    "src/native/release-key.ts has no public key: the binaries could not verify this release",
  );
const key = createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
if (!verify(null, Buffer.from(text, "utf8"), key, signature)) {
  throw new Error("the signing key does not match the public key built into the CLI");
}
writeFileSync(`${manifestPath}.sig`, `${signature.toString("base64")}\n`);
console.log("signed manifest.json");
