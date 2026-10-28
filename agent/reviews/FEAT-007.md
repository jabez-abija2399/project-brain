# Review FEAT-007: re-check of M1 and L1-L3 against 61d29dd

Scope: the fix commit 61d29dd only (`git show 61d29dd -- packages/`), checked against the findings of the previous
review (commit 152583e, still in git history at `git show 61d29dd:agent/reviews/FEAT-007.md`). Ran this session:
`pnpm vitest run packages/core/src/components packages/core/src/llm.test.ts packages/db/src/repos/symbols.test.ts
apps/web/src/server/components.test.ts`: 4 files, 17 tests passed. Plus scratch probes (deleted afterwards; the
working tree is unchanged).

## Previous findings

### M1 (unchanged re-index re-sends null summaries): RESOLVED
- `summarize.ts:67-75` `isDue`: `ok` and `empty` are never re-sent for the same hash. `error` is retried only when
  `summaryAttempts < 3` and at least 24 h have passed. `null` (never attempted, or a row from before 0008 with no
  summary) is sent once.
- `summarize.ts:89`: a changed hash resets the state to not attempted. A legacy row with a summary is treated as `ok`
  (line 94).
- `summarize.ts:105`: the batch stops after 5 errors in a row. Counting calls in flight means an outage makes exactly
  5 calls, not 5 + 3 already in flight. Components that were never started keep `summaryStatus: null` and are tried on
  the next index, so each index costs at most 5 calls during an outage.
- `llm.ts:73`: a failed call is logged with model, purpose and error class name only. `errorType` accepts only an
  identifier-shaped `err.name`, so a message containing the prompt or a key cannot reach the log.
- Migration 0008 adds only a status (CHECK-constrained), a counter and a timestamp: no code or prompt. The schema and
  `listComponents` expose the new columns. `insertMany` passes the rows through.
- Tests have exact expectations and would have failed before the fix: an empty answer followed by 3 re-indexes is 1
  call in total (`components.test.ts:146`); the retry schedule at 23 h / 24 h / 48 h / 30 days, and a reset on a new
  hash (`:159`); an outage over 40 components is 5 calls, 5 errors, 35 not attempted, and 5 log entries without the key
  (`:183`); a success breaks the streak (`:207`).

### L1 (pre-filter used 20 tokens, scoring used all): RESOLVED
- `similar.ts:58-60` `queryTokens` caps at 20 and is used by both `similarNameFilter` and `findSimilarComponent`.
  `apps/web/src/server/components.ts:21` passes `similarNameFilter` to the repo, whose own `MAX_NAME_TOKENS = 20` cap is
  then a no-op. The test at `components.test.ts:250` uses the 25-token case from the previous review.
- Note: the number 20 is defined twice (`similar.ts` MAX_QUERY_TOKENS and `symbols.ts` MAX_NAME_TOKENS). A comment
  links them, but there is no shared constant: packages/db cannot import from core.

### L2 (`LlmOptions.maxTokens` ignored): RESOLVED
- `llm.ts:57,66`: the per-request value is capped by `options.maxTokens`, which is capped at 300. Test
  `llm.test.ts:56` checks `[50, 50, 20]`.

### L3 (no test pins secret masking): RESOLVED
- `components.test.ts:219` puts secrets in the path (`ghp_`), the signature (`AKIA`) and the answer (`sk-ant-`,
  `password=`), and asserts the masked prompt and the exact masked summary. Removing either `maskSecretsIn` call fails
  it.

## New findings

### LOW

#### N1. Workers that stop during a short error streak never restart, so the rest of the batch runs with fewer workers
- `summarize.ts:105`: a worker leaves its `while` loop when `errorsInARow + inFlight >= 5`. That loop is the only
  place it runs, so a worker that leaves never comes back, even after a later success resets `errorsInARow` to 0. Only
  the last worker needs a real 5-error streak to stop, so the batch still finishes; it just runs with fewer workers.
- Evidence (scratch probe, 40 components, fake 5 ms calls, 4 workers): the highest concurrency after call 10 was
  4 with no errors, 3 when calls 2 and 3 failed, and 2 when calls 2, 3 and 4 failed. All 40 calls were made in each
  case.
- Scenario: a short rate-limit burst at the start of a 2,000-component index (3 errors in a row) leaves 2 workers for
  the rest of the batch, which roughly doubles the index time. With 4 errors in a row it is 1 worker, about 4x the time.
- Suggested direction: keep the workers running and test the stop condition as a shared flag. Or `continue` (wait)
  instead of `break` while `errorsInARow + inFlight >= 5` and calls are still in flight. Then add a test that checks
  concurrency after a broken streak.

## For the human (by design, no finding)
- During an outage longer than about 3 days (for example a wrong API key over a weekend), every component that is tried
  uses up its 3 attempts. After that it stays without a summary until its signature changes. This follows the
  2026-10-28 directive (max 3 attempts per hash). A way to reset attempts (for example after the key is fixed) may be
  wanted later.
- `summaryAttemptedAt` comes from the caller's `now`. Once FEAT-008 runs this in the CLI, it will be the user's clock.
  A server-side write should set it, or clamp it, before the 24 h schedule relies on it.

## Not verified
- No real Claude API call. Nothing loads `PreviousSummaries` from the DB or writes the new columns from an index yet
  (KI-022, FEAT-008), so M1 is fixed at the `summarizeComponents` unit level only. I did not run the full
  `verify.sh`.

VERDICT: PASS
