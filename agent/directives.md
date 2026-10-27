# User directives (the user's standing instructions; the agent appends, never deletes; keep under 40 lines)
# Format: - YYYY-MM-DD: <instruction, verbatim or tight paraphrase>
- 2026-10-23: Trial uses the Next.js-only stack (no separate backend server); switch to the Stage 2 stack only after paying users.
- 2026-10-23: Build the MVP first (P1 features); everything else waits in agent/later.md.
- 2026-10-23: Claude Code and Cursor are the first agents; first target codebases are React/Next.js + Supabase.
- 2026-10-23: Explain what you built in plain language at the end of each session; I review every security-sensitive change.
- 2026-10-23: Dogfood: once the MCP server works (FEAT-011), connect it to the sessions building this project.
- 2026-10-23: No Docker. Use a Supabase dev project for development and PGlite for tests.
- 2026-10-23: Use Neon (not Supabase) for our own database: a 'dev' branch for development; tests stay on PGlite. Supabase remains a supported target stack for users' apps.
- 2026-10-23: Parsing: FEAT-004 uses the TypeScript Compiler API (D-011); FEAT-005 uses a hand-written SQL reader, no libpg-query (D-012).
- 2026-10-24: Token API responses use an allowlist: list and create return only id, createdAt, lastUsedAt, revokedAt (create also returns the plaintext token once); the create response key is `id`, not `tokenId`.
- 2026-10-24: Dependency cooldown is 7 days (minimumReleaseAge 10080, D-013); security fixes may bypass it only with human approval.
- 2026-10-24: FEAT-005 switches from the hand-written SQL reader to libpg-query (supersedes the 2026-10-23 D-012 line); tables and policies keyed by schema.name (default public); per-statement parse errors with file and line.
- 2026-10-25: FEAT-005 replays migrations in file order like Postgres (DROP/ALTER/RENAME TABLE, DROP/ALTER POLICY); policies keep permissive/restrictive (restrictive never counts as allowing everyone); a table touched by an unreadable statement gets RLS state unknown, never enabled.
- 2026-10-26: FEAT-015 adds AC-015-06 (RLS state unknown is reported as 'RLS cannot be confirmed', never safe, never skipped) and AC-015-07 (a restrictive policy never counts as allowing everyone, even with USING (true) / WITH CHECK (true)).
- 2026-10-26: FEAT-005 determines RLS state by executing the migrations in a sandboxed in-memory PGlite with Supabase stand-ins (roles anon/authenticated/service_role; auth.uid()/auth.jwt(); storage.objects; extensions schema), one statement at a time in file order, then reading pg_catalog/pg_policies; a failing statement goes to errors[] and marks the tables it touches unknown (all tables if it cannot tell); 30 s total, memory-limited, no network (D-014). FEAT-005 becomes security_sensitive.
- 2026-10-26: FEAT-005 sandbox lives in a new package packages/sandbox (@brain/sandbox), usable by the CLI; it never imports apps/** or @brain/db*. @electric-sql/pglite becomes a production dependency there. Add criteria for T6 (empty env), T9 (>5,000 tables/policies -> unknown), T10 (error messages cut to 200 chars, secrets masked). Stand-in schemas net, vault, cron, extensions so CREATE EXTENSION pg_net/supabase_vault/pg_cron and similar succeeds; more is an open question. The human runs kit.py import.
- 2026-10-26: FEAT-005 sandbox loads uuid-ossp and pgcrypto from PGlite's bundled extensions so uuid_generate_v4(), gen_random_bytes() and crypt() work (stop and ask if the pinned PGlite does not bundle them); repeat the time-limit, memory-cap and file-access measurements on PGlite 0.5.10 first.
- 2026-10-26: Commit directly to main; do not create feature branches. CI runs on every push to main.
- 2026-10-27: FEAT-006 features get a stable path-derived key separate from the display name, and each file link records whether it was placed automatically or by the user; a re-index finds features by key (no duplicates), keeps user-placed files, freely updates automatic placements. New AC-006-06 (state) via agent/plan.json.
