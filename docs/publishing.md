# Publishing the CLI to npm (human steps)

The CLI is published as the npm package **codeceipt** from the build folder `packages/cli/dist`, never from
`packages/cli` itself (that is the private workspace package `@brain/cli`). Only an owner publishes; agents never do.
On 2026-10-30 the name `codeceipt` was still free on npm (`npm view codeceipt` answered 404).

## Before the first release (once)

1. [REVIEW] Choose a license. The package currently has none, which means "all rights reserved". If you want one,
   add a `license` field to `publishManifest()` in `packages/cli/build.mjs` and a LICENSE file next to the README.
2. Create an npm account at https://www.npmjs.com/signup and turn on two-factor authentication for
   **Authorization and writes** (Account Settings > Two-Factor Authentication).
3. On your computer: `npm login` and check with `npm whoami`.

## Every release

1. On an up-to-date `main` with a green CI run, set the version in **both** `packages/cli/package.json` (`version`)
   and `packages/cli/src/index.ts` (`VERSION`). A test fails if they differ. Merge that change first.
2. Build and run the checks:

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @brain/cli build
   pnpm vitest run packages/cli/src/publish.test.ts
   ```

3. Look at exactly what would be published. It must list only `README.md`, `child.mjs`, `codeceipt.mjs` and
   `package.json`, with the name `codeceipt` and the new version:

   ```bash
   cd packages/cli/dist && npm pack --dry-run
   ```

4. Try the package as a user would, in a scratch git repository, before publishing:

   ```bash
   cd packages/cli/dist && npm pack
   ```

   Then, in another folder that is a git repository: `npx /full/path/to/codeceipt-X.Y.Z.tgz` and approve the code
   in the browser. The summary should end with `Codeceipt is set up for this repo.`

5. Publish (npm asks for your two-factor code):

   ```bash
   cd packages/cli/dist && npm publish --access public
   ```

6. Check it: `npm view codeceipt version` shows the new version, and `npx codeceipt@X.Y.Z help` prints the help.
7. Tag the commit: `git tag cli-vX.Y.Z && git push origin cli-vX.Y.Z`.

## If something went wrong

- A broken release can be hidden with `npm deprecate codeceipt@X.Y.Z "reason"`; publish a fixed X.Y.(Z+1).
- `npm unpublish` works only within 72 hours and blocks that version number forever; prefer deprecate.
