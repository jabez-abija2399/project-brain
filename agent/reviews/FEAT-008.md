# Review FEAT-008: CLI login + index (whole feature, HEAD 6288ef7)

Scope: the whole feature, not only the last commit in the review pack. Files: packages/cli/src/{index,api,config,
index-command,main}.ts; apps/web/src/server/{code-index,index-route,rate-limit,tokens}.ts and the three
/api/index/[projectId] routes; packages/db/src/repos/{code-index,rate-counters,symbols}.ts, migration 0009; the
component signature builder in packages/core/src/indexer/components.ts and walker.ts; core summarize.ts.
Focus areas requested: no source code in any upload, token storage and handling, cross-project uploads, upload limits,
the shared rate limit, the AI budget, deleted-file and subfolder handling, and the CLI's https and redirect rules.

Ran this session: `pnpm vitest run src/app/api/index` in apps/web (2 files, 25 tests passed) and `pnpm vitest run` in
packages/cli (4 files, 15 tests passed). I also ran two scratch tests built on the cli.test.ts harness (results below).
They were deleted afterwards and the working tree is unchanged.

## MEDIUM

### M1. An unreadable folder counts as deleted: its files, symbols and user-placed feature links are removed
- `packages/core/src/indexer/walker.ts:40-44`: a `readdirSync` failure is swallowed (`continue`), and so is an
  `lstatSync` failure (`:49-53`). The folder's files are missing from `index.files`, with no error and no skip entry.
- `packages/cli/src/index-command.ts:91`: the delete guard (`unreadable`) only looks at file read failures
  (`"read failed"`, core `indexer/index.ts:31`). The CLI still sends diff ranges, and the server deletes every stored
  file in the range that the request does not list (`packages/db/src/repos/code-index.ts:83-105`).
- Deleting a file cascades to `feature_files` (`packages/db/src/schema/features.ts:64-72`). User-placed links
  (FEAT-006, AC-006-06) are gone for good: the next index re-creates the files, but only with automatic placements.
- Evidence (scratch test, ran): index the component-app fixture (6 files), `chmod 000 src/components/ui`, then run
  `index` again. Exit 0, output `Uploaded 0 changed, 4 unchanged, 2 deleted`. `src/components/ui/Button.tsx` and
  `TextInput.tsx` were removed from the server.
- Realistic triggers: a folder owned by root (Docker or Supabase volume folders inside the repo), a transient EACCES,
  or a permission mistake on one folder.
- Suggested fix: the walker records folder and lstat failures in `errors` (or as a separate flag), and the CLI treats
  them like unreadable files (no ranges). Write a failing test first.

### M2. No limit on stored files or symbols per project; summarize reads them all on every request
- Nothing limits a project's total files or symbols. The only limits are per request: 200 files
  (`apps/web/src/server/code-index.ts:65`), 500 symbols per file (`:61`), 5 MB (`:17`), and 60 requests a minute per
  token.
- `symbolsRepo.listComponents` says it is "Bounded by the project's size (v1 budget: 2,000 files)"
  (`packages/db/src/repos/symbols.ts:64`), but nothing enforces that budget.
- `summarizeDue` (`code-index.ts:261`) loads and hashes every component of the project on every summarize request, and
  the CLI makes up to 200 summarize requests per run (`index-command.ts:10`).
- Evidence (scratch test, ran): one token uploaded 15 batches of 200 distinct paths. All got 200 and 3,000 files were
  stored.
- Scenario: a token leaks, for example from a CI secret or a pasted config. With 60 req/min × 200 files, plus up to
  roughly 100k symbol rows per 5 MB request, it can grow the project by millions of rows an hour. Neon storage and
  cost grow, and every summarize request then reads the whole set into memory.
- Multiple tokens per project also multiply the per-token rate limit (`apps/web/src/server/index-route.ts:25`). The
  AI budget is per project, so AI spend stays bounded.
