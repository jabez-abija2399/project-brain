# Review FEAT-008: re-check of M1, M2 and L1-L6 (fix commit 05c5bdf)

Scope: the fixes for the earlier review findings in 05c5bdf. Focus areas requested: the storage-cap lock, the rule
that keeps hand-placed files, and the hidden login prompt. Files: packages/core/src/indexer/{walker,index}.ts;
packages/cli/src/{index-command,index,main,prompt,config,api}.ts; apps/web/src/server/{code-index,index-route}.ts;
packages/db/src/repos/{code-index,symbols}.ts; the new tests in index.test.ts, cli.test.ts, bin.test.ts, prompt.test.ts.

Ran this session: `pnpm vitest run src/app/api/index` in apps/web (30 passed), `pnpm vitest run` in packages/cli
(24 passed), `pnpm vitest run src/indexer` in packages/core (14 passed). I also ran one scratch test on the
index.test.ts harness (result below). I deleted it afterwards, and the working tree is unchanged.

## MEDIUM

### N1. A hand-placed file is never deleted, and nothing can remove it later: stale components are served for good
- `packages/db/src/repos/code-index.ts:146`: `removeMissing` skips every file that has a `placed_by = 'user'` link,
  and the skip is permanent. There is no grace period such as "missing in two runs".
- KI-027 says the file stays "until the user unplaces it", but no API can do that. The only user-placement
  operation is the features PATCH move (`packages/db/src/repos/features.ts:103`). It always writes
  `placedBy: "user"`, so moving the file to another feature keeps it protected. The only way to remove the row is to
  delete the project.
- The file's symbols stay too. `symbolsRepo.listComponents` (used by find_similar_component and the context pack)
  keeps returning its components. The file and its symbols also count toward the new storage caps for good.
- Evidence (scratch test, ran): upload `src/A.tsx` and `src/Button.tsx` (component `Button`). Place `src/Button.tsx`
  by hand. Then rename it locally to `src/ui/Button.tsx` and index again: diff with an open range, then upload.
  Results:
  `DIFF {"changed":["src/ui/Button.tsx"],"deleted":[]}`,
  `FILES src/A.tsx,src/Button.tsx,src/ui/Button.tsx`,
  `COMPONENTS Button@src/Button.tsx,Button@src/ui/Button.tsx`.
  An agent asking find_similar_component for "Button" is pointed at a file that no longer exists. The CLI's
  "N deleted" line does not mention the file it kept, so the user is never told.
- The trade-off is recorded, but KI-027's mitigation does not exist, and the effect is worse than LOW: agents are
  given wrong answers for good. The directive asks that hand-placed files are "never deleted because they are missing
  from one run". Two options fit it better:
  (a) A missing hand-placed file is marked missing (or kept for one extra run) and deleted when it is still missing
  on the next index. The CLI reports it either way.
  (b) Keep the current rule, but add an "unplace / remove missing file" action and have the read tools skip files
  marked missing.
  The human decides which. Write a failing test first.

## LOW

- N2. `packages/db/src/repos/code-index.ts:51`: the cap lock uses `SELECT ... FOR UPDATE` on the projects row. Inserts
  into any table with a foreign key to projects take `FOR KEY SHARE` on that row, and `FOR UPDATE` blocks that. One
  example is `feature_files.project_id` (`schema/features.ts:42-44`). So a dashboard PATCH move in the same project
  waits until a 200-file, up to 100k-symbol upload transaction commits. `FOR NO KEY UPDATE` still serializes
  concurrent `saveFiles` calls (they all take the same lock) without blocking foreign-key checks. This is from the code
  only; the delay was not measured.
- N3. Test gap: no test proves the lock actually serializes two uploads. PGlite has a single connection, so the M2
  test is sequential. The read-committed reasoning is sound: the count queries run after the lock is granted, and each
  takes a new snapshot. Still, it is NOT VERIFIED on real Postgres. A two-connection test belongs with the
  real-Postgres CI work.

## Re-checked, resolved
- M1 (unreadable folder): `walker.ts` now records `folder read failed` for a readdir failure and `read failed` for an
  lstat failure. Ignored and excluded folders are skipped before they are pushed onto the stack, so a root-owned
  ignored folder does not stop the index. `index-command.ts` throws before any request when a folder failed, and
  sends no diff ranges when an entry failed. The cli.test.ts M1 test covers this.
- M2 (storage caps): the totals are correct. Re-uploaded files are not counted twice, and the batch's symbols replace
  the old ones (`code-index.ts` repo, the kept-symbols join). Over the cap the request gets 413
  `project_storage_full` and nothing is stored (inside the transaction). The CLI gives a clear message. The
  per-project rate limit closes the multi-token bypass (test AC-008-08 M2). Summarize pages by `symbols.id`, keeps at
  most 40 due and 40 exhausted components, and computes `remaining` correctly (test with page size 7). The per-project
  429 risk on large repos is recorded as KI-028.
- L1 (hidden prompt): `prompt.ts` uses raw mode with no echo. It handles Backspace, and Enter/CR/Ctrl-D finish the
  line. Ctrl-C rejects without raising SIGINT. Raw mode is turned off and stdin paused in every exit path. The prompt
  goes to stderr. Piped stdin still reads everything. Tests check that nothing is echoed and that the terminal is
  restored.
- L2: a relative or empty `XDG_CONFIG_HOME` is ignored (`config.ts`), with a test.
- L3: paths the server cannot store are skipped and named, with control characters JSON-escaped. They were never
  stored, so leaving them out of the diff ranges deletes nothing.
- L4: a `.git` in the home folder or above is ignored and the CLI says so. A `.git` below the home folder still works
  (KI-025 test).
- L5: the rate-limit tests freeze the clock mid-minute.
- L6: there is now an index redirect test (`bin.test.ts:141`).

VERDICT: FAIL
