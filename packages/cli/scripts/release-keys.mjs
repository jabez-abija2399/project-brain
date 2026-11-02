// D-027 (run once, by a human, on a trusted computer): creates the Codeceipt release key pair (Ed25519).
// - The PUBLIC key is printed: put it in packages/cli/src/native/release-key.ts and commit it.
// - The PRIVATE key is written to the file given as the first argument (mode 600). Store its contents as the GitHub
//   Actions secret CODECEIPT_RELEASE_SIGNING_KEY, keep an offline backup, then delete the file.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/release-keys.mjs <file for the private key>");
if (existsSync(out)) throw new Error(`${out} already exists; not overwriting a key`);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync(out, privateKey.export({ format: "pem", type: "pkcs8" }), {
  mode: 0o600,
  flag: "wx",
});
console.log("Public key (put in src/native/release-key.ts):");
console.log(publicKey.export({ format: "der", type: "spki" }).toString("base64"));
console.log(
  `Private key written to ${out} (store as the secret CODECEIPT_RELEASE_SIGNING_KEY, then delete it).`,
);