- This goes beyond the written criteria, which only limit each batch. The human decides whether it belongs in
  FEAT-008 or in a known issue. Suggested fix: a per-project file cap (e.g. 2,000, the stated v1 budget) checked in
  `saveIndexBatch` (413 or 422), plus a cap on symbols per batch.

## LOW

- L1. `packages/cli/src/main.ts:7-13`: interactive login reads the token with readline in `terminal: false` mode
  without turning off echo. The pasted token stays visible on screen and in scrollback, so it can leak through screen
  sharing or recordings. Piped stdin and PROJECTBRAIN_TOKEN are fine.
- L2. `packages/cli/src/config.ts:18`: a relative `XDG_CONFIG_HOME` is used as-is, so `config.json` (with the token)
  is written relative to the cwd, which is usually the repo. That breaks AC-008-01. The XDG spec says to ignore
  relative values.
- L3. `walker.ts:47` + `code-index.ts:37-44`: one file whose name contains a backslash or a control character (legal
  on Linux and macOS) makes the server reject the whole diff batch with 400. `index` then fails for the whole repo
  with `The server rejected the request (400 invalid_input).` and does not name the file. The CLI could skip such
  paths locally and report them. (Code evidence only; not run.)
- L4. `packages/cli/src/index-command.ts:40-44`: `repoFolder` uses the nearest `.git` above the folder. A `.git` in a
  parent that is not the app's repo (for example `~/.git` for dotfiles) prefixes every path. The project then gets a
  second copy of every file, and the old root-relative copies are never deleted because they are outside `folder`.
- L5. Test quality: the AC-008-08 test (`apps/web/src/app/api/index/index.test.ts:220`) uses the wall clock with a
  fixed one-minute window (`rate-limit.ts:14`). If its 61 requests cross a minute boundary, the 61st gets 200 and the
  test fails. Inject `now`, or freeze time.
- L6. Test gap: the never-follow-a-redirect test covers `login` only (`packages/cli/src/bin.test.ts:133`). `index`
  uses the same `request()` with `redirect: "error"` (`packages/cli/src/api.ts:47`), so it behaves correctly, but no
  test covers it.

## Checked, no finding
- No source in uploads: the upload and diff schemas are `.strict()` and have no content field. Signatures are built
  from the AST without initializers or literal types, capped at 200 characters (`indexer/components.ts:53-70`), and
  masked in the CLI and again on the server for names and signatures, components and routes (`code-index.ts:206-221`).
  The summarize prompt and output are masked. The AC-008-03 end-to-end test compares every body against every source
  line of 12 or more characters and checks the full key set.
- Tokens: stored hashed (`project-tokens.ts:89-96`), revoked tokens are refused, and the token travels only in the
  Authorization header. Config is 0600 in a 0700 folder, and the mode is re-applied to an existing file. Error
  messages never include the token or a response body. Rate-counter keys hold the token id, never the token.
- Cross-project: `requireTokenProject` returns 404 for a token from another project before anything else runs. Every
  repo query (hashes, saveFiles including the symbol delete, saveSummaries, removeMissing, listComponents join) is
  filtered by projectId.
- Upload limits: Content-Length is checked first, then a streamed byte cap that cancels the reader. More than 200
  files gets 413 before validation, on both upload and diff.
- AI budget: reservation is an atomic upsert, the calls made are at most what was granted (`summarize.ts:153-157`),
  and unused units are given back in `finally`. A killed request keeps its reservation, which errs on the safe side.
- Deleted files and subfolders: ranges use byte order on both sides (`Buffer.compare` / `COLLATE "C"`). The schema
  requires sorted, unique, in-range, in-folder files. The server uses `starts_with` with `folder/`. An empty local
  index never sends a range.
- https and redirects: `isSafeApiUrl` (https, or http only for localhost, 127.0.0.1 or [::1]; WHATWG hostname
  normalizes forms like `0x7f000001` to 127.0.0.1) runs on login and on index before any request. Every request uses
  `redirect: "error"`.

VERDICT: FAIL
