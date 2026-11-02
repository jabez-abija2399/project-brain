// The Codeceipt release public key (Ed25519, SPKI DER, base64), built into every binary. The self-updater only installs
// a release whose manifest this key verifies (D-027). Empty until the release key is created: then auto-update says so
// and does nothing. Create it with `node packages/cli/scripts/release-keys.mjs` (docs/native-release.md); the private
// half goes only into the GitHub secret CODECEIPT_RELEASE_SIGNING_KEY.
export const RELEASE_PUBLIC_KEY = "";
