# Build checklist

Check every feature against these rules before marking it done, and write an attacker test for each rule that
applies (test names carry the criterion id and the word "attack"). Each rule names a real miss from our past reviews.

1. **Every query and route is scoped by project, tested with a second project.**
   Example: KI-003, `feature_files` and `checklist_items` had no `project_id`, so the database could not stop a
   link between a feature and a file of another project. FEAT-008 M2 found the same gap at the route level: the index
   rate limit counted only per token, so each extra token multiplied it. Tests now create project B and check that
   A's token, IDs and limits never reach B.

2. **Fail closed: when unsure, the answer is "unknown" or a refusal, never "safe".**
   Example: FEAT-005 (KI-010/KI-011) reported a table as protected when an unreadable statement or an ignored
   `ALTER POLICY ... USING (true)` had changed it. Now a table touched by an unreadable statement gets RLS state
   unknown, never enabled (AC-015-06), and a restrictive policy never counts as allowing everyone (AC-015-07).

3. **Secrets are masked in output, errors, logs and AI prompts.**
   Example: the FEAT-007 review found secret masking tested only in signatures, not in paths, error messages or the
   AI's answer; FEAT-005 T10 cuts sandbox error messages to 200 characters and masks secrets in them. The CLI never
   prints the token or a response body (AC-008-11).
   Fake secrets in tests are built at runtime (for example `"sk_" + "live_" + "x".repeat(24)`), never written as
   literals: secret scanners (gitleaks in CI) flag a secret-shaped literal even in a test file.
   Invisible and bidirectional characters in tests (U+200B-U+200F, U+202A-U+202E, U+2066-U+2069) are written as
   `\u` escapes (`\u202E`), never raw: semgrep blocks raw ones, and reviewers cannot see them.

4. **Every input, list, loop and AI call has a cap.**
   Example: FEAT-008 M2 and KI-023, where nothing limited stored files or symbols per project or AI calls per day.
   A leaked token could fill the database and spend the AI budget. Now there are 10,000 files and 100,000 symbols
   per project (413 above that), 2,000 AI calls a day, 40 calls per summarize request, and summarize reads in pages.
   FEAT-005 T9: more than 5,000 tables or policies means unknown.

5. **Test with realistic real-world inputs, not only tidy fixtures.**
   Example: KI-017, where route groups like `(dashboard)` swallowed every route and Vite/Lovable apps collapsed into
   'other', because the fixtures were tidy Next.js apps. FEAT-008 L3: legal Linux file names with a backslash or a
   newline failed the whole index. Fixtures now include these layouts and names.

6. **User choices survive re-runs and re-indexes.**
   Example: FEAT-006 and KI-027, where a re-index could re-create features under new names and drop files the user
   had placed by hand. Features now have a stable path-derived key, placements are marked automatic or by the user,
   and a renamed hand-placed file keeps its placement.

7. **Concurrent requests cannot break limits or duplicate data.**
   Example: KI-018, where two saveMap runs at once could insert the same feature key. KI-023: an in-memory rate
   limit per server instance did not hold across instances. Now the limits live in Postgres counters, the daily AI
   budget is reserved atomically, and the storage-cap check takes a per-project advisory lock.

8. **No tests that depend on timing or machine load.**
   Example: KI-016, where sandbox tests failed under load (time limit hit, scan cut short). The FEAT-008 rate-limit
   tests straddled a minute boundary until they got an injected clock (L5). KI-028's retry tests inject `sleep`
   instead of waiting, and the bin tests that spawn node get a 30 s limit instead of the 5 s default.
