# Review: FEAT-004 Code indexer: files, components, exports, imports and routes from TS/JS/TSX

Date: 2026-10-24 (head 2cd98ff). Note: `kit.py review-pack --feat FEAT-004` produced a diff covering only the latest
FEAT-003 commits (24eaa61..2cd98ff), so this review covers the FEAT-004 files listed by `kit.py where FEAT-004`
(introduced in d8e458f): packages/core/src/indexer/{index,types,parser,routes,resolver,walker}.ts,
indexer.test.ts, perf.test.ts, packages/core/src/index.ts, tests/fixtures/next-app/**.

Tests run in this session:
- `pnpm vitest run packages/core/src/indexer` → 7/7 pass (indexer 6, perf 1; 500 files in ~0.3 s).
- `python3 scripts/kit.py dupes` → 0 repeated blocks.
- A throwaway probe suite in /tmp (deleted afterwards, no source touched) called `indexRepo` on generated temp repos.
  All 7 probes failed. They are cited as P1..P7 below.

## HIGH

### H1 Component props and signatures copy raw source text, so default values and secrets leak (AC-004-07, secret rule)
parser.ts:81-89 stores `firstParam.getText(sf)` (up to 200 chars) as `props` and `signature`. That is verbatim source,
including default-value expressions and inline type bodies.
P1: `export function Pay({ apiKey = "sk_l***" }) {...}` gives
`props: "{ apiKey = \"sk_l***\" }"` and the same string in `signature`.
This breaks AC-004-07 ("no source code") and the project rule that secrets are masked before they are stored, returned
or logged. The AC-004-07 test (indexer.test.ts:111-125) puts its sentinel in a plain `const` in a non-component file,
which the parser never captures, so it cannot catch this. Fix direction: emit the prop names and their type text only,
drop initializers, and run secret masking on whatever text you keep.

### H2 Walker follows symlinks out of the repo root (security: indexing untrusted repos server-side)
walker.ts:48 uses `statSync`, which follows symlinks, and walker.ts:61 recurses into the target.
P2: a repo containing `src/link -> /some/outside/dir` returns `files: ['src/link/ServerOnly.tsx']`. The indexer reads,
hashes, parses and reports components from files outside the repo. A cloned malicious repo with `link -> /` would make
the job walk the server filesystem and store its paths and symbol names. A symlink to an ancestor directory also makes
the walker recurse until ELOOP. Fix direction: `lstatSync`, and skip symlinks (or report them as skipped). Add a test.

## MEDIUM

### M1 Import resolution escapes the repo root (filesystem existence oracle)
resolver.ts:36-38 and 63-76: `path.join(dirname, spec)` is not confined to the repo. `tryResolve` stats
`join(repoRoot, "../../..")`.
P3: `import x from "../../../../../tmp/fe4-o2-XXX/probe"` returns
`resolved: "../../../../tmp/fe4-o2-XXX/probe.ts"`. A repo author can probe which files exist on the indexing server,
and the output records the paths. tsconfig `paths` targets have the same problem (resolver.ts:44-46). Fix direction:
return null for any normalized candidate that starts with `..` or is absolute.

### M2 AC-004-05: gitignore handling is untested, and anchored patterns over-match
- The AC-004-05 test (indexer.test.ts:95-109) never asserts the `gitignored` reason. The fixture's `secret.txt` is
  listed in .gitignore, but nothing checks it. `node_modules`/`.next` are caught by `EXCLUDED_DIRS` before gitignore
  runs, so the gitignore part of the criterion has no test.
- walker.ts:111 strips the leading `/` of anchored patterns. The pattern then has no `/`, so matchGitignore
  (walker.ts:127-129) matches it against every path segment.
  P6: `.gitignore` containing `/config.ts` also skips `src/config.ts` (`{"path":"src/config.ts","reason":"gitignored"}`).
  Real source files silently disappear from the index.
- Only the root .gitignore is read (walker.ts:92-99). Nested .gitignore files are ignored (no probe; reading the code).

### M3 Common component shapes are not detected ("every React component", AC-004-01)
parser.ts:54-72 and 98-124 only recognise a function or arrow whose return is directly a JSX element, fragment or
parenthesised JSX.
P4: `return on ? <b/> : <i/>` (a ternary), `forwardRef((p, ref) => <input/>)` and
`memo(function Row() { return <tr/> })` all return `components: []`. The fixture contains none of these, so
AC-004-01 passes on the fixture, but the indexer misses everyday components (conditional renders,
forwardRef/memo-wrapped design-system components). It also misses `export default function () {...}` and class
components (reading the code). The test only checks that six names are present. It never checks for an exact set, so
it would not catch false positives either.

### M4 Imports: re-exports and dynamic imports are dropped, and alias imports are flagged external (AC-004-03)
- parser.ts:25-44 handles only `ImportDeclaration` and `require()`.
  P5: `export { b } from "./B"` and `import("./B")` give `imports: []`. Barrel files (`components/index.ts`) and
  `next/dynamic` imports are invisible, so the import graph is incomplete.
- resolver.ts:108-111 `isExternalSpec` returns true for anything not starting with `.`.
  P7: `@/B`, which resolves to `src/B.ts`, is reported as `external: true`. The AC-004-03 test asserts this wrong
  value (indexer.test.ts:74 `expect(aliasImport?.external).toBe(true)`), so the test locks the bug in. Anything
  downstream that filters `external` will treat the app's own modules as npm packages.

## LOW

- L1 Signature mismatch with the criterion: AC-004-01 says `indexRepo(files)`. The implementation is
  `indexRepo(root: string)` and reads the disk directly (index.ts:16-27, walker.ts, resolver.ts). It works for the
  fixture, but it ties core to a local checkout. The GitHub-webhook path will hand file lists or blobs, not a
  directory. This is a design choice for the human to confirm against the AC wording.
- L2 Routes: `page.js` and `page.ts` are not recognised (routes.ts:8). P6: `src/app/x/page.js` gives `routes: []`.
  Any directory named `app/` anywhere in the tree counts as the app router (routes.ts:3, 11), e.g.
  `src/components/app/page.tsx` → a false route. The `pages/` router is out of scope for the AC.
- L3 Weak assertion: indexer.test.ts:81-82 `if (external) expect(...)`. The home page has no `react` import, so this
  assertion never runs.
- L4 Exports are named in the feature title, but `FileIndex` (types.ts:24-28) has no exported symbols. No AC requires
  them, so this is a note for FEAT-007 and later.
- L5 `IndexResult.root` returns the absolute server path (index.ts:47). Avoid persisting or returning it to clients.
- L6 Tests write `big.ts` and `binary.ts` into the committed fixture directory (indexer.test.ts:13-24). A crashed run
  leaves a 1.4 MB file in tests/fixtures. A temp copy would be safer.
- L7 Unbounded work: there is no cap on the number of files walked or on `skipped[]` size, and each file is read twice
  (looksBinary reads the whole file, walker.ts:148, then index.ts:27). This is fine for the 500-file budget, but worth
  a limit before it runs on arbitrary repos.

## Criteria
- AC-004-01: passes on the fixture; general detection gaps in M3.
- AC-004-02: passes; L2.
- AC-004-03: relative and @/ resolution works; re-exports and dynamic imports are missing, and `external` is wrong (M4).
- AC-004-04: satisfied and tested.
- AC-004-05: size, binary and excluded dirs are tested; gitignore is untested and over-matches (M2).
- AC-004-06: satisfied (~0.3 s for 500 files).
- AC-004-07: NOT satisfied. Raw parameter source text is emitted (H1).

VERDICT: FAIL
