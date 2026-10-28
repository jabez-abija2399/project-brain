# Review FEAT-007: component registry and find_similar_component

Reviewed commit 152583e (the code) and f4d121b (D-015). The review pack's diff covered only f4d121b (docs), so the code
was read from `git show 152583e`. Focus requested: metadata-only prompts, secret masking in summaries, the name
pre-filter and its escaping, the project filter, and LLM calls on an unchanged re-index.

## MEDIUM

### M1. An unchanged re-index calls the LLM again for every component whose summary is null (AC-007-04)
- `packages/core/src/components/summarize.ts:51,53`: a component is reused only if `prev.summary` is non-null; `todo` is
  every component with `summary === null`. `cleanSummary` returns null for an empty answer (line 37), and a failed call
  sets null (line 67). The hash is unchanged, but the component is sent to the LLM again on every index, indefinitely.
- Evidence (scratch vitest probe, run this session, now deleted): a fake client that answers `""`. After the first
  index, three re-indexes of the same unchanged component made `1, 1, 1` LLM calls (expected `0, 0, 0` per AC-007-04).
- Scenario 2: during an API outage or with a bad key, every component fails. Each later unchanged re-index sends all
  components again. There is no backoff and no stop after repeated errors: 2,000 components x 20 s timeout / 4 workers
  is up to about 2.8 h per index, and every failed attempt costs a call. Failures also skip `options.log`
  (`llm.ts:66`), so the cost log never shows them.
- The AC-007-04 test (`components.test.ts:85`) only covers the case where all summaries succeeded, so it does not
  catch this.
- Suggested direction (human decision): store that a summary was attempted for a hash (for example hash plus a
  failed/empty marker) and retry only on a limited schedule. Stop the batch after N consecutive errors.

## LOW

### L1. The name pre-filter keeps only the first 20 query tokens; scoring uses all of them
- `packages/db/src/repos/symbols.ts:69` slices to `MAX_NAME_TOKENS = 20`. `similar.ts:94` scores with every token,
  up to 200 chars. With a query of 25 tokens, a component whose name shares 5 of tokens 21-25 and whose path matches
  the rest scores `0.8*5/25 + 0.2 = 0.36 >= 0.3`. The pre-filter drops it before scoring. Unlikely for real queries;
  cap both sides at the same token count (`similarNameFilter` is a good place).

### L2. `LlmOptions.maxTokens` is accepted but never used
- `packages/core/src/llm.ts:33` declares it. `llm.ts:60` always caps at `DEFAULT_MAX_TOKENS`. A caller passing
  `createLlm(client, { maxTokens: 50 })` still gets up to 300 tokens. Either use it or remove it.

### L3. No test pins secret masking in the summary path
- `summarize.ts:32,36` masks the prompt and the answer (verified by probe: path `src/ghp_ABCD...` became `ghp_***`.
  The answer `sk-ant-ABCD... password=hunter22` became `sk-a*** password=hunt***`). No FEAT-007 test asserts this, so
  removing either `maskSecretsIn` call would still pass the tests. Add one test with a secret-shaped path and answer.

## Checked, no finding
- Metadata-only prompts: the prompt is name + path + signature (`summarize.ts:32`). The signature comes from the AST
  with initializers dropped and string/number/template literal types replaced by keywords
  (`indexer/components.ts:53,72-120`). No body text. The test asserts body markers are absent (`components.test.ts:62`).
  The cost log carries only model/tokens/ms/purpose (`llm.test.ts:45`). Errors are swallowed without logging the
  prompt.
- Name filter escaping: the value is bound as a parameter through drizzle `ilike`. `likePattern` escapes `\ % _`, which
  matches Postgres' default LIKE escape (backslash). Tokens are `[a-z0-9]` only anyway. `["%"]` returns `[]`
  (`symbols.test.ts:290`). An empty token list returns `[]` without a query. Stemming only shortens tokens, so a name
  that matches in TS also matches the ILIKE substring.
- Project filter: `listComponents` filters `symbols.project_id`. The join also requires
  `files.project_id = symbols.project_id` (`symbols.ts:85`), and a composite FK backs it. A cross-project test exists
  (`apps/web/src/server/components.test.ts:218`). `findSimilarComponents` takes the projectId from its caller. No
  route or MCP tool is wired yet (FEAT-011), so `requireProjectAccess` at the entry point is still to be checked there.
- Read path makes no LLM call: `apps/web/src/server/components.ts` is a DB read plus lexical scoring. Indexes
  `(project_id, kind, name)` and `(project_id)` exist.
- AC-007-02/03/05 tests have exact expectations (top match, `[]` below the threshold with a non-empty closest
  candidate, p95 over 40 runs mixing a rare and a common query). `kit.py dupes`: 0 repeated blocks.

## Not verified
- No real Claude API call (fake clients only). Nothing persists summaries or hashes from an index yet (FEAT-008), so
  AC-007-04 holds only at the `summarizeComponents` unit level. p95 was measured on PGlite, not Neon.

VERDICT: FAIL
